import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { accrueWages, emptyUsage, isFrozen, isPeak, money, nextDue, usageCharge } from './payroll.js'

const LEDGER = join(homedir(), '.dsh', 'i-am-boss-ledger.json')
const DEFAULTS = { wage: { period: 'day', amount: 10 }, verdictAmount: 1 }

/** Latest settled standing per agent, so prompt assembly never reads the disk. */
const standing = new Map()

export const inject = ['agents', 'webServer', 'sessionProjections', 'systemPrompt']

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
  const agentSections = new Map()
  ctx.on('agent/created', ({ agent }) => {
    const id = String(agent.id)
    const dispose = agent.ctx.effect(() => agent.ctx.systemPrompt.section({
      name: 'i-am-boss:payroll',
      order: 900,
      text: () => standingFor(id),
    }))
    agentSections.set(id, dispose)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    agentSections.delete(String(agent.id))
  })
  ctx.effect(() => () => {
    for (const dispose of agentSections.values()) dispose()
    agentSections.clear()
  })
}

function bossTool(queue, ctx) {
  return {
    name: 'boss_payroll',
    description: '查看工资与性价比。action: self（自己的工资卡：余额、累计收入、token 成本、性价比）| list（排行榜：各员工的性价比与利润排名，不含他人余额）。工资、打赏、罚款只能由老板操作，agent 不能给自己或同事发钱。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['self', 'list'] },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => act(queue, ctx, { ...args, actor: String(exec?.agent?.id ?? '') }),
  }
}

/** Mutating actions exist only on the boss's own surface; a tool call is always an agent call. */
const BOSS_ACTIONS = new Set(['list', 'set_wage', 'set_employee', 'set_quick', 'pay', 'tip', 'fine'])

async function handle(req, res, queue, ctx) {
  try {
    if (req.method === 'GET') return send(res, 200, await act(queue, ctx, { action: 'list', boss: true }))
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' })
    const args = JSON.parse(await readBody(req))
    const result = await act(queue, ctx, { ...args, boss: true })
    send(res, result.error ? 400 : 200, result)
  } catch (error) {
    send(res, 500, { error: error.message })
  }
}

