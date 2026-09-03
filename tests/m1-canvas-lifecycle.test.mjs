import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const storeUrl = new URL('../dist/project-store.js', import.meta.url)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'excalidraw-m1-canvas-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { ProjectStore, SafeWorkspace } = await import(storeUrl.href)
  const store = new ProjectStore(await SafeWorkspace.open(root))
  const project = await store.create({
    projectPath: 'designs/demo',
    name: 'Demo',
    mutationId: 'create-demo',
  })
  return { store, project }
}

test('canvas lifecycle stays inside its project and updates the default', async (t) => {
  const { store, project } = await fixture(t)
  await assert.rejects(store.createCanvas({
    projectPath: project.projectPath,
    canvasPath: 'designs/other/outside.excalidraw',
    baseProjectRevision: project.projectRevision,
    mutationId: 'create-outside',
  }), /inside projectPath/)

  const second = await store.createCanvas({
    projectPath: project.projectPath,
    canvasPath: 'designs/demo/second.excalidraw',
    baseProjectRevision: project.projectRevision,
    mutationId: 'create-second',
  })
  assert.equal(second.canvas.canvasPath, 'designs/demo/second.excalidraw')

  const main = await store.openCanvas(
    project.projectPath,
    project.defaultCanvasPath,
  )
  const renamed = await store.renameCanvas({
    projectPath: project.projectPath,
    canvasPath: main.canvasPath,
    newCanvasPath: 'designs/demo/home.excalidraw',
    baseRevision: main.revision,
    mutationId: 'rename-main',
  })
  assert.equal(renamed.canvas.canvasPath, 'designs/demo/home.excalidraw')
  assert.equal(
    (await store.inspect(project.projectPath)).defaultCanvasPath,
    'designs/demo/home.excalidraw',
  )
})

test('canvas duplicate and delete enforce revision and confirmation', async (t) => {
  const { store, project } = await fixture(t)
  const main = await store.openCanvas(project.projectPath, project.defaultCanvasPath)
  const copy = await store.duplicateCanvas({
    projectPath: project.projectPath,
    canvasPath: main.canvasPath,
    newCanvasPath: 'designs/demo/copy.excalidraw',
    baseRevision: main.revision,
    mutationId: 'copy-main',
  })
  assert.equal(copy.canvas.revision, main.revision)

  await assert.rejects(store.deleteCanvas({
    projectPath: project.projectPath,
    canvasPath: copy.canvas.canvasPath,
    confirmCanvasPath: main.canvasPath,
    baseRevision: copy.canvas.revision,
    mutationId: 'bad-delete-confirmation',
  }), /exactly match/)
  await assert.rejects(store.deleteCanvas({
    projectPath: project.projectPath,
    canvasPath: copy.canvas.canvasPath,
    confirmCanvasPath: copy.canvas.canvasPath,
    baseRevision: '0'.repeat(64),
    mutationId: 'stale-delete',
  }), /revision conflict/)

  const deleted = await store.deleteCanvas({
    projectPath: project.projectPath,
    canvasPath: copy.canvas.canvasPath,
    confirmCanvasPath: copy.canvas.canvasPath,
    baseRevision: copy.canvas.revision,
    mutationId: 'delete-copy',
  })
  assert.equal(deleted.deleted, true)
  await assert.rejects(store.deleteCanvas({
    projectPath: project.projectPath,
    canvasPath: main.canvasPath,
    confirmCanvasPath: main.canvasPath,
    baseRevision: main.revision,
    mutationId: 'delete-last',
  }), /last canvas/)
})

test('checkCanvas returns a revision for a valid standard document', async (t) => {
  const { store, project } = await fixture(t)
  assert.deepEqual(await store.checkCanvas(
    project.projectPath,
    project.defaultCanvasPath,
  ), {
    canvasPath: project.defaultCanvasPath,
    revision: project.canvases[0].revision,
    valid: true,
    errors: [],
    warnings: [],
  })
})
