window.__ModuleLoader__.load({
  id: 'i-am-boss-dsh',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const en = {
      panel: 'Payroll',
      title: 'Employees',
      empty: 'No agent has run yet.',
      offline: 'Host API is not up. Install this bundle and restart Harness.',
      running: 'running', idle: 'idle', off: 'offline',
      peak: 'peak', offpeak: 'off-peak',
      miss: 'miss', hit: 'hit', write: 'write', out: 'out',
      wage: 'Set wage', pay: 'Pay one period', tip: 'Tip', fine: 'Fine',
      balance: 'Balance', score: 'Score',
      verdicts: 'Verdicts', quickHint: 'Tip/fine per click',
      saveQuick: 'Save amount',
      note: 'Balance is the employee’s score: higher is better. Token fees come out of that balance. Tip or fine each finished turn from the icons under the reply.',
    }
    const zh = {
      panel: '员工',
      title: '员工',
      empty: '还没有员工。有 agent 跑起来后会出现在这里。',
      offline: '没有连上宿主接口。安装本插件并重启 Harness。',
      running: '在跑', idle: '空闲', off: '离线',
      peak: '高峰', offpeak: '闲时',
      miss: '未命中', hit: '命中', write: '写出', out: '输出',
      wage: '设工资', pay: '发一期', tip: '打赏', fine: '罚款',
      balance: '余额', score: '身价',
      verdicts: '奖惩记录', quickHint: '单次打赏/罚款金额',
      saveQuick: '存为单次额度',
      note: '余额就是员工的身价，越高越好。token 费用从余额里扣。任务跑完，在回复下面用图标直接打赏或罚款。',
    }

    function Page(props) {
      const t = props.t || ((key) => zh[key])
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [draft, setDraft] = React.useState({})
      const load = React.useCallback(() => {
        fetch('/i-am-boss/api').then(async (res) => {
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || String(res.status))
          setData(body)
          setError('')
        }).catch((err) => setError(err.message || 'offline'))
      }, [])
      React.useEffect(() => {
        load()
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [load])
      const rowDraft = (id, employee) => draft[id] || {
        period: employee.wage.period,
        wageAmount: String(employee.wage.amount),
        quick: String(employee.verdictAmount),
      }
      const post = (body) => fetch('/i-am-boss/api', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).then(async (res) => {
        const bodyJson = await res.json().catch(() => ({}))
        if (!res.ok) setError(bodyJson.error || String(res.status))
        load()
      })

      return h('div', { style: pageStyle },
        h('header', { className: 'boss-head' },
          h('h1', null, t('title')),
          data && h('span', null, `${data.employees.filter((e) => e.status === 'running').length} ${t('running')} · ${data.peak ? t('peak') : t('offpeak')}`)),
        h('p', { className: 'boss-note' }, t('note')),
        error && h('p', { className: 'boss-error' }, error === 'offline' ? t('offline') : error),
        data && data.employees.length === 0 && h('p', { className: 'boss-note' }, t('empty')),
        data && data.employees.map((employee) => {
          const form = rowDraft(employee.id, employee)
          const set = (patch) => setDraft({ ...draft, [employee.id]: { ...form, ...patch } })
          const tokens = employee.billed || {}
          return h('article', { key: employee.id, className: 'boss-card' },
            h('div', { className: 'boss-id' },
              h('span', { className: 'boss-rank' }, `#${employee.rank}`),
              h('strong', null, employee.id),
              h('span', { className: `boss-${employee.status}` }, t(employee.status === 'offline' ? 'off' : employee.status)),
              employee.model && h('span', { className: 'boss-model' }, employee.model)),
            h('div', { className: 'boss-score' },
              h('span', { className: 'boss-label' }, t('balance')),
              h('b', { className: employee.balance < 0 ? 'boss-debt' : '' }, yuan(employee.balance)),
              h('span', { className: 'boss-delta' }, `tip +${yuan(employee.tipTotal)} / fine -${yuan(employee.fineTotal)}`)),
            h('dl', null,
              row('token', fmtTokens(tokens, t)),
              row('token ¥', yuan(employee.tokenCost)),
              row('工资', `${yuan(employee.wage.amount)} / ${employee.wage.period}`),
              row('下次发薪', new Date(employee.nextPayAt).toLocaleString())),
            h('div', { className: 'boss-actions' },
              h('input', { value: form.quick, 'aria-label': t('quickHint'), inputMode: 'decimal', placeholder: t('quickHint'), onChange: (e) => set({ quick: e.target.value }) }),
              h('button', { type: 'button', onClick: () => post({ action: 'set_quick', id: employee.id, amount: Number(form.quick) }) }, t('saveQuick')),
              h('button', { type: 'button', onClick: () => post({ action: 'tip', id: employee.id }) }, `▲ ${t('tip')} ${yuan(employee.verdictAmount)}`),
              h('button', { type: 'button', className: 'boss-danger', onClick: () => post({ action: 'fine', id: employee.id }) }, `▼ ${t('fine')} ${yuan(employee.verdictAmount)}`)),
            h('details', { className: 'boss-actions-row' },
              h('summary', null, t('wage')),
              h('div', { className: 'boss-actions' },
                h('select', { value: form.period, 'aria-label': 'period', onChange: (e) => set({ period: e.target.value }) },
                  ['day', 'week', 'month'].map((period) => h('option', { key: period, value: period }, period))),
                h('input', { value: form.wageAmount, 'aria-label': 'wage', inputMode: 'decimal', onChange: (e) => set({ wageAmount: e.target.value }) }),
                h('button', { type: 'button', onClick: () => post({ action: 'set_wage', id: employee.id, period: form.period, amount: Number(form.wageAmount) }) }, t('wage')),
                h('button', { type: 'button', onClick: () => post({ action: 'pay', id: employee.id }) }, t('pay')))),
            (employee.verdicts || []).length > 0 && h('details', { className: 'boss-actions-row' },
              h('summary', null, `${t('verdicts')} (${employee.verdicts.length})`),
              h('ul', { className: 'boss-log' }, employee.verdicts.slice().reverse().map((item, index) => h('li', { key: index },
                h('span', { className: item.kind === 'tip' ? 'boss-tip' : 'boss-debt' }, `${item.kind === 'tip' ? '+' : '-'}${yuan(item.amount)}`),
                ` ${new Date(item.at).toLocaleString()}`)))))
        }))
    }

    function row(label, value, debt) {
      return h('div', null, h('dt', null, label), h('dd', { className: debt ? 'boss-debt' : '' }, value))
    }
    function yuan(n) { return Number(n || 0).toFixed(4) }
    function fmtTokens(u, t) {
      const n = (v) => Number(v || 0).toLocaleString()
      return `${t('miss')} ${n(u.uncachedInputTokens)} · ${t('hit')} ${n(u.cacheReadTokens)} · ${t('write')} ${n(u.cacheWriteTokens)} · ${t('out')} ${n(u.outputTokens)}`
    }

    function Icon() {
      return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 },
        h('circle', { cx: 9, cy: 8, r: 2.2 }),
        h('path', { d: 'M4.5 18c.6-3 2.4-4.5 4.5-4.5S13 15 13.6 18' }),
        h('circle', { cx: 17, cy: 15, r: 3.2 }))
    }

    /** One shared read of the roster, so each reply does not refetch it. */
    const rosterCache = { at: 0, employees: [] }
    function readRoster() {
      if (Date.now() - rosterCache.at < 15_000) return Promise.resolve(rosterCache.employees)
      return fetch('/i-am-boss/api').then((res) => res.json()).then((body) => {
        rosterCache.employees = body.employees || []
        rosterCache.at = Date.now()
        return rosterCache.employees
      })
    }

    /** Tip / fine icons under one finished reply; the amount is the employee's per-click value. */
    function TurnVerdict({ id, t }) {
      const [employee, setEmployee] = React.useState(null)
      const [failure, setFailure] = React.useState('')
      const load = React.useCallback(() => {
        readRoster().then((employees) => {
          setEmployee(employees.find((item) => item.id === id) || null)
        }).catch(() => {})
      }, [id])
      React.useEffect(load, [load])
      const act = (kind) => {
        fetch('/i-am-boss/api', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: kind, id }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || String(res.status))
          rosterCache.employees = body.employees || []
          rosterCache.at = Date.now()
          setEmployee(rosterCache.employees.find((item) => item.id === id) || null)
          setFailure('')
        }).catch((err) => setFailure(err.message))
      }
      if (!employee) return null
      const amount = yuan(employee.verdictAmount)
      const label = (kind) => `${kind === 'tip' ? t('tip') : t('fine')} ${amount} · ${t('balance')} ${yuan(employee.balance)}`
      return h(React.Fragment, null,
        h('button', {
          type: 'button', className: 'boss-strip', 'aria-label': label('tip'), title: label('tip'),
          onClick: () => act('tip'),
        }, h(TipIcon)),
        h('button', {
          type: 'button', className: 'boss-strip boss-strip-fine', 'aria-label': label('fine'), title: label('fine'),
          onClick: () => act('fine'),
        }, h(FineIcon)),
        failure && h('span', { className: 'boss-strip-failure' }, failure))
    }

    function TipIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 },
        h('path', { d: 'M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5' }))
    }

    function FineIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 },
        h('path', { d: 'M8 3v10M8 13 4.5 9.5M8 13l3.5-3.5' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('iAmBoss', { en, zh }))
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'i-am-boss-dsh'
          tag.textContent = css
          document.head.appendChild(tag)
          return () => tag.remove()
        })
        const t = ctx.locale.bind('iAmBoss')
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'i-am-boss', locale: 'iAmBoss', inject: () => ({ t }),
        }, Page))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'i-am-boss-verdict', order: 20, locale: 'iAmBoss',
          inject: (sessionId) => ({ id: sessionId, t }),
        }, TurnVerdict))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'i-am-boss', order: 40, locale: 'iAmBoss', label: () => t('panel'),
        }, Icon))
      },
    }
  },
})

