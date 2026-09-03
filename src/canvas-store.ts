import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { z } from 'zod'

export const MAX_CANVAS_BYTES = 4 * 1024 * 1024

const revisionPattern = /^[a-f0-9]{64}$/
const canvasPathPattern = /\.excalidraw$/
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

export const canvasDocumentSchema = z.object({
  type: z.literal('excalidraw'),
  version: z.literal(2),
  source: z.string(),
  elements: z.array(z.record(z.string(), jsonValueSchema)),
  appState: z.record(z.string(), jsonValueSchema),
  files: z.record(z.string(), jsonValueSchema),
}).passthrough()

export type CanvasDocument = z.infer<typeof canvasDocumentSchema>

export interface CanvasSnapshot {
  canvasPath: string
  revision: string
  document: CanvasDocument
}

export interface CanvasWriteResult extends CanvasSnapshot {
  changed: boolean
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly currentRevision: string,
    message = 'canvas revision conflict',
  ) {
    super(message)
    this.name = 'RevisionConflictError'
  }
}

export class MutationConflictError extends Error {
  constructor(mutationId: string) {
    super(`mutationId was already used with different input: ${mutationId}`)
    this.name = 'MutationConflictError'
  }
}

export function emptyCanvasDocument(): CanvasDocument {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'excalidraw-editor-mcp',
    elements: [],
    appState: {},
    files: {},
  }
}

