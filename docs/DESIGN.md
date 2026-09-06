# Excalidraw Canvas MCP 设计方案

> 状态：Draft，等待评审
>
> 更新时间：2026-09-02
>
> 目标宿主：DeepSeek Harness Web + `@creative-dswork/dsh-uni-editor`

## 决策摘要

| 决策 | 建议 | 状态 |
|---|---|---|
| 仓库与包名 | `excalidraw-editor-mcp` | 待确认 |
| Excalidraw 集成 | 固定官方 `@excalidraw/excalidraw@0.18.0`，不 fork 整个 monorepo | 待确认 |
| DSH 接入 | 单一 stdio MCP Server，同时提供 tools 与 MCP App View Resource | 待确认 |
| 工程模型 | 受管工程使用轻量 manifest 标记所有权；已有目录可发现并执行画布级操作 | 待确认 |
| 主数据格式 | 直接保存标准 `.excalidraw` JSON，不定义第二套画布格式 | 待确认 |
| 人机协作 | revision 驱动的轮次协作；显式保存和显式 Ask AI | 待确认 |
| 并发控制 | SHA-256 revision + compare-and-swap + 原子写入 | 待确认 |
| AI 编辑接口 | 常用语义 patch + 受控完整文档替换；所有写操作支持幂等与 revision 检查 | 已确认 |
| 能力口径 | 人类侧复用官方 UI；LLM 侧覆盖持久文档模型，不暴露瞬时 UI 命令 | 已确认 |
| 多人实时协作 | V1 不引入 CRDT、WebSocket room 或 Excalidraw collaboration server | 待确认 |

## 目标

用户可以用自然语言让当前 Agent 在 DSH Workspace 中创建一个 Excalidraw
工程及其多张画布，也可以在 DSH Chat 内打开任意画布，继续使用官方画布的
选择、绘制、文本、连线、缩放、撤销和导出能力，并与 AI 围绕同一工程交替
编辑。

主流程：

```text
用户表达工程目标和所需画布
  -> Agent 创建工程目录和主画布
  -> Agent 按意图创建其他画布并填充初始内容
  -> dsh-uni-editor 在 Chat 中加载 MCP App
  -> 用户直接绘制并显式保存
  -> 用户通过画布中的 Ask AI 或 Chat Composer 发起下一轮
  -> AI 检查当前 revision 和元素
  -> AI 原子应用结构化修改
  -> 干净画布自动刷新；脏画布进入冲突处理
```

## 用户可感知契约

- 画布是 DSH 中的原生 App surface，可在 inline 和 fullscreen 间切换。
- 用户可以只描述目标，由 Agent 命名并创建工程、主画布和其他画布。
- 用户也可以在已有工程中继续创建或打开画布。
- surface 切换复用同一个 iframe，未保存内容、选择和视口不丢失。
- 人类可使用官方组件提供的基础图形、文本、连线、自由绘制、Frame、图片、
  分组、层级、样式和导出能力；受 Sandbox 限制的能力会明确禁用或适配。
- AI 可创建和修改全部持久化元素，处理绑定、分组、Frame、资源与画布属性；
  未知或新版本元素可通过受控完整文档接口无损保留。
- 绘制、拖动、缩放和保存不会隐式启动 Agent。
- `Ask AI` 是显式动作；它先要求画布处于已保存状态，再向当前 Session
  发送包含 canvas、revision 和选择摘要的普通用户消息。
- AI 修改期间，人仍可查看画布；若双方基于同一 revision 修改，后提交者
  不会覆盖先提交者。
- 外部 revision 到达时，干净画布自动刷新；脏画布保留本地内容并显示
  `Reload` 或 `Save as copy`，不自动合并。
- MCP View 暂时不可用时，`.excalidraw` 文件仍是可移植、可恢复的主数据。

## 事实基线

