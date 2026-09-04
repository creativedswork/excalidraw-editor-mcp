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

## Safety Limits

- Asset source: regular file inside the active Workspace only; no URL,
  symlink, or hardlink.
- Asset types: PNG, JPEG, GIF, or WebP with a valid image header.
- Per asset: 1 MiB; decoded assets per canvas: 2 MiB.
- Dimensions: at most 8192 by 8192 and 32 million pixels.
- Canonical canvas document: 4 MiB.
- Model-visible tool result: 256 KiB.
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
