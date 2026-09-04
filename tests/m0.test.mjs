import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const officialPath = new URL('../dist/official.js', import.meta.url)
const readmePath = new URL('../README.md', import.meta.url)
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

test('stdio server exposes M1 tools and the bundled MCP App resource', async () => {
  const client = new Client({
    name: 'excalidraw-editor-m0-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    maxBufferSize: 32 * 1024 * 1024,
  }))

  try {
    const listed = await client.listTools()
    const modelTools = listed.tools
      .filter(tool => tool._meta?.ui?.visibility?.includes('model'))
      .map(tool => tool.name)
    assert.equal(modelTools.includes('create_project'), true)
    assert.equal(modelTools.includes('open_canvas'), true)
    assert.equal(modelTools.includes('pull_canvas'), false)
    assert.deepEqual(
      listed.tools.find(tool => tool.name === 'create_project')._meta?.ui,
      {
        resourceUri: 'ui://excalidraw-editor/app',
        visibility: ['model'],
      },
    )

    const resource = await client.readResource({
      uri: 'ui://excalidraw-editor/app',
    })
    assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app')
    assert.match(resource.contents[0]?.text ?? '', /data-excalidraw-m0/)
    assert.match(resource.contents[0]?.text ?? '', /__EXCALIDRAW_M0__/)

    const readme = await readFile(readmePath, 'utf8')
    const configuredLimit = Number(readme.match(/maxBodyBytes:\s*(\d+)/)?.[1])
    assert.equal(configuredLimit, 32 * 1024 * 1024)
    assert.ok(Buffer.byteLength(resource.contents[0]?.text ?? '', 'utf8') <= configuredLimit)
  } finally {
    await client.close()
  }
})