| 来源 | 已确认事实 | 能证明 | 不能证明 |
|---|---|---|---|
| Excalidraw 官方包 | `@excalidraw/excalidraw@0.18.0` 是可嵌入 React 组件 | 无需复制完整 Web App 即可获得官方画布 | 在 MCP Sandbox 中无需适配即可运行 |
| Excalidraw 官方 API | 提供 `initialData`、`onChange`、`updateScene`、元素/文件读取、library、history、export、restore 和 element conversion API | 可以建立加载、编辑、保存、导出和远端更新链路 | Node 侧可直接使用全部恢复、转换和渲染工具 |
| Excalidraw 官方格式 | `.excalidraw` 是包含 `elements`、`appState`、`files` 的明文 JSON | 可直接使用标准文件作为主数据 | 任意大图片都适合穿过当前 Host body limit |
| 当前 `dsh-uni-editor` | 支持 MCP App Resource、AppBridge、app-only tools、`ui/message`、模型上下文更新和不同源双 iframe | 无需修改 Agent Loop 即可实现画布与 Session 协作 | Excalidraw bundle、字体和 pointer 行为已通过 |
| 当前 `dsh-uni-editor` | Session 级 App runtime 在 inline/fullscreen 间复用 iframe | surface 切换可保留未保存浏览器状态 | Excalidraw resize/坐标换算在切换后一定正确 |
| 当前 Host | trusted stdio Server 可通过 `forwardWorkspace` 获得调用 Session 的固定 `cwd` | 画布可以绑定当前 DSH Workspace | app-only 调用会再次携带 Workspace 路径 |
| `threejs-editor-mcp` | 已验证独立 MCP 包、Workspace 绑定、revision 和 App View 模式 | 可复用宿主协议与测试方法 | 其 3D runtime 和复杂生命周期适用于本项目 |

因此 M0 必须在真实 Harness Web 中验证：bundle 体积、字体资源、Sandbox
CSP、canvas 非空像素、pointer 坐标、键盘输入、inline/fullscreen 连续性及
保存链路。类型检查和单独打开 HTML 都不是充分证据。

## 方案选择

### Excalidraw 来源

| 方案 | 优势 | 代价 | 结论 |
|---|---|---|---|
| Fork 完整 `excalidraw/excalidraw` | 可改所有内部行为 | 仓库庞大、升级和发布成本高，混入协作服务与产品壳 | 不采用 |
| Vendor `packages/excalidraw` 源码 | 可局部修改 | 仍需长期同步内部 API 和构建链 | 不采用 |
| 使用官方 npm React 组件 | 依赖边界清晰，保留官方 UI 和文件兼容性 | 需要适配 MCP App 打包、字体和 Sandbox | 采用 |

“基于 Excalidraw”在本项目中的含义是：画布、元素模型、恢复、序列化和导出
能力来自官方包；MCP Server、Workspace 存储和人机协作协议由本仓库提供。

### 协作模型

| 方案 | 优势 | 代价 | 结论 |
|---|---|---|---|
| Excalidraw 实时协作服务 + CRDT | 多人光标和实时同步 | 需要常驻服务、房间、身份、加密和离线恢复，超过人/AI轮次协作需求 | V1 不采用 |
| 每次 `onChange` 远端自动写入 | 表面上接近实时 | 高频写入、冲突边界模糊，拖拽会产生大量 revision | 不采用 |
| 本地草稿 + 显式 Save + revision | 状态边界清楚，可恢复，可防覆盖 | 双方不能在同一瞬间合并修改 | V1 采用 |

V1 的协作者是“当前人类 + 当前 Session 的 Agent”，不是多人白板房间。
真实多人协作只有在出现明确需求后才进入独立设计。

## 总体架构

```text
Human
  |
  v
Excalidraw React View (browser sandbox)
  | AppBridge: pull/save/selection/Ask AI
  v
dsh-uni-editor Host
  | stdio MCP
  v
excalidraw-editor-mcp
  |-- MCP App resource: ui://excalidraw-editor/app
  |-- model-visible project and canvas tools
  |-- app-only persistence tools
  `-- Workspace-bound project directories and .excalidraw store
          ^
          |
       DSH Agent
