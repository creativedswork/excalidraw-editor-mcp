# M3 AI 结构化编辑与 Session 交接验证

> 状态：`AWAITING_ACCEPTANCE`
>
> 验证日期：2026-09-04
>
> 功能 HEAD：`d7a7f7b`

## 结论

M3 S1-S6 已形成等待人工验收的功能候选。

1. `inspect_canvas` 提供有界语义查询。
2. `apply_canvas_changes` 提供原子 batch、revision CAS、`mutationId` 幂等和关系操作。
3. `replace_canvas` 校验并恢复固定版本文档。
4. Saved View 的 Ask AI 通过普通 Session 消息携带 canonical canvas path、revision、
   selection 和用户指令。
5. DSH sandbox retained publication link 可安全归一化，后续 user hardlink 仍被拒绝。
6. MCP lifecycle、inspect 和 mutation 的 bounded machine-readable JSON 对模型可见。
7. commit `d7a7f7b` 的真实模型双画布 storyboard 已完整通过，并生成同 run GIF。

本报告是 Milestone 功能验收证据，不代表 Release Hardening 或上线标准已经完成。

## Commit 范围

| Commit | 说明 |
|---|---|
| `8b7065b` | `feat: add semantic canvas inspection` |
| `c888eb1` | `feat: apply atomic canvas changes` |
| `fafca9b` | `feat: add canvas relationship operations` |
| `2f35ba2` | `feat: hand off canvas edits to AI` |
| `c610bca` | `docs: close M3 validation` |
| `b9f301f` | `docs: correct M3 runtime validation` |
| `c76efd2` | `fix: normalize sandbox-retained canvas links` |
| `d7a7f7b` | `fix: expose canvas metadata to models` |

本次接任 Owner 只更新 `docs/status/M3.md` 和本报告；未改产品源码，未重跑已完成的
产品实现、route probe、单元测试、typecheck 或 build。

## 自动化验证

| 检查 | 结果 | 证据 |
|---|---|---|
| M3 focused self-test | PASS，8/8，2.96 秒 | `.tmp/m3/m3-quick-self-test.log` |
| S5 store regression | PASS，5/5 | checkpoint 记录的 `node --test tests/m1-store.test.mjs` |
| S6 MCP contract | PASS，4/4 | checkpoint 记录的 `node --test tests/m3-mcp.test.mjs` |
| `pnpm typecheck` | PASS | `.tmp/m3/m3-typecheck.log` 及 S5/S6 checkpoint |
| detached production build | PASS | `.tmp/m3/runtime-build.log` |
| main production build | PASS | `.tmp/m3/main-runtime-build.log` |
| route probe | PASS，真实模型返回 `M3_ROUTE_PROBE_OK` | 既有 route evidence |
| final storyboard | PASS | `evidence/runtime-results.json` |
| GIF encode/inspection | PASS | `evidence/m3-s6-storyboard.gif`、`evidence/gif-check/` |

Build 仅报告既有 `EMPTY_IMPORT_META` warning。功能开发以多小时计；集中自动化和
最终 runtime 验证以分钟计，明显短于开发时间。

## Final Run Identity

- Origin：`http://127.0.0.1:3102`
- Candidate tree：
  `.playwright-mcp/m3-s6-runtime-d7a7f7b-20260904/candidate`
- Candidate commit：`d7a7f7b4ef757799f64d61e3a9e3a6227a86c7c0`
- Host PID：`15907`
- Candidate MCP PID：`18227`
- Runtime PID：`60191`
- Session：`session-d5b672a8-6836-47b3-adbd-b080755f9c15`
- Workspace：
  `.playwright-mcp/m3-s5-final-c76efd2-20260904/workspace/m3-isolated-workspace`
- Project：`excalidraw/m3-smoke-1788497278546-60191`
- Model route：真实 `m3-anthropic/deepseek-v4-pro`
- Browser state：fresh persistent profile
- Fixture/mock/test hook：未使用

启动前 root 和 `/api/mcp-apps/catalog` 均返回 HTTP 200。最终证据全部来自上述
runtime、Session、workspace 和 browser profile。

## Storyboard 断言

### Project And Initial Main

- 创建 managed project、main canvas 和 deployment canvas。
- main View 为 Clean。
- main 含两个 rectangle、两个 bound label text 和一条 arrow，元素数为 5。
- labels 精确为 `API`、`Database`。
- arrow 的 `startBinding.elementId` 与 `endBinding.elementId` 均指向两个 rectangle。

### Human Move And Save

- 通过真实 pointer 选择 API rectangle，再用 `ArrowRight` 移动。
- View 从 Clean 变为 Dirty；点击 Save 后回到 Clean。
- revision 从
  `a23f43d1161842c12b73b1febae9190fb922dd6028c8c098b895fb73871def2f`
  前进到
  `fb6903aceb1d42b36ef5ed76c929ae5ac21cb9108be1c0363fb6b551c1ee905e`。
- selected ID `2f8050b8-8e63-40c8-a37b-e39937dcdbb8` 保留。

### Ask AI

- saved-only Ask AI 发出普通 Session 消息。
- Session trace 显示模型先调用 `inspect_canvas`。
- 模型随后且仅随后执行一个 `apply_canvas_changes` batch，增加带 `Queue` label 的
  rectangle 并重排三个节点。
- 元素数从 5 增至 7；revision 前进到
  `bf7c825c2957139ba03f3a34b6ad5c430095f92d9f3c49cf35464d8200d28e46`。
- View instance ID 始终为 `60b239c6-7c3d-4ce7-b017-f05b7fa96a1b`，selected ID
  保留。
