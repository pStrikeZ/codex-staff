# 命令参考

以下 `codex-staff` 表示 `node /absolute/path/to/codex-staff/companion/codex-companion.mjs`；通过 npm 安装的同名可执行入口行为相同。

## 启动任务

```text
staffer | research | review | implement | ask
  --prompt <文本> | --prompt-file <路径> | --stdin
  [--model <id>] [--effort <级别>]
  [--restricted | --unrestricted] [--timeout <时长>]
  [--continue | --conversation <thread-id>]
  [--json]  （仅 review）
```

三种输入来源必须且只能选一个，最大 2 MiB。文本不重新解析为参数，不接受位置参数形式的任务。续接时，任务文件先按调用者当前目录读取，再回到原作业 cwd。

模型与 effort 独立选择；省略时遵循 Codex 的配置及会话行为。effort 可用拼写为 `none|minimal|low|medium|high|xhigh|max|ultra`，实际支持取决于模型及 provider，不支持时会报错，不会自动降级。

时长支持 `ms|s|m|h`。执行硬时限须大于 0，最大 120m；ask 默认 2m，其余默认 60m。`wait --timeout` 是独立的观察时限，默认 100s，可为 0。

## 权限

| 模式 | 默认 | `--restricted` |
| --- | --- | --- |
| ask | read-only | read-only |
| research / review | danger-full-access | read-only |
| staffer / implement | danger-full-access | workspace-write |

所有调用都设置 `approval_policy="never"`，ask 忽略 `--unrestricted`。本地沙箱不决定 MCP 服务权限，ask 的无工具要求是提示词约定。

`setup --restrict research,review` 设置当前项目默认值；`setup --restrict none` 清除。显式参数优先于项目默认；续接默认继承所选原作业的权限配置。

## 结构化审查

`review --json` 通过 `--output-schema` 使用 `templates/review.schema.json`，并验证最终响应。成功时 `wait`、`result` 及保存的结果只含 JSON，诊断走 stderr：

```json
{"verdict":"approve","summary":"审查结论","findings":[],"could_not_verify":[]}
```

verdict 为 `approve|request_changes|comment`。每条 finding 必须包含字符串字段 `severity,file,line,title,detail`，severity 为 `critical|high|medium|low|nit`。拒绝缺少字段或多余字段的响应。失败返回非零退出码及诊断报告。续接和重启保留 schema。

## 作业操作

| 命令 | 行为 |
| --- | --- |
| `status [id]` | 最近作业列表，或单个记录及有限日志尾部 |
| `observe [id]` | 最大 8 KiB 的 JSON 进度或终态元数据，默认最新作业 |
| `wait [id] --timeout 10m` | 等待并输出报告，默认最新作业 |
| `result [id]` | 输出保存的报告，默认最近结束的作业 |
| `cancel <id>` | 请求停止并等待 worker 完成清理 |
| `continue --job <id> --prompt <文本>` | 同一 Codex 会话中的新作业 |
| `continue --conversation <thread-id> --prompt <文本>` | 续接本地记录过的指定会话 |
| `continue --prompt <文本>` | 续接最近记录的会话 |
| `restart <id> [--timeout <时长>]` | 根据保存的任务和当前上下文新建会话 |

continue 支持覆盖模型、effort、权限、时限及 review JSON，默认继承指定作业的模式、原 cwd、显式模型/effort、权限与 schema。restart 保留任务配置，默认重新使用该模式的默认执行时限，可由 `--timeout` 覆盖。运行中的会话拒绝续接，不排队；要立即改方向，先 cancel 并确认终态。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功；wait/result 已交付报告 |
| 1 | 调用错误、结果不可用或状态错误 |
| 2 | 仍在运行，观察时限到期 |
| 3 | 执行失败或 worker 崩溃 |
| 4 | 已取消 |
| 5 | 达到执行硬时限，已记录可恢复会话 |

status 单个查询、observe、wait 使用作业状态码；result 对仍运行或没有结果文件的作业返回 1。status 列表返回 0。cancel 确认取消或发现已停止时返回 0。observe 不读取完整结果，需从原 wait 或 result 收集。Codex 进程成功不代表任务验收通过。

## 状态和恢复

`.codex-staff/state.json` 使用锁和原子替换，作业先登记再启动。每个作业保存规格、日志、结果和结果状态文件；有需要时保留原始 JSONL 事件及进度快照。写入最终结果后才公布终态。多个调用不能同时续接同一个活跃会话。

进度最多展示五项工具活动和有限的回答尾部，不展示 reasoning。无警告的成功执行清除事件流和快照；失败及警告保留。任务规格、报告与 Codex 自身会话分别保存，job ID 与 Codex thread ID 不同。

硬超时和取消会终止已识别的执行进程树，再保存终态。收到完成事件但进程未成功退出，不能判定成功。清理核对 PID 的进程出生标识；若进程查询不可用，会在诊断中明确指出。宿主权限上下文不同也可能让存活进程不可见，应从原上下文核查。

超时报告保留会话、配置、部分进度、工作区状态及建议恢复命令，不自动重试。检查已有变更并确定下一次执行后，可 continue 原会话或 restart 新会话。取消和失败不会撤销文件。Git 状态摘要无法识别所有已脏文件的进一步变更，应检查真实 diff 及产物。

协议细节及文件布局见 [English reference](REFERENCE.md)；启动、认证、恢复问题见 [troubleshooting](../skills/jobs/references/troubleshooting.md)。