```

### 部署边界

Server 和 View 使用同一个 npm 包发布：

- Host 启动一个 stdio MCP Server 进程；
- Server 通过 `resources/read` 返回打包后的 View HTML；
- View 在 `dsh-uni-editor` 的不同源双 iframe Sandbox 中运行；
- 不启动独立 Web 服务，不新增反向代理；
- MCP Server 不访问 Harness Session 内部状态，只消费 Host 明确转发的
  Workspace 和 Session metadata。

## 工程、画布与存储模型

### 工程模型

V1 将工程分为两类：

| 类型 | 识别方式 | 允许操作 |
|---|---|---|
| 受管工程 | 由 MCP 创建，目录中存在 `.excalidraw-project.json` | 完整工程生命周期和画布操作 |
| 发现工程 | 已有目录中存在 `.excalidraw` 文件，但没有 manifest | 列出、检查、打开及画布级操作 |

工程 rename、duplicate 和 delete 会移动或删除整个目录。只有 manifest 能证明
该目录由本 MCP 管理，因此这些操作禁止作用于发现工程。

```text
<workspace>/
└── designs/payment-system/       # projectPath
    ├── .excalidraw-project.json  # 工程身份、名称和默认画布
    ├── main.excalidraw           # 默认主画布
    ├── deployment.excalidraw
    └── data-flow.excalidraw
```

- `projectPath` 是 Workspace 相对目录，例如 `designs/payment-system`。
- manifest 只保存 `schemaVersion`、工程名和默认 `canvasPath`，不保存 scene、
  revision 或元素索引。
- `list_projects` 同时返回受管工程与发现工程，并明确 `kind`。
- `create_project` 原子创建 manifest 和主画布；若目标目录已存在则整次拒绝。
- 一个 Agent turn 可以继续调用 `create_canvas` 和
  `apply_canvas_changes`，完成用户意图要求的多画布初始内容。
- V1 不创建新的 DSH Workspace，也不在当前 Workspace 外创建工程。

manifest 示例：

```json
{
  "schemaVersion": 1,
  "name": "Payment System",
  "defaultCanvasPath": "main.excalidraw"
}
```

### 主数据

标准 `.excalidraw` 文件是每张画布内容的唯一持久真值：

```text
<workspace>/
└── designs/payment-system/
    ├── main.excalidraw
    └── deployment.excalidraw
```

文件保持官方结构：

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "excalidraw-editor-mcp",
  "elements": [],
  "appState": {},
  "files": {}
}
```

不创建产品私有 scene envelope。工程 manifest 只证明目录所有权和默认入口。
临时 UI 状态（当前工具、hover、侧栏）不写入主文件；对恢复有价值的背景色、
网格等由官方 serializer 决定是否保存。

### 标识与 revision

- `projectPath` 是 Workspace 相对目录。
- `canvasPath` 是 Workspace 相对文件路径，例如
  `designs/payment-system/main.excalidraw`。
- 画布必须位于其 `projectPath` 内。
- 禁止绝对路径、`..`、NUL、符号链接逃逸和非 `.excalidraw` 后缀。
- `revision` 是规范化 JSON UTF-8 字节的 SHA-256。
- `projectRevision` 是 manifest 与排序后的 `canvasPath/revision` 清单摘要。
- 画布写入携带 `baseRevision`；工程级变更携带 `baseProjectRevision`。
- Server 对同一 `canvasPath` 串行执行“重读 -> 比较 -> 临时文件写入 ->
  rename”。
- revision 不匹配时返回当前 revision 和冲突摘要，不覆盖文件。
- 每个变更请求携带 `mutationId`；相同 ID 和相同输入返回第一次结果，相同 ID
  携带不同输入时拒绝，避免超时重试重复创建元素。

### 图片与体积

官方格式允许 `files` 中保存 data URL。V1：

- 可以读取和原样保存限额内的已有图片；
- 人工新增图片必须受单文件和总文档上限约束；
- AI 不直接生成或注入二进制图片；
- 精确上限由 M0 的 Host body limit 和真实 bundle 测量决定，不能先拍脑袋固定。

## View 设计

View 以官方 `<Excalidraw />` 为主体，不重新实现工具栏或画布。

仅增加一条窄的协作状态栏：

| 控件 | 行为 |
|---|---|
| Canvas 名称 | 展示当前 Workspace 相对路径 |
| Sync 状态 | `Saved`、`Unsaved`、`Saving`、`External update`、`Conflict` |
| Save | 以当前 base revision 显式保存 |
| Ask AI | 仅在已保存时发送普通 Session 消息 |
| Reload | 放弃本地草稿并加载外部 revision |
| Save as copy | 将冲突中的本地草稿保存为新文件 |

状态栏使用文本加图标，但不复制 Excalidraw 已有的选择、绘制、撤销或菜单
能力。官方导出 UI 需要接入 Host `ui/download-file`，不能假设 Sandbox
允许页面直接下载。

