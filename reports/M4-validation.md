# M4 资源、导出与发布验证

> 状态：`AWAITING_ACCEPTANCE`
>
> 验证日期：2026-09-07
>
> S5 基线：`4000463`

## 结论

M4 S1-S5 已形成等待人工验收的功能候选。

1. Workspace 内 PNG/JPEG/GIF/WebP 可受限导入，内容 SHA-256 作为稳定 asset ID。
2. URL、越界、symlink、hardlink、格式和资源限额在写入前拒绝。
3. 未引用资源清理保留所有 live image element 正在使用的资源。
4. JSON/SVG/PNG 由 Browser View 使用官方 Excalidraw API 渲染，并通过
   `ui/download-file` 交给 Host。
5. 双语文档、许可证、第三方声明、DSH 示例配置、CI、packed install 和
   `release:check` 已补齐。
6. 同一 tarball 已接入 fresh DSH Web，完成 desktop/mobile、离线资源、真实模型工具
   调用、下载和 teardown 验证。
7. `capture_canvas` 将 exact saved revision 交给已打开的 Browser View，通过官方
   `exportToBlob` 返回标准 MCP PNG 和文本裁剪诊断；公式裁剪 Case 已由真实 DSH
   Session 自主发现并修复。
8. App 通过 MCP Apps `ui/notifications/size-changed` 将 Chat inline View 请求高度
   从 Host 默认 320 px 提升到 480 px；fullscreen 往返和 mobile 均保持同一 iframe
   instance。

本报告证明 M4 功能候选满足里程碑退出条件，不代表 M0-M4 累计独立 Review 或
Release Hardening 已完成。

## Commit 范围

| Commit | 说明 |
|---|---|
| `63638bb` | `feat: add bounded canvas asset lifecycle` |
| `a230bdc` | `feat: add browser-backed canvas export` |
| `d2954c7` | `build: prepare distributable package` |
| `ada73c0` | `fix: bound packed app resource size` |
| `788a932` | `docs: close M4 validation` |
| `4000463` | S5 Canvas Visual Harness、文本尺寸修复、定向验证和文档 |
| 本提交 | Chat inline View 480 px sizing Fix 和真实 DSH 验证 |

Runtime harness、tarball、安装树、截图、下载和日志保留在 gitignored `.tmp/m4/`。

## Release Gate

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm run release:check` | PASS，43/43 | `.tmp/m4/release-check-fix.log` |
| default SDK 1.30 packed read | PASS，1/1 | `.tmp/m4/fix-packed-test.log` |
| packed App Resource wire line | PASS，8,626,188 bytes，低于默认 10 MiB | packed test |
| real Host View response | HTTP 200，8,626,317 bytes | `evidence/view-probe-*` |
| isolated tarball install | PASS | `.tmp/m4/install/` |

`release:check` 包含 typecheck、生产 build 和 43 项串行测试。Build 仍报告依赖中的既有
`EMPTY_IMPORT_META` warning；没有 build 或测试失败。

S5 定向检查：

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm run typecheck` | PASS | 本地命令结果 |
| `pnpm run build` | PASS | 本地命令结果 |
| `node --test --test-concurrency=1 tests/m4-harness.test.mjs` | PASS，3/3 | 定向测试 |
| packed DSH formula Harness | PASS | `.tmp/m4/s5/evidence/runtime-results.json` |
| packed DSH inline sizing | PASS | `.tmp/m4/s5/inline-size-evidence/runtime-results.json` |

Candidate：

- commit：`ada73c03686f5cb3eb1bfe167e7040c26088a3ab`
- tarball：`.tmp/m4/candidate/excalidraw-editor-mcp-0.0.0.tgz`
- tarball size：6,313,240 bytes
- tarball SHA-256：
  `906ab396b55a70a1ba14bef4dc13102c66288c4677a7cd3a8540e36e243c87c9`
- package guard：`version: 0.0.0`、`private: true`

