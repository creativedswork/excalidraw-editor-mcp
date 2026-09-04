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
    created,
    canvasPath: created.structuredContent.canvasPath,
    revision: created.structuredContent.revision,
  }
}

function modelVisibleJson(response) {
  const text = response.content.find(content => content.type === 'text')?.text
  assert.equal(typeof text, 'string')
  return JSON.parse(text.slice(text.indexOf('\n') + 1))
}

test('model-visible tool results expose canonical paths and revisions', async (t) => {
  const state = await fixture(t)
  const created = modelVisibleJson(state.created)
  assert.equal(created.project.projectPath, 'designs/m3')
  assert.equal(created.canvasPath, 'designs/m3/main.excalidraw')
  assert.equal(created.revision, state.revision)

  const inspectedResponse = await state.client.callTool({
    name: 'inspect_canvas',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: created.canvasPath,
      limit: 1,
    },
    _meta: state.meta,
  })
  const inspected = modelVisibleJson(inspectedResponse)
  assert.equal(inspected.canvasPath, created.canvasPath)
  assert.equal(inspected.revision, state.revision)

  const appliedResponse = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: created.canvasPath,
      baseRevision: inspected.revision,
      mutationId: 'model-visible-result',
      changes: [{
        op: 'set_canvas',
        patch: { viewBackgroundColor: '#ffffff' },
      }],
    },
    _meta: state.meta,
  })
  const applied = modelVisibleJson(appliedResponse)
  assert.equal(applied.canvasPath, created.canvasPath)
  assert.match(applied.revision, /^[a-f0-9]{64}$/)

  const tools = await state.client.listTools()
  const inspectTool = tools.tools.find(tool => tool.name === 'inspect_canvas')
  assert.match(
    inspectTool.inputSchema.properties.canvasPath.description,
    /full workspace-relative canvas path.*under projectPath.*designs\/m3\/main\.excalidraw/i,
  )
})

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

