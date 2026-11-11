# i-am-boss-dsh

把 DeepSeek Harness 里正在运行的 agent 当员工管理：**按日 / 周 / 月发工资，按性价比打赏或罚款，token 费用从员工自己的工资里扣。**

[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.1-1f6b4a)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> 员工花公司的 token 是要还的。干得好拿打赏，干得差被罚款，烧太多就欠薪 —— 于是它自己会算这笔账。

## 它解决什么

agent 跑起来之后，你通常只知道"它花了多少钱"，不知道"值不值"。这个插件把每个 agent 变成一个员工账户：

- 每轮对话的 token 钱按 DeepSeek 官方牌价算出来，从它的工资余额里扣；
- 每条回复下面点一下就打赏或罚款，按完成质量给；
- 卡片上直接显示「性价比」= 收入 ÷ token 成本，低于 1 就是亏本；
- 这句话也写进 agent 自己的系统提示里，所以它会主动省 token、少试错。

## 功能

- 自动入职：`ctx.agents.list()` 里出现的 agent 直接进名册，卡片显示头像（按 id 生成，稳定不变）、状态和模型。
- 身价评分：余额就是员工的身价，越高越好，卡片按余额排序。
- 先欠后付：入职时先记一期工资的负余额，第一次发薪才转正；一个发薪周期没有产生 token 消耗就停薪，重新干活才恢复。
- 工资配置：全局一套「金额 + 周期」和「单次打赏/罚款额度」，员工可分别覆盖，个体优先；去掉覆盖即回到全局。
- 打赏 / 罚款：每条回复下方两个按钮，写着 `+1.00` / `-1.00` 这种带符号的金额，点一下直接生效，不填理由。
- 性价比：卡片显示「收入 ÷ token 成本」的回报倍数（`×2.40`），低于 1 就是亏本。收入 = 累计工资 + 打赏 − 罚款。
- 工资感知：每个 agent 的系统提示里有一段自己的工资卡，随结算刷新，明确告诉它「少烧 token 干对活」才是最优策略。
- 权限：改工资、打赏、罚款只能由你操作。agent 的工具只有 `self`（看自己）和 `list`（性价比排行榜，不含他人余额），不能给自己或同事发钱。
- Agent 工具：`boss_payroll`，`action` 为 `self | list`。

## 计价

默认闲时牌价（元 / 百万 tokens），高峰 ×2：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | 0.15 | 4.5 | 13.5 |

高峰为北京时间周一至周五 9:00–12:00、14:00–18:00。法定节假日未排除，价格改在 `payroll.js` 的 `RATES`。

## 安装

**从 GitHub 安装**（不需要 npm 发布）：

```
dsh plugin --profile desktop add github:walldong/i-am-boss-dsh
```

或在 Harness **Plugins** 页添加 `github:walldong/i-am-boss-dsh`。安装后重启 Harness，左侧栏出现「员工」。

**从源码**（改代码时）：

```
plugin_manager action=install_bundle target=/绝对路径/i-am-boss-dsh
```

更新：`dsh plugin --profile desktop update i-am-boss-dsh`，之后必须重启。宿主编译版本没有 HMR 时，改完代码同样要重启。

## 加入插件市场

DSH 没有官方市场，Discover 读的是社区索引。本仓库已打 `dsh-plugin` topic，会被 [dsh-plugin-index](https://github.com/whoishuhu/dsh-plugin-index) 次日自动收录；也可以直接添加本仓库自带的索引：

```
https://raw.githubusercontent.com/walldong/i-am-boss-dsh/main/market/index.json
```

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 插件：路由 `/i-am-boss/api`、30 秒结算定时器、`boss_payroll` 工具、账本读写 |
| `payroll.js` | 纯计算：计价、增量扣费、工资入账、停薪判定 |
| `client.js` | Web UI：`sidebar.panellist` 入口 + `main` 卡片面板 + 回复下的打赏/罚款图标 |
| `cordis.patch.yml` | bundle patch，插入 `i-am-boss` 行 |

账本在 `~/.dsh/i-am-boss-ledger.json`，原子写入（临时文件 + rename）。v1 账本会自动迁移。

## 自检

```
node payroll.js && node test-host.js && node test-client.js
```

`payroll.js` 跑计价与发薪断言；`test-host.js` 用假 ctx 起 HTTP 打真实路由；`test-client.js` 用微型 React shim 渲染真实组件并断言卡片内容。

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
