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
