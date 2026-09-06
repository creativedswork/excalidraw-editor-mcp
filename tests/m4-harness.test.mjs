import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url))
const officialUrl = new URL('../dist/official.js', import.meta.url)
const workspaceKey = 'ai.deepseek.dsh/workspace'
const sessionKey = 'ai.deepseek.dsh/session'
const pngData = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC',
  'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
].join('')
const pngDigest = createHash('sha256').update(Buffer.from(pngData, 'base64')).digest('hex')

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'excalidraw-m4-harness-'))
  const client = new Client({ name: 'excalidraw-editor-m4-harness', version: '0.0.0' })
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
    [sessionKey]: { sessionId: `m4-${Date.now()}`, connectionGeneration: 'one' },
  }
  const created = await client.callTool({
    name: 'create_project',
    arguments: {
      projectPath: 'designs/harness',
      name: 'Harness',
      mutationId: 'create-harness',
    },
    _meta: meta,
  })
  return {
    client,
    meta,
    canvasPath: created.structuredContent.canvasPath,
    revision: created.structuredContent.revision,
  }
}

async function pendingCommand(state) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pulled = await state.client.callTool({
      name: 'pull_canvas',
      arguments: {
        canvasPath: state.canvasPath,
        currentRevision: state.revision,
      },
      _meta: state.meta,
    })
    if (pulled.structuredContent.capture !== undefined) {
      return pulled.structuredContent.capture
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('capture command was not delivered')
}

function successfulOutcome(digest = pngDigest) {
  return {
    status: 'succeeded',
    evidence: {
      evidenceId: crypto.randomUUID(),
      digest,
      mimeType: 'image/png',
      data: pngData,
      width: 1,
      height: 1,
      capturedAt: new Date().toISOString(),
      textDiagnostics: [{
        elementId: 'formula',
        storedWidth: 80,
        measuredWidth: 120,
        overflow: 40,
        clipped: true,
      }],
      truncatedDiagnostics: false,
    },
  }
}

test('capture_canvas returns exact owner/revision Browser evidence as MCP image content', async (t) => {
  const state = await fixture(t)
  const capture = state.client.callTool({
    name: 'capture_canvas',
    arguments: {
      projectPath: 'designs/harness',
      canvasPath: state.canvasPath,
      revision: state.revision,
      maxWidth: 256,
      maxHeight: 256,
    },
    _meta: state.meta,
  })
  const command = await pendingCommand(state)

  const foreign = await state.client.callTool({
    name: 'report_canvas_capture',
    arguments: { commandId: command.commandId, outcome: successfulOutcome() },
    _meta: {
      ...state.meta,
      [sessionKey]: { sessionId: 'foreign', connectionGeneration: 'one' },
    },
  })
  assert.equal(foreign.isError, true)

  const reported = await state.client.callTool({
    name: 'report_canvas_capture',
    arguments: { commandId: command.commandId, outcome: successfulOutcome() },
    _meta: state.meta,
  })
  assert.equal(reported.isError, undefined, reported.content[0]?.text)

  const captured = await capture
  assert.equal(captured.isError, undefined, captured.content[0]?.text)
  assert.deepEqual(captured.content[1], {
    type: 'image',
    data: pngData,
    mimeType: 'image/png',
  })
  assert.equal(captured.structuredContent.revision, state.revision)
  assert.equal(captured.structuredContent.textDiagnostics[0].clipped, true)
})

test('capture_canvas rejects stale revisions and invalid PNG digests', async (t) => {
  const state = await fixture(t)
  const stale = await state.client.callTool({
    name: 'capture_canvas',
    arguments: {
      projectPath: 'designs/harness',
      canvasPath: state.canvasPath,
      revision: '0'.repeat(64),
    },
    _meta: state.meta,
  })
  assert.equal(stale.isError, true)

  const capture = state.client.callTool({
    name: 'capture_canvas',
    arguments: {
      projectPath: 'designs/harness',
      canvasPath: state.canvasPath,
      revision: state.revision,
    },
    _meta: state.meta,
  })
  const command = await pendingCommand(state)
  const reported = await state.client.callTool({
    name: 'report_canvas_capture',
    arguments: {
      commandId: command.commandId,
      outcome: successfulOutcome('0'.repeat(64)),
    },
    _meta: state.meta,
  })
  assert.equal(reported.isError, true)
  assert.equal((await capture).isError, true)
})

test('explicit standalone text dimensions survive official conversion', async () => {
  const { applyOfficialCanvasChanges } = await import(officialUrl.href)
  const transformed = applyOfficialCanvasChanges({
    type: 'excalidraw',
    version: 2,
    source: 'test',
    elements: [],
    appState: {},
    files: {},
  }, [{
    op: 'add',
    clientRef: 'formula',
    element: {
      type: 'text',
      x: 20,
      y: 20,
      text: 'L = -sum(y log(p))',
      width: 420,
      height: 48,
      fontSize: 24,
    },
  }])
  const text = transformed.document.elements.find(element => element.type === 'text')
  assert.equal(text.width, 420)
  assert.equal(text.height, 48)
})
