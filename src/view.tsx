import { App } from '@modelcontextprotocol/ext-apps'
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  restore,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import '@excalidraw/excalidraw/index.css'
import './styles.css'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  appStateForExternalUpdate,
  canvasContentSummary,
  editorStateAfterAction,
  editorStateAfterChange,
  externalUpdateAction,
  type EditorSyncState,
} from './view-state.js'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string
    __EXCALIDRAW_M0__?: {
      elementCount: () => number
      selectedIds: () => string[]
      displayMode: () => string
      syncState: () => EditorSyncState
      draftSummary: () => string | undefined
    }
  }
}

window.EXCALIDRAW_ASSET_PATH =
  'https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/'

const app = new App(
  { name: 'Excalidraw Editor M0', version: '0.0.0' },
  {},
  { strict: true },
)
const POLL_INTERVAL_MS = 5_000

type CanvasDocument = NonNullable<Parameters<typeof restore>[0]>

interface CanvasSnapshot {
  canvasPath: string
  revision: string
  document: CanvasDocument
}

let pendingCanvas: CanvasSnapshot | undefined
let renderCanvas: ((snapshot: CanvasSnapshot) => void) | undefined

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function errorMessage(result: CallToolResult): string {
  const text = result.content.find(block => block.type === 'text')
  return text?.type === 'text' ? text.text : 'Canvas tool failed'
}

function snapshotFromResult(
  result: CallToolResult,
  fallbackCanvasPath?: string,
): CanvasSnapshot {
  if (result.isError) throw new Error(errorMessage(result))
  const content = record(result.structuredContent)
  const nestedCanvas = record(content?.canvas)
  const source = nestedCanvas ?? content
  const document = record(source?.document)
  const canvasPath = source?.canvasPath ?? fallbackCanvasPath
  if (
    typeof canvasPath !== 'string'
    || typeof source?.revision !== 'string'
    || document?.type !== 'excalidraw'
    || !Array.isArray(document.elements)
    || record(document.appState) === undefined
    || record(document.files) === undefined
  ) {
    throw new Error('Canvas tool returned an invalid document')
  }
  return {
    canvasPath,
    revision: source.revision,
    document: document as CanvasDocument,
  }
}

async function pullSnapshot(
  canvasPath: string,
  currentRevision?: string,
): Promise<CanvasSnapshot | undefined> {
  const pulled = await app.callServerTool({
    name: 'pull_canvas',
    arguments: {
      canvasPath,
      ...(currentRevision === undefined ? {} : { currentRevision }),
    },
  })
  const content = record(pulled.structuredContent)
  if (!pulled.isError && content?.changed === false) return undefined
  return snapshotFromResult(pulled, canvasPath)
}

async function pullCanvas(result: CallToolResult): Promise<void> {
  if (result.isError) throw new Error(errorMessage(result))
  const opened = record(result.structuredContent)
  if (typeof opened?.canvasPath !== 'string' || typeof opened.revision !== 'string') {
    throw new Error('Tool result did not identify a canvas')
  }
  pendingCanvas = await pullSnapshot(opened.canvasPath)
  if (pendingCanvas === undefined) throw new Error('Canvas snapshot was not returned')
  renderCanvas?.(pendingCanvas)
}

function embeddedText(name: string, mimeType: string, text: string) {
  return app.downloadFile({
    contents: [{
      type: 'resource',
      resource: {
        uri: `file:///${name}`,
        mimeType,
        text,
      },
    }],
  })
}

async function embeddedBlob(name: string, mimeType: string, blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return app.downloadFile({
    contents: [{
      type: 'resource',
      resource: {
        uri: `file:///${name}`,
        mimeType,
        blob: btoa(binary),
      },
    }],
  })
}

