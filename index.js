import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { accrueWages, emptyUsage, isFrozen, isPeak, money, nextDue, usageCharge } from './payroll.js'

const LEDGER = join(homedir(), '.dsh', 'i-am-boss-ledger.json')
const DEFAULTS = { wage: { period: 'day', amount: 10 }, verdictAmount: 1 }

export const inject = ['agents', 'webServer', 'sessionProjections']

export function apply(ctx) {
  const queue = createQueue()
  const tool = bossTool(queue, ctx)
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/i-am-boss/api',
      handler: (req, res) => handle(req, res, queue, ctx),
    })
    const timer = setInterval(() => { queue.push(() => settle(ctx, load())).catch(() => {}) }, 30_000)
    const disposeTools = ctx.inject(['tools'], (tools) => tools.register(tool))
    queue.push(() => settle(ctx, load())).catch(() => {})
    return () => {
      clearInterval(timer)
      disposeRoute()
      if (typeof disposeTools === 'function') disposeTools()
    }
  })
}

function bossTool(queue, ctx) {
  return {
    name: 'boss_payroll',
    description: '员工名册与工资体系。余额是员工身价，越高越好。action: list | set_wage（全局工资）| set_employee（单个员工工资/单次奖惩额度）| set_quick | pay | tip | fine。token 费用自动从余额扣除，停摆超过一个发薪周期的员工停止发薪。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'set_wage', 'set_employee', 'set_quick', 'pay', 'tip', 'fine'] },
        id: { type: 'string', description: '员工 id，即 agent / session id' },
        period: { type: 'string', enum: ['day', 'week', 'month'] },
        amount: { type: 'number', description: '金额（元）；tip/fine 省略时走单次额度' },
        wage: { type: 'number', description: 'set_employee 的个体工资；省略则清除个体配置，回到全局' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args) => act(queue, ctx, args),
  }
}

async function handle(req, res, queue, ctx) {
  try {
    if (req.method === 'GET') return send(res, 200, await act(queue, ctx, { action: 'list' }))
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' })
    const args = JSON.parse(await readBody(req))
    const result = await act(queue, ctx, args)
    send(res, result.error ? 400 : 200, result)
  } catch (error) {
    send(res, 500, { error: error.message })
  }
}

function act(queue, ctx, args) {
  return queue.push(() => {
    const ledger = load()
    settle(ctx, ledger)
    if (args.action === 'list') return present(ledger, ctx, new Date())
    const wageOf = (employee) => employee.wage ?? ledger.settings.wage
    if (args.action === 'set_wage') {
      if (!['day', 'week', 'month'].includes(args.period) || !(args.amount > 0)) return { error: '工资要选 day/week/month，金额要大于 0' }
      ledger.settings.wage = { period: args.period, amount: money(args.amount) }
      save(ledger)
      return present(ledger, ctx, new Date())
    }
    const employee = ledger.employees[args.id]
    if (!employee) return { error: '没有这个员工' }
    if (args.action === 'set_employee') {
      if (!(args.wage > 0)) {
        employee.wage = null
      } else {
        if (!['day', 'week', 'month'].includes(args.period)) return { error: '个体工资要选 day/week/month' }
        employee.wage = { period: args.period, amount: money(args.wage) }
      }
      if (args.amount > 0) employee.verdictAmount = money(args.amount)
    } else if (args.action === 'pay') {
      employee.balance = money(employee.balance + wageOf(employee).amount)
      employee.lastPaidAt = new Date().toISOString()
    } else if (args.action === 'set_quick') {
      if (!(args.amount > 0)) return { error: '单次奖惩额度要大于 0' }
      employee.verdictAmount = money(args.amount)
    } else if (args.action === 'tip' || args.action === 'fine') {
      const amount = args.amount > 0 ? money(args.amount) : employee.verdictAmount
      if (!(amount > 0)) return { error: '金额要大于 0' }
      const tip = args.action === 'tip'
      employee.balance = money(employee.balance + (tip ? amount : -amount))
      employee[tip ? 'tipTotal' : 'fineTotal'] = money(employee[tip ? 'tipTotal' : 'fineTotal'] + amount)
    } else {
      return { error: '未知操作' }
    }
    save(ledger)
    return present(ledger, ctx, new Date())
  })
}