test('relationship operations preserve ordering and repair removed references', async (t) => {
  const state = await fixture(t)
  const seeded = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: state.revision,
      mutationId: 'relations-seed',
      changes: [
        {
          op: 'add',
          clientRef: 'frame',
          element: {
            type: 'frame',
            x: 0,
            y: 0,
            width: 600,
            height: 300,
            children: [],
            name: 'Flow',
          },
        },
        {
          op: 'add',
          clientRef: 'a',
          element: { type: 'rectangle', x: 40, y: 60, width: 140, height: 80 },
        },
        {
          op: 'add',
          clientRef: 'b',
          element: { type: 'ellipse', x: 360, y: 60, width: 140, height: 80 },
        },
        {
          op: 'add',
          clientRef: 'arrow',
          element: { type: 'arrow', x: 180, y: 100, points: [[0, 0], [180, 0]] },
        },
        {
          op: 'add',
          clientRef: 'label',
          element: { type: 'text', x: 70, y: 90, text: 'A' },
        },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(seeded.isError, undefined, seeded.content[0]?.text)
  const ids = seeded.structuredContent.clientRefMap

  const related = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: seeded.structuredContent.revision,
      mutationId: 'relations-bind',
      changes: [
        {
          op: 'group',
          targets: [{ elementId: ids.a }, { elementId: ids.b }],
        },
        {
          op: 'bind',
          source: { elementId: ids.arrow },
          target: { elementId: ids.a },
          binding: 'start',
        },
        {
          op: 'bind',
          source: { elementId: ids.arrow },
          target: { elementId: ids.b },
          binding: 'end',
        },
        {
          op: 'bind',
          source: { elementId: ids.label },
          target: { elementId: ids.a },
          binding: 'label',
        },
        {
          op: 'add_to_frame',
          targets: [
            { elementId: ids.a },
            { elementId: ids.b },
            { elementId: ids.arrow },
            { elementId: ids.label },
          ],
          frame: { elementId: ids.frame },
        },
        {
          op: 'reorder',
          target: { elementId: ids.b },
          position: 'front',
        },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(related.isError, undefined, related.content[0]?.text)

  const inspect = async revision => {
    const response = await state.client.callTool({
      name: 'inspect_canvas',
      arguments: {
        projectPath: 'designs/m3',
        canvasPath: state.canvasPath,
        includeDocument: true,
        limit: 100,
      },
      _meta: state.meta,
    })
    assert.equal(response.isError, undefined, response.content[0]?.text)
    assert.equal(response.structuredContent.revision, revision)
    return response.structuredContent.document.elements
  }
  let elements = await inspect(related.structuredContent.revision)
  const element = id => elements.find(candidate => candidate.id === id)
  assert.equal(element(ids.b).id, elements.filter(item => !item.isDeleted).at(-1).id)
  assert.equal(element(ids.a).groupIds[0], element(ids.b).groupIds[0])
  assert.equal(element(ids.arrow).startBinding.elementId, ids.a)
  assert.equal(element(ids.arrow).endBinding.elementId, ids.b)
  assert.ok(element(ids.a).boundElements.some(item => item.id === ids.arrow))
  assert.ok(element(ids.a).boundElements.some(item => item.id === ids.label))
  assert.equal(element(ids.label).containerId, ids.a)
  assert.equal(element(ids.arrow).frameId, ids.frame)

  const detached = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: related.structuredContent.revision,
      mutationId: 'relations-detach',
      changes: [
        {
          op: 'ungroup',
          targets: [{ elementId: ids.a }, { elementId: ids.b }],
        },
        {
          op: 'unbind',
          source: { elementId: ids.arrow },
          binding: 'start',
        },
        {
          op: 'unbind',
          source: { elementId: ids.arrow },
          binding: 'end',
        },
        {
          op: 'unbind',
          source: { elementId: ids.label },
          binding: 'label',
        },
        {
          op: 'remove_from_frame',
          targets: [{ elementId: ids.a }, { elementId: ids.b }],
        },
        {
          op: 'reorder',
          target: { elementId: ids.b },
          position: 'before',
          relativeTo: { elementId: ids.arrow },
        },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(detached.isError, undefined, detached.content[0]?.text)
  elements = await inspect(detached.structuredContent.revision)
  assert.deepEqual(element(ids.a).groupIds, [])
  assert.deepEqual(element(ids.b).groupIds, [])
  assert.equal(element(ids.arrow).startBinding, null)
  assert.equal(element(ids.arrow).endBinding, null)
  assert.equal(element(ids.label).containerId, null)
  assert.equal(element(ids.a).frameId, null)
  assert.ok(elements.indexOf(element(ids.b)) < elements.indexOf(element(ids.arrow)))

  const removed = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: detached.structuredContent.revision,
      mutationId: 'relations-remove',
      changes: [
        {
          op: 'bind',
          source: { elementId: ids.arrow },
          target: { elementId: ids.a },
          binding: 'start',
        },
        {
          op: 'bind',
          source: { elementId: ids.label },
          target: { elementId: ids.a },
          binding: 'label',
        },
        {
          op: 'add_to_frame',
          targets: [{ elementId: ids.arrow }],
          frame: { elementId: ids.frame },
        },
        { op: 'remove', target: { elementId: ids.a } },
        { op: 'remove', target: { elementId: ids.frame } },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(removed.isError, undefined, removed.content[0]?.text)
  elements = await inspect(removed.structuredContent.revision)
  assert.equal(element(ids.a), undefined)
  assert.equal(element(ids.label), undefined)
  assert.equal(element(ids.arrow).startBinding, null)
  assert.equal(element(ids.arrow).frameId, null)
  assert.ok(element(ids.b).boundElements === null
    || element(ids.b).boundElements.every(item => !element(item.id)?.isDeleted))

  const active = elements.filter(item => !item.isDeleted)
  assert.equal(new Set(active.map(item => item.index)).size, active.length)
  assert.ok(active.every((item, index) => (
    index === 0 || active[index - 1].index < item.index
  )))
})

test('replace_canvas validates and preserves a restorable full document', async (t) => {
  const state = await fixture(t)
  const seeded = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: state.revision,
      mutationId: 'replace-seed',
      changes: [
        {
          op: 'add',
          clientRef: 'source',
          element: {
            type: 'rectangle',
            x: 20,
            y: 20,
            width: 160,
            height: 80,
            label: { text: 'Source' },
          },
        },
        {
          op: 'add',
          clientRef: 'target',
          element: { type: 'ellipse', x: 300, y: 20, width: 160, height: 80 },
        },
        {
          op: 'add',
          clientRef: 'edge',
          element: {
            type: 'arrow',
            x: 180,
            y: 60,
            points: [[0, 0], [120, 0]],
            startRef: 'source',
            endRef: 'target',
          },
        },
      ],
    },
    _meta: state.meta,
  })
  assert.equal(seeded.isError, undefined, seeded.content[0]?.text)
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
  const replacement = structuredClone(inspected.structuredContent.document)
  replacement.elements.find(element => element.type === 'rectangle').customData = {
    importedField: { mode: 'preserve' },
  }
  replacement.appState.viewBackgroundColor = '#fff4e6'

  const request = {
    projectPath: 'designs/m3',
    canvasPath: state.canvasPath,
    baseRevision: seeded.structuredContent.revision,
    mutationId: 'replace-valid',
    document: replacement,
  }
  const replaced = await state.client.callTool({
    name: 'replace_canvas',
    arguments: request,
    _meta: state.meta,
  })
  assert.equal(replaced.isError, undefined, replaced.content[0]?.text)
  assert.notEqual(replaced.structuredContent.revision, seeded.structuredContent.revision)

  const exactRetry = await state.client.callTool({
    name: 'replace_canvas',
    arguments: request,
    _meta: state.meta,
  })
  assert.equal(exactRetry.isError, undefined, exactRetry.content[0]?.text)
  assert.equal(exactRetry.structuredContent.revision, replaced.structuredContent.revision)

  const mismatch = await state.client.callTool({
    name: 'replace_canvas',
    arguments: {
      ...request,
      document: {
        ...replacement,
        appState: { ...replacement.appState, viewBackgroundColor: '#ffffff' },
      },
    },
    _meta: state.meta,
  })
  assert.equal(mismatch.isError, true)
  assert.match(mismatch.content[0].text, /mutationId was already used with different input/)

  const persisted = JSON.parse(await readFile(join(state.workspace, state.canvasPath), 'utf8'))
  assert.deepEqual(
    persisted.elements.find(element => element.type === 'rectangle').customData,
    { importedField: { mode: 'preserve' } },
  )
  assert.equal(persisted.appState.viewBackgroundColor, '#fff4e6')
  const beforeInvalid = await readFile(join(state.workspace, state.canvasPath), 'utf8')

  const invalidDocument = structuredClone(persisted)
  invalidDocument.elements.find(element => element.type === 'arrow').startBinding.elementId = 'missing'
  const invalid = await state.client.callTool({
    name: 'replace_canvas',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: replaced.structuredContent.revision,
      mutationId: 'replace-invalid',
      document: invalidDocument,
    },
    _meta: state.meta,
  })
  assert.equal(invalid.isError, true)
  assert.match(invalid.content[0].text, /missing element/)
  assert.equal(await readFile(join(state.workspace, state.canvasPath), 'utf8'), beforeInvalid)

  const oversized = await state.client.callTool({
    name: 'replace_canvas',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: replaced.structuredContent.revision,
      mutationId: 'replace-oversized',
      document: {
        ...persisted,
        appState: { ...persisted.appState, oversized: 'x'.repeat(4 * 1024 * 1024) },
      },
    },
    _meta: state.meta,
  })
  assert.equal(oversized.isError, true)
  assert.match(oversized.content[0].text, /canvas exceeds/)
  assert.equal(await readFile(join(state.workspace, state.canvasPath), 'utf8'), beforeInvalid)

  const stale = await state.client.callTool({
    name: 'replace_canvas',
    arguments: {
      projectPath: 'designs/m3',
      canvasPath: state.canvasPath,
      baseRevision: seeded.structuredContent.revision,
      mutationId: 'replace-stale',
      document: persisted,
    },
    _meta: state.meta,
  })
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /revision conflict/)

  const prompts = await state.client.listPrompts()
  assert.ok(prompts.prompts.some(prompt => prompt.name === 'excalidraw-authoring'))
  const prompt = await state.client.getPrompt({ name: 'excalidraw-authoring' })
  assert.match(prompt.messages[0].content.text, /inspect_canvas/)
  assert.match(prompt.messages[0].content.text, /apply_canvas_changes/)
  assert.match(prompt.messages[0].content.text, /revision conflict/)
})