### 选择与 surface 连续性

- `dsh-uni-editor` 负责保持同一 iframe；View 不因 surface 变化重新创建
  Excalidraw 实例。
- resize 后调用官方 `refresh()`，并用真实 pointer 操作验证坐标。
- 远端 scene 更新使用 `updateScene(..., captureUpdate: NEVER)`，不污染人工
  undo stack。
- AI 未删除当前元素时，按 element ID 保留 `selectedElementIds` 和 viewport。
- AI 删除了当前选择时，只清理不存在的 ID，不重置其余视图状态。

## 人机协作状态

```text
Loading -> Clean -> Dirty -> Saving -> Clean
                    |         |
                    |         `-> Conflict
                    |
                    `-> Conflict (发现外部 revision)

Clean -> ApplyingExternal -> Clean
Conflict -> Reloading -> Clean
Conflict -> SavingCopy -> Clean
```

协作规则：

1. View 在本地维护 dirty draft，不在每次 `onChange` 时写文件。
2. View 低频检查 Server revision；只有 clean 状态自动加载新内容。
3. Save 使用 compare-and-swap。
4. AI 工具也必须提交 `baseRevision`。
5. `Ask AI` 只发送已保存 revision；若 dirty，先提示保存。
6. 保存成功不自动触发 Agent。只有用户点击 `Ask AI` 或发送 Composer 消息
   才进入下一轮。

## MCP 接口

### 能力完整性边界

“完备”以固定的 `@excalidraw/excalidraw@0.18.0` 持久文档模型为边界，不等于
把每个 imperative UI 方法变成 MCP tool。

| 能力域 | 人类 View | LLM tools | V1 结论 |
|---|---|---|---|
| 基础元素 | 官方 UI 创建和编辑 shape、text、line、arrow、freedraw | 语义 add/update/remove | 覆盖 |
| 关系 | 官方 UI 处理 label、binding、group、Frame 和层级 | 专用关系操作，不直接维护反向引用 | 覆盖 |
| 图片 | 官方 UI 选择本地文件 | Workspace 本地资源导入和 assetId 引用 | 有界覆盖 |
| 画布状态 | 官方 UI 修改背景、网格及可持久化属性 | `set_canvas` | 覆盖 |
| 文件兼容 | 官方 load/restore/serialize | `inspect_canvas` + `replace_canvas` | 覆盖固定版本可恢复的数据 |
| 导出 | 官方导出界面，经 Host 下载 | `export_canvas` | `.excalidraw`、SVG、PNG |
| 视觉检查 | 人工查看 Browser View | `capture_canvas` | 有界 PNG + 文本裁剪诊断 |
| Library | 官方组件具备 API，但属于独立资产模型 | 不暴露 | V1 排除 |
| embeddable/iframe | 受 Sandbox、CSP 和外链策略影响 | 不暴露 | V1 排除 |
| Magic Frame / 内建 AI | 依赖外部生成服务 | 不暴露 | V1 排除 |
| 实时多人协作 | 官方组件只提供协作接入点，完整同步需外部服务 | revision 轮次协作 | 替代实现 |
| 瞬时 UI 状态 | pointer、tool、zoom、sidebar、undo/redo 由 View 管理 | 不暴露 | 有意排除 |

因此，V1 对“工程管理 + 标准画布持久数据 + 人机轮次协作”完备；对官方
Excalidraw 产品的在线服务和瞬时 UI 控制不承诺完备。

### 工具设计原则

- 工具名表达用户动作，参数使用 `projectPath`、`canvasPath` 和 `elementId`
  等一致术语。
- 常规路径不要求模型生成完整 Excalidraw JSON。
- `inspect_canvas` 支持过滤和分页，禁止把无界画布一次塞入模型上下文。
- 新建元素使用本次调用内的 `clientRef`；返回值包含
  `clientRef -> elementId`，允许同一批内创建并绑定节点、文本和箭头。
- 所有创建工具接受 `mutationId`；已有工程变更使用
  `baseProjectRevision`，已有画布变更使用 `baseRevision`，整批校验后原子
  提交。