function Canvas(): React.JSX.Element {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>()
  const [displayMode, setDisplayMode] = useState('inline')
  const [status, setStatus] = useState('Ready')
  const [canvas, setCanvas] = useState(pendingCanvas)
  const [revision, setRevision] = useState(canvas?.revision)
  const [syncState, setSyncState] = useState<EditorSyncState>('Loading')
  const syncStateRef = useRef<EditorSyncState>('Loading')
  const baseSummary = useRef('')
  const baseRevision = useRef('')
  const draft = useRef<CanvasDocument>()
  const setEditorState = (
    next: EditorSyncState | ((current: EditorSyncState) => EditorSyncState),
  ): void => {
    const value = typeof next === 'function' ? next(syncStateRef.current) : next
    syncStateRef.current = value
    setSyncState(value)
  }

  useEffect(() => {
    renderCanvas = setCanvas
    if (pendingCanvas !== undefined) setCanvas(pendingCanvas)
    return () => {
      renderCanvas = undefined
    }
  }, [])

  useEffect(() => {
    if (canvas === undefined) return
    baseSummary.current = canvasContentSummary(canvas.document)
    baseRevision.current = canvas.revision
    draft.current = canvas.document
    setRevision(canvas.revision)
    setEditorState('Clean')
  }, [canvas])

  useEffect(() => {
    if (api === undefined) return
    window.__EXCALIDRAW_M0__ = {
      elementCount: () => api.getSceneElements().length,
      selectedIds: () => Object.keys(api.getAppState().selectedElementIds),
      displayMode: () => displayMode,
      syncState: () => syncState,
      draftSummary: () => draft.current === undefined
        ? undefined
        : canvasContentSummary(draft.current),
    }
    return () => {
      delete window.__EXCALIDRAW_M0__
    }
  }, [api, displayMode, syncState])

  const onChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (canvas === undefined) return
    const document = JSON.parse(
      serializeAsJSON(elements, appState, files, 'local'),
    ) as CanvasDocument
    const summary = canvasContentSummary(document)
    draft.current = document
    setEditorState(current => editorStateAfterChange(
      current,
      baseSummary.current,
      summary,
    ))
  }

  const applySnapshot = (
    snapshot: CanvasSnapshot,
    preserveView = false,
  ): void => {
    const restored = restore(snapshot.document, null, null)
    const currentAppState = api?.getAppState()
    const appState = preserveView && currentAppState !== undefined
      ? appStateForExternalUpdate(
          restored.appState as unknown as Record<string, unknown>,
          currentAppState as unknown as Record<string, unknown>,
          restored.elements,
        ) as Partial<AppState>
      : restored.appState
    baseSummary.current = canvasContentSummary(snapshot.document)
    baseRevision.current = snapshot.revision
    draft.current = snapshot.document
    api?.updateScene({
      elements: restored.elements,
      appState,
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    if (restored.files !== undefined) api?.addFiles(Object.values(restored.files))
    setRevision(snapshot.revision)
    setEditorState('Clean')
    setStatus('Ready')
  }

  useEffect(() => {
    if (canvas === undefined || api === undefined) return
    let polling = false
    const timer = window.setInterval(() => {
      if (polling || externalUpdateAction(syncStateRef.current) === 'skip') return
      polling = true
      void pullSnapshot(canvas.canvasPath, baseRevision.current)
        .then(snapshot => {
          if (snapshot === undefined) {
            setStatus('Ready')
            return
          }
          const action = externalUpdateAction(syncStateRef.current)
          if (action === 'apply') {
            applySnapshot(snapshot, true)
          } else if (action === 'conflict') {
            setEditorState('Conflict')
            setStatus('External update detected')
          }
        })
        .catch(error => {
          setStatus(`Disconnected: ${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => {
          polling = false
        })
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [api, canvas?.canvasPath])

  const save = async (): Promise<void> => {
    if (canvas === undefined || draft.current === undefined || syncState !== 'Dirty') return
    setEditorState(current => editorStateAfterAction(current, 'save'))
    setStatus('Saving canvas')
    const saved = await app.callServerTool({
      name: 'push_canvas',
      arguments: {
        canvasPath: canvas.canvasPath,
        baseRevision: baseRevision.current,
        mutationId: crypto.randomUUID(),
        document: draft.current,
      },
    })
    if (saved.isError) {
      const message = errorMessage(saved)
      setStatus(message)
      setEditorState(message.includes('revision conflict') ? 'Conflict' : 'Dirty')
      return
    }
    const snapshot = snapshotFromResult(saved, canvas.canvasPath)
    baseSummary.current = canvasContentSummary(snapshot.document)
    baseRevision.current = snapshot.revision
    draft.current = snapshot.document
    setRevision(snapshot.revision)
    setEditorState(current => editorStateAfterAction(current, 'saved'))
    setStatus('Saved')
  }

  const reload = async (): Promise<void> => {
    if (canvas === undefined || syncState === 'Saving' || syncState === 'Loading') return
    setEditorState(current => current === 'Conflict'
      ? editorStateAfterAction(current, 'reload')
      : 'Loading')
    setStatus('Reloading canvas')
    try {
      const snapshot = await pullSnapshot(canvas.canvasPath)
      if (snapshot === undefined) throw new Error('Canvas snapshot was not returned')
      applySnapshot(snapshot)
    } catch (error) {
      setEditorState('Conflict')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const saveCopy = async (): Promise<void> => {
    if (canvas === undefined || draft.current === undefined || syncState !== 'Conflict') return
    const suggested = canvas.canvasPath.replace(
      /\.excalidraw$/,
      `-copy-${String(Date.now())}.excalidraw`,
    )
    const newCanvasPath = window.prompt('Save conflict draft as', suggested)?.trim()
    if (newCanvasPath === undefined || newCanvasPath === '') return
    setEditorState(current => editorStateAfterAction(current, 'save-copy'))
    setStatus('Saving canvas copy')
    const saved = await app.callServerTool({
      name: 'save_canvas_copy',
      arguments: {
        canvasPath: canvas.canvasPath,
        newCanvasPath,
        mutationId: crypto.randomUUID(),
        document: draft.current,
      },
    })
    if (saved.isError) {
      setEditorState('Conflict')
      setStatus(errorMessage(saved))
      return
    }
    const nested = record(record(saved.structuredContent)?.canvas)
    if (typeof nested?.revision !== 'string' || typeof nested.canvasPath !== 'string') {
      setEditorState('Conflict')
      setStatus('save_canvas_copy returned an invalid canvas')
      return
    }
    const snapshot = {
      canvasPath: nested.canvasPath,
      revision: nested.revision,
      document: draft.current,
    }
    setCanvas(snapshot)
    setEditorState(current => editorStateAfterAction(current, 'copy-saved'))
    setStatus('Copy saved')
  }

  const download = async (format: 'json' | 'svg' | 'png'): Promise<void> => {
    if (api === undefined) return
    setStatus(`Exporting ${format.toUpperCase()}`)
    const elements = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    if (format === 'json') {
      await embeddedText(
        'excalidraw-m0.excalidraw',
        'application/json',
        serializeAsJSON(elements, appState, files, 'local'),
      )
    } else if (format === 'svg') {
      const svg = await exportToSvg({
        elements,
        appState,
        files,
        skipInliningFonts: true,
      })
      await embeddedText(
        'excalidraw-m0.svg',
        'image/svg+xml',
        new XMLSerializer().serializeToString(svg),
      )
    } else {
      await embeddedBlob(
        'excalidraw-m0.png',
        'image/png',
        await exportToBlob({ elements, appState, files, mimeType: 'image/png' }),
      )
    }
    setStatus(`${format.toUpperCase()} ready`)
  }

  const toggleFullscreen = async (): Promise<void> => {
    const next = displayMode === 'fullscreen' ? 'inline' : 'fullscreen'
    const result = await app.requestDisplayMode({ mode: next })
    setDisplayMode(result.mode)
    requestAnimationFrame(() => api?.refresh())
  }

  const initialData = canvas === undefined
    ? {
        elements: convertToExcalidrawElements([{
          type: 'rectangle' as const,
          id: 'm0-seed',
          x: 160,
          y: 140,
          width: 260,
          height: 140,
          backgroundColor: '#a5d8ff',
          fillStyle: 'solid' as const,
          label: { text: 'Excalidraw M0' },
        }], { regenerateIds: false }),
        appState: {
          viewBackgroundColor: '#f8f9fa',
          currentItemFontFamily: 5 as const,
        },
        scrollToContent: true,
      }
    : restore(canvas.document, null, null)

  return (
    <main data-excalidraw-m0 data-display-mode={displayMode}>
      <nav className="m2-statusbar" aria-label="Canvas sync status">
        <span data-canvas-path title={canvas?.canvasPath}>
          {canvas?.canvasPath ?? 'No canvas'}
        </span>
        <output data-sync-state>{syncState === 'Clean' ? 'Saved' : syncState}</output>
        <button
          type="button"
          data-save
          disabled={syncState !== 'Dirty'}
          onClick={() => void save().catch(error => {
            setEditorState('Dirty')
            setStatus(error instanceof Error ? error.message : String(error))
          })}
        >
          Save
        </button>
        <button
          type="button"
          data-reload
          disabled={canvas === undefined || syncState === 'Loading' || syncState === 'Saving'}
          onClick={() => void reload()}
        >
          Reload
        </button>
        <button
          type="button"
          data-save-copy
          disabled={syncState !== 'Conflict'}
          onClick={() => void saveCopy().catch(error => {
            setEditorState('Conflict')
            setStatus(error instanceof Error ? error.message : String(error))
          })}
        >
          Save as copy
        </button>
      </nav>
      <div className="m0-canvas">
        <Excalidraw
          key={canvas?.canvasPath ?? 'm0-seed'}
          excalidrawAPI={setApi}
          initialData={initialData}
          langCode="en"
          name="Excalidraw M0"
          onChange={onChange}
        />
      </div>
      <nav className="m0-actions" aria-label="M0 canvas actions">
        <button
          type="button"
          data-fullscreen
          title="Toggle fullscreen"
          aria-label="Toggle fullscreen"
          onClick={() => void toggleFullscreen()}
        >
          {displayMode === 'fullscreen' ? '↙' : '↗'}
        </button>
        {(['json', 'svg', 'png'] as const).map(format => (
          <button
            type="button"
            key={format}
            data-export={format}
            title={`Export ${format.toUpperCase()}`}
            onClick={() => void download(format).catch(error => {
              setStatus(error instanceof Error ? error.message : String(error))
            })}
          >
            {format.toUpperCase()}
          </button>
        ))}
        <output data-m0-status title={revision}>{status}</output>
      </nav>
    </main>
  )
}

app.ontoolresult = result => {
  void pullCanvas(result).catch(error => {
    const status = document.querySelector<HTMLOutputElement>('[data-m0-status]')
    if (status !== null) {
      status.textContent = error instanceof Error ? error.message : String(error)
    }
  })
}
app.onhostcontextchanged = context => {
  const theme = context.theme
  if (theme !== undefined) document.documentElement.dataset.theme = theme
}
app.onteardown = async () => ({})

void app.connect().then(() => {
  const context = app.getHostContext()
  if (context?.displayMode !== undefined) {
    document.documentElement.dataset.displayMode = context.displayMode
  }
  if (context?.theme !== undefined) document.documentElement.dataset.theme = context.theme
  createRoot(document.getElementById('root')!).render(<Canvas />)
}).catch(error => {
  document.body.textContent = error instanceof Error ? error.message : String(error)
})
