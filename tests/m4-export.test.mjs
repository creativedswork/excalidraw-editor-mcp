import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
const stateUrl = new URL('../src/view-state.ts', import.meta.url)
const workspaceKey = 'ai.deepseek.dsh/workspace'
const sessionKey = 'ai.deepseek.dsh/session'

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

test('export_canvas binds the Browser View and returns a bounded download request', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m4-export-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const client = new Client({ name: 'excalidraw-editor-m4-export', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => client.close())
  const meta = {
    [workspaceKey]: { cwd: workspace },
    [sessionKey]: { sessionId: 'm4-export', connectionGeneration: 'test' },
  }
  const created = await client.callTool({
    name: 'create_project',
    arguments: {
      projectPath: 'designs/export',
      name: 'Export',
      defaultCanvasPath: 'System Plan.excalidraw',
      mutationId: 'create-export',
    },
    _meta: meta,
  })
  const canvasPath = created.structuredContent.canvasPath

  for (const format of ['json', 'svg', 'png']) {
    const exported = await client.callTool({
      name: 'export_canvas',
      arguments: {
        projectPath: 'designs/export',
        canvasPath,
        format,
      },
      _meta: meta,
    })
    assert.equal(exported.isError, undefined, exported.content[0]?.text)
    assert.deepEqual(exported.structuredContent, {
      canvasPath,
      revision: created.structuredContent.revision,
      format,
      filename: `System-Plan.${format === 'json' ? 'excalidraw' : format}`,
      delivery: 'ui/download-file',
    })
  }

  const tools = await client.listTools()
  assert.deepEqual(
    tools.tools.find(tool => tool.name === 'export_canvas')._meta?.ui,
    {
      resourceUri: 'ui://excalidraw-editor/app',
      visibility: ['model'],
    },
  )
  assert.deepEqual(
    tools.tools.find(tool => tool.name === 'add_canvas_asset')._meta?.ui,
    { visibility: ['model'] },
  )

  const resource = await client.readResource({ uri: 'ui://excalidraw-editor/app' })
  const html = resource.contents[0]?.text ?? ''
  assert.match(html, /Canvas changed before export; retry export_canvas/)
  assert.match(html, /Host rejected the canvas download/)
})
