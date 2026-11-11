# i-am-boss-dsh

DeepSeek Harness 插件：把正在运行的 agent 当员工管理，按日 / 周 / 月发工资，token 费用从员工自己的工资余额里扣。

## 功能

- 自动入职：`ctx.agents.list()` 里出现的 agent 直接进名册，显示 `running` / `idle` / `offline` 和模型。
- 工资体系：每个员工一份 `{ period, amount }`，可设 day / week / month，到期自动入账（最多每次补 36 期）。
- 手动操作：发一期、扣款；余额允许为负（欠薪）。
- Token 计量：读 `tokenUsage` 投影的未命中输入 / 缓存命中 / 缓存写出 / 输出四个桶，按 DeepSeek 牌价折算成钱并从余额扣除。入职前已产生的用量不补扣。
- Agent 工具：`boss_payroll`，`action` 为 `list | set_wage | pay | deduct`。

## 计价

默认闲时牌价（元 / 百万 tokens），高峰 ×2：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | 0.15 | 4.5 | 13.5 |

高峰为北京时间周一至周五 9:00–12:00、14:00–18:00。法定节假日未排除，价格改在 `payroll.js` 的 `RATES`。

## 安装

Harness 的 **Plugins** 页安装本目录，或用插件工具：

```
plugin_manager action=install_bundle target=/绝对路径/i-am-boss-dsh
```

安装后重启 Harness，左侧栏出现「员工」。宿主编译版本没有 HMR 时，改完代码需要重启。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 插件：路由 `/i-am-boss/api`、30 秒结算定时器、`boss_payroll` 工具、账本读写 |
| `payroll.js` | 纯计算：计价、增量扣费、工资入账。`node payroll.js` 跑自检 |
| `client.js` | Web UI：`sidebar.panellist` 入口 + `main` 面板 |
| `cordis.patch.yml` | bundle patch，插入 `i-am-boss` 行 |

账本在 `~/.dsh/i-am-boss-ledger.json`，原子写入（临时文件 + rename）。

## 自检

```
node --check index.js && node payroll.js
```

## License

MIT
