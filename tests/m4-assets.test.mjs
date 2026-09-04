import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const projectStoreUrl = new URL('../dist/project-store.js', import.meta.url)
const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
const workspaceKey = 'ai.deepseek.dsh/workspace'
const sessionKey = 'ai.deepseek.dsh/session'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

function paddedPng(size, fill) {
  const bytes = Buffer.alloc(size, fill)
  png.copy(bytes)
  return bytes
}

async function mcpFixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m4-assets-'))
  const client = new Client({ name: 'excalidraw-editor-m4-test', version: '0.0.0' })
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
    [sessionKey]: { sessionId: `m4-${String(Date.now())}`, connectionGeneration: 'test' },
  }
  const created = await client.callTool({
    name: 'create_project',
    arguments: {
      projectPath: 'designs/m4',
      name: 'M4',
      mutationId: 'create-m4',
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

async function inspect(state) {
  return state.client.callTool({
    name: 'inspect_canvas',
    arguments: {
      projectPath: 'designs/m4',
      canvasPath: state.canvasPath,
      includeDocument: true,
    },
    _meta: state.meta,
  })
}

test('asset tools round trip local images, retry exactly, and retain live references', async (t) => {
  const state = await mcpFixture(t)
  await writeFile(join(state.workspace, 'pixel.png'), png)
  await writeFile(join(state.workspace, 'unused.gif'), gif)

  const request = {
    name: 'add_canvas_asset',
    arguments: {
      projectPath: 'designs/m4',
      canvasPath: state.canvasPath,
      sourcePath: 'pixel.png',
      baseRevision: state.revision,
      mutationId: 'add-pixel',
    },
    _meta: state.meta,
  }
  const added = await state.client.callTool(request)
  assert.equal(added.isError, undefined, added.content[0]?.text)
  assert.deepEqual(
    {
      canvasPath: added.structuredContent.canvasPath,
      mimeType: added.structuredContent.mimeType,
      width: added.structuredContent.width,
      height: added.structuredContent.height,
      hash: added.structuredContent.hash,
    },
    {
      canvasPath: state.canvasPath,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      hash: createHash('sha256').update(png).digest('hex'),
    },
  )
  assert.equal(added.structuredContent.assetId, added.structuredContent.hash)

  const retry = await state.client.callTool(request)
  assert.deepEqual(retry.structuredContent, added.structuredContent)

  const withImage = await state.client.callTool({
    name: 'apply_canvas_changes',
    arguments: {
      projectPath: 'designs/m4',
      canvasPath: state.canvasPath,
      baseRevision: added.structuredContent.revision,
      mutationId: 'reference-pixel',
      changes: [{
        op: 'add',
        clientRef: 'pixel',
        element: {
          type: 'image',
          width: 100,
          height: 100,
          fileId: added.structuredContent.assetId,
        },
      }],
    },
    _meta: state.meta,
  })
  const unused = await state.client.callTool({
    name: 'add_canvas_asset',
    arguments: {
      projectPath: 'designs/m4',
      canvasPath: state.canvasPath,
      sourcePath: 'unused.gif',
      baseRevision: withImage.structuredContent.revision,
      mutationId: 'add-unused',
    },
    _meta: state.meta,
  })
  const cleaned = await state.client.callTool({
    name: 'remove_unused_assets',
    arguments: {
      projectPath: 'designs/m4',
      canvasPath: state.canvasPath,
      baseRevision: unused.structuredContent.revision,
      mutationId: 'remove-unused',
    },
    _meta: state.meta,
  })
  assert.deepEqual(cleaned.structuredContent.removedAssetIds, [
    unused.structuredContent.assetId,
  ])

  const final = await inspect(state)
  const file = final.structuredContent.document.files[added.structuredContent.assetId]
  assert.ok(file)
  assert.deepEqual(
    Buffer.from(file.dataURL.slice(file.dataURL.indexOf(',') + 1), 'base64'),
    png,
  )
  assert.equal(final.structuredContent.document.files[unused.structuredContent.assetId], undefined)

  const tools = await state.client.listTools()
  for (const name of ['add_canvas_asset', 'remove_unused_assets']) {
    const tool = tools.tools.find(candidate => candidate.name === name)
    assert.deepEqual(tool._meta?.ui, { visibility: ['model'] })
  }
})

test('asset rejection leaves the previous revision intact', async (t) => {
  const state = await mcpFixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'excalidraw-m4-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.png'), png)
  await symlink(join(outside, 'outside.png'), join(state.workspace, 'linked.png'))
  await writeFile(join(state.workspace, 'original.png'), png)
  await link(join(state.workspace, 'original.png'), join(state.workspace, 'hard.png'))
  await writeFile(join(state.workspace, 'fake.png'), 'not an image')
  await writeFile(join(state.workspace, 'large.png'), paddedPng(1024 * 1024 + 1, 1))

  const rejectedPaths = [
    '../outside.png',
    'https://example.com/image.png',
    'linked.png',
    'hard.png',
    'fake.png',
    'large.png',
  ]
  for (const [index, sourcePath] of rejectedPaths.entries()) {
    const rejected = await state.client.callTool({
      name: 'add_canvas_asset',
      arguments: {
        projectPath: 'designs/m4',
        canvasPath: state.canvasPath,
        sourcePath,
        baseRevision: state.revision,
        mutationId: `reject-${String(index)}`,
      },
      _meta: state.meta,
    })
    assert.equal(rejected.isError, true, sourcePath)
    assert.equal((await inspect(state)).structuredContent.revision, state.revision)
  }
})

test('aggregate and document limits reject before preserving the canvas revision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'excalidraw-m4-limits-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { ProjectStore } = await import(projectStoreUrl.href)
  const { SafeWorkspace } = await import(new URL('../dist/canvas-store.js', import.meta.url).href)
  const store = new ProjectStore(await SafeWorkspace.open(root))
  const project = await store.create({
    projectPath: 'designs/limits',
    name: 'Limits',
    mutationId: 'create-limits',
  })
  let canvas = await store.openCanvas('designs/limits', project.defaultCanvasPath)

  for (const index of [0, 1]) {
    const sourcePath = `asset-${String(index)}.png`
    await writeFile(join(root, sourcePath), paddedPng(700 * 1024, index + 1))
    const added = await store.addCanvasAsset({
      projectPath: 'designs/limits',
      canvasPath: canvas.canvasPath,
      sourcePath,
      baseRevision: canvas.revision,
      mutationId: `add-${String(index)}`,
    })
    canvas = await store.openCanvas('designs/limits', canvas.canvasPath)
    assert.equal(canvas.revision, added.revision)
  }

  await writeFile(join(root, 'aggregate.png'), paddedPng(700 * 1024, 3))
  await assert.rejects(store.addCanvasAsset({
    projectPath: 'designs/limits',
    canvasPath: canvas.canvasPath,
    sourcePath: 'aggregate.png',
    baseRevision: canvas.revision,
    mutationId: 'reject-aggregate',
  }), /canvas assets exceed/)
  assert.equal((await store.openCanvas('designs/limits', canvas.canvasPath)).revision, canvas.revision)

  const cleaned = await store.removeUnusedAssets({
    projectPath: 'designs/limits',
    canvasPath: canvas.canvasPath,
    baseRevision: canvas.revision,
    mutationId: 'clean-before-document-limit',
  })
  canvas = await store.openCanvas('designs/limits', canvas.canvasPath)
  assert.equal(canvas.revision, cleaned.revision)
  const padded = await store.canvases.write(
    canvas.canvasPath,
    canvas.revision,
    'pad-document',
    {
      ...canvas.document,
      appState: { padding: 'x'.repeat(3 * 1024 * 1024) },
    },
  )
  await writeFile(join(root, 'document.png'), paddedPng(900 * 1024, 4))
  const beforeDocumentReject = await readFile(join(root, canvas.canvasPath))
  await assert.rejects(store.addCanvasAsset({
    projectPath: 'designs/limits',
    canvasPath: canvas.canvasPath,
    sourcePath: 'document.png',
    baseRevision: padded.revision,
    mutationId: 'reject-document',
  }), /canvas exceeds/)
  assert.equal(
    (await store.openCanvas('designs/limits', canvas.canvasPath)).revision,
    padded.revision,
  )
  assert.deepEqual(await readFile(join(root, canvas.canvasPath)), beforeDocumentReject)
})