const pageStyle = {
  height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '24px 28px',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
  font: '14px/1.45 ui-sans-serif, system-ui, sans-serif',
}

const css = `
.boss-head { display: flex; align-items: baseline; gap: 12px; }
.boss-head h1 { margin: 0; font-size: 20px; font-weight: 600; }
.boss-note { color: var(--dsw-alias-label-secondary); margin: 8px 0 16px; }
.boss-error { color: var(--dsw-alias-state-error-primary); }
.boss-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.boss-id { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.boss-id strong { font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
.boss-rank { color: var(--dsw-alias-label-tertiary); font-family: ui-monospace, monospace; }
.boss-score { display: flex; align-items: baseline; gap: 10px; margin-top: 8px; }
.boss-score b { font-size: 24px; font-variant-numeric: tabular-nums; }
.boss-label { color: var(--dsw-alias-label-tertiary); }
.boss-delta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.boss-tip { color: var(--dsw-alias-state-business-primary); }
.boss-actions-row { margin-top: 10px; }
.boss-actions-row summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.boss-log { margin: 8px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.boss-note-input { flex: 1 1 200px; }
.boss-strip {
  width: 28px; height: 28px; padding: 6px; display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--dsw-radius-sm); background: none; cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}
.boss-strip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.boss-strip-fine:hover { color: var(--dsw-alias-state-error-primary); }
.boss-strip-failure { color: var(--dsw-alias-label-tertiary); font-size: 13px; padding-left: 4px; }
.boss-model { color: var(--dsw-alias-label-tertiary); }
.boss-running { color: var(--dsw-alias-state-business-primary); }
.boss-idle { color: var(--dsw-alias-label-secondary); }
.boss-offline { color: var(--dsw-alias-label-tertiary); }
.boss-card dl { display: grid; grid-template-columns: 72px 1fr; gap: 4px 8px; margin: 10px 0; }
.boss-card dt { color: var(--dsw-alias-label-tertiary); }
.boss-card dd { margin: 0; }
.boss-debt { color: var(--dsw-alias-state-error-primary); }
.boss-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.boss-actions input, .boss-actions select, .boss-actions button {
  font: inherit; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 10px;
}
.boss-actions button { cursor: pointer; }
.boss-actions button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.boss-danger { color: var(--dsw-alias-state-error-primary); }
`