- 模型精确返回 `M3_AI_DONE`。

### Deployment

- main View 的 Ask AI 输入通过正式 Enter-submit 路径发送 deployment-open 消息。
- 模型只调用 `open_canvas` 并精确返回 `M3_DEPLOYMENT_OPEN`。
- newest connected Clean iframe 切换到 deployment。
- 通过真实 pointer/keyboard 绘制 rectangle 并点击 Save。
- 最终 deployment 为 Clean/Saved，元素数为 1，revision 为
  `2bfbf91864ead1c599a09bfe9ae3a5c2ac27d487053f6e673ea2ae3e1848e77d`。

## Evidence

根目录：
`.playwright-mcp/m3-s5-final-c76efd2-20260904/evidence/`

| Artifact | 用途 |
|---|---|
| `runtime-results.json` | 全部 hook 状态、revision、instance 和 selection 断言 |
| `tool-trace.txt` | 可见 Session 消息、tool 顺序和完成 sentinel |
| `session-d5b672a8-6836-47b3-adbd-b080755f9c15.jsonl.zstd` | 精确完整 Session trace |
| `final-main.excalidraw` | 最终 API/Database/Queue 与 bound arrow |
| `final-deployment.excalidraw` | 最终人工 rectangle |
| `browser-events.log` | MCP app 请求和浏览器事件 |
| `provenance.md` | commit、run identity、transport、GIF 参数和校验 |
| `m3-s6-storyboard.gif` | 五状态同 run 演示 |
| `gif-check/00.png` 至 `gif-check/04.png` | 编码 GIF 的代表帧 |
| `../frames/00-project-ready.png` 至 `../frames/04-second-canvas-saved.png` | 原始同 run 截图 |

关键 SHA-256：

- final main：
  `bf7c825c2957139ba03f3a34b6ad5c430095f92d9f3c49cf35464d8200d28e46`
- final deployment：
  `2bfbf91864ead1c599a09bfe9ae3a5c2ac27d487053f6e673ea2ae3e1848e77d`
- runtime results：
  `77a5f4672612436c8bc0d3a57f182a12806f7109c4cb4ca13b0a1f2dea837060`
- tool trace：
  `2a7e7b8aaba4b4d17dec544c1a3477540b2b17a41b4248cc9930f511c9978b23`
- GIF：
  `3d9dfa7bfd07ace67db93daef934f6b2fc4b99e6b653026546fd40859256d210`

GIF encoder summary：5 source frames、150 encoded frames、1200x834、10 fps、
15.0 秒、319798 bytes、128 colors。已目视检查编码后解码的五个代表帧，顺序、
可读性和最终停留均符合 storyboard；未发现 credential 或个人数据。GIF 未发布。

## Archived Failures

失败尝试均保留在最终 evidence 根目录的独立子目录，未混入最终 GIF。主要原因包括：

- composer 创建 workspace 后未选中；
- pointer 坐标落点错误；
- post-AI composer placeholder 不匹配；
- 清理 workspace 后复用固定 `mutationId` 命中长生命周期幂等缓存；
- stale/disconnected iframe 被错误选中；
- deployment Ask AI button 位于外层 viewport 之外。

最终 harness 使用 unique run suffix、拒绝 disconnected iframe、真实 iframe-local
pointer 操作和 Ask AI 输入的正式 Enter-submit 路径。所有 harness 与证据均在
gitignored `.playwright-mcp/` 下。

## Cleanup

- Runtime PID `60191` 和 browser 已退出。
- M3 process group `15810` 已停止。
- Host PID `15907`、candidate PID `18227` 和 3102 listener 均不存在。
- 无 `runtime.mjs` 或使用 storyboard profile 的 Chrome 进程存活。
- 无关 3097 listener PID `37490` 保持存活。

PTY 在结果写入后报告 Chrome Crashpad 尝试访问全局 settings 文件被 sandbox 拒绝。
该提示不影响 `runtime-results.json`、最终画布、Session trace、截图或 GIF 的完整性。

## Acceptance Steps

1. 复核 M3 commits 和自动化验证表。
2. 打开 `evidence/m3-s6-storyboard.gif`，确认五个状态的顺序和可读性。
3. 对照 `runtime-results.json` 验证 count、revision、instance ID 和 selection。
4. 对照 `tool-trace.txt` 与 Session trace 验证 inspect → single apply 和
   deployment open。
5. 检查两份 final canvas 文件的 labels、bindings 和 deployment rectangle。

预期结果：两个 canvas 均 Saved；main 包含 `API`、`Database`、`Queue` 和有效
bound arrow；AI 更新不替换 View、不丢失 selection；证据全部同源且不含 secret。

失败判定：batch 部分写入，CAS/幂等或引用修复失效，dirty Ask AI 可发送，模型未按
inspect/apply 顺序执行，AI 更新替换 View 或丢失选择，deployment 未保存，证据/GIF
缺失或混用不同 run。

## Release Hardening

- 全仓测试、全量 lint、覆盖率扩展、完整生产门禁和独立 Review。
- 大文档与复杂官方元素组合的压力及兼容性矩阵。
- 长时间 polling、多 View 并发、断线重连和长期 Session 耐久性。
- 不同真实模型/provider 的工具调用稳定性与 mutation ID 策略。
- 多个历史 View 的资源回收、可见性和 disconnected-frame 回归。

## Exclusions And Remote Status

- 未修改产品源码，未开始 M4，未修改其他仓库。
- 未访问 `default-canvas`。
- 未执行 push、PR、amend、rebase、发布或其他远端操作。
- GIF 和 runtime evidence 均保持 gitignored，closure commit 仅包含两份文档。
