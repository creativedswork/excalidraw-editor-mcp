import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const execute = promisify(execFile)
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

test('packed install starts from a temporary project', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'excalidraw-m1-packed-'))
  t.after(() => rm(sandbox, { recursive: true, force: true }))
  await execute('pnpm', ['pack', '--pack-destination', sandbox], { cwd: root })
  const tarball = (await readdir(sandbox)).find(name => name.endsWith('.tgz'))
  assert.ok(tarball)
  await writeFile(join(sandbox, 'package.json'), JSON.stringify({
    name: 'packed-smoke',
    private: true,
  }))
  await execute('pnpm', [
    'add',
    '--offline',
    '--ignore-scripts',
    join(sandbox, tarball),
  ], { cwd: sandbox })

  const serverPath = join(
    sandbox,
    'node_modules',
    'excalidraw-editor-mcp',
    'dist',
    'server.js',
  )
  const client = new Client({
    name: 'excalidraw-editor-packed-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  }))
  t.after(() => client.close())
  const listed = await client.listTools()
  assert.equal(listed.tools.some(tool => tool.name === 'create_project'), true)
  assert.equal(listed.tools.some(tool => tool.name === 'pull_canvas'), true)
})
