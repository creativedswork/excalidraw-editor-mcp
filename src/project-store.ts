import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { basename, dirname, join, posix, relative } from 'node:path'
import { z } from 'zod'
import {
  MAX_TOTAL_ASSET_BYTES,
  loadWorkspaceImage,
  totalAssetBytes,
} from './assets.js'
import {
  CanvasStore,
  type CanvasDocument,
  type CanvasSnapshot,
  MutationConflictError,
  RevisionConflictError,
  SafeWorkspace,
  canonicalCanvasBytes,
  emptyCanvasDocument,
} from './canvas-store.js'
import type { CanvasChange } from './official.js'

export const PROJECT_MANIFEST = '.excalidraw-project.json'

const projectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(200),
  defaultCanvasPath: z.string().min(1).max(512),
}).strict()

export type ProjectManifest = z.infer<typeof projectManifestSchema>
export type ProjectKind = 'managed' | 'discovered'

export interface CanvasSummary {
  canvasPath: string
  revision: string
}

export interface ProjectSummary {
  projectPath: string
  kind: ProjectKind
  name: string
  defaultCanvasPath: string | null
  canvasCount: number
  projectRevision: string
  canvases: CanvasSummary[]
}

export interface CanvasLifecycleResult {
  canvas: CanvasSnapshot
  projectRevision: string
}

export class ProjectRevisionConflictError extends Error {
  constructor(public readonly currentProjectRevision: string) {
    super('project revision conflict')
    this.name = 'ProjectRevisionConflictError'
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function projectFile(projectPath: string, child: string): string {
  return `${projectPath}/${child}`
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

export class ProjectStore {
  readonly canvases: CanvasStore
  private readonly mutations = new Map<string, {
    fingerprint: string
    result: Promise<unknown>
  }>()
  private queue = Promise.resolve()

  constructor(readonly workspace: SafeWorkspace) {
    this.canvases = new CanvasStore(workspace)
  }

  async list(): Promise<ProjectSummary[]> {
    const projects: ProjectSummary[] = []
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const projectPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        const path = await this.workspace.existingDirectory(projectPath)
        const names = await readdir(path)
        if (names.includes(PROJECT_MANIFEST)
          || names.some(name => name.endsWith('.excalidraw'))) {
          projects.push(await this.inspect(projectPath))
        } else {
          await visit(path, projectPath)
        }
      }
    }
    await visit(this.workspace.root, '')
    return projects.sort((left, right) => left.projectPath.localeCompare(right.projectPath))
  }

  async inspect(projectPath: string): Promise<ProjectSummary> {
    const safeProject = this.workspace.validateProjectPath(projectPath)
    const directory = await this.workspace.existingDirectory(safeProject)
    const manifest = await this.readManifest(safeProject)
    const canvasPaths = await this.collectCanvases(directory, safeProject)
    if (manifest === null && canvasPaths.length === 0) {
      throw new Error(`directory is not an Excalidraw project: ${safeProject}`)
    }
    const canvases = await Promise.all(canvasPaths.map(async (canvasPath) => {
      const snapshot = await this.canvases.read(canvasPath)
      return { canvasPath, revision: snapshot.revision }
    }))
    const defaultCanvasPath = manifest === null
      ? (canvases[0]?.canvasPath ?? null)
      : this.resolveCanvasPath(safeProject, manifest.defaultCanvasPath)
    if (defaultCanvasPath !== null
      && !canvases.some(canvas => canvas.canvasPath === defaultCanvasPath)) {
      throw new Error(`project default canvas does not exist: ${defaultCanvasPath}`)
    }
    const kind: ProjectKind = manifest === null ? 'discovered' : 'managed'
    const name = manifest?.name ?? basename(safeProject)
    const projectRevision = digest(JSON.stringify({
      manifest,
      canvases: canvases.map(canvas => [canvas.canvasPath, canvas.revision]),
    }))
    return {
      projectPath: safeProject,
      kind,
      name,
      defaultCanvasPath,
      canvasCount: canvases.length,
      projectRevision,
      canvases,
    }
  }

  async listCanvases(projectPath: string): Promise<CanvasSummary[]> {
    return (await this.inspect(projectPath)).canvases
  }

  async openCanvas(projectPath: string, canvasPath: string): Promise<CanvasSnapshot> {
    const current = await this.inspect(projectPath)
    const safeCanvas = this.canvasInProject(current.projectPath, canvasPath)
    if (!current.canvases.some(canvas => canvas.canvasPath === safeCanvas)) {
      throw new Error(`canvas does not belong to project: ${safeCanvas}`)
    }
    return this.canvases.read(safeCanvas)
  }

  async checkCanvas(projectPath: string, canvasPath: string): Promise<{
    canvasPath: string
    revision: string
    valid: true
    errors: []
    warnings: []
  }> {
    const canvas = await this.openCanvas(projectPath, canvasPath)
    return {
      canvasPath: canvas.canvasPath,
      revision: canvas.revision,
      valid: true,
      errors: [],
      warnings: [],
    }
  }

  async addCanvasAsset(input: {
    projectPath: string
    canvasPath: string
    sourcePath: string
    baseRevision: string
    mutationId: string
  }): Promise<{
    canvasPath: string
    assetId: string
    mimeType: string
    width: number
    height: number
    hash: string
    byteLength: number
    revision: string
    changed: boolean
  }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const sourcePath = this.workspace.validateProjectPath(input.sourcePath)
    const fingerprint = digest(JSON.stringify({
      operation: 'addCanvasAsset',
      ...input,
      projectPath,
      canvasPath,
      sourcePath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const project = await this.inspect(projectPath)
      this.requireCanvas(project, canvasPath)
      const current = await this.canvases.read(canvasPath)
      if (current.revision !== input.baseRevision) {
        throw new RevisionConflictError(current.revision)
      }
      const asset = await loadWorkspaceImage(this.workspace, sourcePath)
      const created = Date.now()
      const document: CanvasDocument = {
        ...current.document,
        files: current.document.files[asset.assetId] === undefined
          ? {
              ...current.document.files,
              [asset.assetId]: {
                id: asset.assetId,
                mimeType: asset.mimeType,
                dataURL: asset.dataURL,
                created,
                lastRetrieved: created,
              },
            }
          : current.document.files,
      }
      const aggregateBytes = totalAssetBytes(document.files)
      if (aggregateBytes > MAX_TOTAL_ASSET_BYTES) {
        throw new Error(`canvas assets exceed ${String(MAX_TOTAL_ASSET_BYTES)} bytes`)
      }
      canonicalCanvasBytes(document)
      const canvas = await this.canvases.write(
        canvasPath,
        input.baseRevision,
        `canvas-asset:${input.mutationId}`,
        document,
      )
      return {
        canvasPath,
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        hash: asset.hash,
        byteLength: asset.byteLength,
        revision: canvas.revision,
        changed: canvas.changed,
      }
    }))
  }