首次 S3 candidate 将 235 个字体文件全部内联，导致 MCP `resources/read` JSON line
超过 SDK 1.30 默认 10 MiB stdio buffer。`ada73c0` 仅保留当前 UI 使用的字体注册和
payload，并在 packed test 中直接按默认 transport 和真实 wire size 回归。

S5 runtime candidate：

- 基线：`788a9325dfc30ee8d3e8610225b3cc7576a2c76a`
- tarball：`.tmp/m4/s5/candidate/excalidraw-editor-mcp-0.0.0.tgz`
- tarball size：6,316,305 bytes
- tarball SHA-256：
  `1b4da4ab2d3721a9d53f3491ea82d897578009a1be17abb8c7df9fa4337a3038`

真实 DSH run 后只修订了 `capture_canvas` 的输入模态说明和随包 README，运行协议与
实现未变。最终 packed candidate：

- tarball：`.tmp/m4/s5/final-candidate/excalidraw-editor-mcp-0.0.0.tgz`
- tarball size：6,317,171 bytes
- tarball SHA-256：
  `6ffa7484776de32f897af5f98ea35475049e9d0f6b6f8a3706e8c141b24ea3fe`
- final source checks：typecheck PASS、build PASS、S5 定向测试 3/3 PASS

Inline sizing Fix candidate：

- 基线：`40004638cb76b9d2abc61c0f48943e7b0597b7a3`
- tarball：`.tmp/m4/s5/inline-size-candidate/excalidraw-editor-mcp-0.0.0.tgz`
- tarball size：6,317,319 bytes
- tarball SHA-256：
  `082e918bb9a2d7500a3b8144493d101409db6c68ec9bb53acd0f10e1028e72e9`
- source checks：typecheck PASS、build PASS

## S4 Final Run Identity

- DSH origin：`http://127.0.0.1:3104`
- provider/model：`m4-anthropic/deepseek-v4-pro`
- candidate tarball SHA-256：
  `906ab396b55a70a1ba14bef4dc13102c66288c4677a7cd3a8540e36e243c87c9`
- run ID：`1788550560409-15063`
- workspace：`.tmp/m4/final-runtime/workspace`
- project：`excalidraw/m4-smoke-1788550560409-15063`
- canvas：`excalidraw/m4-smoke-1788550560409-15063/main.excalidraw`
- View instance：`35ebec63-beac-40b3-96fa-ad941aa98392`
- final revision：
  `76362b56bc4d51163b273de3c5aa87885c72555e8539dc89329a3719cb8611bc`

desktop、mobile、资源导入、清理、超限拒绝和三种下载均来自同一 fresh Host、page、
Workspace、View instance 和 candidate。

## S5 Harness Run Identity

- DSH origin：`http://127.0.0.1:3104`
- provider/model：`m4-anthropic/deepseek-v4-pro`
- run ID：`1788724330286-25540`
- Session：`session-da40e0d1-ab03-458b-b35d-d08a59165ac6`
- project：`excalidraw/m4-harness-1788724330286-25540`
- canvas：`excalidraw/m4-harness-1788724330286-25540/main.excalidraw`
- View instance：`1c849b8e-59b3-4630-9956-aa3c14ecb6f4`
- final revision：
  `48fa8c8512f8c63bf15becc06b3f47dd075068c1043df2a3edd9ca92af1717ee`

## Runtime 断言

### Desktop And Mobile

- desktop viewport：1440x1000；View root：748x320。
- mobile viewport：390x844；View root：262x320。
- 两者均为 inline、Clean，revision 和 instance ID 完全一致。
- desktop/mobile 截图均可见 Excalidraw 工具栏、画布和 DSH Chat。

### Offline Resources And Fonts