- 返回值固定包含新 revision、受影响元素 ID、引用映射、变更摘要和警告。
- 完整文档接口用于导入已有场景，以及处理语义 patch 未覆盖但当前固定版本
  可以恢复的官方字段；它不是默认编辑方式。
- MCP Server instructions 和可选 `excalidraw-authoring` Prompt 描述推荐调用
  顺序；不增加 `get_capabilities` 这类可由 tools/list 取代的工具。

### Model-visible 工程工具

| Tool | 作用 | 结果 |
|---|---|---|
| `list_projects` | 分页发现受管工程和发现工程 | projectPath、kind、名称、画布数、默认画布 |
| `create_project` | 根据 Agent 从用户意图解析出的名称和路径创建工程及主画布 | project summary + 主画布 View |
| `open_project` | 打开工程主画布；主画布不唯一时返回候选而不擅自选择 | project summary + View |
| `inspect_project` | 检查工程内画布、revision 和基本内容摘要 | 有界工程清单 |
| `rename_project` | 重命名受管工程目录并更新 manifest | 新 projectPath |
| `duplicate_project` | 复制受管工程和全部画布 | 新 project summary |
| `delete_project` | 删除受管工程；要求 `confirmProjectPath` 与目标完全一致 | 删除摘要 |

`create_project` 不接收自然语言并自行调用另一个模型。当前 DSH Agent 负责将
用户意图转换为 `projectPath`、主画布名称和后续画布操作，MCP Server 只执行
确定性的文件与元素变更。破坏性工具只应在用户明确要求时调用。

### Model-visible 画布工具

| Tool | 作用 | 结果 |
|---|---|---|
| `list_canvases` | 分页列出指定工程中的 `.excalidraw` 文件 | canvasPath、title、revision |
| `create_canvas` | 在指定 projectPath 内创建画布并打开 View | canvas summary + View |
| `open_canvas` | 打开指定工程中的画布 | canvas summary + View |
| `inspect_canvas` | 按 ID、类型或文本过滤并分页读取语义元素；小文件可请求完整文档 | revision、元素、关系、范围、nextCursor |
| `apply_canvas_changes` | 在一个 base revision 上原子执行一批元素操作 | 新 revision、变更摘要 |
| `check_canvas` | 校验格式、引用、绑定、尺寸和资源限制 | errors、warnings |
| `replace_canvas` | 用完整官方文档替换画布，用于导入、迁移和语义 patch 未覆盖的固定版本字段 | 新 revision、校验摘要 |
| `rename_canvas` | 在同一受管工程内重命名画布并更新默认入口 | 新 canvasPath |
| `duplicate_canvas` | 复制画布并生成独立 revision | 新 canvas summary |
| `delete_canvas` | 删除画布；要求 revision 和 `confirmCanvasPath` | 删除摘要 |
| `export_canvas` | 导出 `.excalidraw`、SVG 或 PNG 到 Workspace 或用户下载 | 产物路径或下载资源 |
| `capture_canvas` | 从已打开且 revision 精确匹配的 Browser View 捕获画布 | 标准 MCP PNG、摘要和文本裁剪诊断 |

### `apply_canvas_changes` 操作协议

| 操作 | 能力 |
|---|---|
| `add` | 使用官方 skeleton 语义创建 shape、text、line、arrow、freedraw、frame 和 image |
| `update` | 按引用更新几何、文本、样式、链接、锁定和自定义数据 |
| `remove` | 软删除元素并修复文本、箭头、Frame 和资源引用 |
| `reorder` | 将元素移到指定元素前后、顶层或底层 |
| `group` / `ungroup` | 创建或移除组关系 |
| `bind` / `unbind` | 管理箭头端点及容器文本绑定 |
| `add_to_frame` / `remove_from_frame` | 管理 Frame 成员关系 |
| `set_canvas` | 修改允许持久化的背景、网格和展示属性 |

引用规则：

- 已存在元素使用 `elementId`；
- 同批新元素声明唯一 `clientRef`；
- `bind`、`group` 和 Frame 操作均可引用两者；
- `inspect_canvas` 将容器文本折叠为 label，同时保留底层 element IDs；
- Server 使用官方 version、index、binding 和 restore 规则，不要求模型维护
  `versionNonce`、fractional index 或反向绑定数组。

典型调用不包含 Excalidraw 内部字段：

