/** Wage periods and DeepSeek token prices. Pure: no host, no disk. */

/** Off-peak CNY / 1M tokens. Peak is ×2. Source: api-docs.deepseek.com pricing, 2026-11. */
export const RATES = {
  flash: { hit: 0.02, miss: 1, output: 4 },
  pro: { hit: 0.15, miss: 4.5, output: 13.5 },
}

export const PERIODS = ['day', 'week', 'month']
const PERIOD_MS = { day: 86_400_000, week: 7 * 86_400_000 }

export function emptyUsage() {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

export function money(n) {
  return Math.round(n * 1e6) / 1e6
}

export function rateCard(model) {
  return String(model || '').toLowerCase().includes('pro') ? RATES.pro : RATES.flash
}

/** Weekday 09–12 and 14–18 Asia/Shanghai. ponytail: no PRC holiday calendar. */
export function isPeak(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false
  const hour = Number(parts.hour)
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

export function priceUsage(usage, model, date) {
  const card = rateCard(model)
  const factor = isPeak(date) ? 2 : 1
  const tokens = (usage.uncachedInputTokens * card.miss)
    + (usage.cacheReadTokens * card.hit)
    + (usage.cacheWriteTokens * card.miss)
    + (usage.outputTokens * card.output)
  return money(tokens / 1e6 * factor)
}

/** First sight bills nothing. A shrinking counter is a new log, not a refund. */
export function usageCharge(prev, next, model, date) {
  const billed = { ...next }
  if (!prev) return { billed, cost: 0 }
  const keys = Object.keys(emptyUsage())
  if (keys.some((key) => next[key] < prev[key])) return { billed, cost: 0 }
  const delta = emptyUsage()
  for (const key of keys) delta[key] = next[key] - prev[key]
  return { billed, cost: priceUsage(delta, model, date) }
}

export function nextDue(fromMs, period) {
  if (period === 'month') {
    const d = new Date(fromMs)
    d.setMonth(d.getMonth() + 1)
    return d.getTime()
  }
  return fromMs + PERIOD_MS[period]
}

/** Wages pay for work already delivered: a period with no work pays nothing. */
export function accrueWages(employee, nowMs, wage) {
  let paid = 0
  let cursor = Date.parse(employee.lastPaidAt)
  for (let n = 0; n < 36; n++) {
    const due = nextDue(cursor, wage.period)
    if (due > nowMs) break
    if (employee.workedAt >= cursor) {
      employee.balance = money(employee.balance + wage.amount)
      employee.wageTotal = money((employee.wageTotal ?? 0) + wage.amount)
      paid = money(paid + wage.amount)
    }
    cursor = due
  }
  employee.lastPaidAt = new Date(cursor).toISOString()
  return paid
}

/** Idle for a whole pay period: wages stop until the employee works again. */
export function isFrozen(employee, wage, nowMs) {
  const since = Math.max(employee.workedAt, Date.parse(employee.hiredAt))
  return nextDue(since, wage.period) <= nowMs
}

function assert(cond, msg) {  if (!cond) throw new Error(msg)
}

function demo() {
  const zero = emptyUsage()
  const used = { ...zero, uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 }
  assert(usageCharge(null, used, 'deepseek-flash', new Date('2026-11-08T03:00:00Z')).cost === 0, 'no backfill')
  const off = new Date('2026-11-08T03:00:00Z') // Sunday
  assert(!isPeak(off), 'sunday off-peak')
  assert(priceUsage(used, 'deepseek-flash', off) === 5, 'flash miss 1 + output 4')
  const peak = new Date('2026-11-09T02:00:00Z') // Monday 10:00 Shanghai
  assert(isPeak(peak), 'weekday morning peak')
  assert(priceUsage({ ...zero, cacheReadTokens: 1_000_000 }, 'deepseek-v4-pro', off) === 0.15, 'pro hit')
  assert(priceUsage({ ...zero, cacheReadTokens: 1_000_000 }, 'deepseek-v4-pro', peak) === 0.3, 'pro hit peak')
  const again = usageCharge(used, { ...used, outputTokens: 1_500_000 }, 'deepseek-flash', off)
  assert(again.cost === 2, 'delta output only')
  assert(usageCharge(used, zero, 'deepseek-flash', off).cost === 0, 'shrink is not a refund')
  const wage = { period: 'day', amount: 10 }
  const emp = { balance: -10, lastPaidAt: '2026-11-01T00:00:00.000Z', hiredAt: '2026-11-01T00:00:00.000Z', workedAt: Date.parse('2026-11-01T01:00:00.000Z') }
  assert(accrueWages(emp, Date.parse('2026-11-01T12:00:00.000Z'), wage) === 0, 'not due yet')
  assert(!isFrozen(emp, wage, Date.parse('2026-11-01T20:00:00.000Z')), 'worked this period')
  assert(accrueWages(emp, Date.parse('2026-11-02T00:00:00.000Z'), wage) === 10, 'one worked day')
  assert(emp.balance === 0, 'debt settled by the first payday')
  assert(emp.wageTotal === 10, 'running wage total')
  assert(isFrozen(emp, wage, Date.parse('2026-11-02T12:00:00.000Z')), 'idle a whole period')
  const paidAt = { ...emp, lastPaidAt: '2026-11-02T00:00:00.000Z' }
  assert(accrueWages(paidAt, Date.parse('2026-11-05T00:00:00.000Z'), wage) === 0, 'idle periods pay nothing')
  assert(paidAt.balance === 0 && paidAt.wageTotal === 10, 'frozen balance and total unchanged')
  const never = { balance: -10, lastPaidAt: '2026-11-01T00:00:00.000Z', hiredAt: '2026-11-01T00:00:00.000Z', workedAt: 0 }
  assert(accrueWages(never, Date.parse('2026-11-03T00:00:00.000Z'), wage) === 0, 'no work, no pay')
  assert(never.balance === -10, 'debt stays')
  assert(isFrozen(never, wage, Date.parse('2026-11-02T00:00:00.000Z')), 'no work for a period')
  console.log('payroll ok')
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) demo()
