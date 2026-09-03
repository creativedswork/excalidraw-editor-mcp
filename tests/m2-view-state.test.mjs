import assert from 'node:assert/strict'
import test from 'node:test'

const stateUrl = new URL('../src/view-state.ts', import.meta.url)

function document(overrides = {}) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'test',
    elements: [{ id: 'box', type: 'rectangle', x: 10, y: 20 }],
    appState: {
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      viewBackgroundColor: '#ffffff',
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    },
    files: {},
    ...overrides,
  }
}

test('content summary ignores selection and viewport changes', async () => {
  const { canvasContentSummary } = await import(stateUrl.href)
  const initial = document()
  const transient = document({
    appState: {
      ...initial.appState,
      selectedElementIds: { box: true },
      scrollX: 240,
      scrollY: -80,
      zoom: { value: 1.5 },
    },
  })

  assert.equal(canvasContentSummary(transient), canvasContentSummary(initial))
})

test('content summary treats omitted appState as official defaults', async () => {
  const { canvasContentSummary } = await import(stateUrl.href)
  const initial = document({ appState: {} })
  const restored = document({
    appState: {
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      viewBackgroundColor: '#ffffff',
    },
  })

  assert.equal(canvasContentSummary(initial), canvasContentSummary(restored))
})

test('content summary detects persistent canvas changes', async () => {
  const { canvasContentSummary } = await import(stateUrl.href)
  const initial = document()

  assert.notEqual(
    canvasContentSummary(document({
      elements: [...initial.elements, { id: 'label', type: 'text', text: 'M2' }],
    })),
    canvasContentSummary(initial),
  )
  assert.notEqual(
    canvasContentSummary(document({ files: { image: { id: 'image' } } })),
    canvasContentSummary(initial),
  )
  assert.notEqual(
    canvasContentSummary(document({
      appState: { ...initial.appState, viewBackgroundColor: '#f8f9fa' },
    })),
    canvasContentSummary(initial),
  )
})

test('editor state changes only when persistent content differs', async () => {
  const { canvasContentSummary, editorStateAfterChange } = await import(stateUrl.href)
  const baseline = canvasContentSummary(document())

  assert.equal(editorStateAfterChange('Clean', baseline, baseline), 'Clean')
  assert.equal(
    editorStateAfterChange(
      'Clean',
      baseline,
      canvasContentSummary(document({ elements: [] })),
    ),
    'Dirty',
  )
  assert.equal(editorStateAfterChange('Conflict', baseline, baseline), 'Conflict')
})

test('explicit actions have lossless save and recovery transitions', async () => {
  const { editorStateAfterAction } = await import(stateUrl.href)

  assert.equal(editorStateAfterAction('Dirty', 'save'), 'Saving')
  assert.equal(editorStateAfterAction('Saving', 'saved'), 'Clean')
  assert.equal(editorStateAfterAction('Saving', 'conflict'), 'Conflict')
  assert.equal(editorStateAfterAction('Conflict', 'reload'), 'Loading')
  assert.equal(editorStateAfterAction('Loading', 'reloaded'), 'Clean')
  assert.equal(editorStateAfterAction('Conflict', 'save-copy'), 'Saving')
  assert.equal(editorStateAfterAction('Saving', 'copy-saved'), 'Clean')
})

test('external updates apply only to clean drafts', async () => {
  const { externalUpdateAction } = await import(stateUrl.href)

  assert.equal(externalUpdateAction('Clean'), 'apply')
  assert.equal(externalUpdateAction('Dirty'), 'conflict')
  assert.equal(externalUpdateAction('Conflict'), 'conflict')
  assert.equal(externalUpdateAction('Saving'), 'skip')
})

test('external scene state preserves viewport and surviving selection', async () => {
  const { appStateForExternalUpdate } = await import(stateUrl.href)
  const next = appStateForExternalUpdate(
    { viewBackgroundColor: '#eeeeee', scrollX: 0, scrollY: 0, zoom: { value: 1 } },
    {
      selectedElementIds: { kept: true, removed: true },
      scrollX: 120,
      scrollY: -40,
      zoom: { value: 1.75 },
    },
    [{ id: 'kept' }, { id: 'deleted', isDeleted: true }],
  )

  assert.deepEqual(next.selectedElementIds, { kept: true })
  assert.equal(next.scrollX, 120)
  assert.equal(next.scrollY, -40)
  assert.deepEqual(next.zoom, { value: 1.75 })
  assert.equal(next.viewBackgroundColor, '#eeeeee')
})

test('initialData hydration establishes a clean canonical baseline', async () => {
  const { reconcileCanvasChange } = await import(stateUrl.href)
  const hydrated = reconcileCanvasChange(
    'Loading',
    'initial-input-summary',
    'excalidraw-canonical-summary',
  )

  assert.deepEqual(hydrated, {
    state: 'Loading',
    baseSummary: 'excalidraw-canonical-summary',
  })
  assert.deepEqual(
    reconcileCanvasChange(
      'Clean',
      hydrated.baseSummary,
      'human-edit-summary',
    ),
    {
      state: 'Dirty',
      baseSummary: 'excalidraw-canonical-summary',
    },
  )
})

test('external scene apply accepts every callback behind the Loading barrier', async () => {
  const { reconcileCanvasChange } = await import(stateUrl.href)
  const first = reconcileCanvasChange(
    'Loading',
    'remote-input-summary',
    'excalidraw-canonical-summary-1',
  )
  const second = reconcileCanvasChange(
    first.state,
    first.baseSummary,
    'excalidraw-canonical-summary-2',
  )

  assert.deepEqual(second, {
    state: 'Loading',
    baseSummary: 'excalidraw-canonical-summary-2',
  })
  assert.deepEqual(
    reconcileCanvasChange('Clean', second.baseSummary, second.baseSummary),
    {
      state: 'Clean',
      baseSummary: 'excalidraw-canonical-summary-2',
    },
  )
})

test('conflict copy path stays beside the bound canvas', async () => {
  const { conflictCopyPath } = await import(stateUrl.href)

  assert.equal(
    conflictCopyPath('designs/demo/main.excalidraw', 1234),
    'designs/demo/main-copy-1234.excalidraw',
  )
})

test('saved model context is bounded and excludes scene contents', async () => {
  const { savedCanvasModelContext } = await import(stateUrl.href)
  const selection = Array.from({ length: 30 }, (_, index) => `element-${String(index)}`)
  const context = savedCanvasModelContext(
    'designs/demo/main.excalidraw',
    'a'.repeat(64),
    selection,
  )

  assert.equal(context.structuredContent.canvasPath, 'designs/demo/main.excalidraw')
  assert.equal(context.structuredContent.projectPath, 'designs/demo')
  assert.equal(context.structuredContent.revision, 'a'.repeat(64))
  assert.equal(context.structuredContent.state, 'saved')
  assert.equal(context.structuredContent.selection.length, 20)
  assert.equal(context.content[0].text.includes('"elements"'), false)
  assert.ok(context.content[0].text.length < 2_000)
})
