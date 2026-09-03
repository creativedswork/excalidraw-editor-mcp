import assert from 'node:assert/strict'
import test from 'node:test'

const operationsUrl = new URL('../src/canvas-operations.ts', import.meta.url)

function document() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'test',
    elements: [
      {
        id: 'box',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 200,
        height: 80,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: '#a5d8ff',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        roundness: { type: 3 },
        groupIds: ['group-a'],
        frameId: 'frame-a',
        boundElements: [
          { id: 'label', type: 'text' },
          { id: 'arrow', type: 'arrow' },
        ],
      },
      {
        id: 'label',
        type: 'text',
        text: 'Deploy API',
        originalText: 'Deploy API',
        containerId: 'box',
        x: 30,
        y: 40,
        width: 160,
        height: 24,
      },
      {
        id: 'arrow',
        type: 'arrow',
        x: 210,
        y: 60,
        width: 120,
        height: 0,
        startBinding: { elementId: 'box', focus: 0, gap: 1 },
        endBinding: { elementId: 'frame-a', focus: 0, gap: 1 },
        points: [[0, 0], [120, 0]],
      },
      {
        id: 'note',
        type: 'text',
        text: 'x'.repeat(600),
        x: 20,
        y: 140,
        width: 200,
        height: 40,
      },
      { id: 'deleted', type: 'ellipse', isDeleted: true },
    ],
    appState: {},
    files: {},
  }
}

test('semantic inspection folds labels and exposes bounded structure', async () => {
  const { inspectCanvas } = await import(operationsUrl.href)
  const page = inspectCanvas(document(), { limit: 1 })

  assert.equal(page.totalMatched, 3)
  assert.equal(page.truncated, true)
  assert.equal(typeof page.nextCursor, 'string')
  assert.deepEqual(page.elements[0], {
    id: 'box',
    type: 'rectangle',
    label: { id: 'label', text: 'Deploy API', truncated: false },
    bounds: { x: 10, y: 20, width: 200, height: 80, angle: 0 },
    style: {
      strokeColor: '#1e1e1e',
      backgroundColor: '#a5d8ff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      roundness: { type: 3 },
    },
    groupIds: ['group-a'],
    frameId: 'frame-a',
    bindings: {
      boundElementIds: ['label', 'arrow'],
    },
  })

  const next = inspectCanvas(document(), { cursor: page.nextCursor, limit: 1 })
  assert.equal(next.elements[0].id, 'arrow')
  assert.deepEqual(next.elements[0].bindings, {
    start: { elementId: 'box', focus: 0, gap: 1 },
    end: { elementId: 'frame-a', focus: 0, gap: 1 },
  })
})

test('semantic inspection filters by underlying ID, type, and text', async () => {
  const { inspectCanvas } = await import(operationsUrl.href)

  assert.deepEqual(
    inspectCanvas(document(), { ids: ['label'] }).elements.map(element => element.id),
    ['box'],
  )
  assert.deepEqual(
    inspectCanvas(document(), { types: ['text'] }).elements.map(element => element.id),
    ['note'],
  )
  assert.deepEqual(
    inspectCanvas(document(), { text: 'deploy' }).elements.map(element => element.id),
    ['box'],
  )
})

test('semantic inspection marks truncated text and rejects invalid cursors', async () => {
  const { inspectCanvas } = await import(operationsUrl.href)
  const note = inspectCanvas(document(), { ids: ['note'] }).elements[0]

  assert.equal(note.text.length, 500)
  assert.equal(note.textTruncated, true)
  assert.throws(
    () => inspectCanvas(document(), { cursor: 'not-a-cursor' }),
    /invalid inspect cursor/,
  )
})
