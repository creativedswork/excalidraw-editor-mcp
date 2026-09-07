import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
const stateUrl = new URL('../src/view-state.ts', import.meta.url)

test('export filenames are host-safe and derive from the canvas path', async () => {
  const { exportFilename } = await import(stateUrl.href)

  assert.equal(
    exportFilename('designs/demo/My system plan.excalidraw', 'json'),
    'My-system-plan.excalidraw',
  )
  assert.equal(exportFilename('designs/demo/.部署图.excalidraw', 'svg'), 'canvas.svg')
  const bounded = exportFilename(`designs/${'x'.repeat(200)}.excalidraw`, 'png')
  assert.match(bounded, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
  assert.equal(bounded.length, 128)
})

test('canvas export is available only through an explicit View action', async (t) => {
  const client = new Client({ name: 'excalidraw-editor-m4-export', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    maxBufferSize: 32 * 1024 * 1024,
  }))
  t.after(() => client.close())

  const tools = await client.listTools()
  assert.equal(tools.tools.some(tool => tool.name === 'export_canvas'), false)
  assert.deepEqual(
    tools.tools.find(tool => tool.name === 'add_canvas_asset')._meta?.ui,
    { visibility: ['model'] },
  )

  const resource = await client.readResource({ uri: 'ui://excalidraw-editor/app' })
  const html = resource.contents[0]?.text ?? ''
  assert.match(html, /data-export/)
  assert.match(html, /Host rejected the canvas download/)
  assert.doesNotMatch(html, /delivery/)
  assert.doesNotMatch(html, /retry export_canvas/)
})
