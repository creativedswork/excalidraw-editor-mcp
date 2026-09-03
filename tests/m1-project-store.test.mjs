import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const projectStoreUrl = new URL('../dist/project-store.js', import.meta.url)
const canvasStoreUrl = new URL('../dist/canvas-store.js', import.meta.url)

async function fixture(t) {
  const { mkdtemp } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'excalidraw-m1-project-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { ProjectStore } = await import(projectStoreUrl.href)
  const { SafeWorkspace } = await import(canvasStoreUrl.href)
  return { root, store: new ProjectStore(await SafeWorkspace.open(root)) }
}

test('project store discovers managed and existing projects', async (t) => {
  const { root, store } = await fixture(t)
  const managed = await store.create({
    projectPath: 'designs/managed',
    name: 'Managed',
    mutationId: 'create-managed',
  })
  assert.equal(managed.kind, 'managed')
  assert.equal(managed.defaultCanvasPath, 'designs/managed/main.excalidraw')

  await mkdir(join(root, 'existing'), { recursive: true })
  await store.canvases.create(
    'existing/sketch.excalidraw',
    'create-existing-canvas',
  )
  assert.deepEqual(
    (await store.list()).map(project => [project.projectPath, project.kind]),
    [['designs/managed', 'managed'], ['existing', 'discovered']],
  )
})

test('managed project lifecycle enforces revisions and idempotency', async (t) => {
  const { store } = await fixture(t)
  const created = await store.create({
    projectPath: 'designs/source',
    name: 'Source',
    mutationId: 'create-source',
  })
  assert.deepEqual(await store.create({
    projectPath: 'designs/source',
    name: 'Source',
    mutationId: 'create-source',
  }), created)

  await assert.rejects(store.rename({
    projectPath: created.projectPath,
    newProjectPath: 'designs/renamed',
    baseProjectRevision: '0'.repeat(64),
    mutationId: 'stale-rename',
  }), /project revision conflict/)

  const renamed = await store.rename({
    projectPath: created.projectPath,
    newProjectPath: 'designs/renamed',
    name: 'Renamed',
    baseProjectRevision: created.projectRevision,
    mutationId: 'rename-source',
  })
  assert.equal(renamed.name, 'Renamed')
  await assert.rejects(store.inspect(created.projectPath), /ENOENT/)

  const duplicate = await store.duplicate({
    projectPath: renamed.projectPath,
    newProjectPath: 'designs/copy',
    name: 'Copy',
    baseProjectRevision: renamed.projectRevision,
    mutationId: 'duplicate-renamed',
  })
  assert.equal(duplicate.name, 'Copy')
  assert.equal(duplicate.canvasCount, 1)

  await assert.rejects(store.delete({
    projectPath: duplicate.projectPath,
    confirmProjectPath: 'designs/not-copy',
    baseProjectRevision: duplicate.projectRevision,
    mutationId: 'bad-confirmation',
  }), /exactly match/)
  assert.deepEqual(await store.delete({
    projectPath: duplicate.projectPath,
    confirmProjectPath: duplicate.projectPath,
    baseProjectRevision: duplicate.projectRevision,
    mutationId: 'delete-copy',
  }), {
    projectPath: 'designs/copy',
    deleted: true,
  })
})

test('directory lifecycle rejects discovered projects', async (t) => {
  const { root, store } = await fixture(t)
  await mkdir(join(root, 'existing'), { recursive: true })
  await store.canvases.create(
    'existing/sketch.excalidraw',
    'create-discovered-canvas',
  )
  const discovered = await store.inspect('existing')
  await assert.rejects(store.duplicate({
    projectPath: discovered.projectPath,
    newProjectPath: 'existing-copy',
    baseProjectRevision: discovered.projectRevision,
    mutationId: 'duplicate-discovered',
  }), /only available for managed projects/)
})
