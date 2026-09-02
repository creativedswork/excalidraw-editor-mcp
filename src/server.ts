#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const RESOURCE_URI = 'ui://excalidraw-editor/app'
const FONT_ORIGIN = 'https://esm.sh'
const FONT_PATH =
  `${FONT_ORIGIN}/@excalidraw/excalidraw@0.18.0/dist/prod/fonts/`
const CSP = {
  connectDomains: [] as string[],
  resourceDomains: [FONT_ORIGIN],
  frameDomains: [] as string[],
  baseUriDomains: [] as string[],
}

function viewHtml(script: string, css: string): string {
  const selfContainedCss = css.replaceAll('./fonts/', FONT_PATH)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Excalidraw M0</title>
  <style>${selfContainedCss.replaceAll('</style', '<\\/style')}</style>
</head>
<body>
  <div id="root"></div>
  <script>${script.replaceAll('</script', '<\\/script')}</script>
</body>
</html>`
}

function shown(): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: 'Opened the Excalidraw M0 integration canvas.',
    }],
    structuredContent: {
      kind: 'excalidraw-m0-spike',
      version: 1,
    },
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'excalidraw-editor-mcp',
    version: '0.0.0',
  })

  registerAppTool(server, 'show_canvas_spike', {
    title: 'Show Excalidraw M0 canvas',
    description: 'Opens the M0 Excalidraw MCP App integration canvas.',
    inputSchema: {},
    outputSchema: z.object({
      kind: z.literal('excalidraw-m0-spike'),
      version: z.literal(1),
    }),
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['model'],
      },
    },
  }, async () => shown())

  registerAppResource(server, 'excalidraw-editor-view', RESOURCE_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        csp: CSP,
        prefersBorder: false,
      },
    },
  }, async (): Promise<ReadResourceResult> => {
    const [script, css] = await Promise.all([
      readFile(new URL('./view.js', import.meta.url), 'utf8'),
      readFile(new URL('./style.css', import.meta.url), 'utf8'),
    ])
    return {
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: viewHtml(script, css),
        _meta: {
          ui: {
            csp: CSP,
            prefersBorder: false,
          },
        },
      }],
    }
  })

  return server
}

await createServer().connect(new StdioServerTransport())