function safeRelativePath(path: string): string {
  if (
    path.length === 0
    || path.length > 512
    || path.includes('\0')
    || path.includes('\\')
    || isAbsolute(path)
    || /^[A-Za-z]:/.test(path)
  ) {
    throw new Error(`invalid workspace-relative path: ${path}`)
  }
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid workspace-relative path: ${path}`)
  }
  return parts.join('/')
}

function isWithin(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    )
  }
  return value
}

export function canonicalCanvasBytes(input: unknown): Buffer {
  const serializable = JSON.parse(JSON.stringify(input)) as unknown
  const document = canvasDocumentSchema.parse(serializable)
  const bytes = Buffer.from(`${JSON.stringify(stableValue(document), null, 2)}\n`)
  if (bytes.length > MAX_CANVAS_BYTES) {
    throw new Error(`canvas exceeds ${String(MAX_CANVAS_BYTES)} bytes`)
  }
  return bytes
}

export function canvasRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class SafeWorkspace {
  private constructor(readonly root: string) {}

  static async open(cwd: string): Promise<SafeWorkspace> {
    const root = await realpath(resolve(cwd))
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('workspace root must be a real directory')
    }
    return new SafeWorkspace(root)
  }

  validateCanvasPath(path: string): string {
    const safe = safeRelativePath(path)
    if (!canvasPathPattern.test(safe)) {
      throw new Error(`canvas path must end with .excalidraw: ${path}`)
    }
    return safe
  }

  validateProjectPath(path: string): string {
    return safeRelativePath(path)
  }

  absolute(path: string): string {
    const safe = safeRelativePath(path)
    const target = resolve(this.root, ...safe.split('/'))
    if (!isWithin(this.root, target)) {
      throw new Error(`workspace path escapes root: ${path}`)
    }
    return target
  }

  async existingFile(path: string): Promise<string> {
    const target = this.absolute(path)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error(`workspace path is not a regular unlinked file: ${path}`)
    }
    const resolved = await realpath(target)
    if (resolved !== target || !isWithin(this.root, resolved)) {
      throw new Error(`workspace path contains a symlink: ${path}`)
    }
    return target
  }

  async existingDirectory(path: string): Promise<string> {
    const target = this.absolute(path)
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`workspace path is not a real directory: ${path}`)
    }
    const resolved = await realpath(target)
    if (resolved !== target || !isWithin(this.root, resolved)) {
      throw new Error(`workspace path contains a symlink: ${path}`)
    }
    return target
  }

  async prepareFile(path: string): Promise<string> {
    const safe = safeRelativePath(path)
    const target = this.absolute(safe)
    let current = this.root
    for (const part of dirname(safe) === '.' ? [] : dirname(safe).split('/')) {
      current = join(current, part)
      try {
        const info = await lstat(current)
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new Error(`workspace parent is not a real directory: ${relative(this.root, current)}`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await mkdir(current)
      }
      const resolved = await realpath(current)
      if (resolved !== current || !isWithin(this.root, resolved)) {
        throw new Error(`workspace parent contains a symlink: ${relative(this.root, current)}`)
      }
    }
    return target
  }
}

class MutationRegistry {
  private readonly entries = new Map<string, {
    fingerprint: string
    result: Promise<unknown>
  }>()

  async run<T>(mutationId: string, fingerprint: string, action: () => Promise<T>): Promise<T> {
    if (mutationId.length === 0 || mutationId.length > 200) {
      throw new Error('mutationId must contain 1-200 characters')
    }
    const previous = this.entries.get(mutationId)
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new MutationConflictError(mutationId)
      return previous.result as Promise<T>
    }
    const result = action().catch((error: unknown) => {
      this.entries.delete(mutationId)
      throw error
    })
    this.entries.set(mutationId, { fingerprint, result })
    return result
  }
}

export class CanvasStore {
  private readonly mutations = new MutationRegistry()
  private readonly queues = new Map<string, Promise<void>>()

  constructor(readonly workspace: SafeWorkspace) {}

  async read(canvasPath: string): Promise<CanvasSnapshot> {
    const safe = this.workspace.validateCanvasPath(canvasPath)
    const path = await this.workspace.existingFile(safe)
    const info = await stat(path)
    if (info.size > MAX_CANVAS_BYTES) {
      throw new Error(`canvas exceeds ${String(MAX_CANVAS_BYTES)} bytes`)
    }
    const bytes = await readFile(path)
    if (bytes.length > MAX_CANVAS_BYTES) {
      throw new Error(`canvas exceeds ${String(MAX_CANVAS_BYTES)} bytes`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new Error(`canvas is not valid JSON: ${safe}`)
    }
    const document = canvasDocumentSchema.parse(parsed)
    const canonical = canonicalCanvasBytes(document)
    return {
      canvasPath: safe,
      revision: canvasRevision(canonical),
      document,
    }
  }

  async create(
    canvasPath: string,
    mutationId: string,
    document: CanvasDocument = emptyCanvasDocument(),
  ): Promise<CanvasWriteResult> {
    const safe = this.workspace.validateCanvasPath(canvasPath)
    const bytes = canonicalCanvasBytes(document)
    const fingerprint = canvasRevision(Buffer.concat([
      Buffer.from(`create\0${safe}\0`),
      bytes,
    ]))
    return this.mutations.run(mutationId, fingerprint, () => (
      this.serialized(safe, async () => {
        const target = await this.workspace.prepareFile(safe)
        await this.writeNew(target, bytes)
        return {
          canvasPath: safe,
          revision: canvasRevision(bytes),
          document: canvasDocumentSchema.parse(JSON.parse(bytes.toString('utf8'))),
          changed: true,
        }
      })
    ))
  }

  async write(
    canvasPath: string,
    baseRevision: string,
    mutationId: string,
    document: CanvasDocument,
  ): Promise<CanvasWriteResult> {
    const safe = this.workspace.validateCanvasPath(canvasPath)
    if (!revisionPattern.test(baseRevision)) throw new Error('invalid baseRevision')
    const bytes = canonicalCanvasBytes(document)
    const fingerprint = canvasRevision(Buffer.concat([
      Buffer.from(`write\0${safe}\0${baseRevision}\0`),
      bytes,
    ]))
    return this.mutations.run(mutationId, fingerprint, () => (
      this.serialized(safe, async () => {
        const current = await this.read(safe)
        if (current.revision !== baseRevision) {
          throw new RevisionConflictError(current.revision)
        }
        const revision = canvasRevision(bytes)
        if (revision === current.revision) return { ...current, changed: false }
        const target = await this.workspace.existingFile(safe)
        const latest = await this.read(safe)
        if (latest.revision !== baseRevision) {
          throw new RevisionConflictError(latest.revision)
        }
        await this.replaceAtomic(target, bytes)
        return {
          canvasPath: safe,
          revision,
          document: canvasDocumentSchema.parse(JSON.parse(bytes.toString('utf8'))),
          changed: true,
        }
      })
    ))
  }

  private async serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolveCurrent => {
      release = resolveCurrent
    })
    this.queues.set(key, previous.then(() => current))
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
  }

  private async writeNew(target: string, bytes: Buffer): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      await link(temporary, target)
      await this.syncDirectory(dirname(target))
    } finally {
      await handle.close().catch(() => undefined)
      await rm(temporary, { force: true })
    }
  }

  private async replaceAtomic(target: string, bytes: Buffer): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      await rename(temporary, target)
      await this.syncDirectory(dirname(target))
    } finally {
      await handle.close().catch(() => undefined)
      await rm(temporary, { force: true })
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