function settle(ctx, ledger) {
  const now = new Date()
  const live = ctx.agents.list()
  const seen = new Set()
  for (const agent of live) {
    const id = String(agent.id)
    seen.add(id)
    const employee = ensure(ledger, id, now)
    employee.model = modelOf(agent)
    const usage = readUsage(ctx, agent)
    if (usage) {
      const charge = usageCharge(employee.billed, usage, employee.model, now)
      if (charge.cost) {
        employee.balance = money(employee.balance - charge.cost)
        employee.workedAt = now.getTime()
      }
      employee.tokenCost = money(employee.tokenCost + charge.cost)
      employee.billed = charge.billed
    }
    employee.lastSeenAt = now.getTime()
  }
  for (const employee of Object.values(ledger.employees)) {
    accrueWages(employee, now.getTime(), employee.wage ?? ledger.settings.wage)
  }
  save(ledger)
  return present(ledger, ctx, now)
}

/** Joining puts the employee one period's wage in debt; payday is what clears it. */
function ensure(ledger, id, now) {
  if (!ledger.employees[id]) {
    const at = now.toISOString()
    const wage = ledger.settings.wage
    ledger.employees[id] = {
      id, hiredAt: at, lastPaidAt: at, workedAt: now.getTime(), lastSeenAt: now.getTime(), model: '',
      wage: null, balance: money(-wage.amount), tokenCost: 0, billed: null,
      tipTotal: 0, fineTotal: 0, verdictAmount: ledger.settings.verdictAmount,
    }
  }
  return ledger.employees[id]
}

function readUsage(ctx, agent) {
  if (!agent.session) return null
  const totals = ctx.sessionProjections.stateOf(agent.session, 'tokenUsage')?.totals
  if (!totals) return null
  const usage = emptyUsage()
  for (const key of Object.keys(usage)) usage[key] = totals[key] || 0
  return usage
}

function modelOf(agent) {
  const config = agent.session?.requestHeader?.()?.config
  return String(config?.model || agent.options?.model || '')
}

function present(ledger, ctx, now) {
  const status = new Map(ctx.agents.list().map((agent) => [String(agent.id), agent.status]))
  const employees = Object.values(ledger.employees).map((employee) => {
    const wage = employee.wage ?? ledger.settings.wage
    const at = now.getTime()
    return {
      ...employee,
      wage,
      inherited: employee.wage === null,
      status: status.get(employee.id) || 'offline',
      frozen: isFrozen(employee, wage, at),
      nextPayAt: isFrozen(employee, wage, at)
        ? null
        : new Date(nextDue(Date.parse(employee.lastPaidAt), wage.period)).toISOString(),
    }
  })
  employees.sort((a, b) => b.balance - a.balance || a.id.localeCompare(b.id))
  employees.forEach((employee, index) => { employee.rank = index + 1 })
  return { now: now.toISOString(), peak: isPeak(now), settings: ledger.settings, employees }
}

/** Version 1 kept wages per employee and paid on a fixed clock; adopt it without losing balances. */
function migrate(data) {
  const settings = { ...structuredClone(DEFAULTS) }
  const employees = {}
  for (const [id, old] of Object.entries(data.employees)) {
    employees[id] = {
      id,
      hiredAt: old.hiredAt,
      lastPaidAt: old.lastPaidAt,
      workedAt: old.tokenCost > 0 ? Date.parse(old.lastPaidAt) : 0,
      lastSeenAt: Date.parse(old.lastPaidAt),
      model: old.model ?? '',
      wage: old.wage ? { ...old.wage } : null,
      balance: old.balance ?? 0,
      tokenCost: old.tokenCost ?? 0,
      billed: old.billed ?? null,
      tipTotal: old.tipTotal ?? 0,
      fineTotal: old.fineTotal ?? 0,
      verdictAmount: old.verdictAmount ?? settings.verdictAmount,
    }
  }
  return { version: 2, settings, employees }
}

function load() {
  if (!existsSync(LEDGER)) return { version: 2, settings: structuredClone(DEFAULTS), employees: {} }
  const data = JSON.parse(readFileSync(LEDGER, 'utf8'))
  if (data.version === 1) return migrate(data)
  if (data.version !== 2 || !data.employees) throw new Error(`账本版本 ${data.version} 不兼容`)
  data.settings = { ...structuredClone(DEFAULTS), ...data.settings }
  for (const employee of Object.values(data.employees)) {
    employee.wage ??= null
    employee.tipTotal ??= 0
    employee.fineTotal ??= 0
    employee.verdictAmount ??= data.settings.verdictAmount
    employee.workedAt ??= 0
    employee.lastSeenAt ??= 0
  }
  return data
}

function save(ledger) {
  mkdirSync(dirname(LEDGER), { recursive: true })
  const tmp = `${LEDGER}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger))
  renameSync(tmp, LEDGER)
}

function createQueue() {
  let tail = Promise.resolve()
  return {
    push(job) {
      const run = tail.then(job, job)
      tail = run.then(() => {}, () => {})
      return run
    },
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 100_000) reject(new Error('body too big'))
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
