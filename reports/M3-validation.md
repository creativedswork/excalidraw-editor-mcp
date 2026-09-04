# M3 AI 结构化编辑与 Session 交接验证

> 状态：Milestone candidate，runtime storyboard blocked，等待人工验收
>
> 验证日期：2026-09-04
>
> 功能 HEAD：`2f35ba2`

## 结论

M3 S1-S4 产品实现和集中自测已完成：

1. `inspect_canvas` 支持有界语义查询。
2. `apply_canvas_changes` 支持原子批次、revision CAS 和 `mutationId` 幂等。
3. V1 关系操作会维护绑定、Frame 和删除引用不变量。
4. `replace_canvas` 校验并恢复固定版本文档。
5. Saved View 的 Ask AI 发送一条携带 canvas/revision/selection 的普通 Session 消息。

focused tests 8/8、typecheck、detached build 和 main build 均 PASS。真实 route probe
也已 PASS：Session `session-cbbbfbb4-7ab2-4ec2-a88a-08a60c674d78` 的实际
request/header 和 session-title-llm-request 都使用
`m3-anthropic/deepseek-v4-pro`，真实模型精确返回 `M3_ROUTE_PROBE_OK`。
旧报告中的 provider `1210` 不是当前最终 blocker。

完整双画布 storyboard 未完成。首次真实 Session 在 `workspace-write` 下创建 canvas
时，MCP atomic create 的 unlink 被 sandbox 阻止，canvas 留下 `nlink=2` 并被安全检查
拒绝。清理隔离 Workspace 后，唯一一次 corrected retry 准备在新 Session 使用现有
`Full access` preset，但 Host 冷启动页面在 30 秒内既未出现已识别 composer，也未出现
旧 `Choose workspace` 控件，因而在创建 Session 前停止。按 bounded execution 规则
没有第二次修正或重试。

## 自动化验证

| 检查 | 结果 | 证据 |
|---|---|---|
| M3 focused self-test | PASS，8/8，2.96 秒 | `.tmp/m3/m3-quick-self-test.log` |
| `pnpm typecheck` | PASS | `.tmp/m3/m3-typecheck.log` |
| detached production build | PASS，commit `2f35ba2` | `.tmp/m3/runtime-build.log` |
| main production build | PASS，功能 HEAD `2f35ba2` | `.tmp/m3/main-runtime-build.log` |
| route probe | PASS，真实模型精确返回 sentinel | `evidence/route-probe.json` |
| corrected storyboard retry | FAIL，Session 创建前 locator timeout | `evidence/runtime-error.txt` |

本次没有修改产品源码，因此没有重跑已经通过的 focused tests、typecheck 或 builds。

## Runtime 结果

### Run Identity

- Host：`http://127.0.0.1:3097/`
- Host PID：`37490`
- MCP PID：`41558`
- Workspace：`.playwright-mcp/m3-runtime-real-20260904/workspace/m3-isolated-workspace`
- Route Session：`session-cbbbfbb4-7ab2-4ec2-a88a-08a60c674d78`
- Failed storyboard Session：`session-757009ad-4b03-4c19-9ea3-6522ff0f6e03`
- Runtime root：`.playwright-mcp/m3-runtime-real-20260904`

### Route Probe

结果为 PASS。`route-probe.json` 同时记录 request/header、title request、assistant
completion 和 turn end；两条路由均为 `m3-anthropic/deepseek-v4-pro`。对应压缩 Session
log 已复制到 evidence 目录。

### Storyboard Attempt

首次 Session 确实调用了 Excalidraw MCP，但在 `create_project` 后返回：

```text
Error: workspace path is not a regular unlinked file:
excalidraw/m3-smoke/main.excalidraw
```

提取 trace 证明该 Session 使用正确模型路由，并记录 create/list/inspect 的准确
arguments 和 tool result。该 Session 随后的探索不是有效 storyboard。

corrected retry 只改动 gitignored runtime harness：

- 识别当前中文 composer `给智能体发消息`；
- 停止遗留 turn；
- 新 Session 选择现有 `Full access` preset；
- MCP 失败时禁止转入 Bash/Read 诊断；
- harness 通过 `node --check`。

执行时 `connectFreshWorkspace()` 在以下 locator 等待 30 秒后超时：