- 首次导航前即阻断全部非 loopback HTTP(S) 请求。
- 外部资源请求数为 0。
- 4 条字体规则全部为 embedded data URL。
- `document.fonts.status` 为 `loaded`；实际使用的 Assistant 和 Excalifont 已加载。
- 未使用的 FontFace 保持 `unloaded` 是浏览器按需加载行为；最终断言只拒绝
  `error`，不把 `unloaded` 误判为产品失败。

### Asset Round Trip And Cleanup

- `pixel.png` 原始 68 bytes 经模型调用 `add_canvas_asset` 导入。
- 稳定 asset ID：
  `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`。
- 模型创建一个 live image element，其 `fileId` 指向该 asset。
- `unused.gif` 导入后由 `remove_unused_assets` 删除。
- 最终文档只保留一个 image element 和一个 asset；解码后的 PNG bytes 与源文件一致。

### Limit Rejection

- 真实模型只调用一次 `add_canvas_asset` 导入 `large.png`。
- Server 返回 `asset exceeds 1048576 bytes`，模型按约定返回
  `M4_OVERSIZE_REJECTED`，没有重试或其他 mutation。
- 拒绝前后 revision 和文件 SHA-256 均保持
  `76362b56bc4d51163b273de3c5aa87885c72555e8539dc89329a3719cb8611bc`。

### Downloads

| 格式 | 文件名 | Bytes | SHA-256 |
|---|---|---:|---|
| JSON | `main.excalidraw` | 1,492 | `3ee9e9a72b0235959d65aa3bf1b3dfc78793c7555477a29d3b1a05da901dfdfc` |
| SVG | `main.svg` | 714 | `6f8b238e1e712c07837cfce13e55c47f0318c2caa3b497d2ba6388cc0f154020` |
| PNG | `main.png` | 1,715 | `bd388d9c1b212f618cf9f28d8285c535ee42d7f5b755d81f75b31788fa1fd766` |

三次 `export_canvas` 均经真实 MCP App `tools/call` 和 `ui/download-file` 完成。
文件分别通过 JSON、SVG 和 PNG 类型检查；PNG 为 260x180 RGBA。

### Canvas Visual Harness

- 模型创建 standalone 公式文本时显式指定 width 60、height 40；保存后的元素保留该
  尺寸，没有被 Node text-metrics shim 覆盖。
- 第一次 `capture_canvas` 绑定 revision
  `57e40d9ac344692f326d8ff9c7fe2b48b9f4634f1fe0dcdc05e45b50afe7f730`，
  Browser 测得宽度 291.73、overflow 231.73、`clipped=true`。
- 模型没有调用 Bash、文件、图片或网络工具，直接将同一元素改为 width 600、
  height 48。
- 第二次 capture 绑定最终 revision，测得 overflow 0、`clipped=false`；View 为
  `Clean`，View revision 与 canonical 文件 SHA-256 一致。
- 两次结果均携带有效 PNG digest 和尺寸。当前 `deepseek-v4-pro` 不声明 image
  input，DSH 明确返回 `image unavailable`，因此本次只证明模型使用文本诊断完成
  修复，不声称该模型检查过 PNG 像素。
- 定向 MCP 测试另行验证标准 image content、owner 隔离、exact revision、PNG digest
  拒绝和显式 text 尺寸保持。

### Chat Inline Sizing

- desktop inline iframe 和 View root 均为 748x480。
- fullscreen iframe 和 View root 均为 1440x956，高度不受 480 px inline 请求限制。
- 返回 inline 后恢复为 748x480。
- mobile inline iframe 和 View root 均为 262x480，无横向溢出。
- 四个状态的 instance ID 均为
  `00df31c5-ff11-4468-94f1-02a6fdc16a6f`，证明 fullscreen 往返复用同一 iframe。
- page error 为空。
- 首次恢复旧 Session 被 DSH history timeout 阻断，未进入尺寸断言；最终 PASS 使用
  fresh Session 和一次 `open_canvas`，不复用失败尝试的页面状态。

## Evidence

根目录：`.tmp/m4/final-runtime/`

