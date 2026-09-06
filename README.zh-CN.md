# excalidraw-editor-mcp

[English](README.md)

面向 DeepSeek Harness（DSH）的 Excalidraw MCP App。它复用官方
`@excalidraw/excalidraw` 组件，并在当前 DSH Workspace 中保存标准
`.excalidraw` 文件。

## 能力

- 管理多画布工程，也可发现已有的独立画布。
- 分页检查画布，并通过 revision 校验原子应用语义编辑。
- 在 inline/fullscreen View 中编辑、保存、重载、处理冲突和 Ask AI。
- 有界导入 Workspace 内的 PNG、JPEG、GIF 和 WebP；拒绝网络图片。
- 通过 MCP Host 下载 JSON、SVG 和 PNG。
- 基于 saved revision 从 Browser View 捕获标准 MCP PNG 和文本裁剪诊断，供 AI
  验证。
- App HTML 和 Excalidraw 字体完全自包含，运行时不依赖 CDN。

## 环境要求

- Node.js `>=22.19.0`
- pnpm `10.25.0`
- 已安装 `@creative-dswork/dsh-uni-editor` 的 DSH Web

## 构建与打包

```bash
pnpm install --frozen-lockfile
pnpm run release:check
pnpm pack --pack-destination .tmp
```

包当前有意保持 `private: true` 和版本 `0.0.0`。发布前必须由维护者确定正式版本、
移除 private 门禁、检查 tarball 内容并确认第三方许可。

## 配置 DSH

先把 tarball 安装到独立目录：

```bash
mkdir -p /absolute/path/to/excalidraw-mcp-install
cd /absolute/path/to/excalidraw-mcp-install
pnpm init
pnpm add /absolute/path/to/excalidraw-editor-mcp-0.0.0.tgz
```

复制 [`examples/dsh/cordis.patch.yml`](examples/dsh/cordis.patch.yml) 到 Web
profile 配置并替换占位路径。核心配置如下：

```yaml
- id: mcp-apps
  config:
    maxBodyBytes: 33554432
    servers:
      - serverName: excalidraw
        transport: stdio
        command: /absolute/path/to/excalidraw-mcp-install/node_modules/.bin/excalidraw-editor-mcp
        args: []
        cwd: /absolute/path/to/excalidraw-mcp-install
        forwardWorkspace: true
```

`forwardWorkspace` 必须开启。Server 只从可信 DSH 请求元数据读取 Workspace，不接受
模型传入任意文件系统根路径。`maxBodyBytes` 用于承载包含字体的自包含 App Resource。

校验配置并启动：

```bash
DSH_HOME="${DSH_HOME:-$HOME/.dsh}" pnpm dsh web --dump-config
DSH_HOME="${DSH_HOME:-$HOME/.dsh}" pnpm dsh web --host 127.0.0.1 --port 3080 --no-open
```

打开 `http://127.0.0.1:3080/`，选择 Workspace 并创建 Session。工具名会带配置的
Server 前缀，例如 `mcp__excalidraw__create_project`。

## AI 视觉验证

编辑后保持画布 View 打开，并使用精确的 saved revision 调用
`capture_canvas`。View 通过 Excalidraw 官方 `exportToBlob` API 渲染画布并返回：

- 标准 MCP `image/png` content block；
- 图片尺寸、SHA-256 和捕获时间；
- 有界文本诊断，包括保存宽度、浏览器测量宽度、溢出量和裁剪状态。

支持图像输入的模型可以直接检查 PNG。若当前模型未声明图像输入，DSH 会明确报告该
限制，模型仍可使用文本诊断；此时结果不能证明模型检查过像素。

## 安全限额

- 图片必须是当前 Workspace 内的普通文件；拒绝 URL、symlink 和 hardlink。
- 只接受图片头有效的 PNG、JPEG、GIF 和 WebP。
- 单资源不超过 1 MiB；单画布解码后资源总量不超过 2 MiB。
- 宽高均不超过 8192，像素总量不超过 3200 万。
- canonical 画布文档不超过 4 MiB。
- 模型可见工具结果不超过 256 KiB。
- Harness capture 宽高均不超过 1024，base64 图片数据不超过 512 KiB，文本诊断
  不超过 100 条；每个 Session 连接同时只能有一个请求，15 秒超时。
- 所有写入均校验 revision；拒绝的 mutation 不改变旧文件。

## 开发检查

```bash
pnpm typecheck
pnpm test
pnpm run release:check
```

架构与里程碑说明见 [`docs/DESIGN.md`](docs/DESIGN.md) 和
[`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)。