```json
{
  "canvasPath": "designs/payment-system/main.excalidraw",
  "baseRevision": "<sha256>",
  "mutationId": "add-payment-flow-v1",
  "changes": [
    {
      "op": "add",
      "clientRef": "api",
      "element": {
        "type": "rectangle",
        "x": 120,
        "y": 100,
        "width": 180,
        "height": 80,
        "label": { "text": "Payment API" }
      }
    },
    {
      "op": "add",
      "clientRef": "db",
      "element": {
        "type": "rectangle",
        "x": 420,
        "y": 100,
        "width": 180,
        "height": 80,
        "label": { "text": "Ledger DB" }
      }
    },
    {
      "op": "add",
      "clientRef": "write-path",
      "element": {
        "type": "arrow",
        "startRef": "api",
        "endRef": "db",
        "label": { "text": "writes" }
      }
    }
  ]
}
```

一批操作只产生一个 revision。`replace_canvas` 同样执行 schema、大小、引用和
restore 校验。M0 必须先证明官方
`convertToExcalidrawElements` / `restoreElements` 能在 Server 构建目标中安全
运行；若不能，停止 M1 设计扩展并重新评审，不手写一套完整 Excalidraw
元素默认值和绑定算法。

M0 验证确认 `@excalidraw/excalidraw@0.18.0` 的根入口面向浏览器。Server
侧使用这些官方转换、恢复与序列化 API 时，需要在加载模块前安装受控的最小
DOM/text-metrics shim，并将依赖打入 Node bundle。Server 不承担 SVG/PNG
渲染；这些导出继续由已加载完整字体和 Canvas API 的 MCP View 完成。

### Model-visible 资源工具

| Tool | 作用 | 结果 |
|---|---|---|
| `add_canvas_asset` | 从当前 Workspace 的受限图片路径导入文件数据 | assetId、MIME、尺寸、摘要 |
| `remove_unused_assets` | 删除没有元素引用的文件数据 | 新 revision、删除的 asset IDs |

V1 不允许工具抓取任意网络 URL。AI 创建 image 元素时引用
`add_canvas_asset` 返回的 `assetId`。

### App-only tools

| Tool | 作用 |
|---|---|
| `pull_canvas` | 按 canvasPath 读取完整文档，未变化时只返回 revision |
| `push_canvas` | 用 baseRevision 和 mutationId 保存完整官方序列化结果 |
| `save_canvas_copy` | 用 mutationId 将冲突中的草稿保存到新的 Workspace 相对路径 |
| `report_canvas_capture` | 向同一 Session 的待处理 Harness 请求提交 PNG 和诊断 |

`create_project`、`open_project`、`create_canvas` 和 `open_canvas`
绑定 `ui://excalidraw-editor/app`。`export_canvas` 是唯一例外：它也绑定该
Resource，使已加载的 Browser View 使用官方 Excalidraw SVG/PNG export API，
再经 Host `ui/download-file` 交付下载。工程工具打开主画布；普通检查、AI
修改和资源 mutation 工具不创建 View。

### Canvas Visual Harness

`capture_canvas` 复用已经打开的 MCP App View，不创建第二套 renderer：

1. Server 校验当前 Session 已绑定目标工程、画布和 saved revision，并为
   `sessionId + connectionGeneration` 创建一个 15 秒待处理请求；
2. View 的下一次 `pull_canvas` 只有在上报同一 canvas path 和 revision 时才收到
   capture command；
3. View 等待字体加载，使用官方 `exportToBlob` 渲染纯画布 PNG，并用 Browser
   Canvas 2D text metrics 生成文本宽度和裁剪诊断；
4. `report_canvas_capture` 只接受同一 owner、command、工程、画布和 revision 的结果；
5. Server 校验 PNG signature、IHDR 尺寸、SHA-256 和限额，再向调用方返回标准 MCP
   image content 与有界文本摘要。

每个 owner 同时最多一个请求。PNG 宽高均不超过 1024，base64 字符串不超过
512 KiB，文本诊断最多 100 条。Harness 不捕获 DSH Chat、Host DOM、鼠标键盘或
其他应用状态。

模型是否能直接检查 PNG 取决于 provider 声明的输入模态。支持图像输入的模型接收
标准 MCP image content；不支持图像输入的模型会收到 Host 的降级提示，但仍能使用
`storedWidth`、`measuredWidth`、`overflow` 和 `clipped` 诊断。后者只能证明这些
结构化检查结果，不能证明模型检查过像素。