```text
[aria-label="Choose workspace"], [aria-label="选择工作区"]
```

该 run 没有创建新 Session、没有发送模型请求，也没有写入 fixture。随后只读检查显示
页面最终可见中文 composer 和 `m3-isolated-workspace`，说明当前未解决的是 Host
readiness/定位时序，而不是模型路由或产品 MCP 返回。

## Evidence

根目录：`.playwright-mcp/m3-runtime-real-20260904/evidence`

- `route-probe.json`
- `route-probe-browser.json`
- `route-probe-session.jsonl.zstd`
- `failed-storyboard-mcp-trace.jsonl`
- `runtime-error.txt`
- `runtime-results.partial.json`
- `browser-events.log`
- `corrected-retry-blocker.png`
- `failed-attempt/`：首次失败时的原始诊断文件

关键 SHA-256：

- route probe：`dd7c4374606c9a3cb9f03529638c63815a166627478f82bed9d28f3326f6b072`
- route Session：`eed206394a9fa7b07095fee5daaf658df05a6980cacdcbbb71567a558f789f36`
- failed MCP trace：`061d709ca990e0d4eeec3311e6cb64e87938fe2738fab4791d04d11c34319468`
- corrected error：`c992d4e3eaf7363187ff4dc0a5a36c7287ba5e3938d4941050ed640adb4405f7`
- blocker screenshot：`d3e02e657a4ecdf4b7660e355560a78a1a987abf28e6311370311e1c21a7d79f`

没有最终 `.excalidraw` 文件、3-6 张同 run 语义截图或 GIF。storyboard 未开始，
不能把 route probe、旧失败 Session 和 blocker 截图拼接成一个证据 run；
`record-browser-gif` encoder 因少于两个同 run 合格 frame 而未执行。GIF 未发布或推送。

## Cleanup

- 失败的 `excalidraw/m3-smoke`、`excalidraw/m3-fresh-test` 和诊断 test files
  已从隔离 Workspace 清理。
- 隔离 Workspace 当前为空。
- `default-canvas` 未访问或修改。
- Host PID `37490` 和 MCP PID `41558` 保持存活，3097 返回 HTTP 200。

## Acceptance Steps

1. 复核 S1-S4 commits：`8b7065b`、`c888eb1`、`fafca9b`、`2f35ba2`。
2. 复核本报告的 8/8 focused tests、typecheck 和两次 build PASS 证据。
3. 打开 `http://127.0.0.1:3097/`，在 `m3-isolated-workspace` 新建 Session，
   将访问模式切换为 `Full access`。
4. 创建 `excalidraw/m3-smoke`、`main.excalidraw` 和 `deployment.excalidraw`；
   用一个 batch 创建 API、Database 和 bound arrow，并打开 main View。
5. 人工移动节点、Save、保留选择并点击 Ask AI；确认 Agent 先
   `inspect_canvas`，再用一个 `apply_canvas_changes` batch 添加 Queue 和调整布局。
6. 确认同一 View instance 的 revision 前进且 surviving selection 保留；打开
   deployment View，人工编辑并 Save。
7. 保留同一 run 的精确 tool trace/Session log、两份最终画布和 3-6 张语义截图，
   编码本地 GIF，并目视检查编码后的 GIF。

预期结果：两个 canvas 均为 Saved；main 包含三个节点和有效关系；AI 更新不替换
View、不丢失 surviving selection；证据同源且不包含 secret。

失败判定：batch 部分写入、CAS/幂等或引用修复失效、dirty Ask AI 可发送、Agent
未按 inspect/apply 顺序执行、AI 更新替换 View 或丢失选择、双画布/证据/GIF 缺失，
或 Workspace/composer readiness 再次阻断新 Session。

## Release Hardening

- 全仓测试、全量 lint、覆盖率扩展、完整生产门禁和独立 Review。
- 大文档、复杂元素组合、多 View、长时间 polling 和断线耐久性。
- 修复 Host 冷启动 readiness locator 后，重跑完整双画布真实模型 flow，并补齐
  tool trace、最终画布、同 run 截图和目视核验 GIF。

## Exclusions And Remote Status

- 未修改产品源码，未开始 M4，未修改其他仓库。
- 未访问 `default-canvas`。
- 未执行 push、PR、amend、rebase、发布或任何其他远端操作。