| Artifact | 用途 |
|---|---|
| `evidence/runtime-results.json` | 同 run 状态、字体、离线、资源、限额和下载断言 |
| `evidence/tool-trace.txt` | 真实模型工具顺序、错误和完成 sentinel |
| `evidence/browser-events.log` | MCP App View/tool/download 请求 |
| `frames/desktop.png` | desktop 真实页面 |
| `frames/mobile.png` | mobile 真实页面 |
| `evidence/downloads/` | JSON/SVG/PNG Host 下载 |
| `evidence/view-probe-response.html` | packed App Resource Host 响应 |
| `evidence/teardown.txt` | Host、MCP、Browser 和端口清理 |

关键 SHA-256：

- runtime results：
  `48662abaf97d75b96ec855c0a04c8063f053102a57426f562bcd4781d337a4b8`
- tool trace：
  `4954c9417073f1a932ade4f59976d9e5bdd0b00715a08262c9b7a3758dbd0f9c`
- desktop：
  `bc04d12e71c1a4dbb2ad5255421e10d3a444d7e27e8c1f2b11c0a098b04c833c`
- mobile：
  `d115a6b6851d0f962ca2e68e8188a80a5ba02dcec895b02ebe6419473dc8ddb9`
- View response：
  `edb19ca631aaa66b751c890e5ae10c3c8f397126b1d4d3ac4d479971e4c57b44`

失败尝试隔离在 `evidence/attempt-*`。最终 PASS 不复用失败 run 的 page、project 或
View identity。

S5 根目录：`.tmp/m4/s5/`

| Artifact | 用途 |
|---|---|
| `evidence/runtime-results.json` | 两次 capture、Session、revision、公式和 page error 断言 |
| `evidence/tool-trace.txt` | 模型工具顺序、无 Bash 和完成 sentinel |
| `evidence/browser-events.log` | MCP App View 与 app-only tool 请求 |
| `frames/formula-fixed.png` | DSH Chat 与最终 View |
| `frames/canvas-fixed.png` | 最终 Excalidraw View |

S5 关键 SHA-256：

- runtime results：
  `c2f7b4a1072fe9d341ff36c265d9479891ad766485942d2da90588faff955724`
- tool trace：
  `9909da05f050e7a10535f042d3149d480a96e4683d784d4730ad74141fc9b9c9`
- DSH page：
  `80f059b6a2d29254172f9f1badd779c642133cd2869b1ed94b417e1764161d25`
- Canvas View：
  `f733e1bd6bece2231729bdb812b1965a06505b1ea2c73b800495e6d0fe5bb7bf`

Inline sizing 根目录：`.tmp/m4/s5/inline-size-evidence/`

| Artifact | 用途 |
|---|---|
| `runtime-results.json` | desktop/fullscreen/returned-inline/mobile 尺寸、instance 和 page error |
| `desktop-inline.png` | 480 px desktop inline View |
| `fullscreen.png` | 同一 instance 的 fullscreen View |
| `mobile-inline.png` | 480 px mobile inline View |
| `history-attempt-failure.png` | 隔离的旧 Session history timeout |

Inline sizing 关键 SHA-256：

- runtime results：
  `b17af79b636e0b0a0c7a433570620ac12c7ca4578d65f62155f87f9fd3294179`
- desktop inline：
  `6fe0e35c81078eb12c649ce6032fd58c5f2b7ecacecbafe6d21ae4bd504ac1a8`
- fullscreen：
  `6a6bc0767c16c5495682b9dc9c1ac3c4524c57f97171dde86a1988e85894081f`
- mobile inline：
  `f81a7d0ae183d44771d92c48306ff53f8f51ad29c6fd7b7f0edf8ed915b1c3db`

## Cleanup

