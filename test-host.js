/** Host-level check: fake ctx, then drive /i-am-boss/api through the handler. */
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'boss-'))
mkdirSync(join(home, '.dsh'), { recursive: true })
process.env.HOME = home
const LEDGER_PATH = join(home, '.dsh/i-am-boss-ledger.json')
const { apply } = await import('./index.js')

const agents = []
const routes = new Map()
const cleanups = []
const handlers = []
const tools = new Map()
const ctx = {
  effect(fn) { cleanups.push(fn()) },
  on(event, handler) { handlers.push([event, handler]) },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  inject(name, fn) {
    if (name.includes('tools')) return fn({ register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } })
    return () => {}
  },
  agents: { list: () => agents },
  sessionProjections: { stateOf: (session, key) => session.usage?.[key] },
}

apply(ctx)
const route = routes.get('/i-am-boss/api')
const server = createServer((req, res) => route.handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/i-am-boss/api`

const call = async (body) => {
  const res = await fetch(base, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {})
  return { status: res.status, body: await res.json() }
}

const toolCall = async (body, exec) => {
  const registered = tools.get('boss_payroll')
  return registered.execute({ ...body }, exec)
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

agents.push({ id: 'a1', status: 'idle', options: { model: 'deepseek-flash' } })
let out = await call()
assert(out.body.employees.length === 1, 'hired')
let emp = out.body.employees[0]
assert(emp.balance === 10, `starts with the configured opening balance, got ${emp.balance}`)
assert(emp.wage.amount === 10 && emp.wage.period === 'day', 'inherits default wage')
assert(emp.inherited === true, 'marked inherited')

out = await call({ action: 'set_wage', period: 'week', amount: 70 })
assert(out.body.employees[0].wage.amount === 70, 'global wage applies to inherited employee')

out = await call({ action: 'set_employee', id: 'a1', period: 'day', wage: 3 })
emp = out.body.employees[0]
assert(emp.wage.amount === 3 && emp.inherited === false, 'employee wage wins over default')

out = await call({ action: 'set_employee', id: 'a1', wage: 0 })
emp = out.body.employees[0]
assert(emp.wage.amount === 70 && emp.inherited === true, 'dropping the override restores the default')

out = await call({ action: 'tip', id: 'a1', amount: 5 })
assert(out.body.employees[0].balance === 15, 'tip credits')
out = await call({ action: 'fine', id: 'a1', amount: 2 })
assert(out.body.employees[0].balance === 13, 'fine debits')
assert(out.body.employees[0].tipTotal === 5 && out.body.employees[0].fineTotal === 2, 'totals')

const bad = await call({ action: 'set_wage', period: 'year', amount: 1 })
assert(bad.status === 400, 'bad period rejected')
const missing = await call({ action: 'tip', id: 'nope' })
assert(missing.status === 400, 'unknown employee rejected')

// The opening balance is configurable and credited once, when the employee joins.
const first = await call({ action: 'set_starting', amount: 25 })
assert(first.body.settings.startingBalance === 25, 'starting balance saved')
agents.push({ id: 'fresh', status: 'idle', options: { model: 'deepseek-flash' } })
out = await call()
const hire = out.body.employees.find((employee) => employee.id === 'fresh')
assert(hire.balance === 25, `a new employee joins with the configured balance, got ${hire.balance}`)
const negative = await call({ action: 'set_starting', amount: -5 })
assert(negative.status === 400, 'a negative opening balance is rejected')
// Prompt awareness: one section per agent, scoped, reading the latest standing.
const sections = new Map()
const fakeAgent = (id) => ({
  id, status: 'idle', options: { model: 'deepseek-flash' },
  ctx: {
    effect(fn) { return fn() },
    systemPrompt: { section(section) { sections.set(id, section); return () => sections.delete(id) } },
  },
})
agents.push({ id: 'prompted', status: 'running', options: { model: 'deepseek-flash' } })
await call()
const created = handlers.find(([event]) => event === 'agent/created')[1]
created({ agent: fakeAgent('prompted') })
assert(sections.has('prompted'), 'agent gets its own prompt section')
let prompt = sections.get('prompted').text()
assert(prompt.includes('余额'), 'standing mentions the balance')
assert(prompt.includes('70 元/周'), 'standing mentions the inherited wage')
assert(prompt.includes('打赏或罚款是'), 'standing mentions the tip amount')
assert(!prompt.includes('停薪'), 'a fresh hire is not paused')

const balanceOf = (text) => Number(/余额 (-?\d+\.\d\d)/.exec(text)[1])
const before = balanceOf(prompt)
await call({ action: 'fine', id: 'prompted', amount: 4 })
prompt = sections.get('prompted').text()
assert(balanceOf(prompt) === before - 4, `standing follows the balance, got ${prompt.split('\n')[0]}`)
assert(!prompt.includes('余额是负数'), 'a funded employee is not flagged as overspending')
// Global default tip amount, then an employee override.
out = await call({ action: 'set_quick', amount: 5 })
assert(out.body.settings.verdictAmount === 5, 'global tip amount saved')
emp = out.body.employees[0]
assert(emp.verdictAmount === 5 && emp.quickInherited === true, 'employees inherit the global amount')
out = await call({ action: 'tip', id: 'a1' })
assert(out.body.employees.find((e) => e.id === 'a1').balance === 18, 'tip used the global amount')
out = await call({ action: 'set_quick', id: 'a1', amount: 3 })
assert(out.body.employees[0].verdictAmount === 3 && out.body.employees[0].quickInherited === false, 'own amount wins')
out = await call({ action: 'set_employee', id: 'a1', amount: 0 })
assert(out.body.employees[0].verdictAmount === 5 && out.body.employees[0].quickInherited === true, 'clearing restores global')
assert(out.body.employees[0].inherited === true, 'clearing the tip amount left the wage alone')

// Agents read their own standing and the efficiency board, but never move money.
const agentTool = await toolCall({ action: 'self' }, { agent: { id: 'a1' } })
assert(agentTool.self.id === 'a1', 'self returns the calling employee')
assert(agentTool.self.profit !== undefined, 'self carries the profit figure')
assert(!('employees' in agentTool), 'self does not leak the roster')

const blockedTip = await toolCall({ action: 'tip', id: 'a1', amount: 999 }, { agent: { id: 'a1' } })
assert(String(blockedTip.error).includes('只有老板'), `agent cannot tip, got ${JSON.stringify(blockedTip)}`)
const blockedWage = await toolCall({ action: 'set_wage', period: 'day', amount: 999 }, { agent: { id: 'a1' } })
assert(String(blockedWage.error).includes('只有老板'), 'agent cannot set wages')
out = await call()
assert(out.body.employees.find((e) => e.id === 'a1').balance === 18, 'blocked tool calls moved no money')

const board = await toolCall({ action: 'list' }, { agent: { id: 'a1' } })
assert(board.you.id === 'a1', 'list names the caller')
assert(!('balance' in board.board[0]), 'the board hides other balances')
assert(board.board[0].profit !== undefined, 'the board ranks by profit')

// Efficiency: earned money against token cost. The first sight of a log is a baseline, so bump it.
agents[0].session = { usage: { tokenUsage: { totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } } }
await call()
agents[0].session.usage.tokenUsage.totals.uncachedInputTokens = 5_000_000
out = await call()
emp = out.body.employees[0]
assert(emp.tokenCost === 4, `four million delta miss tokens cost 4 CNY off-peak, got ${emp.tokenCost}`)
const earned = emp.wageTotal + emp.tipTotal - emp.fineTotal
assert(emp.earned === earned, `earned = wage + tip - fine, got ${emp.earned}`)
assert(emp.profit === earned - emp.tokenCost, `profit = earned - cost, got ${emp.profit}`)

// Display order: live agents first, longest-idle last.
agents.push({ id: 'gone', status: 'idle', options: { model: 'deepseek-flash' } })
out = await call()
assert(out.body.employees[0].id === 'gone' || out.body.employees[0].status !== 'offline', 'live agents sort before offline ones')
const offline = out.body.employees.filter((employee) => employee.status === 'offline')
assert(offline.every((employee, index) => index === 0 || (offline[index - 1].lastSeenAt ?? 0) >= (employee.lastSeenAt ?? 0)), 'offline agents sort by last seen')

// The prompt states the same economics the panel shows.
const later = sections.get('prompted').text()
assert(later.includes('利润'), 'standing teaches the profit target')
assert(later.includes('token 成本'), 'standing names the token cost')

// A ledger from the advance era is repaired to the configured opening balance, once.
const seeded = {
  version: 2,
  settings: { wage: { period: 'day', amount: 10 }, verdictAmount: 1, startingBalance: 10 },
  employees: {
    idle: {
      id: 'idle', hiredAt: '2026-11-01T00:00:00.000Z', lastPaidAt: '2026-11-01T00:00:00.000Z',
      model: '', wage: null, balance: -10, tokenCost: 0, billed: null,
      tipTotal: 0, fineTotal: 0, wageTotal: 0, verdictAmount: null, workedAt: 0, lastSeenAt: 0,
    },
    earner: {
      id: 'earner', hiredAt: '2026-11-01T00:00:00.000Z', lastPaidAt: '2026-11-01T00:00:00.000Z',
      model: '', wage: null, balance: -4, tokenCost: 1.5, billed: null,
      tipTotal: 8, fineTotal: 0.5, wageTotal: 0, verdictAmount: null, workedAt: 1, lastSeenAt: 1,
    },
  },
}
writeFileSync(LEDGER_PATH, JSON.stringify(seeded))
await call()
let stored = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).employees
assert(stored.idle.balance === 10, `an untouched employee gets the opening balance, got ${stored.idle.balance}`)
assert(stored.earner.balance === -4, `real history is left alone, got ${stored.earner.balance}`)
await call()
stored = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).employees
assert(stored.idle.balance === 10, `the repair does not compound, got ${stored.idle.balance}`)

server.close()
for (const dispose of cleanups) dispose()
console.log('host ok')
