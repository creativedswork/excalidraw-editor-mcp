# Excalidraw Canvas MCP 实施计划

> 状态：设计已确认，M0 功能候选等待人工验收
>
> 原则：每个里程碑执行“红测 -> 最小实现 -> 验证 -> 独立提交”。

## 交付策略

先证明最可能阻断方案的五件事，再建设完整能力：

1. 官方 Excalidraw bundle 能在 MCP App Sandbox 中加载；
2. 字体与样式可以在既定 CSP 和资源体积内工作；
3. inline/fullscreen 切换后 canvas pointer 坐标和 iframe 状态正确；
4. 官方 element conversion/restore 工具可在 Server 构建目标中运行；
5. `.excalidraw`、SVG 和 PNG 能经 Host 支持的路径可靠导出。

任一项失败都先回到设计评审，不通过复制 Excalidraw 内部源码绕过。

## M0：集成可行性

### 红测

- 创建最小 Browser E2E，期望 DSH 工具结果中出现非空 Excalidraw canvas。
- 断言画矩形、输入文本、选中和拖动会改变 scene。
- 断言 inline -> fullscreen -> inline 后 iframe identity、未保存元素和选择不变。
- 断言切换 surface 后拖动命中正确坐标。
- 创建 Node 测试，直接执行 `convertToExcalidrawElements`、`restoreElements`
  和 serialization round trip。
- 创建 bundle size、字体请求和 CSP 检查。
- 验证官方 JSON/SVG/PNG export 与 Host `ui/download-file` 的集成路径。

### 最小实现

- 初始化 TypeScript ESM npm 包，使用 pnpm、Node >= 22.19。
- 固定 `@excalidraw/excalidraw@0.18.0`、React、MCP SDK 和 ext-apps。
- 注册一个 `show_canvas_spike` 工具和
  `ui://excalidraw-editor/app` Resource。
- View 只渲染官方 `<Excalidraw />` 和最小测试桥接。
- 不实现存储、协作工具和自定义状态栏。

### 验证与退出

- `pnpm typecheck`
- `pnpm test`
- 真实 DSH Browser E2E
- canvas 像素检查和截图
- 浏览器 console/network 无意外错误
- 记录实际 HTML bundle 字节、字体方案和要求的 `maxBodyBytes`

产物：`reports/M0-validation.md`。五个阻断项全部有运行证据后进入 M1。

## M1：工程与画布生命周期

### 红测

- 路径逃逸、符号链接逃逸、非法后缀和超限文件被拒绝。
- 受管/发现工程识别、重复工程创建、跨工程画布路径和空工程边界先有失败测试。
- 发现工程的目录级 rename、duplicate 和 delete 必须被拒绝。
- 工程或画布 rename、duplicate 和 delete 失败时不得留下半完成目录。
- 破坏性删除必须同时匹配确认路径和目标 revision。
- 工程变更使用 `baseProjectRevision`，画布变更使用 `baseRevision`。
- 相同 `mutationId` 的工程或画布生命周期调用只生效一次。
- `create/open/list/inspect/check` 针对临时 Workspace 失败。
- 相同 `baseRevision` 的两个写入只有一个成功。
- 写入中断不会破坏旧文件。
- App-only tools 不出现在模型工具注册表。

### 实现

- `project-store.ts`：轻量 manifest、工程发现、创建、主画布和目录级生命周期。
- `canvas-store.ts`：标准 `.excalidraw` 读取、规范化、revision 和原子写入。
- 读取 `ai.deepseek.dsh/workspace.cwd`，将 model-originated open/create
  绑定到固定 Workspace。
- 实现工程级 model-visible：
  `list_projects`、`create_project`、`open_project`、`inspect_project`、
  `rename_project`、`duplicate_project`、`delete_project`。
- 实现画布级 model-visible：
  `list_canvases`、`create_canvas`、`open_canvas`、`inspect_canvas`、
  `check_canvas`、`rename_canvas`、`duplicate_canvas`、`delete_canvas`；
  画布操作必须携带 `projectPath`。
- 实现 app-only：`pull_canvas`、`push_canvas`、`save_canvas_copy`。
- 工程 create/open 打开主画布；画布 create/open 打开目标画布。

### 验证与退出

- 单元测试覆盖工程所有权、工程/画布生命周期、存储和 revision。
- stdio MCP 协议测试覆盖 tools/list、tools/call、resources/read。
- packed install 可从临时目录启动。
- 无 View 时仍可通过模型工具创建工程、多张画布并检查标准文件。

## M2：可持续人工编辑

### 红测

- `onChange` 只标记 dirty，不触发 MCP 写入。
- Save 携带 base revision 并更新状态。
- clean 状态接收外部 revision 时不写入 undo history。
- dirty 状态接收外部 revision 时不丢草稿。
- Reload、Save as copy 的状态转换和文件结果正确。
- surface 切换保持 iframe、选择和 viewport。

### 实现

- 加载完整 scene、files 和允许持久化的 appState。
- 增加窄状态栏：同步状态、Save、Ask AI、Reload、Save as copy。
- 内容摘要去重，避免 selection/viewport 变化误标为文件修改。
- 低频 revision polling；clean 自动刷新，dirty 进入 Conflict。
- 更新时保留仍存在的 selected element IDs 和 viewport。
- Save 成功后更新有界 model context。

### 验证与退出

