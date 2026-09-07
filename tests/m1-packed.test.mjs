import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const execute = promisify(execFile)
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const stdioDefaultMaxBufferSize = 10 * 1024 * 1024

test('packed install is complete and starts without external App assets', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'excalidraw-m1-packed-'))
  t.after(() => rm(sandbox, { recursive: true, force: true }))
  const env = { ...process.env, PNPM_HOME: join(sandbox, '.pnpm-home') }
  await execute('pnpm', ['pack', '--pack-destination', sandbox], { cwd: root, env })
  const tarball = (await readdir(sandbox)).find(name => name.endsWith('.tgz'))
  assert.ok(tarball)
  await writeFile(join(sandbox, 'package.json'), JSON.stringify({
    name: 'packed-smoke',
    private: true,
  }))
  await execute('pnpm', [
    'add',
    '--prefer-offline',
    '--ignore-scripts',
    join(sandbox, tarball),
  ], { cwd: sandbox, env })

  const packageRoot = join(
    sandbox,
    'node_modules',
    'excalidraw-editor-mcp',
  )
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.private, true)
  assert.equal(manifest.version, '0.0.0')
  assert.deepEqual(manifest.bin, { 'excalidraw-editor-mcp': 'dist/server.js' })
  await readFile(join(packageRoot, 'LICENSE'))
  await readFile(join(packageRoot, 'THIRD_PARTY_NOTICES.md'))
  await readFile(join(packageRoot, 'README.zh-CN.md'))
  await readFile(join(packageRoot, 'examples', 'dsh', 'cordis.patch.yml'))

  const client = new Client({
    name: 'excalidraw-editor-packed-test',
    version: '0.0.0',
  })
  await client.connect(new StdioClientTransport({
    command: join(sandbox, 'node_modules', '.bin', 'excalidraw-editor-mcp'),
  }))
  t.after(() => client.close())
  const listed = await client.listTools()
  assert.equal(listed.tools.some(tool => tool.name === 'create_project'), true)
  assert.equal(listed.tools.some(tool => tool.name === 'pull_canvas'), true)

  const resource = await client.readResource({ uri: 'ui://excalidraw-editor/app' })
  const html = resource.contents[0]?.text ?? ''
  assert.deepEqual(resource.contents[0]?._meta?.ui?.csp, {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  })
  assert.ok((html.match(/data:font\/woff2;base64/g) ?? []).length > 0)
  assert.doesNotMatch(html, /\.\/fonts\/[^"'`()\s]+\.woff2/)
  const wireLine = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: resource,
  })}\n`
  assert.ok(
    Buffer.byteLength(wireLine) < stdioDefaultMaxBufferSize,
    'resources/read response must fit the MCP SDK 1.30 default stdio buffer',
  )
})
