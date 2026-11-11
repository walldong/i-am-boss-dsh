/** Client smoke test: a tiny React shim renders the real components against a fake API. */
import { readFileSync } from 'node:fs'

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

let stores = new Map()
let current = []
let cursor = 0
let pending = false
const effects = []

function resetHooks(type) {
  if (!stores.has(type)) stores.set(type, [])
  current = stores.get(type)
  cursor = 0
}

function useState(init) {
  const slot = cursor++
  if (!(slot in current)) current[slot] = typeof init === 'function' ? init() : init
  const set = (value) => {
    const next = typeof value === 'function' ? value(current[slot]) : value
    if (!Object.is(next, current[slot])) { current[slot] = next; pending = true }
  }
  return [current[slot], set]
}

const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.flat(Infinity) } }
  },
  useState,
  useCallback: (fn) => fn,
  useEffect: (fn) => { effects.push(fn) },
}

const EMPLOYEES = [
  {
    id: 'session-abc', status: 'running', rank: 1, balance: -3.5, frozen: false, inherited: true,
    model: 'deepseek-flash', tipTotal: 5, fineTotal: 2, verdictAmount: 1, tokenCost: 1.25,
    wage: { period: 'day', amount: 10 }, lastPaidAt: '2026-11-11T00:00:00.000Z',
  },
  {
    id: 'session-def', status: 'offline', rank: 2, balance: 42, frozen: true, inherited: false,
    model: 'deepseek-v4-pro', tipTotal: 60, fineTotal: 8, verdictAmount: 5, tokenCost: 0,
    wage: { period: 'week', amount: 70 }, lastPaidAt: '2026-11-01T00:00:00.000Z',
  },
]

const calls = []
globalThis.fetch = async (url, options) => {
  calls.push(options ? JSON.parse(options.body) : { action: 'list' })
  return {
    ok: true,
    status: 200,
    json: async () => ({ employees: EMPLOYEES, settings: { wage: { period: 'day', amount: 10 }, verdictAmount: 1 } }),
  }
}

let module
globalThis.window = { __ModuleLoader__: { load: (m) => { module = m } } }
globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
new Function('window', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))(globalThis.window)

const slots = new Map()
let dict = {}
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (_ns, dictionaries) => { dict = dictionaries.zh; return () => {} },
    bind: () => (key) => dict[key] ?? key,
  },
  slots: {
    inject: (name, register) => { slots.set(name, register()) },
    register: (options, component) => ({ options, component }),
  },
}

const body = module.factory((id) => {
  assert(id === 'react', `unexpected require ${id}`)
  return React
})
body.apply(ctx)
assert(slots.has('main'), 'registers the employee panel')
assert(slots.has('conversation.chat.assistant-actions'), 'registers the tip/fine strip')
assert(slots.has('sidebar.panellist'), 'registers the sidebar entry')

const text = []
function walk(node) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) return node.forEach(walk)
  if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return }
  const { type, props } = node
  if (type === 'Fragment') return walk(props.children)
  if (typeof type === 'function') {
    resetHooks(type)
    return walk(type(props))
  }
  if (typeof type === 'string') return walk(props.children)
}

const Page = slots.get('main').component
const t = (key) => dict[key] ?? key
for (let pass = 0; pass < 8; pass++) {
  pending = false
  text.length = 0
  walk(React.createElement(Page, { t }))
  for (const run of effects.splice(0)) run()
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!pending) break
}

const rendered = text.join(' ')
assert(rendered.includes('session-abc'), 'renders the running employee')
assert(rendered.includes('-3.50'), 'negative balance shown as debt')
assert(rendered.includes('42.00'), 'positive balance shown')
assert(rendered.includes('10.00/天'), 'inherited wage with its period')
assert(rendered.includes('70.00/周'), 'own wage with its period')
assert(rendered.includes('停薪'), 'paused employee is marked')
assert(rendered.includes('+5.00') && rendered.includes('-2.00'), 'tip and fine totals')

const strip = slots.get('conversation.chat.assistant-actions')
const verdictProps = strip.options.inject('session-abc', undefined)
resetHooks()
text.length = 0
walk(React.createElement(strip.component, verdictProps))
for (const run of effects.splice(0)) run()
await new Promise((resolve) => setTimeout(resolve, 0))
resetHooks()
text.length = 0
walk(React.createElement(strip.component, verdictProps))
assert(calls.some((call) => call.action === 'list'), 'strip reads the roster')

console.log('client ok')
process.exit(0)
