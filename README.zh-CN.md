# Forge Flow

给编码智能体用的工程工作流。判断交给模型，事实交给工具。改一行不用走流程，一份计划也可以无人值守跑一整夜。

[English](README.md)

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

命令行工具需要 Node 22 或更新版本。装好后运行一次配置，它会找到你的工具和模型，并写入 `~/.ff/config.json`。

| Claude Code | Codex | Pi |
|---|---|---|
| `/ff:setup` | `$ff:setup` | `/ff-setup` |

## 使用

从 `go` 开始，说清你要什么就行。需要走多少流程，由它判断。

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
- 契约档和高风险任务会评审。常规任务不评审，这些提交要你自己读。
- 它不会推送、合并或上线。第二天早上你会看到一份报告。

这需要一个能在命令行运行的执行者，配置时会设好 `claude`、`codex` 或 Pi 上的模型。

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