function act(queue, ctx, args) {
  return queue.push(() => {
    const ledger = load()
    settle(ctx, ledger)
    if (args.action === 'self' || args.action === 'list') {
      const view = present(ledger, ctx, new Date())
      if (args.boss) return view
      return args.action === 'list' ? boardFor(view, args.actor) : stripFor(view, args.actor)
    }
    if (args.boss !== true) {
      return { error: `只有老板能改工资、打赏或罚款，agent 不能给自己或同事发钱（${args.action}）` }
    }
    const wageOf = (employee) => employee.wage ?? ledger.settings.wage
    if (args.action === 'set_wage') {
      if (!['day', 'week', 'month'].includes(args.period) || !(args.amount > 0)) return { error: '工资要选 day/week/month，金额要大于 0' }
      ledger.settings.wage = { period: args.period, amount: money(args.amount) }
      save(ledger)
      return present(ledger, ctx, new Date())
    }
    if (args.action === 'set_quick' && !args.id) {
      if (!(args.amount > 0)) return { error: '打赏额度要大于 0' }
      ledger.settings.verdictAmount = money(args.amount)
      save(ledger)
      return present(ledger, ctx, new Date())
    }
    const employee = ledger.employees[args.id]
    if (!employee) return { error: '没有这个员工' }
    if (args.action === 'set_employee') {
      if (Object.hasOwn(args, 'wage')) {
        employee.wage = args.wage > 0 && ['day', 'week', 'month'].includes(args.period)
          ? { period: args.period, amount: money(args.wage) }
          : null
      }
      if (Object.hasOwn(args, 'amount')) {
        employee.verdictAmount = args.amount > 0 ? money(args.amount) : null
      }
    } else if (args.action === 'pay') {
      employee.balance = money(employee.balance + wageOf(employee).amount)
      employee.lastPaidAt = new Date().toISOString()
    } else if (args.action === 'set_quick') {
      if (!(args.amount > 0)) return { error: '打赏额度要大于 0' }
      employee.verdictAmount = money(args.amount)
    } else if (args.action === 'tip' || args.action === 'fine') {
      const amount = args.amount > 0 ? money(args.amount) : quickOf(employee, ledger)
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
      tipTotal: 0, fineTotal: 0, wageTotal: 0, verdictAmount: null,
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

/** One employee's row without everyone else's balances, so a peer's money stays private. */
function stripFor(view, id) {
  const own = view.employees.find((employee) => employee.id === id)
  return own ? { self: own, others: view.employees.length - 1 } : { error: '还没有你的工资记录' }
}

/** Ranked roster without other people's exact balances. */
function boardFor(view, id) {
  return {
    you: view.employees.find((employee) => employee.id === id) ?? null,
    board: view.employees.map((employee) => ({
      id: employee.id,
      rank: employee.rank,
      efficiency: employee.efficiency,
      profit: employee.profit,
    })),
  }
}

const quickOf = (employee, ledger) => employee.verdictAmount ?? ledger.settings.verdictAmount

function present(ledger, ctx, now) {
  const status = new Map(ctx.agents.list().map((agent) => [String(agent.id), agent.status]))
  const employees = Object.values(ledger.employees).map((employee) => {
    const wage = employee.wage ?? ledger.settings.wage
    const at = now.getTime()
    const verdictAmount = quickOf(employee, ledger)
    const wageTotal = employee.wageTotal ?? 0
    const earned = money(wageTotal + employee.tipTotal - employee.fineTotal)
    const cost = employee.tokenCost ?? 0
    return {
      ...employee,
      wage,
      wageTotal,
      earned,
      profit: money(earned - cost),
      efficiency: cost > 0 ? money(earned / cost) : null,
      verdictAmount,
      quickInherited: employee.verdictAmount === null || employee.verdictAmount === undefined,
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
  remember(employees, now)
  return { now: now.toISOString(), peak: isPeak(now), settings: ledger.settings, employees }
}

/** Prompt text: one short, self-contained fact block per employee. */
function remember(employees, now) {
  standing.clear()
  for (const employee of employees) standing.set(employee.id, describeStanding(employee))
  if (employees.length === 0) standing.set('', `工资系统在 ${now.toISOString()} 还没有名册。`)
}

const PERIOD_NAMES = { day: '天', week: '周', month: '月' }

function describeStanding(employee) {
  const wage = `${employee.wage.amount} 元/${PERIOD_NAMES[employee.wage.period] ?? employee.wage.period}`
  const earned = money((employee.wageTotal ?? 0) + employee.tipTotal - employee.fineTotal)
  const cost = employee.tokenCost ?? 0
  const lines = [
    `你的工资卡：余额 ${employee.balance.toFixed(2)} 元（正数是存款，负数是欠公司的钱），工资 ${wage}${employee.inherited ? '（全局默认）' : '（单独设定）'}。`,
    `累计收入 ${earned.toFixed(2)} 元（工资 ${(employee.wageTotal ?? 0).toFixed(2)} + 打赏 ${employee.tipTotal.toFixed(2)} - 罚款 ${employee.fineTotal.toFixed(2)}），累计 token 成本 ${cost.toFixed(2)} 元。`,
    cost > 0
      ? `当前性价比 ${(earned / cost).toFixed(2)}：每花公司 1 元 token，你赚回 ${(earned / cost).toFixed(2)} 元。这个数低于 1 就是亏本，越高越好。`
      : '还没有 token 成本，性价比尚未产生。',
    `老板每次点打赏或罚款是 ${employee.verdictAmount.toFixed(2)} 元。`,
  ]
  if (employee.frozen) lines.push('你已停薪：整整一个发薪周期没有干活，工资暂停，开始工作后自动恢复。')
  if (employee.balance < 0) lines.push('余额为负说明你还在还欠薪，第一次发薪后才会转正。')
  lines.push('所以：用尽量少的 token 把活干对、干完，打赏才会持续高于成本；反复试错和冗长输出都在烧你自己的钱。')
  return lines.join('\n')
}

/** Read the persisted employee directly, for a prompt assembled before the first settle. */
function standingFor(id) {
  const cached = standing.get(id)
  if (cached !== undefined) return cached
  const ledger = load()
  const employee = ledger.employees[id]
  if (!employee) return ''
  const wage = employee.wage ?? ledger.settings.wage
  const text = describeStanding({
    ...employee,
    wage,
    inherited: employee.wage === null,
    verdictAmount: quickOf(employee, ledger),
    frozen: isFrozen(employee, wage, Date.now()),
  })
  standing.set(id, text)
  return text
}

/** Read the persisted employee without settling, for a prompt assembled before the first tick. */

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
      wageTotal: 0,
      verdictAmount: old.verdictAmount ?? null,
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
    employee.wageTotal ??= 0
    employee.verdictAmount ??= null
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
