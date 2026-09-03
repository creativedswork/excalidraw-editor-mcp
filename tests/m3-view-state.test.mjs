import assert from 'node:assert/strict'
import test from 'node:test'

const stateUrl = new URL('../src/view-state.ts', import.meta.url)

test('Ask AI is blocked unless the canvas is saved', async () => {
  const { askAiMessage } = await import(stateUrl.href)

  assert.equal(
    askAiMessage(
      'Dirty',
      'designs/demo/main.excalidraw',
      'a'.repeat(64),
      ['box'],
      'Add a node',
    ),
    undefined,
  )
  assert.equal(
    askAiMessage(
      'Conflict',
      'designs/demo/main.excalidraw',
      'a'.repeat(64),
      ['box'],
      'Add a node',
    ),
    undefined,
  )
  assert.equal(
    askAiMessage(
      'Clean',
      'designs/demo/main.excalidraw',
      'a'.repeat(64),
      ['box'],
      '   ',
    ),
    undefined,
  )
})

test('saved Ask AI creates one bounded normal Session message', async () => {
  const { askAiMessage } = await import(stateUrl.href)
  const message = askAiMessage(
    'Clean',
    'designs/demo/main.excalidraw',
    'b'.repeat(64),
    Array.from({ length: 25 }, (_, index) => `element-${String(index)}`),
    '  Add a deployment node  ',
  )

  assert.equal(message.role, 'user')
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.match(message.content[0].text, /designs\/demo\/main\.excalidraw/)
  assert.match(message.content[0].text, new RegExp('b{64}'))
  assert.match(message.content[0].text, /element-0/)
  assert.doesNotMatch(message.content[0].text, /element-24/)
  assert.match(message.content[0].text, /Add a deployment node/)
  assert.ok(message.content[0].text.length < 2_000)
})
