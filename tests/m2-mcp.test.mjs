import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
const workspaceKey = 'ai.deepseek.dsh/workspace'
const sessionKey = 'ai.deepseek.dsh/session'

test('app save, conflict, reload, and save-as-copy preserve drafts', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m2-mcp-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const client = new Client({ name: 'excalidraw-editor-m2-test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => client.close())

  const meta = {
    [workspaceKey]: { cwd: workspace },
    [sessionKey]: { sessionId: 'm2-test', connectionGeneration: 'test' },
  }
  const created = await client.callTool({
    name: 'create_project',
    arguments: {
      projectPath: 'designs/demo',
      name: 'Demo',
      mutationId: 'create-demo',
    },
    _meta: meta,
  })
  const canvasPath = created.structuredContent.canvasPath
  const baseRevision = created.structuredContent.revision
  const draft = {
    type: 'excalidraw',
    version: 2,
    source: 'test',
    elements: [{ id: 'saved', type: 'text', text: 'saved' }],
    appState: {},
    files: {},
  }

  const saved = await client.callTool({
    name: 'push_canvas',
    arguments: {
      canvasPath,
      baseRevision,
      mutationId: 'save-draft',
      document: draft,
    },
    _meta: meta,
  })
  assert.equal(saved.isError, undefined)
  const savedRevision = saved.structuredContent.canvas.revision
  assert.notEqual(savedRevision, baseRevision)

  const stale = await client.callTool({
    name: 'push_canvas',
    arguments: {
      canvasPath,
      baseRevision,
      mutationId: 'save-stale',
      document: { ...draft, elements: [{ id: 'local', type: 'text', text: 'local' }] },
    },
    _meta: meta,
  })
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /revision conflict/)

  const pulled = await client.callTool({
    name: 'pull_canvas',
    arguments: { canvasPath, currentRevision: baseRevision },
    _meta: meta,
  })
  assert.equal(pulled.structuredContent.changed, true)
  assert.equal(pulled.structuredContent.revision, savedRevision)

  const copyPath = 'designs/demo/conflict-copy.excalidraw'
  const copied = await client.callTool({
    name: 'save_canvas_copy',
    arguments: {
      canvasPath,
      newCanvasPath: copyPath,
      mutationId: 'save-copy',
      document: { ...draft, elements: [{ id: 'local', type: 'text', text: 'local' }] },
    },
    _meta: meta,
  })
  assert.equal(copied.isError, undefined)
  assert.equal(copied.structuredContent.canvas.canvasPath, copyPath)
  assert.equal(
    JSON.parse(await readFile(join(workspace, copyPath), 'utf8')).elements[0].id,
    'local',
  )
  assert.equal(
    JSON.parse(await readFile(join(workspace, canvasPath), 'utf8')).elements[0].id,
    'saved',
  )
})
