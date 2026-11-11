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
      balance: 'Balance', wage: 'Wage', tipTotal: 'Tipped', fineTotal: 'Fined',
      efficiency: 'Return', earned: 'Earned', tokenCost: 'Token cost',
      frozen: 'paused', 'per.day': '/day', 'per.week': '/week', 'per.month': '/month',
      defaults: 'Default wage', quick: 'Per tip/fine',
      override: 'Own wage', useDefault: 'Use default', ownQuick: 'Own amount',      save: 'Save',
      note: 'Balance starts one wage in debt: the first payday is what clears it. Token fees come out of the balance. An employee paused for a full period earns nothing until it works again.',
    }
    const zh = {
      panel: '员工',
      title: '员工',
      empty: '还没有员工。有 agent 跑起来后会出现在这里。',
      offline: '没有连上宿主接口。安装本插件并重启 Harness。',
      running: '在跑', idle: '空闲', off: '离线',
      balance: '余额', wage: '工资', tipTotal: '总打赏', fineTotal: '总罚款',
      efficiency: '性价比', earned: '收入', tokenCost: 'token 成本',
      frozen: '停薪', 'per.day': '/天', 'per.week': '/周', 'per.month': '/月',
      defaults: '默认工资', quick: '每次打赏/罚款',
      override: '单独工资', useDefault: '用默认', ownQuick: '单独额度',
      save: '保存',
      note: '入职时先欠一期工资，第一次发薪后转正。token 费用从余额里扣。停摆满一个发薪周期的员工暂停发薪，再干活才恢复。',
    }

    const NS = 'iAmBoss'
    const periodLabel = (t, period) => t(`per.${period}`)

    function Page(props) {
      const t = props.t || ((key) => zh[key])
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [global, setGlobal] = React.useState({ period: 'day', amount: '10' })
      const [drafts, setDrafts] = React.useState({})

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

      const post = (body) => fetch('/i-am-boss/api', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).then(async (res) => {
        const out = await res.json().catch(() => ({}))
        if (!res.ok) setError(out.error || String(res.status))
        else setError('')
        load()
      })

      const settingsKey = `${data?.settings?.wage?.period}:${data?.settings?.wage?.amount}:${data?.settings?.verdictAmount}`
      React.useEffect(() => {
        const wage = data?.settings?.wage
        if (wage) setGlobal({ period: wage.period, amount: String(wage.amount), quick: String(data.settings.verdictAmount) })
      }, [settingsKey])

      return h('div', { style: pageStyle },
        h('header', { className: 'boss-head' },
          h('h1', null, t('title')),
          h('span', { className: 'boss-count' },
            data ? data.employees.filter((e) => e.status === 'running').length : 0, ' ', t('running'))),
        error && h('p', { className: 'boss-error' }, error === 'offline' ? t('offline') : error),
        h('div', { className: 'boss-defaults' },
          h('label', null, t('defaults')),
          h('select', {
            value: global.period, 'aria-label': t('defaults'),
            onChange: (e) => setGlobal({ ...global, period: e.target.value }),
          }, ['day', 'week', 'month'].map((p) => h('option', { key: p, value: p }, periodLabel(t, p)))),
          h('input', {
            value: global.amount, inputMode: 'decimal', 'aria-label': t('wage'),
            onChange: (e) => setGlobal({ ...global, amount: e.target.value }),
          }),
          h('span', { className: 'boss-sep' }),
          h('label', null, t('quick')),
          h('input', {
            value: global.quick, inputMode: 'decimal', 'aria-label': t('quick'),
            onChange: (e) => setGlobal({ ...global, quick: e.target.value }),
          }),
          h('button', {
            type: 'button',
            onClick: () => Promise.all([
              post({ action: 'set_wage', period: global.period, amount: Number(global.amount) }),
              post({ action: 'set_quick', amount: Number(global.quick) }),
            ]),
          }, t('save'))),
        data && data.employees.length === 0 && h('p', { className: 'boss-empty' }, t('empty')),
        h('div', { className: 'boss-grid' },
          (data?.employees ?? []).map((employee) => {
            const draft = drafts[employee.id] ?? {
              period: employee.wage.period,
              wage: String(employee.wage.amount),
              quick: String(employee.verdictAmount),
            }
            const set = (patch) => setDrafts({ ...drafts, [employee.id]: { ...draft, ...patch } })
            return h('article', { key: employee.id, className: `boss-card${employee.frozen ? ' boss-card-frozen' : ''}` },
              h('div', { className: 'boss-card-head' },
                h(Avatar, { id: employee.id }),
                h('div', { className: 'boss-identity' },
                  h('strong', { title: employee.id }, employee.id),
                  h('span', { className: `boss-status boss-${employee.status}` },
                    employee.status === 'offline' ? t('off') : t(employee.status)),
                  employee.frozen && h('span', { className: 'boss-frozen-tag' }, t('frozen')))),
              h('div', { className: 'boss-balance' },
                h('span', { className: 'boss-label' }, t('balance')),
                h('b', { className: employee.balance < 0 ? 'boss-debt' : 'boss-good' }, yuan(employee.balance))),
              h('dl', { className: 'boss-stats' },
                stat(t('wage'), `${yuan(employee.wage.amount)}${periodLabel(t, employee.wage.period)}`, employee.inherited),
                stat(t('tipTotal'), signed(employee.tipTotal, '+'), false, 'boss-good'),
                stat(t('fineTotal'), signed(employee.fineTotal, '-'), false, 'boss-debt')),
              h('div', { className: 'boss-roi' },
                h('span', null,
                  h('span', { className: 'boss-label' }, t('efficiency')), ' ',
                  h('b', {
                    className: employee.efficiency === null ? '' : employee.efficiency >= 1 ? 'boss-good' : 'boss-debt',
                    title: `${t('earned')} ${yuan(employee.earned)} − ${t('tokenCost')} ${yuan(employee.tokenCost)}`,
                  }, employee.efficiency === null ? '—' : `×${employee.efficiency.toFixed(2)}`)),
                h('span', { className: 'boss-roi-detail' },
                  `${t('earned')} ${yuan(employee.earned)} · ${t('tokenCost')} ${yuan(employee.tokenCost)}`)),
              h('details', { className: 'boss-override' },
                h('summary', null, employee.inherited ? t('override') : t('wage')),
                h('div', { className: 'boss-override-row' },
                  h('select', {
                    value: draft.period, 'aria-label': t('override'),
                    onChange: (e) => set({ period: e.target.value }),
                  }, ['day', 'week', 'month'].map((p) => h('option', { key: p, value: p }, periodLabel(t, p)))),
                  h('input', {
                    value: draft.wage, inputMode: 'decimal', 'aria-label': t('wage'),
                    onChange: (e) => set({ wage: e.target.value }),
                  }),
                  h('button', {
                    type: 'button',
                    onClick: () => post({ action: 'set_employee', id: employee.id, period: draft.period, wage: Number(draft.wage) }),
                  }, t('save')),
                  !employee.inherited && h('button', {
                    type: 'button',
                    onClick: () => post({ action: 'set_employee', id: employee.id, wage: 0 }),
                  }, t('useDefault')))),
              h('details', { className: 'boss-override' },
                h('summary', null, `${t('ownQuick')} ${yuan(employee.verdictAmount)}`),
                h('div', { className: 'boss-override-row' },
                  h('input', {
                    value: draft.quick, inputMode: 'decimal', 'aria-label': t('quick'),
                    onChange: (e) => set({ quick: e.target.value }),
                  }),
                  h('button', {
                    type: 'button',
                    onClick: () => post({ action: 'set_quick', id: employee.id, amount: Number(draft.quick) }),
                  }, t('save')),
                  !employee.quickInherited && h('button', {
                    type: 'button',
                    onClick: () => post({ action: 'set_employee', id: employee.id, amount: 0 }),
                  }, t('useDefault')))))
          })),
        h('p', { className: 'boss-note' }, t('note')))
    }

    function stat(label, value, inherited, tone) {
      return h('div', null,
        h('dt', null, label),
        h('dd', { className: tone || '' }, value,
          inherited ? h('span', { className: 'boss-inherited', title: 'default' }, ' ·') : null))
    }

    /** Deterministic from the id, so one employee keeps one face across reloads. */
    function Avatar({ id }) {
      const [face] = React.useState(() => faceOf(id))
      return h('svg', {
        viewBox: '0 0 40 40', width: 40, height: 40, className: 'boss-avatar', 'aria-hidden': true,
      },
        h('rect', { width: 40, height: 40, rx: 12, fill: face.skin }),
        h('circle', { cx: 20, cy: 17, r: 9, fill: face.face }),
        h('circle', { cx: 16.5, cy: 16, r: 1.3, fill: face.ink }),
        h('circle', { cx: 23.5, cy: 16, r: 1.3, fill: face.ink }),
        h('path', { d: face.mouth, stroke: face.ink, 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round' }),
        h('path', { d: 'M6 40c1.5-8 7-11 14-11s12.5 3 14 11z', fill: face.skin }))
    }

    const PALETTE = [
      ['#f2d9c4', '#f7e6d7', '#3a2b26'], ['#e8c9a8', '#f5e0c8', '#33241c'],
      ['#c99b78', '#e2b795', '#2b1d17'], ['#8d6349', '#a87a5c', '#f7ead9'],
      ['#bcc6d4', '#d3dae4', '#243040'], ['#c9b8dd', '#dcd0ec', '#2f2440'],
      ['#a9c9bd', '#c6ddd4', '#1f3a32'], ['#e2b3b8', '#f0cdd1', '#3d2027'],
    ]
    const MOUTHS = ['M16 22q4 3 8 0', 'M16 22h8', 'M16 22q4 4 8 0', 'M16 22q4 2 8 -0.5']

    function faceOf(id) {
      let hash = 2166136261
      for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
      }
      const n = hash >>> 0
      const [skin, face, ink] = PALETTE[n % PALETTE.length]
      const mouth = MOUTHS[(n >>> 8) % MOUTHS.length]
      return { skin, face, ink, mouth }
    }

    function yuan(n) {
      const value = Number(n || 0)
      return value.toFixed(2)
    }

    /** A sign only when there is something to sign: 0.00, not -0.00. */
    function signed(n, sign) {
      const value = Number(n || 0)
      return value === 0 ? '0.00' : `${sign}${value.toFixed(2)}`
    }

    function TipIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 },
        h('path', { d: 'M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5' }))
    }

    function FineIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 },
        h('path', { d: 'M8 3v10M8 13 4.5 9.5M8 13l3.5-3.5' }))
    }

    const rosterCache = { at: 0, employees: [] }
    function readRoster() {
      if (Date.now() - rosterCache.at < 15_000) return Promise.resolve(rosterCache.employees)
      return fetch('/i-am-boss/api').then((res) => res.json()).then((body) => {
        rosterCache.employees = body.employees || []
        rosterCache.at = Date.now()
        return rosterCache.employees
      })
    }

    /** Tip / fine icons under one finished reply, using the employee's per-click amount. */
    function TurnVerdict({ id, t }) {
      const [employee, setEmployee] = React.useState(null)
      const [failure, setFailure] = React.useState('')
      const adopt = (employees) => setEmployee(employees.find((item) => item.id === id) || null)
      React.useEffect(() => {
        readRoster().then(adopt).catch(() => {})
      }, [id])
      const act = (kind) => {
        fetch('/i-am-boss/api', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: kind, id }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || String(res.status))
          rosterCache.employees = body.employees || []
          rosterCache.at = Date.now()
          adopt(rosterCache.employees)
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
        }, h(TipIcon), h('span', null, `+${amount}`)),
        h('button', {
          type: 'button', className: 'boss-strip boss-strip-fine', 'aria-label': label('fine'), title: label('fine'),
          onClick: () => act('fine'),
        }, h(FineIcon), h('span', null, `-${amount}`)),
        failure && h('span', { className: 'boss-strip-failure' }, failure))
    }

    function Icon() {
      return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 },
        h('circle', { cx: 9, cy: 8, r: 2.2 }),
        h('path', { d: 'M4.5 18c.6-3 2.4-4.5 4.5-4.5S13 15 13.6 18' }),
        h('circle', { cx: 17, cy: 15, r: 3.2 }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'i-am-boss-dsh'
          tag.textContent = css
          document.head.appendChild(tag)
          return () => tag.remove()
        })
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'i-am-boss', locale: NS, inject: () => ({ t }),
        }, Page))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'i-am-boss-verdict', order: 20, locale: NS,
          inject: (sessionId) => ({ id: sessionId, t }),
        }, TurnVerdict))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'i-am-boss', order: 40, locale: NS, label: () => t('panel'),
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
.boss-count { color: var(--dsw-alias-label-secondary); }
.boss-error { color: var(--dsw-alias-state-error-primary); }
.boss-empty { color: var(--dsw-alias-label-secondary); }
.boss-defaults { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0 18px; }
.boss-defaults label { color: var(--dsw-alias-label-secondary); }
.boss-defaults input, .boss-defaults select, .boss-defaults button,
.boss-override-row input, .boss-override-row select, .boss-override-row button {
  font: inherit; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; padding: 5px 9px;
}
.boss-defaults input, .boss-override-row input { width: 72px; font-variant-numeric: tabular-nums; }
.boss-sep { width: 1px; height: 18px; background: var(--dsw-alias-border-l2); margin: 0 2px; }
.boss-defaults button, .boss-override-row button { cursor: pointer; }
.boss-defaults button:hover, .boss-override-row button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.boss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 12px; }
.boss-card {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  border-radius: 12px; padding: 14px;
}
.boss-card-frozen { opacity: 0.72; }
.boss-card-head { display: flex; align-items: center; gap: 10px; }
.boss-avatar { flex: none; border-radius: 12px; }
.boss-identity { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.boss-identity strong {
  font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.boss-status { font-size: 12px; }
.boss-running { color: var(--dsw-alias-state-business-primary); }
.boss-idle { color: var(--dsw-alias-label-secondary); }
.boss-offline { color: var(--dsw-alias-label-tertiary); }
.boss-frozen-tag { color: var(--dsw-alias-state-warn-label); font-size: 12px; }
.boss-balance { display: flex; align-items: baseline; justify-content: space-between; margin: 12px 0 8px; }
.boss-balance b { font-size: 22px; font-variant-numeric: tabular-nums; }
.boss-label { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.boss-good { color: var(--dsw-alias-state-business-primary); }
.boss-debt { color: var(--dsw-alias-state-error-primary); }
.boss-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 0; }
.boss-stats dt { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.boss-stats dd { margin: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
.boss-roi { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.boss-roi b { font-size: 13px; font-variant-numeric: tabular-nums; }
.boss-roi-detail { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.boss-inherited { color: var(--dsw-alias-label-tertiary); }
.boss-override { margin-top: 10px; }
.boss-override summary { cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.boss-override-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.boss-note { color: var(--dsw-alias-label-secondary); margin: 16px 0 0; font-size: 12px; }
.boss-strip {
  height: 28px; padding: 4px 8px 4px 6px; gap: 3px; display: inline-flex; align-items: center;
  border: none; border-radius: var(--dsw-radius-sm); background: none; cursor: pointer;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; font-variant-numeric: tabular-nums;
}
.boss-strip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-state-business-primary); }
.boss-strip-fine:hover { color: var(--dsw-alias-state-error-primary); }
.boss-strip-failure { color: var(--dsw-alias-label-tertiary); font-size: 13px; padding-left: 4px; }
`
