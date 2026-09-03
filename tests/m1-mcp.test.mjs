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

test('stdio tools manage a standard canvas without loading the View', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m1-mcp-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const client = new Client({
    name: 'excalidraw-editor-m1-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => client.close())

  const meta = {
    [workspaceKey]: { cwd: workspace },
    [sessionKey]: { sessionId: 'm1-test', connectionGeneration: 'test' },
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
  assert.equal(created.isError, undefined)
  const project = created.structuredContent.project
  assert.equal(project.defaultCanvasPath, 'designs/demo/main.excalidraw')

  const added = await client.callTool({
    name: 'create_canvas',
    arguments: {
      projectPath: project.projectPath,
      canvasPath: 'designs/demo/flow.excalidraw',
      baseProjectRevision: project.projectRevision,
      mutationId: 'create-flow',
    },
    _meta: meta,
  })
  assert.equal(added.isError, undefined)

  const inspected = await client.callTool({
    name: 'inspect_canvas',
    arguments: {
      projectPath: project.projectPath,
      canvasPath: 'designs/demo/flow.excalidraw',
      includeDocument: true,
    },
    _meta: meta,
  })
  assert.equal(inspected.isError, undefined)
  assert.equal(inspected.structuredContent.document.type, 'excalidraw')
  assert.equal(inspected.structuredContent.elementCount, 0)

  const pulled = await client.callTool({
    name: 'pull_canvas',
    arguments: {
      canvasPath: 'designs/demo/flow.excalidraw',
    },
    _meta: {
      [sessionKey]: { sessionId: 'm1-test', connectionGeneration: 'test' },
    },
  })
  assert.equal(pulled.isError, undefined)
  assert.equal(pulled.structuredContent.changed, true)
  assert.equal(pulled.structuredContent.document.type, 'excalidraw')

  const stored = JSON.parse(await readFile(
    join(workspace, 'designs/demo/flow.excalidraw'),
    'utf8',
  ))
  assert.deepEqual(Object.keys(stored), [
    'appState',
    'elements',
    'files',
    'source',
    'type',
    'version',
  ])
})

test('model tools require trusted Workspace metadata', async (t) => {
  const client = new Client({
    name: 'excalidraw-editor-m1-no-workspace-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => client.close())
  const listed = await client.callTool({
    name: 'list_projects',
    arguments: {},
  })
  assert.equal(listed.isError, true)
  assert.match(listed.content[0].text, /workspace is unavailable/)
})