- M4 Host process group `91548` 已退出。
- S5 Host PID `11403` 及 packed MCP PID `15110` 已退出。
- Inline sizing Host PID `92992` 及 packed MCP PID `98333` 已退出。
- 3104 无 TCP listener，HTTP probe 返回 connection refused / `000`。
- packed MCP、`runtime.mjs` 和 final browser profile 均无残留进程。
- 旧 3080/3094/3097 和其他历史实例不属于 M4 ownership，未修改。

## DSH 配置与启动

1. 从 candidate 安装：

   ```bash
   pnpm add /absolute/path/to/excalidraw-editor-mcp-0.0.0.tgz
   ```

2. 在 Web profile 合并 `examples/dsh/cordis.patch.yml`，将 `command` 和 `cwd`
   替换为 packed install 的绝对路径，并保持 `forwardWorkspace: true`。
3. 启动 DSH Web：

   ```bash
   pnpm dsh --profile web --host 127.0.0.1 --port 3104 --no-open
   ```

4. 在 DSH 选择 Workspace、新建 Session，并要求模型使用 `excalidraw` MCP 创建或
   打开画布。View 会以内嵌 Canvas 形式出现在 Chat。

完整配置、工具和安全边界见 `README.md`、`README.zh-CN.md` 与
`examples/dsh/cordis.patch.yml`。

## Acceptance Steps

1. 复核 M4 commit、两个 candidate SHA-256、43/43 release gate 和 S5 3/3 定向测试。
2. 查看 desktop/mobile 截图，确认同一画布在两种 viewport 下可见且没有 UI 重叠。
3. 对照 `runtime-results.json` 检查同一 instance/revision、离线字体和资源 round trip。
4. 对照 `tool-trace.txt` 检查导入、live 引用、清理、超限单次拒绝和三个 export。
5. 打开 `evidence/downloads/`，确认 JSON/SVG/PNG 文件名、格式和内容。
6. 查看 `evidence/teardown.txt`，确认 3104、packed MCP 和 Browser 无残留。
7. 查看 S5 `runtime-results.json` 和 `formula-fixed.png`，确认第一次 capture 为
   `clipped=true`，模型扩宽同一元素后第二次为 `clipped=false`，且没有 Bash 调用。
8. 查看 inline sizing `runtime-results.json` 和三张截图，确认 desktop/mobile inline
   高度均为 480 px，fullscreen 高度为 956 px，往返期间 instance ID 不变。

预期结果：画布 desktop/mobile 均为 Clean；live PNG 原字节保留，unused GIF 删除；
超限导入不改变 revision；三种文件均由 Host 下载；离线无外部资源请求；teardown
完整；Harness 证据与 Session owner、canvas path 和 exact saved revision 一致。
Chat inline 高度为 480 px，fullscreen 仍填满 Host viewport，返回 inline 后恢复
480 px，mobile 无横向溢出。

失败判定：资源越界或超限仍写盘、live 资源被误删、导出文件为空或类型错误、View 依赖
外网、desktop/mobile 身份漂移，或 M4 Host/MCP/Browser/3104 listener 残留。
Harness 的跨 Session 证据被接受、revision 漂移仍返回图片、公式裁剪未闭环，或出现
未授权 Bash 调用也判定失败。
Inline 高度仍为 320 px、fullscreen 被固定为 480 px、往返后 iframe instance 变化，
或 mobile 出现横向溢出也判定失败。

## Release Hardening

- M0-M4 累计 diff 的独立代码审查和额外覆盖。
- 完整跨 provider、跨版本、长时间运行和多 View 并发矩阵。
- 使用声明 image input 的 provider 验证 PNG 像素直接进入模型上下文。
- 最终版本号、公开发布内容、许可证清单和发布渠道确认。

这些项目只有在用户验收 M4 并明确授权后才开始。

## Exclusions And Remote Status

- 未实现网络图片、AI 图片生成、CRDT 或多人协作。
- 未修改 DeepSeek Harness Agent Loop 或其他仓库。
- 未执行累计独立 Review 或 Release Hardening。
- 未执行 npm publish、push、PR、amend、rebase 或其他远端操作。
