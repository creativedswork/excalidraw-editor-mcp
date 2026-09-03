# M3 AI 结构化编辑与 Session 交接验证

> 状态：Milestone candidate，等待人工验收
>
> 验证日期：2026-09-04
>
> 功能 HEAD：`2f35ba2`

## 结论

M3 已完成 S1-S4 的产品代码和定向自动化验证：

1. `inspect_canvas` 支持语义过滤、cursor 分页、截断、容器 label 折叠和有界结构返回。
2. `apply_canvas_changes` 支持原子批量变更、同批 `clientRef`、revision CAS 和 `mutationId` 幂等。
3. V1 关系操作支持排序、分组、绑定和 Frame 成员变更；删除会修复悬空引用。
4. `replace_canvas` 执行 schema、大小、引用和官方 restore 校验。
5. View 仅在 Saved 状态发送一条普通 Ask AI Session 消息；消息携带画布路径、revision、选择和用户文本。

集中快速自测 8/8 通过，类型检查和生产构建通过。实际 DSH 人机回合未完成：
隔离 Host 在 `session.create` 阶段重复超时；获准使用原 Host 后，fresh Session
创建和用户消息写入成功，但当前模型路由在调用 MCP 前返回 provider `1210`
错误。因此本报告不宣称完成 tool trace、最终画布、完整截图序列或 GIF。

## 自动化验证

| 检查 | 结果 | 证据 |
|---|---|---|
| M3 focused self-test | PASS，8/8，2.96 秒 | `.tmp/m3/m3-quick-self-test.log` |
| `pnpm typecheck` | PASS | `.tmp/m3/m3-typecheck.log` |
| detached worktree production build | PASS，commit `2f35ba2` | `.tmp/m3/runtime-build.log` |
| main checkout production build | PASS，功能 HEAD `2f35ba2` | `.tmp/m3/main-runtime-build.log` |
| `git diff --check` | PASS | 最终文档提交前复核 |

集中测试覆盖：

- inspect 的 ID/type/text 过滤、cursor 分页、截断和 label 折叠。
- 九种 add 类型、existing-file image、update/remove/set_canvas 和同批 `clientRef` 绑定。
- 无效批次零部分写入、stale revision、exact retry 和 mutationId mismatch。
- reorder、group/ungroup、bind/unbind、add_to_frame/remove_from_frame 和删除引用修复。
- `replace_canvas` 字段保留、无效引用、超限输入、stale revision 和幂等复用拒绝。
- Ask AI dirty/conflict 阻断和一条有界 Saved Session 消息。

## DSH 运行验证

### 隔离 Host

隔离 Host `http://127.0.0.1:3096/` 使用 clean `2f35ba2` worktree、独立
`DSH_HOME`、Workspace 和浏览器 profile。Host 曾达到 HTTP 200，但浏览器记录到：

```text
initial workspace selection failed: SessionCreateError:
session create failed: internal: signal timed out
requestfailed:http://127.0.0.1:3096/api/session.create:net::ERR_ABORTED
```

随后 `page.reload` 等待 navigation `commit` 超时。按停止条件未继续重试。

### 原 Host fallback

用户批准复用原 Host 和已验证浏览器 profile。该运行不是全新 Host/profile：

- Host：PID `57670`，`http://127.0.0.1:3080/`。
- Workspace：Three.js MCP 的 `tests/fixtures/m6/workspace`，只允许创建
  `excalidraw/m3-smoke`。
- Browser：复用 M2 已验证 profile。
- M3 MCP：main checkout 在功能 HEAD `2f35ba2` 重新构建后，将子进程
  PID `17015` 替换为 PID `11695`。

fallback 成功创建 fresh Session
`session-3ab217b0-b317-40da-9183-01f6c8acb0d9`，并记录完整用户请求。
模型请求随后在任何 MCP tool call 前结束：

```text
400: {"code":"1210","message":"API 调用参数有误，请检查文档。"}
code: INVALID_REQUEST
```

因此：

- 未创建 `excalidraw/m3-smoke`，`default-canvas` 未被访问或修改。
- 未生成 Excalidraw tool trace 或最终 `.excalidraw` 文件。
- 只保留请求态截图 `00-create-request.png`，没有将其伪装成完成证据。
- 不满足至少两帧的编码条件，未生成或发布 GIF。
- Host PID `57670` 和 M3 MCP PID `11695` 在停止后保持存活，3080 返回 200。

## 证据

- focused tests：`.tmp/m3/m3-quick-self-test.log`
- typecheck：`.tmp/m3/m3-typecheck.log`
- detached build：`.tmp/m3/runtime-build.log`
- main build：`.tmp/m3/main-runtime-build.log`
- 3096 browser 事件：`.playwright-mcp/m3-runtime/evidence/browser-events.log`
- 3096 runtime 错误：`.playwright-mcp/m3-runtime/evidence/runtime-error.txt`
- 3080 请求态截图：`.playwright-mcp/gif-frames-m3-3080/00-create-request.png`
- 3080 Session log：`~/.dsh/sessions/--Users-bytedanceo-Workspace-DeepSeekSpace-threejs-editor-mcp-tests-fixtures-m6-workspace--/session-3ab217b0-b317-40da-9183-01f6c8acb0d9/session.jsonl.zstd`

关键 SHA-256：

- focused tests：`a2240f713ce9aada32391cac7ad5e9157b40bcd22293f3065d06bd34eaa86096`
- typecheck：`bd4ac3e3757b1d09e49b10675e5ae4c90e9de0d4576c99079d9dfd0067b3e523`
- detached build：`0a7993a3339deee6a0b3c04defaf274817550e448d115b9cf8373eaee8ff95de`
- main build：`ed0ff1d566549c6141ed97c0687ca7c80b951de45241410735b6bb6086662a31`
- 3080 请求态截图：`87a91504f5bc16a1b2613c0a2ffb59d036b6a95fe22a1a152d02d0d900eb4dc7`
- 3080 Session log：`5fb8256b9dc94cb94203db60eb2f877f07c65345eacdc63f7927b9d1bc2d663e`

## Release Hardening

以下检查未在 M3 开发阶段执行：

- 全仓测试、全量 lint、覆盖率扩展和独立 Review。
- 大文档、复杂元素组合、多 View、长时间 polling 和断线耐久性。
- 使用可工作的原 Host 模型路由重跑一次完整人机双画布回合，保留 tool trace、
  最终画布、完整截图序列，并编码和目视核验 GIF。

运行时补验必须继续使用隔离工程，不能访问 `default-canvas`。当前 provider `1210`
错误解除前，不应重复浏览器运行。

## 人工验收

1. 检查 S1-S4 的四个本地 commit 和本报告中的 8/8 集中测试结果。
2. 在 Saved 画布执行 Ask AI，确认只生成一条普通 Session 消息，且 dirty/conflict
   状态无法发送。
3. 使用可工作的模型路由创建 `excalidraw/m3-smoke` 双画布，观察模型先 inspect，
   再执行一个 `apply_canvas_changes` 批次。
4. 人工移动并保存一个节点，再由 AI 增加节点；确认 iframe 实例不替换、revision
   前进且 surviving selection 保留。
5. 打开第二张画布，人工编辑并保存；保留 tool trace、两份最终画布、截图和 GIF。

失败判定：批次发生部分写入、stale revision 被覆盖、mutationId 不同输入被复用、
删除后存在悬空引用、`replace_canvas` 接受无效或超限文档、dirty Ask AI 可发送、
clean AI 更新替换 iframe 或丢失 surviving selection，或运行时仍在 MCP 调用前失败。
