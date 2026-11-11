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
const ctx = {
  effect(fn) { cleanups.push(fn()) },
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

out = await call({ action: 'set_employee', id: 'a1' })
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

server.close()
for (const dispose of cleanups) dispose()
console.log('host ok')
