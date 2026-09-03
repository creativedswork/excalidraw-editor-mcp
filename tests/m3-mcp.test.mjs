import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = process.env.M3_SERVER_PATH
  ?? fileURLToPath(new URL('../dist/server.js', import.meta.url))
const workspaceKey = 'ai.deepseek.dsh/workspace'
const sessionKey = 'ai.deepseek.dsh/session'

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m3-mcp-'))
  const client = new Client({ name: 'excalidraw-editor-m3-test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => Promise.all([
    client.close(),
    rm(workspace, { recursive: true, force: true }),
  ]))
  const meta = {
    [workspaceKey]: { cwd: workspace },
    [sessionKey]: { sessionId: `m3-${String(Date.now())}`, connectionGeneration: 'test' },
  }
  const created = await client.callTool({
    name: 'create_project',
    arguments: {
      projectPath: 'designs/m3',
      name: 'M3',
      mutationId: 'create-m3',
    },
    _meta: meta,
  })
  return {
    client,
    workspace,
    meta,
    canvasPath: created.structuredContent.canvasPath,
    revision: created.structuredContent.revision,
  }
}

test('apply_canvas_changes is atomic, idempotent, and uses official element invariants', async (t) => {
  const state = await fixture(t)
  const seeded = await state.client.callTool({
    name: 'push_canvas',
    arguments: {
      canvasPath: state.canvasPath,
      baseRevision: state.revision,
      mutationId: 'seed-asset',
      document: {
        type: 'excalidraw',
        version: 2,
        source: 'test',
        elements: [],
        appState: {},
        files: {
          asset: {
            id: 'asset',
            mimeType: 'image/png',
            dataURL: 'data:image/png;base64,iVBORw0KGgo=',
            created: 1,
            lastRetrieved: 1,
          },
        },
      },
    },
    _meta: state.meta,
  })
  const baseRevision = seeded.structuredContent.canvas.revision
  const request = {
    projectPath: 'designs/m3',
    canvasPath: state.canvasPath,
    baseRevision,
    mutationId: 'batch-one',
    changes: [
      {
        op: 'add',
        clientRef: 'box',
        element: {
          type: 'rectangle',
          x: 20,
          y: 20,
          width: 180,
          height: 80,
          label: { text: 'API' },
        },
      },
      {
        op: 'add',
        clientRef: 'ellipse',
        element: { type: 'ellipse', x: 300, y: 20, width: 160, height: 80 },
      },
      {
        op: 'add',
        clientRef: 'diamond',
        element: { type: 'diamond', x: 520, y: 20, width: 120, height: 80 },
      },
      {
        op: 'add',
        clientRef: 'note',
        element: { type: 'text', x: 20, y: 150, text: 'before' },
      },
      {
        op: 'add',
        clientRef: 'line',
        element: { type: 'line', x: 20, y: 230, points: [[0, 0], [120, 20]] },
      },
      {
        op: 'add',
        clientRef: 'arrow',
        element: {
          type: 'arrow',
          x: 200,
          y: 60,
          points: [[0, 0], [100, 0]],
          startRef: 'box',
          endRef: 'ellipse',
          label: { text: 'calls' },
        },
      },
      {
        op: 'add',
        clientRef: 'draw',
        element: {
          type: 'freedraw',
          x: 20,
          y: 300,
          points: [[0, 0], [10, 10], [30, 5]],
          pressures: [],
          simulatePressure: true,
        },
      },
      {
        op: 'add',
        clientRef: 'frame',
        element: {
          type: 'frame',
          x: 0,
          y: 0,
          width: 700,
          height: 400,
          children: [],
          name: 'Overview',
        },
      },
      {
        op: 'add',
        clientRef: 'image',
        element: {
          type: 'image',
          x: 680,
          y: 20,
          width: 80,
          height: 80,
          fileId: 'asset',
        },
      },
      {
        op: 'add',
        clientRef: 'temporary',
        element: { type: 'text', x: 20, y: 380, text: 'remove me' },
      },
      {
        op: 'update',
        target: { clientRef: 'note' },
        patch: { text: 'after', x: 40, backgroundColor: '#ffc9c9' },
      },
      { op: 'remove', target: { clientRef: 'temporary' } },
      {
        op: 'set_canvas',
        patch: {
          viewBackgroundColor: '#f8f9fa',
          gridSize: 20,
          gridStep: 5,
          gridModeEnabled: true,
        },
      },
    ],
  }

  const applied = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: request,
    _meta: state.meta,
  })
  assert.equal(applied.isError, undefined, applied.content[0]?.text)
  assert.notEqual(applied.structuredContent.revision, baseRevision)
  assert.equal(Object.keys(applied.structuredContent.clientRefMap).length, 10)
  assert.equal(applied.structuredContent.changed, true)

  const exactRetry = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: request,
    _meta: state.meta,
  })
  assert.equal(exactRetry.isError, undefined)
  assert.equal(exactRetry.structuredContent.revision, applied.structuredContent.revision)
  assert.deepEqual(
    exactRetry.structuredContent.clientRefMap,
    applied.structuredContent.clientRefMap,
  )

  const mismatch = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      ...request,
      changes: [...request.changes, {
        op: 'set_canvas',
        patch: { viewBackgroundColor: '#ffffff' },
      }],
    },
    _meta: state.meta,
  })
  assert.equal(mismatch.isError, true)
  assert.match(mismatch.content[0].text, /mutationId was already used with different input/)

  const inspected = await state.client.callTool({
    name: 'inspect_canvas',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      includeDocument: true,
      limit: 100,
    },
    _meta: state.meta,
  })
  const document = inspected.structuredContent.document
  const active = document.elements.filter(element => !element.isDeleted)
  assert.deepEqual(
    new Set(active.map(element => element.type)),
    new Set(['rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow', 'freedraw', 'frame', 'image']),
  )
  assert.equal(active.find(element => element.id
    === applied.structuredContent.clientRefMap.note).text, 'after')
  assert.equal(document.appState.gridModeEnabled, true)
  assert.ok(active.every(element => element.version >= 1))
  assert.ok(active.every(element => typeof element.versionNonce === 'number'))
  assert.ok(active.every(element => typeof element.index === 'string'))

  const arrow = active.find(element => element.id
    === applied.structuredContent.clientRefMap.arrow)
  assert.equal(
    arrow.startBinding.elementId,
    applied.structuredContent.clientRefMap.box,
  )
  assert.equal(
    arrow.endBinding.elementId,
    applied.structuredContent.clientRefMap.ellipse,
  )

  const beforeInvalid = await readFile(join(state.workspace, state.canvasPath), 'utf8')
  const invalid = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: applied.structuredContent.revision,
      mutationId: 'invalid-batch',
      changes: [
        {
          op: 'add',
          clientRef: 'would-write',
          element: { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
        },
        {
          op: 'update',
          target: { elementId: 'missing' },
          patch: { x: 1 },
        },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(invalid.isError, true)
  assert.equal(await readFile(join(state.workspace, state.canvasPath), 'utf8'), beforeInvalid)

  const stale = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision,
      mutationId: 'stale-batch',
      changes: [{ op: 'set_canvas', patch: { viewBackgroundColor: '#ffffff' } }],
    },
    _meta: state.meta,
  })
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /revision conflict/)
})
