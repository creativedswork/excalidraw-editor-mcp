# excalidraw-editor-mcp

[中文](README.zh-CN.md)

An Excalidraw editor delivered as an MCP App for DeepSeek Harness (DSH). It
uses the official `@excalidraw/excalidraw` component and stores standard
`.excalidraw` files in the active DSH Workspace.

## Features

- Managed multi-canvas projects and discovered standalone canvases.
- Semantic inspect and atomic revision-checked edits.
- Interactive inline/fullscreen editing with save, reload, conflict recovery,
  and Ask AI.
- Bounded local PNG, JPEG, GIF, and WebP assets. Network images are rejected.
- JSON, SVG, and PNG downloads through the MCP Host.
- Revision-bound Browser captures with a standard MCP PNG and text clipping
  diagnostics for AI verification.
- Self-contained App HTML, including all Excalidraw fonts; no runtime CDN is
  required.

## Requirements

- Node.js `>=22.19.0`
- pnpm `10.25.0`
- DSH Web with `@creative-dswork/dsh-uni-editor`

## Build And Pack

```bash
pnpm install --frozen-lockfile
pnpm run release:check
pnpm pack --pack-destination .tmp
```

The package intentionally remains `private: true` at version `0.0.0`. Before
publishing, a maintainer must choose the release version, remove the private
guard, inspect the tarball, and confirm third-party notices.

## Configure DSH

Install the tarball into a directory and point DSH at its executable:

```bash
mkdir -p /absolute/path/to/excalidraw-mcp-install
cd /absolute/path/to/excalidraw-mcp-install
pnpm init
pnpm add /absolute/path/to/excalidraw-editor-mcp-0.0.0.tgz
```

Copy [`examples/dsh/cordis.patch.yml`](examples/dsh/cordis.patch.yml) into the
Web profile configuration and replace the placeholder paths. The essential
server entry is:

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

`forwardWorkspace` is required. The server accepts the Workspace only from
trusted DSH request metadata. `maxBodyBytes` allows the Host to carry the
self-contained App Resource and embedded fonts.

Validate and start the Web profile:

```bash
DSH_HOME="${DSH_HOME:-$HOME/.dsh}" pnpm dsh web --dump-config
DSH_HOME="${DSH_HOME:-$HOME/.dsh}" pnpm dsh web --host 127.0.0.1 --port 3080 --no-open
```

Open `http://127.0.0.1:3080/`, select a Workspace, and start a Session. Tools
are exposed with the configured prefix, such as
`mcp__excalidraw__create_project`.

## AI Visual Verification

After an edit, keep the canvas View open and call `capture_canvas` with the
exact saved revision. The View renders the canvas with Excalidraw's official
`exportToBlob` API and returns:

- a standard MCP `image/png` content block;
- the image dimensions, SHA-256 digest, and capture time;
- bounded text diagnostics with stored width, measured width, overflow, and
  clipping state.

Image-capable models can inspect the PNG directly. If the selected model does
not declare image input, DSH reports that limitation and the model can still
use the text diagnostics. In that case, the result does not prove that the
model inspected the pixels.

## Safety Limits

- Asset source: regular file inside the active Workspace only; no URL,
  symlink, or hardlink.
- Asset types: PNG, JPEG, GIF, or WebP with a valid image header.
- Per asset: 1 MiB; decoded assets per canvas: 2 MiB.
- Dimensions: at most 8192 by 8192 and 32 million pixels.
- Canonical canvas document: 4 MiB.
- Model-visible tool result: 256 KiB.
- Harness capture: at most 1024 by 1024, 512 KiB of base64 image data, and 100
  text diagnostics; one pending capture per Session connection with a
  15-second timeout.
- All writes use revision checks; rejected mutations preserve the old file.

## Development

```bash
pnpm typecheck
pnpm test
pnpm run release:check
```

Architecture and milestone details are in
[`docs/DESIGN.md`](docs/DESIGN.md) and
[`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md).
