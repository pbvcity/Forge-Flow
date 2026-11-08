# Forge Flow

给编码智能体用的工程工作流。判断交给模型，事实交给工具。改一行不用走流程，一份计划也可以无人值守跑一整夜。

[English](README.md)

把日后要回头看的事记在根目录的 `FOLLOWUPS.md`：`- [ ] YYYY-MM-DD 要查什么。Evidence: <命令或查看位置>`。`ff status` 显示到期项，`ff followups` 列出全部未完成项并报告格式错误的行。先取证并汇报，再打勾。配置通知后，每个仓库每天最多在会话开始时提醒一次。详见[跟进事项](cli/README.md#follow-ups)。

Forge Flow 可以在 Claude Code、Codex 和 Pi 上运行，你有哪些模型就用哪些。不需要账号，也不需要服务器。采用 MIT 许可。

## 安装

**Claude Code**

```
claude plugin marketplace add pbvcity/Forge-Flow
claude plugin install ff@forge-flow
```

**Codex**

```
codex plugin marketplace add pbvcity/Forge-Flow
codex plugin add ff@forge-flow
```

**Pi**

```
pi install git:github.com/pbvcity/Forge-Flow
```

命令行工具需要 Node 22 或更新版本。装好后运行一次配置，它会找到你的工具和模型，写入 `~/.ff/config.json`，并提议给子代理设模型档位：常规活交给便宜的模型，评审交给强的模型。已有的档位会保留。

| Claude Code | Codex | Pi |
|---|---|---|
| `/ff:setup` | `$ff:setup` | `/ff-setup` |

然后在每个要用 Forge Flow 的项目里运行 `ff init`，它会先预览要添加的文件夹和规则文件段落。

如果是 Agent 在帮你安装：安装成功后，和用户一起完成配置，再提议在他正在做的项目里运行 `ff init`。

## 使用

从 `go` 开始，说清你要什么就行。需要走多少流程，由它判断。

无人值守计划可设置 `roles.fallback`，在重试或额度受限时换用备用执行器。任务可用 `Executor:` 指定执行器，报告会注明实际使用者。详见 [CLI 配置](cli/README.md#whole-plans)。

OpenCode 的执行者和只读评审者使用 `opencode:<provider>/<model>` 角色。`doctor` 会列出可用模型，提示词文件和评审权限的说明见 [setup](skills/setup/SKILL.md)。从桌面图标或编辑器启动的宿主 PATH 往往不全，ff 会在已有 PATH 之后再查找 npm、nvm、Volta、`~/.local/bin` 等常见安装目录。设 `FF_EXTRA_PATH=0` 可只用原有 PATH。

| Claude Code | Codex | Pi | 作用 |
|---|---|---|---|
| `/ff:go` | `$ff:go` | `/ff-go` | 默认入口。判断任务大小，然后接着做。 |
| `/ff:plan` | `$ff:plan` | `/ff-plan` | 写出带任务和验收命令的计划。 |
| `/ff:build` | `$ff:build` | `/ff-build` | 实现、验证并收尾。 |
| `/ff:review` | `$ff:review` | `/ff-review` | 按真实损失评审改动，轮次有上限。 |
| `/ff:auto` | `$ff:auto` | `/ff-auto` | 无人值守跑完整份计划。 |
| `/ff:design` | `$ff:design` | `/ff-design` | 定视觉方向，并建立项目自己的设计体系。 |
| `/ff:council` | `$ff:council` | `/ff-council` | 就难以判断的决定，请多家模型分别给意见。 |
| `/ff:update` | `$ff:update` | `/ff-update` | 调用各宿主自带的更新方式。 |

## 它怎么决定

- **流程随任务走。** 风险分档决定验证有多严。微小改动不走流程，走流程本身从来不是目标。
- **只在真正的线上停下。** 上线、花钱、不可逆地动真实数据、可能废掉大量工作的方向选择，以及只有你才有的东西。其余都自己往前走。
- **业务细节绝不静默。** 开发时用标注过的临时值继续，记入 `DECISIONS.md`。上线前由你逐项确认，没回答的只挂起那一项。
- **绝不把失败报成成功。** 验收由工具自己跑，也只有工具能打勾。

## 无人值守运行

`/ff:auto` 一次跑一个任务，每个任务用一个干净的进程，都在单独的分支上。

- 每个通过的任务是一个提交。失败任务的工作保留在分支上，下一个任务从干净状态开始。
- 卡住的任务交给干净的主控进程，它可以收窄或拆分任务。计划的每处改动都会列出，验收被改过的结果要你复核。
- 模型额度用尽时运行会暂停，不会把任务判为失败。
- 无输出超时按执行者配置（`idleMinutes`）：Codex 默认 10 分钟，Claude 和 Pi 默认不限。静默进程会被终止，每次尝试可免费重试一次。评审静默超时记为执行失败，但它已打印的 FAIL 仍然有效。
- 契约档和高风险任务会评审。常规任务不评审，这些提交要你自己读。运行报告会列出已完成但未经评审的任务。
- 它不会推送、合并或上线。第二天早上你会看到一份报告。

这需要一个能在命令行运行的执行者，配置时会设好 `claude`、`codex` 或 Pi 上的模型。

把 `ff wait [--timeout-min <n>]` 作为宿主后台任务运行，最新一次运行结束时即可唤醒会话。它输出状态和摘要路径：退出码 0 表示完成，1 表示其他结束方式或没有运行记录，3 表示等待超时。宿主没有后台任务时，在后续会话用 `ff status` 查看。

`ff stop` 可以停止运行，未完成的工作会存到分支上。`ff wait` 会一直等到运行结束。`ff cleanup` 预览并清理旧运行记录。

## 通知

Forge Flow 可以在工作结束时通过 webhook、Telegram 或两者通知你。不配置就不发送。创建 `~/.ff/notify.env`：

```
FF_TELEGRAM_BOT_TOKEN=<机器人令牌>
FF_TELEGRAM_CHAT_ID=<会话 ID>
FF_NOTIFY_WEBHOOK=<地址>
FF_NOTIFY_MIN_MINUTES=5
FF_NOTIFY_LANG=zh
```

两个渠道可以只配一个。`ff notify --test` 发送测试消息。

通知会注明机器名。一轮以提问结束时，会发送「等待你回应」（waiting）通知，而非「已完成」（done）。如果运行的主控进程意外退出，下次在该项目启动会话时会报告。每次发送尝试都会记入 `~/.ff/notify-log.jsonl`，只保留最近 200 次，不记录消息正文或秘密信息。

| 时机 | Claude Code | Codex | Pi |
|---|---|---|---|
| `ff run --all` 结束、无法启动或因额度暂停 | 是 | 是 | 是 |
| 运行至少 `FF_NOTIFY_MIN_MINUTES` 分钟的一轮结束 | 是 | 是 | 是 |
| 一轮因 API 错误结束 | 是 | 否 | 是 |
| 输入框空闲，等你回应 | 是 | 否 | 否 |
| 主会话弹出权限请求，需要你批准 | 是 | 否 | 否 |

每轮最多发一条，权限弹窗除外，每个弹窗发一条。只有你正在使用的交互会话会发：子代理、`claude -p` 或 `codex exec` 这类无界面运行、ff 启动的进程都不发，自动批准的请求也不发。消息会截短，已知的密钥格式会被隐藏。发送失败不影响工作。Codex 要先用 `/hooks` 信任一次插件的钩子才会运行。

## 保护主分支

```
ff protect
```

每个仓库运行一次。它安装一个 git `commit-msg` 钩子，拒绝在 `main`、`master` 和 origin 默认分支上提交，对所有工作树和所有工具都生效。如果 `core.hooksPath` 是相对路径，它只覆盖当前工作树，并会明确提示。以 `docs:` 或 `docs(` 开头的提交和合并提交仍可通过。`FF_ALLOW_MAIN=1 git commit ...` 可放行一次。

用 `--branch <名称>` 增加分支，`--status` 查看状态，`--remove` 移除。本地钩子只是兜底，`--no-verify` 可以跳过。要做到谁都跳不过，请在代码托管平台上再开分支保护。

## 项目目录

```
ff init            # 预览
ff init --apply    # 创建缺少的部分
```

`init` 会建好 `docs/`、存放计划、待定事项和跟进事项的 `planning/`，以及被 git 忽略的 `temp/`，里面按 `scripts/`、`logs/`、`scratch/`、`snapshots/`、`backups/` 分类。它会在 `AGENTS.md` 末尾加一节简短的「Files and folders」，并沿用项目已有的命名，比如 `temp-ignore/`。worktree 放在仓库旁边的 `../<仓库名>-worktree/`。

`ff docs` 会根据改动的文件列出可能需要更新的文档。在文档开头写 `Covers: <通配符>` 就能把它和代码关联起来。

`ff wt new <名称>` 从最新主分支创建 worktree，`ff wt clean` 在归档被忽略的文件后删除已合并的 worktree，包括 squash 合并的。

## 并行运行

`ff run --all --lanes 2` 让 `Files:` 互不相交的任务在各自的 worktree 里同时运行，逐个合并回来，每次合并后重跑验收，有冲突的任务转到最后串行处理。`--dry-run --lanes 2` 可以先预览分组。没写 `Files:` 的任务、高风险任务和改动仓库级文件的任务会串行运行。

## 清理

`ff cleanup` 预览旧的运行、评审和合议记录，以及已合并的本地 `ff/*` 分支，加 `--apply` 才删除。每个目录保留最新 20 项，且只删 30 天以前的，可用 `--keep`、`--days` 或配置里的 `cleanup: { keep, days }` 调整。运行中的记录、名字含备份字样的内容和未合并分支都会保留。详见 [CLI 清理](cli/README.md#cleanup)。

## 模型

| 你有几家模型 | 怎么分工 |
|---|---|
| 一家 | 一个模型开发，干净进程评审。汇报会写明没有独立评审。 |
| 两家 | 一家开发，另一家再读一遍。 |
| 三家或更多 | 同上，高风险工作再加第三家。 |

缺少某个模型只会让流程降级，不会卡住。在 Pi 上，一个工具能接多家厂商，角色写模型名就行。

## 你自己的规则

项目设置放在 `.ff/config.json`，它优先于 `~/.ff/config.json`。你自己的规则放在 `~/.ff/my-rules.md`。工具用法见 [cli/README.md](cli/README.md)。

## 更新

运行 `/ff:update`，或者用宿主自带的插件更新。每个版本都打了标签，随时可以固定到旧版本。

## 许可

[MIT](LICENSE)
