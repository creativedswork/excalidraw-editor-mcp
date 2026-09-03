# M1 工程与画布生命周期验证

> 状态：Milestone candidate，等待人工验收
>
> 验证日期：2026-09-03

## 结论

M1 已完成 S1-S4：

1. Workspace 内路径、符号链接和文件类型边界受控。
2. 标准 `.excalidraw` 文档支持规范化、SHA-256 revision、CAS、原子写和 mutation 幂等。
3. managed/discovered 工程支持发现、创建、检查、重命名、复制和删除。
4. 工程内画布支持创建、打开、检查、重命名、复制和删除，并保持默认画布一致性。
5. MCP Server 从可信 DSH metadata 获取 Workspace，按 Session 限制 app-only 画布访问。
6. 发布 tarball 可安装，并可从临时工程启动 stdio Server、列出 M1 工具。

## 环境

- Node.js：`v24.18.0`
- pnpm：`10.25.0`
- 分支：`main`
- M1 生产代码 HEAD：`6cec45c`
- 完整日志：`.tmp/m1/m1-self-test.log`
- 日志 SHA-256：`c19c2ddcc4e38c28740322c7b135a9ffd67f1b4b27486e1b7756799b11dc3547`

## 自动化结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `node --test tests/m1-store.test.mjs tests/m1-project-store.test.mjs tests/m1-canvas-lifecycle.test.mjs tests/m1-mcp.test.mjs` | PASS，12/12 |
| `pnpm test` | build PASS；测试 15/15 PASS；packed install PASS |

`pnpm test` 的 Node 测试耗时约 12.5 秒，其中 packed install 约 11.6 秒。
本环境的命令包装器在全部断言通过后阻止 pnpm 清理
`~/Library/pnpm/_tmp_*`，因此工具层返回 restricted；完整日志已结束于
`pass 15`、`fail 0`。该限制不影响构建、安装、Server 启动或协议断言。

构建仍有 M0 已知的 `EMPTY_IMPORT_META` warning。M0 Browser 验证已证明当前
IIFE 产物可运行，warning 治理保留到 Release Hardening。

## 覆盖项

| 验收项 | 自动化证据 | 预期结果 |
|---|---|---|
| Workspace 安全边界 | `tests/m1-store.test.mjs` | 拒绝绝对路径、越界路径、错误扩展名和 symlink traversal |
| revision、CAS、幂等和原子写 | `tests/m1-store.test.mjs` | revision 稳定；并发旧 revision 仅一方成功；失败写不破坏旧文件 |
| 工程 lifecycle | `tests/m1-project-store.test.mjs` | managed/discovered 正确识别；工程 revision、确认字段和幂等生效 |
| 画布 lifecycle | `tests/m1-canvas-lifecycle.test.mjs` | 操作限定在工程内；默认画布随 rename 更新；最后画布不可删除 |
| MCP 分层与可信 metadata | `tests/m0.test.mjs`、`tests/m1-mcp.test.mjs` | model/app 工具可见性正确；无 Workspace metadata 时拒绝；app-only 仅访问当前 Session 绑定画布 |
| packed install | `tests/m1-packed.test.mjs` | tarball 可离线安装；安装后的 `dist/server.js` 可启动并响应 `tools/list` |

## 实现提交

- `6743241 feat: add revisioned canvas storage`
- `5b6407c feat: add project lifecycle storage`
- `ec8f607 feat: add canvas lifecycle operations`
- `6cec45c feat: wire workspace canvas MCP tools`

功能实现为数小时量级；集中自测与失败归因、定向复验和收口为数十分钟量级。

## 人工验收

在仓库根目录执行：

```bash
pnpm typecheck
pnpm test
git status --short
```

验收项：

1. TypeScript 编译边界。
2. M0 回归及 M1 存储、工程、画布、MCP stdio 行为。
3. tarball 临时安装与安装后 Server 启动。
4. 收口后 Git 工作树无未提交文件。

预期结果：

- `pnpm typecheck` 退出码为 0。
- `pnpm test` 输出 `tests 15`、`pass 15`、`fail 0`。
- packed install 用例通过，安装后的 Server 返回包含 M1 工具的 `tools/list`。
- `git status --short` 无输出。

失败判定：

- 任一命令出现类型错误、构建错误或测试断言失败。
- 测试结果不是 15/15，或 packed install/Server 启动失败。
- 路径逃逸、symlink traversal、旧 revision 写入或 mutation 冲突未被拒绝。
- model-visible 工具不要求可信 Workspace metadata，或 app-only 工具可访问未绑定画布。
- managed 工程默认画布在 rename/delete 后失配。
- 收口提交后仍存在非预期未提交文件。

在 TRAE workspace sandbox 内，若全部测试断言通过后仅出现
`~/Library/pnpm/_tmp_*` cleanup restricted，应在允许 pnpm 清理临时目录的普通
终端复跑 `pnpm test`；任何产品断言失败仍按验收失败处理。

## 延后到 Release Hardening

- 真实 DSH Web 的工程/画布生命周期 Browser 回归。
- 跨进程并发、文件系统故障注入和更大工程目录规模验证。
- 全仓 lint、完整生产发布门禁、累计 diff 独立 Review 和安全审查。
- `EMPTY_IMPORT_META` warning 的消除或显式固定。
