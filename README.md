# i-am-boss-dsh

DeepSeek Harness 插件：把正在运行的 agent 当员工管理，按日 / 周 / 月发工资，token 费用从员工自己的工资余额里扣。

## 功能

- 自动入职：`ctx.agents.list()` 里出现的 agent 直接进名册，显示 `running` / `idle` / `offline` 和模型。
- 身价评分：余额就是员工的身价，越高越好，名册按余额排名。
- 工资体系：每个员工一份 `{ period, amount }`，可设 day / week / month，到期自动入账（最多每次补 36 期）。
- 打赏 / 罚款：每条回复下方有两个箭头图标，点一下就按该员工的「单次额度」打赏或罚款，不填理由；面板里也能改这个额度。保留最近 20 条奖惩记录。
- Token 计量：读 `tokenUsage` 投影的未命中输入 / 缓存命中 / 缓存写出 / 输出四个桶，按 DeepSeek 牌价折算成钱并从余额扣除 —— 干得差的员工会被自己的消耗拖成欠薪。入职前已产生的用量不补扣。
- Agent 工具：`boss_payroll`，`action` 为 `list | set_wage | pay | set_quick | tip | fine`。

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

## 发布

推 `v*` tag 触发 `.github/workflows/publish.yml`，需要仓库 secret `NPM_TOKEN`（npmjs.org Automation Token）：

```
git tag v1.0.0 && git push origin v1.0.0
```

## 插件市场

DSH **没有官方市场**，Discover 只列你手动添加的索引（格式 1 的 JSON）。本仓库自带一份：

```
https://raw.githubusercontent.com/walldong/i-am-boss-dsh/main/market/index.json
```

在 Plugins → More → 开启 **Custom plugin markets** → Discover 里粘贴上面这个 URL 即可搜到。索引里的版本用 `git` source + commit SHA 固定，`npm` 发布后可改成 `{"type":"npm"}`。

改完 `market/index.json` 用 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 校验，和 Discover 读的是同一套规则；版本按 SemVer 降序，`publishTimestamp` 是 Unix 秒。

## License

MIT