  async removeUnusedAssets(input: {
    projectPath: string
    canvasPath: string
    baseRevision: string
    mutationId: string
  }): Promise<{
    canvasPath: string
    revision: string
    changed: boolean
    removedAssetIds: string[]
  }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'removeUnusedAssets',
      ...input,
      projectPath,
      canvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const project = await this.inspect(projectPath)
      this.requireCanvas(project, canvasPath)
      const current = await this.canvases.read(canvasPath)
      if (current.revision !== input.baseRevision) {
        throw new RevisionConflictError(current.revision)
      }
      const referenced = new Set(current.document.elements.flatMap(element => (
        element.type === 'image'
        && element.isDeleted !== true
        && typeof element.fileId === 'string'
          ? [element.fileId]
          : []
      )))
      const removedAssetIds = Object.keys(current.document.files)
        .filter(assetId => !referenced.has(assetId))
        .sort()
      const files = Object.fromEntries(
        Object.entries(current.document.files)
          .filter(([assetId]) => referenced.has(assetId)),
      )
      const canvas = await this.canvases.write(
        canvasPath,
        input.baseRevision,
        `canvas-asset-cleanup:${input.mutationId}`,
        { ...current.document, files },
      )
      return {
        canvasPath,
        revision: canvas.revision,
        changed: canvas.changed,
        removedAssetIds,
      }
    }))
  }

  async applyCanvasChanges(input: {
    projectPath: string
    canvasPath: string
    baseRevision: string
    mutationId: string
    changes: CanvasChange[]
  }): Promise<{
    canvasPath: string
    revision: string
    changed: boolean
    clientRefMap: Record<string, string>
    affectedElementIds: string[]
    summary: { changeCount: number }
    warnings: string[]
  }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'applyCanvasChanges',
      ...input,
      projectPath,
      canvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const project = await this.inspect(projectPath)
      this.requireCanvas(project, canvasPath)
      const current = await this.canvases.read(canvasPath)
      if (current.revision !== input.baseRevision) {
        throw new RevisionConflictError(current.revision)
      }
      const { applyOfficialCanvasChanges } = await import('./official.js')
      const transformed = applyOfficialCanvasChanges(current.document, input.changes)
      const canvas = await this.canvases.write(
        canvasPath,
        input.baseRevision,
        `canvas-change:${input.mutationId}`,
        transformed.document,
      )
      return {
        canvasPath,
        revision: canvas.revision,
        changed: canvas.changed,
        clientRefMap: transformed.clientRefMap,
        affectedElementIds: transformed.affectedElementIds,
        summary: { changeCount: input.changes.length },
        warnings: transformed.warnings,
      }
    }))
  }

  async replaceCanvas(input: {
    projectPath: string
    canvasPath: string
    baseRevision: string
    mutationId: string
    document: CanvasDocument
  }): Promise<{
    canvasPath: string
    revision: string
    changed: boolean
    validation: { valid: true; elementCount: number }
  }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'replaceCanvas',
      ...input,
      projectPath,
      canvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const project = await this.inspect(projectPath)
      this.requireCanvas(project, canvasPath)
      const current = await this.canvases.read(canvasPath)
      if (current.revision !== input.baseRevision) {
        throw new RevisionConflictError(current.revision)
      }
      canonicalCanvasBytes(input.document)
      const { restoreOfficialCanvasDocument } = await import('./official.js')
      const document = restoreOfficialCanvasDocument(input.document)
      const canvas = await this.canvases.write(
        canvasPath,
        input.baseRevision,
        `canvas-replace:${input.mutationId}`,
        document,
      )
      return {
        canvasPath,
        revision: canvas.revision,
        changed: canvas.changed,
        validation: {
          valid: true,
          elementCount: canvas.document.elements.length,
        },
      }
    }))
  }

  async createCanvas(input: {
    projectPath: string
    canvasPath: string
    baseProjectRevision: string
    mutationId: string
    document?: CanvasDocument
  }): Promise<CanvasLifecycleResult> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'createCanvas',
      ...input,
      projectPath,
      canvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.inspect(projectPath)
      this.requireProjectRevision(current, input.baseProjectRevision)
      const canvas = await this.canvases.create(
        canvasPath,
        `canvas:${input.mutationId}`,
        input.document,
      )
      return {
        canvas,
        projectRevision: (await this.inspect(projectPath)).projectRevision,
      }
    }))
  }

  async renameCanvas(input: {
    projectPath: string
    canvasPath: string
    newCanvasPath: string
    baseRevision: string
    mutationId: string
  }): Promise<CanvasLifecycleResult> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const newCanvasPath = this.canvasInProject(projectPath, input.newCanvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'renameCanvas',
      ...input,
      projectPath,
      canvasPath,
      newCanvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.inspect(projectPath)
      if (current.kind !== 'managed') {
        throw new Error('canvas rename is only available for managed projects')
      }
      this.requireCanvas(current, canvasPath)
      const canvas = await this.canvases.rename(
        canvasPath,
        newCanvasPath,
        input.baseRevision,
        `canvas:${input.mutationId}`,
      )
      if (current.defaultCanvasPath === canvasPath) {
        try {
          await this.writeManifest(projectPath, {
            schemaVersion: 1,
            name: current.name,
            defaultCanvasPath: posix.relative(projectPath, newCanvasPath),
          })
        } catch (error) {
          await this.canvases.rename(
            newCanvasPath,
            canvasPath,
            canvas.revision,
            `rollback:${input.mutationId}`,
          ).catch(() => undefined)
          throw error
        }
      }
      return {
        canvas,
        projectRevision: (await this.inspect(projectPath)).projectRevision,
      }
    }))
  }

  async duplicateCanvas(input: {
    projectPath: string
    canvasPath: string
    newCanvasPath: string
    baseRevision: string
    mutationId: string
  }): Promise<CanvasLifecycleResult> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    const newCanvasPath = this.canvasInProject(projectPath, input.newCanvasPath)
    const fingerprint = digest(JSON.stringify({
      operation: 'duplicateCanvas',
      ...input,
      projectPath,
      canvasPath,
      newCanvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.inspect(projectPath)
      this.requireCanvas(current, canvasPath)
      const canvas = await this.canvases.duplicate(
        canvasPath,
        newCanvasPath,
        input.baseRevision,
        `canvas:${input.mutationId}`,
      )
      return {
        canvas,
        projectRevision: (await this.inspect(projectPath)).projectRevision,
      }
    }))
  }

  async deleteCanvas(input: {
    projectPath: string
    canvasPath: string
    confirmCanvasPath: string
    baseRevision: string
    mutationId: string
  }): Promise<{
    canvasPath: string
    deleted: true
    projectRevision: string
  }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const canvasPath = this.canvasInProject(projectPath, input.canvasPath)
    if (input.confirmCanvasPath !== canvasPath) {
      throw new Error('confirmCanvasPath must exactly match canvasPath')
    }
    const fingerprint = digest(JSON.stringify({
      operation: 'deleteCanvas',
      ...input,
      projectPath,
      canvasPath,
    }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.inspect(projectPath)
      this.requireCanvas(current, canvasPath)
      if (current.canvases.length === 1) {
        throw new Error('cannot delete the last canvas in a project')
      }
      const snapshot = await this.canvases.read(canvasPath)
      await this.canvases.delete(
        canvasPath,
        canvasPath,
        input.baseRevision,
        `canvas:${input.mutationId}`,
      )
      if (current.kind === 'managed' && current.defaultCanvasPath === canvasPath) {
        const nextDefault = current.canvases.find(canvas => canvas.canvasPath !== canvasPath)!
        try {
          await this.writeManifest(projectPath, {
            schemaVersion: 1,
            name: current.name,
            defaultCanvasPath: posix.relative(projectPath, nextDefault.canvasPath),
          })
        } catch (error) {
          await this.canvases.create(
            canvasPath,
            `rollback:${input.mutationId}`,
            snapshot.document,
          ).catch(() => undefined)
          throw error
        }
      }
      return {
        canvasPath,
        deleted: true,
        projectRevision: (await this.inspect(projectPath)).projectRevision,
      }
    }))
  }

  async create(input: {
    projectPath: string
    name: string
    defaultCanvasPath?: string
    mutationId: string
  }): Promise<ProjectSummary> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const manifest = projectManifestSchema.parse({
      schemaVersion: 1,
      name: input.name,
      defaultCanvasPath: input.defaultCanvasPath ?? 'main.excalidraw',
    })
    this.workspace.validateCanvasPath(manifest.defaultCanvasPath)
    const fingerprint = digest(JSON.stringify({ operation: 'create', projectPath, manifest }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const target = this.workspace.absolute(projectPath)
      await this.requireMissing(target, projectPath)
      const parent = await this.prepareParent(projectPath)
      const temporaryName = `.${basename(projectPath)}-${randomUUID()}.tmp`
      const temporary = join(parent, temporaryName)
      const temporaryPath = relative(this.workspace.root, temporary).split(posix.sep).join('/')
      await mkdir(temporary, { mode: 0o700 })
      try {
        await this.writeFile(
          join(temporary, PROJECT_MANIFEST),
          `${JSON.stringify(manifest, null, 2)}\n`,
        )
        await this.canvases.create(
          projectFile(temporaryPath, manifest.defaultCanvasPath),
          `project:${input.mutationId}`,
          emptyCanvasDocument(),
        )
        await rename(temporary, target)
        await this.syncDirectory(parent)
      } catch (error) {
        await rm(temporary, { recursive: true, force: true })
        throw error
      }
      return this.inspect(projectPath)
    }))
  }

  async rename(input: {
    projectPath: string
    newProjectPath: string
    name?: string
    baseProjectRevision: string
    mutationId: string
  }): Promise<ProjectSummary> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const newProjectPath = this.workspace.validateProjectPath(input.newProjectPath)
    const fingerprint = digest(JSON.stringify({ operation: 'rename', ...input }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.requireManaged(projectPath, input.baseProjectRevision)
      const source = await this.workspace.existingDirectory(projectPath)
      const target = this.workspace.absolute(newProjectPath)
      await this.requireMissing(target, newProjectPath)
      const targetParent = await this.prepareParent(newProjectPath)
      await rename(source, target)
      try {
        if (input.name !== undefined && input.name !== current.name) {
          const manifest = projectManifestSchema.parse({
            schemaVersion: 1,
            name: input.name,
            defaultCanvasPath: relative(
              projectPath,
              current.defaultCanvasPath!,
            ).split(posix.sep).join('/'),
          })
          await this.replaceFile(
            join(target, PROJECT_MANIFEST),
            `${JSON.stringify(manifest, null, 2)}\n`,
          )
        }
        await this.syncDirectory(targetParent)
      } catch (error) {
        await rename(target, source).catch(() => undefined)
        throw error
      }
      return this.inspect(newProjectPath)
    }))
  }

  async duplicate(input: {
    projectPath: string
    newProjectPath: string
    name?: string
    baseProjectRevision: string
    mutationId: string
  }): Promise<ProjectSummary> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    const newProjectPath = this.workspace.validateProjectPath(input.newProjectPath)
    const fingerprint = digest(JSON.stringify({ operation: 'duplicate', ...input }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      const current = await this.requireManaged(projectPath, input.baseProjectRevision)
      const source = await this.workspace.existingDirectory(projectPath)
      const target = this.workspace.absolute(newProjectPath)
      await this.requireMissing(target, newProjectPath)
      const parent = await this.prepareParent(newProjectPath)
      const temporary = join(parent, `.${basename(newProjectPath)}-${randomUUID()}.tmp`)
      await mkdir(temporary, { mode: 0o700 })
      try {
        await this.copyDirectory(source, temporary)
        if (input.name !== undefined && input.name !== current.name) {
          const manifest = await this.readManifest(projectPath)
          await this.replaceFile(join(temporary, PROJECT_MANIFEST), `${JSON.stringify({
            ...manifest,
            name: input.name,
          }, null, 2)}\n`)
        }
        await rename(temporary, target)
        await this.syncDirectory(parent)
      } catch (error) {
        await rm(temporary, { recursive: true, force: true })
        throw error
      }
      return this.inspect(newProjectPath)
    }))
  }

  async delete(input: {
    projectPath: string
    confirmProjectPath: string
    baseProjectRevision: string
    mutationId: string
  }): Promise<{ projectPath: string; deleted: true }> {
    const projectPath = this.workspace.validateProjectPath(input.projectPath)
    if (input.confirmProjectPath !== projectPath) {
      throw new Error('confirmProjectPath must exactly match projectPath')
    }
    const fingerprint = digest(JSON.stringify({ operation: 'delete', ...input }))
    return this.mutate(input.mutationId, fingerprint, () => this.serialized(async () => {
      await this.requireManaged(projectPath, input.baseProjectRevision)
      const source = await this.workspace.existingDirectory(projectPath)
      const parent = dirname(source)
      const temporary = join(parent, `.${basename(projectPath)}-${randomUUID()}.delete`)
      await rename(source, temporary)
      try {
        await rm(temporary, { recursive: true })
        await this.syncDirectory(parent)
      } catch (error) {
        await rename(temporary, source).catch(() => undefined)
        throw error
      }
      return { projectPath, deleted: true }
    }))
  }

  private async requireManaged(
    projectPath: string,
    baseProjectRevision: string,
  ): Promise<ProjectSummary> {
    const current = await this.inspect(projectPath)
    if (current.kind !== 'managed') {
      throw new Error('directory lifecycle is only available for managed projects')
    }
    if (current.projectRevision !== baseProjectRevision) {
      throw new ProjectRevisionConflictError(current.projectRevision)
    }
    return current
  }

  private requireProjectRevision(current: ProjectSummary, expected: string): void {
    if (current.projectRevision !== expected) {
      throw new ProjectRevisionConflictError(current.projectRevision)
    }
  }

  private requireCanvas(current: ProjectSummary, canvasPath: string): void {
    if (!current.canvases.some(canvas => canvas.canvasPath === canvasPath)) {
      throw new Error(`canvas does not belong to project: ${canvasPath}`)
    }
  }

  private canvasInProject(projectPath: string, canvasPath: string): string {
    const safeCanvas = this.workspace.validateCanvasPath(canvasPath)
    const child = posix.relative(projectPath, safeCanvas)
    if (child === '' || child === '..' || child.startsWith('../')) {
      throw new Error(`canvas path must be inside projectPath: ${canvasPath}`)
    }
    return safeCanvas
  }

  private async readManifest(projectPath: string): Promise<ProjectManifest | null> {
    const path = projectFile(projectPath, PROJECT_MANIFEST)
    try {
      const file = await this.workspace.existingFile(path)
      const bytes = await readFile(file, 'utf8')
      return projectManifestSchema.parse(JSON.parse(bytes))
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
  }

  private async writeManifest(projectPath: string, manifest: ProjectManifest): Promise<void> {
    const parsed = projectManifestSchema.parse(manifest)
    this.workspace.validateCanvasPath(parsed.defaultCanvasPath)
    await this.replaceFile(
      await this.workspace.existingFile(projectFile(projectPath, PROJECT_MANIFEST)),
      `${JSON.stringify(parsed, null, 2)}\n`,
    )
  }

  private resolveCanvasPath(projectPath: string, canvasPath: string): string {
    const relativeCanvas = this.workspace.validateCanvasPath(canvasPath)
    const full = projectFile(projectPath, relativeCanvas)
    this.workspace.validateCanvasPath(full)
    return full
  }

  private async collectCanvases(directory: string, projectPath: string): Promise<string[]> {
    const canvases: string[] = []
    const visit = async (path: string, prefix: string): Promise<void> => {
      for (const entry of (await readdir(path, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) {
          throw new Error(`project contains a symlink: ${projectFile(projectPath, prefix + entry.name)}`)
        }
        if (entry.isDirectory()) {
          await visit(join(path, entry.name), `${prefix}${entry.name}/`)
        } else if (entry.isFile() && entry.name.endsWith('.excalidraw')) {
          canvases.push(projectFile(projectPath, `${prefix}${entry.name}`))
        }
      }
    }
    await visit(directory, '')
    return canvases
  }

  private async copyDirectory(source: string, target: string): Promise<void> {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      const info = await lstat(sourcePath)
      if (info.isSymbolicLink()) throw new Error(`project contains a symlink: ${entry.name}`)
      if (entry.isDirectory()) {
        await mkdir(targetPath, { mode: 0o700 })
        await this.copyDirectory(sourcePath, targetPath)
      } else if (entry.isFile() && info.nlink === 1) {
        const sourceHandle = await open(sourcePath, 'r')
        try {
          await this.writeFile(targetPath, await sourceHandle.readFile())
        } finally {
          await sourceHandle.close()
        }
      } else {
        throw new Error(`project contains an unsupported file: ${entry.name}`)
      }
    }
  }

  private async prepareParent(projectPath: string): Promise<string> {
    const parentPath = posix.dirname(projectPath)
    if (parentPath === '.') return this.workspace.root
    await this.workspace.prepareFile(`${parentPath}/.project-parent`)
    return this.workspace.existingDirectory(parentPath)
  }

  private async requireMissing(path: string, displayPath: string): Promise<void> {
    try {
      await lstat(path)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return
      throw error
    }
    throw new Error(`workspace path already exists: ${displayPath}`)
  }

  private async writeFile(path: string, bytes: string | Uint8Array): Promise<void> {
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async replaceFile(path: string, bytes: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    await this.writeFile(temporary, bytes)
    try {
      await rename(temporary, path)
      await this.syncDirectory(dirname(path))
    } finally {
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

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await action()
    } finally {
      release()
    }
  }

  private async mutate<T>(
    mutationId: string,
    fingerprint: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (mutationId.length === 0 || mutationId.length > 200) {
      throw new Error('mutationId must contain 1-200 characters')
    }
    const previous = this.mutations.get(mutationId)
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new MutationConflictError(mutationId)
      return previous.result as Promise<T>
    }
    const result = action().catch((error: unknown) => {
      this.mutations.delete(mutationId)
      throw error
    })
    this.mutations.set(mutationId, { fingerprint, result })
    return result
  }
}
