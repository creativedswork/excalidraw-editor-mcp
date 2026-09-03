# excalidraw-editor-mcp

An Excalidraw canvas delivered as an MCP App for DeepSeek Harness and
`@creative-dswork/dsh-uni-editor`.

Status: M1 project and canvas lifecycle implementation.

- [`docs/DESIGN.md`](docs/DESIGN.md)
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

The implementation embeds the official
`@excalidraw/excalidraw` package instead of maintaining a fork of the full
Excalidraw application.

## Prerequisites

- Node.js `^22.19.0` or `>=24.0.0`.
- `pnpm`; each checkout pins its required version in `packageManager`.
- Local checkouts of `deepseek-harness`, `dsh-uni-editor`, and this repository.
- A configured DSH model credential with available credit. For the default
  provider, set `DEEPSEEK_API_KEY` or configure it through DSH before starting.

## Build

Set the three checkout paths, then install and build each component:

```bash
export DSH_ROOT=/absolute/path/to/deepseek-harness
export UNI_EDITOR_ROOT=/absolute/path/to/dsh-uni-editor
export EXCALIDRAW_MCP_ROOT=/absolute/path/to/excalidraw-editor-mcp

cd "$EXCALIDRAW_MCP_ROOT"
pnpm install --frozen-lockfile
pnpm build

cd "$UNI_EDITOR_ROOT"
pnpm install --frozen-lockfile
pnpm build

cd "$DSH_ROOT"
pnpm install --frozen-lockfile
pnpm run build
```

## Configure DSH

Install the local Uni Editor bundle into the Web profile:

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
cd "$DSH_ROOT"
DSH_HOME="$DSH_HOME" pnpm dsh plugin --profile web add "$UNI_EDITOR_ROOT"
```

Edit `$DSH_HOME/profiles/web/cordis.patch.yml`. This is the configuration
shape used by this workspace:

```yaml
- id: mcp-apps
  config:
    maxBodyBytes: 16777216
    servers:
      - serverName: excalidraw
        transport: stdio
        command: node
        args:
          - /absolute/path/to/excalidraw-editor-mcp/dist/server.js
        cwd: /absolute/path/to/excalidraw-editor-mcp
        forwardWorkspace: true
```

`forwardWorkspace` is required for model-visible project and canvas tools.
The server accepts the Workspace only from trusted DSH request metadata,
never from a model-visible filesystem-path argument.

`maxBodyBytes: 16777216` is also required. The current bundled App Resource is
about 8.19 MiB; a smaller limit such as `2097152` lets tools succeed but makes
the linked view fail with `MCP App unavailable` and
`MCP App resource is too large`. Change the value in
`$DSH_HOME/profiles/web/cordis.patch.yml`; a running DSH profile reloads valid
config edits automatically. Re-open the Session after HMR. Restart only that
DSH process if the profile does not reload.

Validate the composed configuration, then start DSH:

```bash
cd "$DSH_ROOT"
DSH_HOME="$DSH_HOME" pnpm dsh web --dump-config
DSH_HOME="$DSH_HOME" pnpm dsh web --host 127.0.0.1 --port 3080 --no-open
```

Open `http://127.0.0.1:3080/`, choose the Workspace that should contain the
Excalidraw projects, and start a Session. A model-visible tool is named with
the configured server prefix, for example
`mcp__excalidraw__create_project`.

For a published DSH installation, use the equivalent commands:

```bash
dsh plugin --profile web add "$UNI_EDITOR_ROOT"
dsh web
```

Full M1 user acceptance cases, expected files, and failure criteria are in
[`reports/M1-validation.md`](reports/M1-validation.md).