- 真实 pointer、keyboard、undo/redo、保存和刷新 Browser E2E。
- inline/fullscreen desktop 和 mobile viewport 截图。
- reload、Server 重启和冲突故障注入。
- 用户人工编辑保存后，官方 Excalidraw 可打开生成文件。

## M3：AI 结构化编辑与 Session 交接

### 红测

- add/update/remove/reorder/group/ungroup/bind/unbind/frame/set_canvas
  每种操作先有失败测试。
- 同批新增元素可通过 `clientRef` 相互绑定，返回稳定 ID 映射。
- `inspect_canvas` 的过滤、分页、截断标记和容器 label 折叠正确。
- 一批操作中任一项非法时整批不写入。
- 绑定元素删除后不存在悬挂引用。
- stale AI revision 被拒绝。
- 相同 `mutationId` 重试不重复创建元素，不同输入复用相同 ID 时拒绝。
- `replace_canvas` 保留当前固定版本可恢复但语义 patch 未建模的字段，并拒绝
  无效绑定和超限文档。
- AI 更新后 clean View 保留未删除的当前选择。
- Ask AI 在 dirty 状态被阻止；saved 状态只产生一个普通 Session 消息。

### 实现

- 实现 `apply_canvas_changes` 的完整 V1 语义操作集。
- 通过官方 skeleton conversion 和 restore API 创建、修复元素。
- `inspect_canvas` 支持 ID、类型、文本过滤和 cursor 分页，返回
  element ID/type/text/bounds/style/group/frame/bindings。
- 实现 `replace_canvas` 完整文档逃生口和 mutation 幂等表。
- 注册可选 `excalidraw-authoring` MCP Prompt，说明检查、修改、冲突重试和
  打开 View 的推荐顺序。
- Ask AI 消息包含 canvasPath、revision、选择 ID 和用户输入。
- AI 修改只产生一个 revision；View 轮询并更新同一实例。

### 验证与退出

执行一个真实人机回合：

1. 用户用自然语言要求创建一个包含总览和部署图的工程；
2. Agent 创建工程、两张画布，并在主画布生成两个节点和一条连接；
3. 用户保存并选中一个节点；
4. 用户点击 Ask AI 请求增加第三个节点并调整布局；
5. Agent inspect 后执行一个批量 patch；
6. 同一 View 显示新 revision，原选择仍在；
7. 人工切换到工程中的另一张画布，继续编辑并保存。

保留工具 trace、最终 `.excalidraw`、截图和 GIF 作为证据。

## M4：资源、导出与发布

### 红测

- 限额内图片 round trip 不丢失。
- 超限图片和总文档被拒绝且旧 revision 完整。
- Workspace 外图片路径和网络 URL 被拒绝。
- 未引用图片清理不会删除仍被任意 image 元素使用的文件。
- JSON/SVG/PNG 导出在 Sandbox 中可下载。
- `capture_canvas` 只接受同一 Session owner、canvas path 和 saved revision 的
  Browser View 证据。
- 公式文本先报告 `clipped=true`，修正尺寸后在新 revision 报告
  `clipped=false`。
- Server teardown 后没有残留进程或 View 调用。

### 实现

- 实现 `add_canvas_asset` 和 `remove_unused_assets`。
- 实现 `export_canvas`，复用 Excalidraw 官方导出能力和 Host
  `ui/download-file`。
- 实现 `capture_canvas` 与 app-only `report_canvas_capture`，复用官方
  `exportToBlob`，返回标准 MCP PNG 和有界文本布局诊断。
- 保留 `add` 操作显式提供的 standalone text 宽高，避免 Node text-metrics shim
  覆盖 Agent 的布局意图。
- 完成 README、中文 README、LICENSE、第三方声明和示例配置。
- 增加 CI、packed install 和 release checks。

### 验证与退出

- `pnpm run release:check`
- 从 npm pack tarball 安装并接入真实 DSH Web
- desktop/mobile Browser 回归
- 真实 DSH Session 中连续执行窄公式 capture、扩宽和再次 capture；核对 exact
  revision、诊断、图片交付状态和无 Bash
- 断网启动验证自包含字体和静态资源
- 发布前人工确认版本、包内容和第三方许可证

## 预计代码范围

```text
src/server.ts
src/project-store.ts
src/canvas-store.ts
src/canvas-operations.ts
src/assets.ts
src/export.ts
src/app/index.tsx
src/app/styles.css
tests/*.test.mjs
tests/*-browser.mjs
scripts/build-view.mjs
```

首版不先建 interface/factory/plugin abstraction。M0 完成后根据真实 bundle
边界决定 View 是否需要拆分资源。

## DSH 配置目标

```yaml
- id: mcp-apps
  config:
    maxBodyBytes: <M0 实测后确定>
    servers:
      - serverName: excalidraw
        transport: stdio
        command: node
        args:
          - /absolute/path/to/excalidraw-editor-mcp/dist/server.js
        cwd: /absolute/path/to/excalidraw-editor-mcp
        forwardWorkspace: true
```

## 评审后执行顺序

1. 确认 `DESIGN.md` 中 8 项待确认决策。
2. 实施并提交 M0。
3. 提交 M0 运行证据，由用户确认是否继续。
4. 依次实施 M1、M2、M3；每个里程碑单独验收和提交。
5. M4 功能候选通过验收后，等待用户决定是否进入统一 Release Hardening；未经明确
   授权不执行累计 Review、发布 npm 或创建公开 GitHub 仓库。