### Session 交接

View 使用 `ui/update-model-context` 维护一个有界上下文：

```text
Canvas: docs/system.excalidraw
Project: docs
Revision: <sha256>
Selection: gateway, worker-pool
State: saved
```

只在 canvas、revision 或 selection 变化后更新，不包含完整 scene JSON。

`Ask AI` 使用 `ui/message` 发送用户可见的普通消息，例如：

```text
请基于 docs/system.excalidraw 的 revision <sha256>，
调整当前选中的 gateway 和 worker-pool：<用户输入>
```

## 安全边界

- 仅 trusted local stdio 配置可启用 `forwardWorkspace: true`。
- Server 只访问调用 Session 固定 Workspace 下的受管工程文件、
  `.excalidraw` 文件和显式选择的本地图片。
- app-only 调用不接收任意文件路径；它使用已注册的 `canvasPath`。
- Harness 请求和回报绑定同一 Session owner、连接 generation、canvas path 和 saved
  revision；过期、跨连接或 revision 漂移的证据全部拒绝。
- 所有输入经 Zod 校验，元素数、文本长度、图片和总文档大小有硬上限。
- View 继续运行在 `dsh-uni-editor` 的不同源双 iframe 和 CSP 下。
- 不启用任意脚本、外部链接自动打开或网络图片抓取。
- AI patch 不能静默覆盖 stale revision。

## 异常与恢复

| 异常 | 行为 |
|---|---|
| 文件被外部修改，View clean | 拉取并无 history 地更新，保留仍存在的选择 |
| 文件被外部修改，View dirty | 进入 Conflict，保留本地草稿 |
| MCP Server 重启 | View 重连后按 canvasPath/revision 拉取；未保存 iframe 草稿仍由 Host 保活 |
| View 重建或浏览器刷新 | 恢复最后已保存 revision；未保存草稿不承诺跨刷新恢复 |
| 写入中断 | 临时文件不成为主文件；下次读取仍得到旧 revision |
| MCP 调用超时后重试 | 相同 mutationId 返回第一次提交结果，不重复应用 |
| AI patch 非法 | 整批拒绝，不产生部分 revision |
| Harness View 不存在或 revision 不一致 | 超时或拒绝；不返回其他 View 的证据 |
| 文件超过限额 | 明确报告上限，不截断或丢弃元素 |
| 删除发现工程 | 拒绝；只能逐张删除明确指定且 revision 匹配的画布 |

## 建议目录

```text
excalidraw-editor-mcp/
├── src/
│   ├── server.ts
│   ├── project-store.ts
│   ├── canvas-store.ts
│   ├── canvas-operations.ts
│   ├── assets.ts
│   ├── export.ts
│   └── app/
│       ├── index.tsx
│       └── styles.css
├── tests/
├── docs/
│   ├── DESIGN.md
│   └── IMPLEMENTATION-PLAN.md
├── package.json
└── LICENSE
```

先保持少量模块。只有在文件职责明显冲突时再拆目录。

## 验收标准

- 一个 npm 包同时提供 stdio MCP Server、tools 和 MCP App View。
- 用户可以只描述目标，由 Agent 在当前 Workspace 中创建一个工程、主画布和
  其他所需画布，并生成初始内容。
- 工程级工具可以列出、创建、打开、检查、重命名、复制和安全删除受管工程。
- 在 DSH Chat 中可创建、打开、绘制、选择、撤销、保存和再次打开画布。
- inline/fullscreen 切换前后是同一 iframe，未保存内容和选择保持。
- 人工 Save 不触发 Agent；Ask AI 明确进入当前 Session 的普通下一轮。
- AI 能分页检查画布，通过同批临时引用创建并绑定元素，并完整修改文本、
  shape、自由绘制、图片、Frame、分组、层级和连接关系。
- 当前固定版本可恢复、但语义 patch 尚未覆盖的字段可通过 `replace_canvas`
  导入；常规编辑不依赖完整 JSON。
- 画布可重命名、复制、安全删除，并导出 `.excalidraw`、SVG 和 PNG。
- AI 可对 exact saved revision 调用 `capture_canvas`，获得 Browser 渲染 PNG 和文本
  裁剪诊断；非视觉模型的图片降级必须明确可见。
