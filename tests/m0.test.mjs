import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const officialPath = new URL('../dist/official.js', import.meta.url)
const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))

test('official Excalidraw conversion, restore, and serialization round trip', async () => {
  const { officialRoundTrip } = await import(officialPath.href)
  const result = officialRoundTrip()

  assert.deepEqual(result.types, ['rectangle', 'text'])
  assert.equal(result.text, 'M0')
  assert.equal(result.document.type, 'excalidraw')
  assert.equal(result.document.version, 2)
  assert.equal(result.document.elements.length, 2)
})

test('stdio server exposes the spike tool and bundled MCP App resource', async () => {
  const client = new Client({
    name: 'excalidraw-editor-m0-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))

  try {
    const listed = await client.listTools()
    assert.deepEqual(listed.tools.map(tool => tool.name), ['show_canvas_spike'])
    assert.deepEqual(listed.tools[0]._meta?.ui, {
      resourceUri: 'ui://excalidraw-editor/app',
      visibility: ['model'],
    })

    const shown = await client.callTool({
      name: 'show_canvas_spike',
      arguments: {},
    })
    assert.equal(shown.isError, undefined)
    assert.equal(shown.structuredContent?.kind, 'excalidraw-m0-spike')

    const resource = await client.readResource({
      uri: 'ui://excalidraw-editor/app',
    })
    assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app')
    assert.match(resource.contents[0]?.text ?? '', /data-excalidraw-m0/)
    assert.match(resource.contents[0]?.text ?? '', /__EXCALIDRAW_M0__/)
  } finally {
    await client.close()
  }
})
