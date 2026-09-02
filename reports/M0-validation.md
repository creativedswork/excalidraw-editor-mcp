# M0 集成可行性验证

> 状态：功能候选，等待人工验收
>
> 验证日期：2026-09-02

## 结论

M0 的五个集成阻断项均已通过真实运行验证：

1. 官方 Excalidraw View 可在 DSH MCP App 双 iframe Sandbox 中加载。
2. Excalidraw 官方 conversion、restore 和 serialization API 可在 Node bundle 中运行。
3. 字体可在 CSP 下加载，Canvas 有非空像素输出。
4. inline/fullscreen 切换保留同一 iframe、未保存 scene 和选择状态。
5. `.excalidraw`、SVG 和 PNG 可通过 DSH Host 的 `ui/download-file` 落盘。

本结论仅表示 M0 功能候选成立，不代表完整工程能力或上线标准。

## 环境

- Node.js：>= 22.19
- 包管理器：pnpm
- Excalidraw：`@excalidraw/excalidraw@0.18.0`
- MCP SDK：`@modelcontextprotocol/sdk@1.30.0`
- MCP Apps：`@modelcontextprotocol/ext-apps@1.7.5`
- DSH Web：`http://127.0.0.1:3094/`
- MCP Resource：`ui://excalidraw-editor/app`
- DSH `maxBodyBytes`：16 MiB

## 自动化结果

`pnpm typecheck` 通过。`pnpm test` 覆盖：

- 官方 `convertToExcalidrawElements` -> `restoreElements` -> JSON serialization round trip。
- stdio MCP Server 的 `tools/list`、`tools/call` 和 App Resource 读取。

结果：2/2 通过。

DSH Host 的浏览器 bundle 通过 `pnpm run build` 构建。未执行 DSH 全仓测试、
全仓 lint 或完整 Release Hardening。

Excalidraw/Jotai/Zustand 的 IIFE 构建仍产生 `EMPTY_IMPORT_META` warning；当前
Browser smoke 已证明生成物可运行，warning 的消除或显式固定延后到 Release
Hardening。

## 真实 DSH Browser 证据

### 加载与渲染

- 工具调用：`mcp__excalidraw__show_canvas_spike`
- Server：`excalidraw`
- Resource：`ui://excalidraw-editor/app`
- 双 iframe 加载后 frame 总数：3
- 初始 scene 元素数：2
- Canvas 节点数：2
- 主 Canvas 非透明采样点：21,120
- 采样颜色数：46
- `Excalifont` 与 `Assistant` 的 `document.fonts.check()` 均为 `true`
- 字体源：`https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/fonts/`
- 验证期间无相关 CSP、字体网络或 console 错误

### Pointer 与 surface 连续性

- 点击种子矩形后选择 ID：`m0-seed`
- 拖动前后截图 SHA-256 不同，且选择 ID 保留
- inline iframe：`748 x 320`
- fullscreen iframe：`1440 x 856`
- 返回 inline：`748 x 320`
- 切换前后 frame 总数始终为 3
- iframe identity marker 全程不变
- 返回 inline 后 `m0-seed` 仍处于选择状态

这证明 surface 切换没有重建 App iframe，未保存 scene 与选择状态连续。

### Host 导出

真实点击三个导出按钮后，Playwright 捕获到浏览器下载事件，三项
`download.failure()` 均为 `null`。

| 文件 | 大小 | 校验 |
|---|---:|---|
| `excalidraw-m0.excalidraw` | 1,931 B | JSON，`type=excalidraw`，version 2，2 个元素 |
| `excalidraw-m0.svg` | 1,169 B | SVG，包含实际 `<rect>` |
| `excalidraw-m0.png` | 5,915 B | PNG 签名，280 x 160 RGBA |

SHA-256：

- JSON：`b62409c631aa94af7362fa36acf9882612048ed5b7046d7ca58dd1fbf9d3fd7a`
- SVG：`f37b6f69e169377e975a3ccde018dd94c5a238ff8941f9e45694b56fac5b7986`
- PNG：`aa6f28c66207d4733931238944836f6b69fe96b2937d7b49e3c446a2138cb52c`

下载文件位于被 Git 忽略的 `.tmp/m0-exports/`。

## Bundle 结果

| 产物 | 字节数 |
|---|---:|
| `dist/view.js` | 8,023,750 |
| `dist/style.css` | 163,399 |
| `dist/server.js` | 2,465 |
| View JS + CSS | 8,187,149 |

M0 的 DSH Profile 使用 16 MiB `maxBodyBytes`，可容纳当前 App Resource。

## 实现与提交

### `excalidraw-editor-mcp`

- `066f449 feat: add M0 Excalidraw MCP app spike`
- S2 候选提交见 `docs/status/M0.md`

S2 修复字体资源源、inline 高度和初始状态文案。

### `dsh-uni-editor`

- `68cf501 feat: support MCP App canvas exports`

Host 现在接受以下受限的 embedded resource：

- `.excalidraw` / `.json` + `application/json` text
- `.svg` + `image/svg+xml` text
- `.png` + `image/png` base64 blob

文件名仍需通过安全字符校验，单文件仍限制为 4 MiB。

## 延后到 Release Hardening

- DSH 全仓测试、类型检查、lint 和生产门禁。
- MCP 仓库 packed install 与发布包内容验证。
- 断网启动与静态资源完全自包含验证。
- desktop/mobile 完整 viewport 回归。
- 大文件、非法 base64、MIME/扩展名不匹配和用户取消下载的自动化矩阵。
- 独立累计 diff Review。

这些项目不阻断 M0 的集成可行性结论，但上线前必须统一执行。

## 人工验收

1. 打开 `http://127.0.0.1:3094/` 中现有 M0 会话。
2. 确认 Excalidraw 画布、种子矩形和文本可见。
3. 选中并拖动矩形。
4. 切换 fullscreen，再返回 inline，确认选择和画布内容仍在。
5. 依次导出 JSON、SVG、PNG，确认浏览器产生三个文件。

失败判定：

- 画布为空白或字体缺失；
- pointer 命中偏移；
- surface 切换后 iframe、scene 或选择重置；
- 任一格式未触发下载或文件无法由对应格式解析。
