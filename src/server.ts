#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  SafeWorkspace,
  type CanvasDocument,
  canvasDocumentSchema,
} from './canvas-store.js'
import {
  ProjectStore,
  type CanvasSummary,
  type ProjectSummary,
} from './project-store.js'

const RESOURCE_URI = 'ui://excalidraw-editor/app'
const DSH_WORKSPACE_META_KEY = 'ai.deepseek.dsh/workspace'
const DSH_SESSION_META_KEY = 'ai.deepseek.dsh/session'
const FONT_ORIGIN = 'https://esm.sh'
const FONT_PATH =
  `${FONT_ORIGIN}/@excalidraw/excalidraw@0.18.0/dist/prod/fonts/`
const CSP = {
  connectDomains: [] as string[],
  resourceDomains: [FONT_ORIGIN],
  frameDomains: [] as string[],
  baseUriDomains: [] as string[],
}

function viewHtml(script: string, css: string): string {
  const selfContainedCss = css.replaceAll('./fonts/', FONT_PATH)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Excalidraw M0</title>
  <style>${selfContainedCss.replaceAll('</style', '<\\/style')}</style>
</head>
<body>
  <div id="root"></div>
  <script>${script.replaceAll('</script', '<\\/script')}</script>
</body>
</html>`
}

const pathSchema = z.string().min(1).max(512)
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const mutationSchema = z.string().min(1).max(200)
const bindingSchema = z.object({
  workspaceRoot: z.string().min(1),
  projectPath: pathSchema,
  canvasPath: pathSchema,
})
const bindingsDirectory = process.env.EXCALIDRAW_BINDINGS_DIR
  ?? join(tmpdir(), 'excalidraw-editor-mcp-bindings')
const stores = new Map<string, Promise<ProjectStore>>()
interface CanvasBinding {
  store: ProjectStore
  projectPath: string
  canvasPath: string
}

const bindings = new Map<string, CanvasBinding>()

function result(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  }
}

function workspacePath(meta: Record<string, unknown> | undefined): string {
  const parsed = z.object({ cwd: z.string().min(1) }).safeParse(
    meta?.[DSH_WORKSPACE_META_KEY],
  )
  if (parsed.success) return parsed.data.cwd
  throw new Error('current DSH workspace is unavailable')
}

function sessionId(meta: Record<string, unknown> | undefined): string | undefined {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(
    meta?.[DSH_SESSION_META_KEY],
  )
  return parsed.success ? parsed.data.sessionId : undefined
}

async function storeForWorkspace(cwd: string): Promise<ProjectStore> {
  let store = stores.get(cwd)
  if (store === undefined) {
    store = SafeWorkspace.open(cwd)
      .then(workspace => new ProjectStore(workspace))
    stores.set(cwd, store)
  }
  return store
}

async function projectStore(meta: Record<string, unknown> | undefined): Promise<ProjectStore> {
  return storeForWorkspace(workspacePath(meta))
}

function bindingPath(id: string): string {
  const key = createHash('sha256').update(id).digest('hex')
  return join(bindingsDirectory, `${key}.json`)
}

async function persistBinding(id: string, binding: CanvasBinding): Promise<void> {
  await mkdir(bindingsDirectory, { recursive: true, mode: 0o700 })
  const path = bindingPath(id)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({
    workspaceRoot: binding.store.workspace.root,
    projectPath: binding.projectPath,
    canvasPath: binding.canvasPath,
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

async function bindCanvas(
  meta: Record<string, unknown> | undefined,
  store: ProjectStore,
  projectPath: string,
  canvasPath: string,
): Promise<void> {
  const id = sessionId(meta)
  if (id === undefined) return
  const binding = { store, projectPath, canvasPath }
  await persistBinding(id, binding)
  bindings.set(id, binding)
}

async function boundCanvas(
  meta: Record<string, unknown> | undefined,
  canvasPath: string,
): Promise<CanvasBinding> {
  const id = sessionId(meta)
  let binding = id === undefined ? undefined : bindings.get(id)
  if (binding === undefined && id !== undefined) {
    try {
      const stored = bindingSchema.parse(JSON.parse(
        await readFile(bindingPath(id), 'utf8'),
      ))
      binding = {
        ...stored,
        store: await storeForWorkspace(stored.workspaceRoot),
      }
      bindings.set(id, binding)
    } catch {
      // Report the same bounded error for absent, stale, or invalid records.
    }
  }
  if (binding === undefined || binding.canvasPath !== canvasPath) {
    throw new Error('canvas is not bound to this app session')
  }
  return binding
}

async function bindProject(
  meta: Record<string, unknown> | undefined,
  store: ProjectStore,
  project: ProjectSummary,
): Promise<CanvasSummary> {
  if (project.defaultCanvasPath === null) throw new Error('project has no default canvas')
  const canvas = project.canvases.find(
    candidate => candidate.canvasPath === project.defaultCanvasPath,
  )
  if (canvas === undefined) throw new Error('project default canvas is unavailable')
  await bindCanvas(meta, store, project.projectPath, canvas.canvasPath)
  return canvas
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'excalidraw-editor-mcp',
    version: '0.0.0',
  })

  registerAppTool(server, 'list_projects', {
    title: 'List Excalidraw projects',
    description: 'Lists managed and discovered Excalidraw projects in the current Workspace.',
    inputSchema: {},
    _meta: { ui: { visibility: ['model'] } },
  }, async (_, { _meta }) => result('Listed Excalidraw projects.', {
    projects: await (await projectStore(_meta)).list(),
  }))

  registerAppTool(server, 'create_project', {
    title: 'Create Excalidraw project',
    description: 'Creates a managed project and opens its default canvas.',
    inputSchema: {
      projectPath: pathSchema,
      name: z.string().trim().min(1).max(200),
      defaultCanvasPath: pathSchema.optional(),
      mutationId: mutationSchema,
    },
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['model'],
      },
    },
  }, async (input, { _meta }) => {
    const store = await projectStore(_meta)
    const project = await store.create(input)
    const canvas = await bindProject(_meta, store, project)
    return result('Created Excalidraw project.', { project, ...canvas })
  })

  registerAppTool(server, 'open_project', {
    title: 'Open Excalidraw project',
    description: 'Opens the default canvas of an existing Excalidraw project.',
    inputSchema: { projectPath: pathSchema },
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['model'],
      },
    },
  }, async ({ projectPath }, { _meta }) => {
    const store = await projectStore(_meta)
    const project = await store.inspect(projectPath)
    const canvas = await bindProject(_meta, store, project)
    return result('Opened Excalidraw project.', { project, ...canvas })
  })

  registerAppTool(server, 'inspect_project', {
    title: 'Inspect Excalidraw project',
    description: 'Returns a bounded project and canvas summary.',
    inputSchema: { projectPath: pathSchema },
    _meta: { ui: { visibility: ['model'] } },
  }, async ({ projectPath }, { _meta }) => result(
    'Inspected Excalidraw project.',
    { project: await (await projectStore(_meta)).inspect(projectPath) },
  ))

  registerAppTool(server, 'rename_project', {
    title: 'Rename Excalidraw project',
    description: 'Renames a managed project when its project revision is current.',
    inputSchema: {
      projectPath: pathSchema,
      newProjectPath: pathSchema,
      name: z.string().trim().min(1).max(200).optional(),
      baseProjectRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Renamed Excalidraw project.',
    { project: await (await projectStore(_meta)).rename(input) },
  ))

  registerAppTool(server, 'duplicate_project', {
    title: 'Duplicate Excalidraw project',
    description: 'Copies a managed project when its project revision is current.',
    inputSchema: {
      projectPath: pathSchema,
      newProjectPath: pathSchema,
      name: z.string().trim().min(1).max(200).optional(),
      baseProjectRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Duplicated Excalidraw project.',
    { project: await (await projectStore(_meta)).duplicate(input) },
  ))

  registerAppTool(server, 'delete_project', {
    title: 'Delete Excalidraw project',
    description: 'Deletes a managed project after exact path and revision confirmation.',
    inputSchema: {
      projectPath: pathSchema,
      confirmProjectPath: pathSchema,
      baseProjectRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Deleted Excalidraw project.',
    await (await projectStore(_meta)).delete(input),
  ))

  registerAppTool(server, 'list_canvases', {
    title: 'List Excalidraw canvases',
    description: 'Lists canvases in one project.',
    inputSchema: { projectPath: pathSchema },
    _meta: { ui: { visibility: ['model'] } },
  }, async ({ projectPath }, { _meta }) => result('Listed Excalidraw canvases.', {
    canvases: await (await projectStore(_meta)).listCanvases(projectPath),
  }))

  registerAppTool(server, 'create_canvas', {
    title: 'Create Excalidraw canvas',
    description: 'Creates and opens an empty canvas inside one project.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
      baseProjectRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['model'],
      },
    },
  }, async (input, { _meta }) => {
    const store = await projectStore(_meta)
    const created = await store.createCanvas(input)
    await bindCanvas(_meta, store, input.projectPath, created.canvas.canvasPath)
    return result('Created Excalidraw canvas.', {
      ...created,
      canvasPath: created.canvas.canvasPath,
      revision: created.canvas.revision,
    })
  })

  registerAppTool(server, 'open_canvas', {
    title: 'Open Excalidraw canvas',
    description: 'Opens one canvas inside its project.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
    },
    _meta: {
      ui: {
        resourceUri: RESOURCE_URI,
        visibility: ['model'],
      },
    },
  }, async ({ projectPath, canvasPath }, { _meta }) => {
    const store = await projectStore(_meta)
    const canvas = await store.openCanvas(projectPath, canvasPath)
    await bindCanvas(_meta, store, projectPath, canvas.canvasPath)
    return result('Opened Excalidraw canvas.', {
      canvasPath: canvas.canvasPath,
      revision: canvas.revision,
    })
  })

  registerAppTool(server, 'inspect_canvas', {
    title: 'Inspect Excalidraw canvas',
    description: 'Returns bounded metadata and optionally the standard document.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
      includeDocument: z.boolean().default(false),
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async ({ projectPath, canvasPath, includeDocument }, { _meta }) => {
    const canvas = await (await projectStore(_meta)).openCanvas(projectPath, canvasPath)
    return result('Inspected Excalidraw canvas.', {
      canvasPath: canvas.canvasPath,
      revision: canvas.revision,
      elementCount: canvas.document.elements.length,
      source: canvas.document.source,
      ...(includeDocument ? { document: canvas.document } : {}),
    })
  })

  registerAppTool(server, 'check_canvas', {
    title: 'Check Excalidraw canvas',
    description: 'Checks that a canvas is a valid bounded standard document.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async ({ projectPath, canvasPath }, { _meta }) => result(
    'Checked Excalidraw canvas.',
    await (await projectStore(_meta)).checkCanvas(projectPath, canvasPath),
  ))

  registerAppTool(server, 'rename_canvas', {
    title: 'Rename Excalidraw canvas',
    description: 'Renames a canvas inside the same managed project.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
      newCanvasPath: pathSchema,
      baseRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Renamed Excalidraw canvas.',
    { ...(await (await projectStore(_meta)).renameCanvas(input)) },
  ))

  registerAppTool(server, 'duplicate_canvas', {
    title: 'Duplicate Excalidraw canvas',
    description: 'Copies a canvas inside the same project.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
      newCanvasPath: pathSchema,
      baseRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Duplicated Excalidraw canvas.',
    { ...(await (await projectStore(_meta)).duplicateCanvas(input)) },
  ))

  registerAppTool(server, 'delete_canvas', {
    title: 'Delete Excalidraw canvas',
    description: 'Deletes a canvas after exact path and revision confirmation.',
    inputSchema: {
      projectPath: pathSchema,
      canvasPath: pathSchema,
      confirmCanvasPath: pathSchema,
      baseRevision: revisionSchema,
      mutationId: mutationSchema,
    },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input, { _meta }) => result(
    'Deleted Excalidraw canvas.',
    await (await projectStore(_meta)).deleteCanvas(input),
  ))

  registerAppTool(server, 'pull_canvas', {
    title: 'Pull Excalidraw canvas',
    description: 'Returns the bound document when the app revision is stale.',
    inputSchema: {
      canvasPath: pathSchema,
      currentRevision: revisionSchema.optional(),
    },
    _meta: { ui: { visibility: ['app'] } },
  }, async ({ canvasPath, currentRevision }, { _meta }) => {
    const binding = await boundCanvas(_meta, canvasPath)
    const canvas = await binding.store.openCanvas(binding.projectPath, canvasPath)
    const changed = canvas.revision !== currentRevision
    return result(changed ? 'Canvas snapshot returned.' : 'Canvas is current.', {
      canvasPath,
      changed,
      revision: canvas.revision,
      ...(changed ? { document: canvas.document } : {}),
    })
  })

  registerAppTool(server, 'push_canvas', {
    title: 'Save Excalidraw canvas',
    description: 'Saves the bound standard document with compare-and-swap.',
    inputSchema: {
      canvasPath: pathSchema,
      baseRevision: revisionSchema,
      mutationId: mutationSchema,
      document: canvasDocumentSchema,
    },
    _meta: { ui: { visibility: ['app'] } },
  }, async ({ canvasPath, baseRevision, mutationId, document }, { _meta }) => {
    const binding = await boundCanvas(_meta, canvasPath)
    const canvas = await binding.store.canvases.write(
      canvasPath,
      baseRevision,
      mutationId,
      document as CanvasDocument,
    )
    return result('Saved Excalidraw canvas.', { canvas })
  })

  registerAppTool(server, 'save_canvas_copy', {
    title: 'Save Excalidraw canvas copy',
    description: 'Saves the bound draft as a new canvas in the same project.',
    inputSchema: {
      canvasPath: pathSchema,
      newCanvasPath: pathSchema,
      mutationId: mutationSchema,
      document: canvasDocumentSchema,
    },
    _meta: { ui: { visibility: ['app'] } },
  }, async ({ canvasPath, newCanvasPath, mutationId, document }, { _meta }) => {
    const binding = await boundCanvas(_meta, canvasPath)
    const project = await binding.store.inspect(binding.projectPath)
    const created = await binding.store.createCanvas({
      projectPath: binding.projectPath,
      canvasPath: newCanvasPath,
      baseProjectRevision: project.projectRevision,
      mutationId,
      document: document as CanvasDocument,
    })
    await bindCanvas(_meta, binding.store, binding.projectPath, created.canvas.canvasPath)
    return result('Saved Excalidraw canvas copy.', { ...created })
  })

  registerAppResource(server, 'excalidraw-editor-view', RESOURCE_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        csp: CSP,
        prefersBorder: false,
      },
    },
  }, async (): Promise<ReadResourceResult> => {
    const [script, css] = await Promise.all([
      readFile(new URL('./view.js', import.meta.url), 'utf8'),
      readFile(new URL('./style.css', import.meta.url), 'utf8'),
    ])
    return {
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: viewHtml(script, css),
        _meta: {
          ui: {
            csp: CSP,
            prefersBorder: false,
          },
        },
      }],
    }
  })

  return server
}

await createServer().connect(new StdioServerTransport())
