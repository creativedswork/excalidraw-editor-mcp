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

## DSH 安装、配置和启动

完整前置条件、三个仓库的安装/构建命令、DSH profile 安装命令和启动命令见
[`README.md` 的 Prerequisites 至 Configure DSH](../README.md#prerequisites)。
本 Workspace 使用的实际配置文件是
`$DSH_HOME/profiles/web/cordis.patch.yml`，不是通用的 `mcpServers` JSON。
核心配置如下：

```yaml
- id: mcp-apps
  config:
    servers:
      - serverName: excalidraw
        transport: stdio
        command: node
        args:
          - /absolute/path/to/excalidraw-editor-mcp/dist/server.js
        cwd: /absolute/path/to/excalidraw-editor-mcp
        forwardWorkspace: true
```

从源码启动 DSH：

```bash
cd "$DSH_ROOT"
DSH_HOME="$DSH_HOME" pnpm dsh web --dump-config
DSH_HOME="$DSH_HOME" pnpm dsh web --host 127.0.0.1 --port 3080 --no-open
```

打开 `http://127.0.0.1:3080/`，选择用于存放工程的 Workspace，再创建
Session。必须提前配置有效的模型凭据和可用额度；默认提供方需要
`DEEPSEEK_API_KEY`。`forwardWorkspace: true` 只应授予受信任的本地 stdio
Server。

## 真实 DSH Browser smoke

为避免影响旧实例，先确认 `3094` 的 Host PID `91636` 和 MCP PID `92200`
来自 M0 运行，且 MCP 进程早于 M1；该实例未停止、未重启。随后使用独立
DSH_HOME `.tmp/m1-acceptance/dsh-home` 在 `3194` 启动当前构建：

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm build` | PASS | `.tmp/m1-acceptance/evidence/excalidraw-build.log` |
| 本地安装 `dsh-uni-editor` Web bundle | PASS | `.tmp/m1-acceptance/evidence/dsh-plugin-install.log` |
| DSH 配置组合，含 `mcp-apps` 和 `forwardWorkspace: true` | PASS | `.tmp/m1-acceptance/evidence/dsh-dump-config.log` |
| `http://127.0.0.1:3194/` readiness 和真实页面加载 | PASS | `.tmp/m1-acceptance/evidence/dsh-web.log`、`.tmp/m1-acceptance/evidence/browser-initial.png` |
| 选择 Workspace 并创建 Session | PASS | `.tmp/m1-acceptance/dsh-home/storages/workspace.json` |
| 自然语言请求 `mcp__excalidraw__create_project` | BLOCKED | `.tmp/m1-acceptance/evidence/quota-session-extract.jsonl` |
| MCP 工具实际执行和 MCP App 渲染 | NOT RUN | 上一步在工具调用前终止 |

Browser 中已提交：

```text
请调用 mcp__excalidraw__create_project，参数为：projectPath "acceptance/demo"，
name "Acceptance Demo"，mutationId "acceptance-create-1"。
```

模型在第一个 step 返回 HTTP `402`、`code: "QUOTA"`、
`message: "Insufficient Balance"`。Session request header 已包含
`mcp__excalidraw__create_project` 等 M1 工具 schema，证明插件已连接且工具
已注册；但模型未产生 tool call，因此没有创建 `acceptance/demo`，也没有
MCP App iframe。该结果是外部额度阻塞，不能记为产品 PASS，也没有证据表明
存在生产实现缺陷。补充有效额度后应从下列 Case 1 重新验收。

## 用户验收用例

以下路径均相对于在 DSH 中选择的 Workspace。自然语言提示词可直接粘贴；
括号内给出需要核对的工具。

### Case 1：创建工程并渲染关联 App shell

- 提示词：`请使用 Excalidraw 创建工程 acceptance/demo，名称为 Acceptance Demo，并打开默认画布。`
- 工具调用：`mcp__excalidraw__create_project`，参数
  `{"projectPath":"acceptance/demo","name":"Acceptance Demo","mutationId":"acceptance-create-1"}`。
- 可观察 UI/文件：工具行显示 `Created Excalidraw project.`；其下渲染
  通用 Excalidraw MCP App shell；Workspace 中出现
  `acceptance/demo/.excalidraw-project.json` 和
  `acceptance/demo/main.excalidraw`。
- 期望结果：manifest 的 `name` 为 `Acceptance Demo`，
  `defaultCanvasPath` 为 `main.excalidraw`；画布是可打开的标准空白
  `.excalidraw` 文档；关联的通用 App shell 可以加载。M1 View 仍是 M0
  shell，不要求它读取或显示刚创建的持久化画布内容。
- 失败判定：工具未出现或报错；关联 App shell 不渲染；任一文件缺失、
  越出 Workspace、JSON 无效，或重复同一 `mutationId` 得到不一致结果。

### Case 2：新增、列出、打开并检查多个画布

- 提示词：`在 acceptance/demo 新建 notes.excalidraw；列出工程内所有画布，然后分别打开并检查 main.excalidraw 和 notes.excalidraw。`
- 工具调用：先用 `inspect_project` 取得最新 `projectRevision`，再调用
  `create_canvas`；随后调用 `list_canvases`、`open_canvas`、
  `inspect_canvas`。`canvasPath` 必须是
  `acceptance/demo/notes.excalidraw` 这样的工程内完整相对路径。
- 可观察 UI/文件：列表包含 `main.excalidraw` 与 `notes.excalidraw`；
  两个文件都存在；`open_canvas` 返回被打开的路径和 revision；
  `inspect_canvas` 返回 `elementCount`、`source` 和 64 位 revision。
- 期望结果：画布数为 2；两次 inspect 均成功；打开一个画布不会删除或
  改写另一个画布。M1 不验收 View 切换或持久化画布内容同步。
- 失败判定：遗漏任一画布、路径跨出工程、revision 格式错误、打开错误
  画布，或 inspect 结果与对应文件不一致。

### Case 3：关闭页面或重启 DSH 后重新打开

- 操作：记录 Case 2 的 project/canvas revision，关闭页面；如需验证进程
  持久化，再停止并用同一 DSH 配置、同一 Workspace 重启。新 Session 中
  输入：`列出 Excalidraw 工程，打开 acceptance/demo，再检查两个画布。`
- 工具调用：`list_projects`、`open_project`、`list_canvases`、
  `open_canvas`、`inspect_canvas`。
- 可观察 UI/文件：重开前后的 manifest 和两个 `.excalidraw` 文件保持
  存在；工程仍为 managed；`open_project`/`open_canvas` 返回正确路径和
  revision；未修改文件的 revision 不变。
- 期望结果：已保存文件跨页面和 DSH 重启持久化；新 Session 通过显式
  open 重新建立 app-only 画布绑定。M1 不验收 View dirty/save/conflict
  状态、View 内容恢复或持久化画布同步，这些属于 M2。
- 失败判定：文件丢失或无操作却 revision 改变；工程无法发现/打开；新
  Session 可在未 open 的情况下调用 app-only 保存工具。未保存的 View
  dirty 状态和跨重启恢复属于 M2，M1 不承诺。

### Case 4：旧 revision 与越界路径必须安全失败

- 操作：保存 `inspect_project` 返回的 revision A；成功新建一个画布使
  工程进入 revision B；再用旧 revision A 调用 `create_canvas` 创建
  `acceptance/demo/stale.excalidraw`。另调用 `create_project`，令
  `projectPath` 为 `../escape`。
- 可观察 UI/文件：第一个错误包含 `project revision conflict`；第二个
  请求被 Workspace 路径校验拒绝；`stale.excalidraw` 和 Workspace 外的
  `escape` 均不存在；已有工程文件保持可读。
- 期望结果：两个请求都失败且不产生部分文件，不覆盖现有画布。
- 失败判定：任一请求成功、创建临时/目标文件、破坏已有文件，或错误未
  明确指出 revision/path 约束。

## 自动化复验

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

- 补充有效模型额度后执行上述四个真实 DSH Browser Case；当前仅完成配置、
  启动、Workspace 选择和 prompt 提交，工具调用前被外部 quota 阻塞。
- 跨进程并发、文件系统故障注入和更大工程目录规模验证。
- 全仓 lint、完整生产发布门禁、累计 diff 独立 Review 和安全审查。
- `EMPTY_IMPORT_META` warning 的消除或显式固定。
