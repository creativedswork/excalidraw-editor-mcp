import assert from 'node:assert/strict'
import fs from 'node:fs'
import { link, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const storeUrl = new URL('../dist/canvas-store.js', import.meta.url)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'excalidraw-m1-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { CanvasStore, SafeWorkspace } = await import(storeUrl.href)
  return { root, store: new CanvasStore(await SafeWorkspace.open(root)) }
}

function documentWith(label) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'test',
    elements: [{ id: label, type: 'text', text: label }],
    appState: {},
    files: {},
  }
}

test('canvas store confines paths and rejects symlink traversal', async (t) => {
  const { root, store } = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'excalidraw-m1-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(root, 'escape'), 'dir')

  for (const path of [
    '../outside.excalidraw',
    '/tmp/outside.excalidraw',
    'C:/outside.excalidraw',
    'wrong.json',
    'escape/canvas.excalidraw',
  ]) {
    await assert.rejects(
      store.create(path, `invalid-${path}`, documentWith('invalid')),
      /invalid|must end|symlink|not a real directory/,
    )
  }
})

test('canvas store writes canonical documents and enforces CAS', async (t) => {
  const { root, store } = await fixture(t)
  const created = await store.create(
    'designs/demo/main.excalidraw',
    'create-main',
    documentWith('initial'),
  )
  assert.match(created.revision, /^[a-f0-9]{64}$/)
  const bytes = await readFile(join(root, 'designs/demo/main.excalidraw'), 'utf8')
  assert.equal(bytes.endsWith('\n'), true)

  const [first, second] = await Promise.allSettled([
    store.write(
      created.canvasPath,
      created.revision,
      'write-first',
      documentWith('first'),
    ),
    store.write(
      created.canvasPath,
      created.revision,
      'write-second',
      documentWith('second'),
    ),
  ])
  assert.equal([first, second].filter(result => result.status === 'fulfilled').length, 1)
  assert.equal([first, second].filter(result => result.status === 'rejected').length, 1)
  assert.match(
    String([first, second].find(result => result.status === 'rejected').reason),
    /revision conflict/,
  )
})

test('canvas create normalizes a retained publication link without accepting later hardlinks', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'excalidraw-m1-retained-link-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'designs/demo/main.excalidraw')
  const retained = join(root, 'retained-publication')
  const originalRm = fs.promises.rm
  let retainedPublication = false
  let store

  fs.promises.rm = async (path, options) => {
    if (!retainedPublication && String(path).startsWith(`${target}.`)) {
      await link(path, retained)
      retainedPublication = true
    }
    return originalRm(path, options)
  }
  syncBuiltinESMExports()
  try {
    const { CanvasStore, SafeWorkspace } = await import(
      `${storeUrl.href}?retained-link=${String(Date.now())}`
    )
    store = new CanvasStore(await SafeWorkspace.open(root))
    await store.create(
      'designs/demo/main.excalidraw',
      'create-with-retained-link',
      documentWith('initial'),
    )
  } finally {
    fs.promises.rm = originalRm
    syncBuiltinESMExports()
  }

  assert.equal(retainedPublication, true)
  assert.equal((await lstat(target)).nlink, 1)
  await link(target, join(root, 'user-hardlink.excalidraw'))
  await assert.rejects(store.read('designs/demo/main.excalidraw'), /regular unlinked file/)
})

test('mutation retries are idempotent and conflicting reuse is rejected', async (t) => {
  const { store } = await fixture(t)
  const first = await store.create(
    'designs/demo/main.excalidraw',
    'same-create',
    documentWith('same'),
  )
  const retry = await store.create(
    'designs/demo/main.excalidraw',
    'same-create',
    documentWith('same'),
  )
  assert.deepEqual(retry, first)
  await assert.rejects(
    store.create(
      'designs/demo/other.excalidraw',
      'same-create',
      documentWith('different'),
    ),
    /mutationId was already used with different input/,
  )
})

test('failed validation leaves the previous canvas intact', async (t) => {
  const { root, store } = await fixture(t)
  const created = await store.create(
    'designs/demo/main.excalidraw',
    'create-before-failure',
    documentWith('stable'),
  )
  const before = await readFile(join(root, created.canvasPath))
  await assert.rejects(
    store.write(
      created.canvasPath,
      created.revision,
      'invalid-write',
      { ...documentWith('invalid'), type: 'other' },
    ),
  )
  assert.deepEqual(await readFile(join(root, created.canvasPath)), before)

  await mkdir(join(root, 'designs/demo/orphan.tmp'))
  assert.equal((await store.read(created.canvasPath)).revision, created.revision)
})
