# Codex Staff

[English](README.md) · [项目仓库](https://github.com/pStrikeZ/codex-staff)

在 Claude Code 或 Pi 中把任务交给 **Codex CLI**。参照 [agy-staff](https://github.com/keli-wen/agy-staff) 实现，保留角色技能、持久化后台作业、进度快照、取消、会话续接及重启，执行层改为 Codex JSONL 协议。只使用 Node.js 标准库，无 npm 第三方依赖。

| 技能 | 执行命令 | 用途 |
| --- | --- | --- |
| staffer | `staffer` | 通用任务 |
| researcher | `research` | 调研，附证据和未验证事项 |
| reviewer | `review` | 代码、方案和决策审查，可输出 JSON |
| implementer | `implement` | 实现及验证 |
| ask | `ask` | 同步简短问答 |
| lead | — | 主代理负责委派、验收、整合及交付 |
| jobs | 作业管理命令 | 收集、观察、取消和恢复 |

## 环境要求

- Node.js 20 或更新版本。
- 已安装并登录 Codex CLI：`codex --version`、`codex login`。需要支持 `codex exec --json`、`exec resume` 和 `--output-schema`；集成测试使用 CLI 0.157.0。
- Git 可选。同一 Git worktree 内共享作业状态；无 Git 时使用当前目录。

默认沿用已有的 Codex provider、模型及 reasoning 配置。`--model` 与 `--effort` 可分别覆盖，不会自动换模型。

## 安装技能

### 让 Agent 帮你安装

把下面这段提示词直接复制给你的 coding agent：

```text
Read the raw text of https://raw.githubusercontent.com/pStrikeZ/codex-staff/master/docs/INSTALL_FOR_AGENTS.md (curl it — do not
work from a summary) and follow it to install and verify the codex-staff plugin for the harness you are running in.
Respond in the user's language.
```

### 手动安装

以下命令由宿主直接从 GitHub 下载并安装：

**Claude Code：**

```bash
claude plugin marketplace add https://github.com/pStrikeZ/codex-staff.git
claude plugin install codex-staff@codex-staff
```

重启后使用 `/codex-staff:staffer` 等技能。

**Pi：**

```bash
pi install https://github.com/pStrikeZ/codex-staff.git
```

执行 `/reload`，然后使用 `/skill:codex-staffer` 等入口。七个入口分别是 `codex-staffer`、`codex-researcher`、`codex-reviewer`、`codex-implementer`、`codex-ask`、`codex-lead`、`codex-jobs`。

详细安装流程见 [INSTALL_FOR_AGENTS](docs/INSTALL_FOR_AGENTS.md)。

## 直接使用

安装完成后，从目标工作区执行。将 `/path/to/installed/codex-staff` 替换为宿主登记的实际安装目录，定位方法见[验证已安装副本](docs/INSTALL_FOR_AGENTS.md#3-verify-the-installed-copy)。

```bash
node /path/to/installed/codex-staff/companion/codex-companion.mjs setup
node /path/to/installed/codex-staff/companion/codex-companion.mjs ask --prompt "只回复 OK"
node /path/to/installed/codex-staff/companion/codex-companion.mjs research --prompt "调查本项目的入口及调用关系"
node /path/to/installed/codex-staff/companion/codex-companion.mjs wait <job-id> --timeout 10m
```

任务文本必须通过 `--prompt <文本>`、`--prompt-file <路径>`、`--stdin` 三者之一传入。长任务建议使用文件。文本通过 stdin 交给 Codex，不经 shell 拼接执行。

`ask` 等待并返回答案；其他四种模式立即返回后台作业 ID。`wait` 等待并打印完整结果，等待超时返回 **2**，原作业仍在运行，继续等待同一个 ID 即可。`observe <id>` 查看有长度限制的进度快照；`cancel <id>` 停止执行；`continue --job <id> --prompt <文本>` 在同一 Codex 会话中续接；`restart <id>` 在新会话中重做保存的任务。

## 权限及状态

与 agy-staff 一致，使用工具的模式默认 **unrestricted**；`ask` 固定使用只读沙箱。可设置当前项目的受限默认值：

```bash
node /path/to/installed/codex-staff/companion/codex-companion.mjs setup --restrict staffer,research,review,implement
```

受限 research/review 使用 `read-only`；受限 staffer/implement 使用 `workspace-write`。所有任务均设置 `approval_policy="never"`，不会等待交互式批准。单次调用的 `--restricted` / `--unrestricted` 优先于项目默认值。MCP 服务权限独立于本地沙箱，启动它的宿主仍须具有相应执行权限。`ask` 的“不用工具”是提示词约定，不是禁用全部工具的 API。

作业状态、任务文本、报告和诊断保存在 `.codex-staff/`。首次运行会尽可能写入 Git 本地 exclude 文件；无警告的成功任务会清除事件流及进度快照，失败或带警告任务保留诊断。任务规格和结果继续保留，供续接及重启使用；这些文件可能包含任务数据，不应公开发布。

执行硬时限默认 **60 分钟**，ask 为 **2 分钟**，均最多 **120 分钟**。它与 `wait --timeout` 的观察时限独立。达到硬时限会终止执行并保留恢复信息，不会自动重试。取消不会撤销已写入的文件。退出码、结构化审查和恢复规则见 [中文命令参考](docs/REFERENCE.zh-CN.md)。

## 开发与验证

```bash
npm run generate:pi
npm run check:pi
npm test
npm pack
```

无需运行 `npm install`。离线测试使用隔离的 Codex 替身，打包测试会解压真实 npm 包并运行其中的 companion。真实 CLI 测试需主动启用，使用现有 Codex 账户，见 [测试说明](docs/TESTING.md)。

编辑 `skills/` 后重新生成 `pi-skills/`。运行代码在 `companion/`，提示模板与审查 schema 在 `templates/`。发布时保持 package.json 和两个插件 manifest 的版本一致。Windows 进程处理有离线测试，真实 Windows Codex 集成尚未验证。

MIT 许可，保留原项目的 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
