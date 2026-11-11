/** Host-level check: fake ctx, then drive /i-am-boss/api through the handler. */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HOME = mkdtempSync(join(tmpdir(), 'boss-'))
const { apply } = await import('./index.js')

const agents = []
const routes = new Map()
const cleanups = []
const handlers = []
const ctx = {
  effect(fn) { cleanups.push(fn()) },
  on(event, handler) { handlers.push([event, handler]) },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  inject(name, fn) { if (name.includes('tools')) return () => {} },
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

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

agents.push({ id: 'a1', status: 'idle', options: { model: 'deepseek-flash' } })
let out = await call()
assert(out.body.employees.length === 1, 'hired')
let emp = out.body.employees[0]
assert(emp.balance === -10, `starts one period in debt, got ${emp.balance}`)
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
assert(out.body.employees[0].balance === -5, 'tip credits')
out = await call({ action: 'fine', id: 'a1', amount: 2 })
assert(out.body.employees[0].balance === -7, 'fine debits')
assert(out.body.employees[0].tipTotal === 5 && out.body.employees[0].fineTotal === 2, 'totals')

const bad = await call({ action: 'set_wage', period: 'year', amount: 1 })
assert(bad.status === 400, 'bad period rejected')
const missing = await call({ action: 'tip', id: 'nope' })
assert(missing.status === 400, 'unknown employee rejected')

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

await call({ action: 'fine', id: 'prompted', amount: 4 })
prompt = sections.get('prompted').text()
assert(prompt.includes('-74.00'), `standing follows the balance, got ${prompt.split('\n')[0]}`)
assert(prompt.includes('余额为负'), 'negative balance is explained')
// Global default tip amount, then an employee override.
out = await call({ action: 'set_quick', amount: 5 })
assert(out.body.settings.verdictAmount === 5, 'global tip amount saved')
emp = out.body.employees[0]
assert(emp.verdictAmount === 5 && emp.quickInherited === true, 'employees inherit the global amount')
out = await call({ action: 'tip', id: 'a1' })
assert(out.body.employees[0].balance === -2, `tip used the global amount, got ${out.body.employees[0].balance}`)
out = await call({ action: 'set_quick', id: 'a1', amount: 3 })
assert(out.body.employees[0].verdictAmount === 3 && out.body.employees[0].quickInherited === false, 'own amount wins')
out = await call({ action: 'set_employee', id: 'a1', amount: 0 })
assert(out.body.employees[0].verdictAmount === 5 && out.body.employees[0].quickInherited === true, 'clearing restores global')
assert(out.body.employees[0].inherited === true, 'clearing the tip amount left the wage alone')

server.close()
for (const dispose of cleanups) dispose()
console.log('host ok')
