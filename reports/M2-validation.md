# M2 可持续人工编辑验证

> 状态：Milestone candidate，等待人工验收
>
> 验证日期：2026-09-03

## 结论

M2 已完成 S1-S4：

1. View 维护完整本地草稿，selection/viewport 等瞬时变化不触发 Dirty。
2. Save、Reload、CAS Conflict 和 Save as copy 均为显式操作。
3. clean 画布低频同步外部 revision，并保留选择与 viewport；dirty 画布保留草稿并进入 Conflict。
4. 程序化 initialData、reload 和 external apply 以 Loading barrier 接受 canonical scene，不污染 Dirty 或 undo history。
5. Save 成功后提交有界 model context；MCP 子进程重启后恢复绑定 canvas path/revision。
6. inline/fullscreen surface 保持同一实例、选择和 viewport；desktop/mobile 均完成真实 Browser smoke。

Ask AI Session 消息交接按 DESIGN 留在 M3，本里程碑没有无功能按钮。

## 环境与自动化

- Node.js：`v24.18.0`
- pnpm：`10.25.0`
- 分支：`main`
- M2 基线：`27fa16f`
- quick self-test：`.tmp/m2/m2-quick-self-test.log`
- quick self-test SHA-256：`300cfe2f8936a1543f6543a366ad2ea97e6c9629fe4785386f405c619468e2a4`

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `node --test tests/m2-view-state.test.mjs tests/m2-mcp.test.mjs` | PASS，13/13 |
| `git diff --check` | PASS |
| 最终 production build | PASS，`.tmp/m2/s4-copy-fix-build.log` |
| Host readiness | PID `57670` 保持存活，`http://127.0.0.1:3080/` 返回 200 |

构建仍有既有 `EMPTY_IMPORT_META` warning；真实 IIFE View 已完成 Browser
运行验证。Playwright 关闭 Chromium 时命令包装器报告 Crashpad 路径
restricted，但脚本此前已写出 `phase=complete`、JSON 和截图，不影响业务
断言。

## 真实 DSH 验证

测试仅使用 fixture Workspace 中的隔离工程 `excalidraw/m2-smoke`，未访问
用户的 92-element `default-canvas`。验收完成后已删除该 M2 工程。

| 路径 | 结果 |
|---|---|
| initialData hydration | 首次 hook 为 Clean，持久文档完整加载 |
| pointer/keyboard/undo/redo | 2→4 elements，undo 4→3，redo 3→4 |
| Save + model context | 文件含 4 elements 和 `M2 smoke`；model context revision 与保存 revision 相同 |
| Reload | 未保存 5-element 草稿恢复为磁盘 4 elements |
| clean external apply | revision 前进，7→8 elements；状态保持 Clean |
| selection/viewport | 7 个 surviving selections 保持；viewport 保持 `(80, 50, 1)` |
| Conflict | 本地 9-element 草稿、选择和 viewport 均保留，不被外部文件覆盖 |
| Save as copy | 创建 `main-copy-1788437357260.excalidraw`；副本含本地元素，原文件含外部冲突元素 |
| MCP restart/polling | Server PID `14938`→`17015`；copy path、revision、10 elements 和 Clean 状态恢复 |
| surface continuity | inline/fullscreen/inline 的 instanceId、选择和 viewport 保持 |
| mobile | 390×844 截图可见状态栏、编辑区和操作栏 |

Save as copy 初次真实运行没有产生 tool request。Browser console 明确报告
`prompt()` 被 sandbox 拒绝；修复后按钮直接使用同目录时间戳 copy path，
真实 `save_canvas_copy`、磁盘文件和 model context 均通过。

## 证据

- 早期 pointer/save/reload/surface 数据：`.tmp/m2/runtime-evidence/runtime-partial.json`
- external/Conflict 阶段：`.tmp/m2/runtime-evidence/runtime-affected-final.log`
- Save as copy：`.tmp/m2/runtime-evidence/runtime-copy-reconnect-final.log`
- reconnect/mobile 数据：`.tmp/m2/runtime-evidence/runtime-affected.json`
- reconnect/mobile 阶段：`.tmp/m2/runtime-evidence/runtime-reconnect-mobile-final.log`
- Browser 请求响应：`.tmp/m2/runtime-evidence/browser-events-affected.log`
- desktop inline：`.tmp/m2/runtime-evidence/desktop-inline.png`
- desktop fullscreen：`.tmp/m2/runtime-evidence/desktop-fullscreen.png`
- mobile：`.tmp/m2/runtime-evidence/mobile.png`

截图 SHA-256：

- desktop inline：`6e1418e38d07a42bf09e5f302ea25f605bc03b5b7fa0c91aff94b839e463e581`
- desktop fullscreen：`be3c8a5b14405f261420fc25f4fbc8be02884890aa170632f1e7fb46be7405ab`
- mobile：`13e48009b588d38b2eb25c3f5a8c900ea7aa6c62878df60cc56674ef3d525b1f`

## 人工验收

1. 打开任意受管画布，确认初始状态为 Saved。
2. 编辑后确认 Dirty；Save 后确认 Saved，磁盘 revision 前进。
3. 制造外部更新：clean 时自动应用且保持选择/viewport；dirty 时进入 Conflict 且不丢草稿。
4. 在 Conflict 点击 Save as copy，确认状态栏切到时间戳副本路径，原文件不被覆盖。
5. 在 inline/fullscreen 间切换，确认实例、选择和 viewport 连续。

失败判定：初始误报 Dirty、程序化更新进入 Dirty、自动覆盖 dirty 草稿、Save
绕过 CAS、copy 覆盖原文件、重连后路径/revision 错误，或 surface 切换丢失
当前编辑上下文。
