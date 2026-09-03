# excalidraw-editor-mcp

An Excalidraw canvas delivered as an MCP App for DeepSeek Harness and
`@creative-dswork/dsh-uni-editor`.

Status: M1 project and canvas lifecycle implementation.

- [`docs/DESIGN.md`](docs/DESIGN.md)
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

The proposed implementation embeds the official
`@excalidraw/excalidraw` package instead of maintaining a fork of the full
Excalidraw application.

Build the package and configure it as a trusted local stdio MCP server:

```bash
pnpm install
pnpm build
```

```json
{
  "mcpServers": {
    "excalidraw-editor": {
      "command": "node",
      "args": ["/absolute/path/to/excalidraw-editor-mcp/dist/server.js"],
      "transport": "stdio",
      "forwardWorkspace": true
    }
  }
}
```

`forwardWorkspace` is required for model-visible project and canvas tools.
The server accepts the Workspace only from trusted request metadata, never
from a model-visible filesystem-path argument.