- clean View 自动接收 AI revision；dirty View 不被覆盖并进入可操作冲突状态。
- revision 冲突、非法路径、超限文件和非法 patch 不造成数据丢失。
- 产物是标准 `.excalidraw` 文件，可由官方 Excalidraw 打开。
- Browser E2E 验证非空 canvas 像素、pointer 坐标、键盘输入、保存、
  AI 更新、选择连续性、冲突和 teardown。
- packed install 后可由 `dsh-uni-editor` 通过 stdio 启动。

## 明确不做

- Fork 或重写 Excalidraw；
- 多人在线房间、远端协作服务、CRDT 和用户光标同步；
- 绘制时把每个 pointer event 注入当前 Agent turn；
- 自动将每次 Save 转成 Agent 请求；
- 任意 Workspace 文件读写；
- V1 内的 AI 图片生成、网络图片抓取、外部 embeddable、Magic Frame、
  Library 管理和无限大小附件；
- 将 `setCursor`、当前工具、zoom、sidebar、undo/redo 等瞬时 UI 行为暴露为
  model-visible tools；
- 修改 `deepseek-harness` Agent Loop。

## 风险与门禁

| 风险 | 首轮处理 | 门禁 |
|---|---|---|
| Excalidraw bundle 超过 Host 默认 512 KiB | M0 测量并选择有限 `maxBodyBytes` 或拆分静态资源 | 未证明真实加载前不进入 M1 |
| 字体依赖外部 CDN | 优先自包含字体；若体积不可接受再单独评审资源服务 | 离线启动和 CSP 均通过 |
| 官方转换工具不适合 Node bundle | M0 直接导入并运行样例 | 失败时回到方案评审，不手写全量模型 |
| iframe surface 切换后 pointer 偏移 | 切换后 `refresh()` 并做真实 drag E2E | 坐标与选中元素一致 |
| 高频 `onChange` 造成性能或误 dirty | 内容摘要去重，只更新本地 draft | 连续拖动无网络写入 |
| 图片导致请求过大 | 有界读取、保存和清晰报错 | 边界测试无截断、无旧文件损坏 |
| AI 与人覆盖 | 双方统一 baseRevision CAS | stale 写入 100% 被拒绝 |
| 超时重试重复创建元素 | mutationId 幂等表 + 同批 clientRef | 相同调用只产生一个 revision |
| 完整文档接口挤占上下文 | 默认使用分页语义检查和 patch；replace 仅作逃生口 | 大画布主流程不传输完整 JSON |
| 工程删除误伤普通目录 | 只有带有效 manifest 的受管工程支持目录级变更 | 发现工程的目录级写操作全部拒绝 |
| 语义检查无法证明视觉结果 | Browser View 生成 revision-bound PNG 和文本诊断 | owner/revision 不匹配时拒绝；公式裁剪 Case 闭环 |

## 待确认

1. 仓库名使用 `excalidraw-editor-mcp`。
2. 使用官方 npm 组件而不是 fork 完整 Excalidraw 仓库。
3. 受管工程使用轻量 `.excalidraw-project.json` 标记所有权和默认画布；
   发现工程不允许目录级 rename、duplicate 或 delete。
4. V1 是人类与当前 Agent 的 revision 轮次协作，不做多人实时协作。
5. `.excalidraw` 文件是画布的唯一持久真值。
6. Save 不触发 Agent；Ask AI 是显式进入下一轮的入口。
7. LLM 工具采用语义 patch 主路径和完整文档逃生口，并覆盖工程、画布、
   元素、资源和导出生命周期。
8. M0 先解决 bundle、字体、Sandbox、Node 侧官方工具和导出路径五个阻断项。

## 参考

- [Excalidraw repository](https://github.com/excalidraw/excalidraw)
- [Excalidraw package README](https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw)
- [Excalidraw imperative API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [Excalidraw JSON schema](https://docs.excalidraw.com/docs/codebase/json-schema)
- [Programmatic element creation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)
- [`dsh-uni-editor`](../../dsh-uni-editor/README.md)
- [`threejs-editor-mcp` design reference](../../threejs-editor-mcp/docs/DESIGN.md)
