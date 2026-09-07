import { App } from '@modelcontextprotocol/ext-apps'
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  FONT_FAMILY,
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
  askAiMessage,
  canvasContentSummary,
  conflictCopyPath,
  editorStateAfterAction,
  exportFilename,
  externalUpdateAction,
  reconcileCanvasChange,
  savedCanvasModelContext,
  type EditorSyncState,
  type ExportFormat,
} from './view-state.js'

declare global {
  interface Window {
    __EXCALIDRAW_M0__?: {
      elementCount: () => number
      selectedIds: () => string[]
      displayMode: () => string
      syncState: () => EditorSyncState
      draftSummary: () => string | undefined
      revision: () => string | undefined
      instanceId: () => string
      viewport: () => { scrollX: number; scrollY: number; zoom: number }
      modelContextRevision: () => string | undefined
    }
  }
}

const app = new App(
  { name: 'Excalidraw Editor', version: '0.0.0' },
  { availableDisplayModes: ['inline', 'fullscreen'] },
  { strict: true },
)
const POLL_INTERVAL_MS = 5_000
const INLINE_HEIGHT = 480

type CanvasDocument = NonNullable<Parameters<typeof restore>[0]>

interface CanvasSnapshot {
  canvasPath: string
  revision: string
  document: CanvasDocument
}

interface CanvasCaptureCommand {
  commandId: string
  canvasPath: string
  revision: string
  maxWidth: number
  maxHeight: number
  expiresAt: string
}

function normalizedCanvasDocument(document: CanvasDocument): CanvasDocument {
  const restored = restore(document, null, null)
  return JSON.parse(serializeAsJSON(
    restored.elements,
    restored.appState,
    restored.files ?? {},
    'local',
  )) as CanvasDocument
}

let pendingCanvas: CanvasSnapshot | undefined
let renderCanvas: ((snapshot: CanvasSnapshot) => void) | undefined
let runCanvasCapture: ((command: CanvasCaptureCommand) => void) | undefined

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

function captureCommandFromResult(result: CallToolResult): CanvasCaptureCommand | undefined {
  const capture = record(record(result.structuredContent)?.capture)
  if (capture === undefined) return undefined
  if (
    typeof capture.commandId !== 'string'
    || typeof capture.canvasPath !== 'string'
    || typeof capture.revision !== 'string'
    || typeof capture.maxWidth !== 'number'
    || typeof capture.maxHeight !== 'number'
    || typeof capture.expiresAt !== 'string'
  ) {
    throw new Error('Canvas tool returned an invalid capture command')
  }
  return capture as unknown as CanvasCaptureCommand
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
  const capture = captureCommandFromResult(pulled)
  if (capture !== undefined) runCanvasCapture?.(capture)
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

async function downloadScene(
  format: ExportFormat,
  name: string,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): Promise<void> {
  if (format === 'json') {
    const downloaded = await embeddedText(
      name,
      'application/json',
      serializeAsJSON(elements, appState, files, 'local'),
    )
    if (downloaded.isError) throw new Error('Host rejected the canvas download')
    return
  }
  if (format === 'svg') {
    const svg = await exportToSvg({
      elements,
      appState,
      files,
      skipInliningFonts: true,
    })
    const downloaded = await embeddedText(
      name,
      'image/svg+xml',
      new XMLSerializer().serializeToString(svg),
    )
    if (downloaded.isError) throw new Error('Host rejected the canvas download')
    return
  }
  const blob = await exportToBlob({
    elements,
    appState,
    files,
    mimeType: 'image/png',
  })
  const downloaded = await embeddedBlob(name, 'image/png', blob)
  if (downloaded.isError) throw new Error('Host rejected the canvas download')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length < 24
    || bytes[0] !== 137
    || bytes[1] !== 80
    || bytes[2] !== 78
    || bytes[3] !== 71
  ) {
    throw new Error('Excalidraw renderer did not return a PNG')
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  }
}

function fontString(element: Extract<ExcalidrawElement, { type: 'text' }>): string {
  const family = Object.entries(FONT_FAMILY)
    .find(([, value]) => value === element.fontFamily)?.[0] ?? 'Segoe UI Emoji'
  const fallbacks = element.fontFamily === FONT_FAMILY.Excalifont
    ? ', Xiaolai, Segoe UI Emoji'
    : ', Segoe UI Emoji'
  return `${element.fontSize}px ${family}${fallbacks}`
}

function textLayoutDiagnostics(elements: readonly ExcalidrawElement[]) {
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) throw new Error('Canvas text measurement is unavailable')
  const textElements = elements.filter(
    (element): element is Extract<ExcalidrawElement, { type: 'text' }> => (
      element.type === 'text' && !element.isDeleted
    ),
  )
  const diagnostics = textElements.slice(0, 100).map(element => {
    context.font = fontString(element)
    const measuredWidth = Math.max(
      0,
      ...element.text.split('\n').map(line => context.measureText(line).width),
    )
    const overflow = Math.max(0, measuredWidth - element.width)
    return {
      elementId: element.id,
      storedWidth: Math.round(element.width * 100) / 100,
      measuredWidth: Math.round(measuredWidth * 100) / 100,
      overflow: Math.round(overflow * 100) / 100,
      clipped: element.containerId === null && element.autoResize && overflow > 0.5,
    }
  })
  return {
    textDiagnostics: diagnostics,
    truncatedDiagnostics: textElements.length > diagnostics.length,
  }
}

function Canvas(): React.JSX.Element {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>()
  const [displayMode, setDisplayMode] = useState('inline')
  const [status, setStatus] = useState('Ready')
  const [canvas, setCanvas] = useState(pendingCanvas)
  const [revision, setRevision] = useState(canvas?.revision)
  const [syncState, setSyncState] = useState<EditorSyncState>('Loading')
  const [askText, setAskText] = useState('')
  const [asking, setAsking] = useState(false)
  const syncStateRef = useRef<EditorSyncState>('Loading')
  const baseSummary = useRef('')
  const baseRevision = useRef('')
  const draft = useRef<CanvasDocument>()
  const apiRef = useRef<ExcalidrawImperativeAPI>()
  const settleFrame = useRef<number>()
  const instanceId = useRef(crypto.randomUUID())
  const modelContextRevision = useRef<string>()
  const handledCaptureIds = useRef(new Set<string>())
  const setEditorState = (
    next: EditorSyncState | ((current: EditorSyncState) => EditorSyncState),
  ): void => {
    const value = typeof next === 'function' ? next(syncStateRef.current) : next
    syncStateRef.current = value
    setSyncState(value)
  }
  const scheduleProgrammaticSettled = (): void => {
    if (settleFrame.current !== undefined) {
      window.cancelAnimationFrame(settleFrame.current)
    }
    settleFrame.current = window.requestAnimationFrame(() => {
      settleFrame.current = undefined
      if (syncStateRef.current !== 'Loading') return
      const currentApi = apiRef.current
      if (currentApi === undefined) {
        scheduleProgrammaticSettled()
        return
      }
      const document = JSON.parse(serializeAsJSON(
        currentApi.getSceneElements(),
        currentApi.getAppState(),
        currentApi.getFiles(),
        'local',
      )) as CanvasDocument
      baseSummary.current = canvasContentSummary(document)
      draft.current = document
      setEditorState('Clean')
    })
  }
  const beginProgrammaticChange = (): void => {
    if (settleFrame.current !== undefined) {
      window.cancelAnimationFrame(settleFrame.current)
      settleFrame.current = undefined
    }
    setEditorState('Loading')
  }

  useEffect(() => {
    renderCanvas = snapshot => {
      beginProgrammaticChange()
      setCanvas(snapshot)
    }
    if (pendingCanvas !== undefined) setCanvas(pendingCanvas)
    return () => {
      renderCanvas = undefined
    }
  }, [])

  useEffect(() => {
    if (canvas === undefined) return
    const document = normalizedCanvasDocument(canvas.document)
    baseSummary.current = canvasContentSummary(document)
    draft.current = document
    baseRevision.current = canvas.revision
    setRevision(canvas.revision)
    scheduleProgrammaticSettled()
  }, [canvas])

  useEffect(() => () => {
    if (settleFrame.current !== undefined) {
      window.cancelAnimationFrame(settleFrame.current)
    }
  }, [])

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
      revision: () => revision,
      instanceId: () => instanceId.current,
      viewport: () => {
        const appState = api.getAppState()
        return {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
        }
      },
      modelContextRevision: () => modelContextRevision.current,
    }
    return () => {
      delete window.__EXCALIDRAW_M0__
    }
  }, [api, displayMode, revision, syncState])

  useEffect(() => {
    if (api === undefined || canvas === undefined) return
    runCanvasCapture = command => {
      if (handledCaptureIds.current.has(command.commandId)) return
      handledCaptureIds.current.add(command.commandId)
      void (async () => {
        try {
          if (
            command.canvasPath !== canvas.canvasPath
            || command.revision !== baseRevision.current
            || syncStateRef.current !== 'Clean'
            || Date.now() > Date.parse(command.expiresAt)
          ) {
            throw new Error('Canvas View is not clean at the requested saved revision')
          }
          await document.fonts.ready
          const elements = api.getSceneElements()
          const blob = await exportToBlob({
            elements,
            appState: api.getAppState(),
            files: api.getFiles(),
            mimeType: 'image/png',
            getDimensions: (width: number, height: number) => {
              const scale = Math.min(
                command.maxWidth / width,
                command.maxHeight / height,
                1,
              )
              return {
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale)),
                scale,
              }
            },
          })
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const data = bytesToBase64(bytes)
          if (data.length > 512 * 1024) {
            throw new Error('Canvas Harness PNG exceeds the 524288-byte limit')
          }
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            byte => byte.toString(16).padStart(2, '0'),
          ).join('')
          const reported = await app.callServerTool({
            name: 'report_canvas_capture',
            arguments: {
              commandId: command.commandId,
              outcome: {
                status: 'succeeded',
                evidence: {
                  evidenceId: crypto.randomUUID(),
                  digest,
                  mimeType: 'image/png',
                  data,
                  ...pngDimensions(bytes),
                  capturedAt: new Date().toISOString(),
                  ...textLayoutDiagnostics(elements),
                },
              },
            },
          })
          if (reported.isError) throw new Error(errorMessage(reported))
          setStatus('Canvas captured for AI')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const reported = await app.callServerTool({
            name: 'report_canvas_capture',
            arguments: {
              commandId: command.commandId,
              outcome: { status: 'failed', message },
            },
          })
          setStatus(reported.isError ? errorMessage(reported) : message)
        }
      })()
    }
    return () => {
      runCanvasCapture = undefined
    }
  }, [api, canvas?.canvasPath])

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
    const reconciled = reconcileCanvasChange(
      syncStateRef.current,
      baseSummary.current,
      summary,
    )
    if (reconciled.state === 'Loading') {
      scheduleProgrammaticSettled()
    }
    baseSummary.current = reconciled.baseSummary
    draft.current = document
    setEditorState(reconciled.state)
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
    const document = normalizedCanvasDocument(snapshot.document)
    beginProgrammaticChange()
    baseSummary.current = canvasContentSummary(document)
    baseRevision.current = snapshot.revision
    draft.current = document
    if (api !== undefined) {
      api.updateScene({
        elements: restored.elements,
        appState,
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    }
    if (restored.files !== undefined) api?.addFiles(Object.values(restored.files))
    setRevision(snapshot.revision)
    scheduleProgrammaticSettled()
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

  const publishSavedContext = async (
    canvasPath: string,
    savedRevision: string,
  ): Promise<void> => {
    if (app.getHostCapabilities()?.updateModelContext === undefined) return
    const selectedIds = api === undefined
      ? []
      : Object.keys(api.getAppState().selectedElementIds)
    try {
      await app.updateModelContext(
        savedCanvasModelContext(canvasPath, savedRevision, selectedIds),
      )
      modelContextRevision.current = savedRevision
    } catch (error) {
      setStatus(`Saved; context unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`)
    }
  }

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
    await publishSavedContext(snapshot.canvasPath, snapshot.revision)
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
    const newCanvasPath = conflictCopyPath(canvas.canvasPath)
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
    beginProgrammaticChange()
    setCanvas(snapshot)
    setStatus('Copy saved')
    await publishSavedContext(snapshot.canvasPath, snapshot.revision)
  }

  const askAi = async (): Promise<void> => {
    const message = askAiMessage(
      syncStateRef.current,
      canvas?.canvasPath,
      revision,
      api === undefined ? [] : Object.keys(api.getAppState().selectedElementIds),
      askText,
    )
    if (message === undefined) {
      setStatus(syncStateRef.current === 'Clean'
        ? 'Enter an AI request'
        : 'Save before asking AI')
      return
    }
    setAsking(true)
    setStatus('Sending AI request')
    try {
      const sent = await app.sendMessage(message)
      if (sent.isError) throw new Error('Host rejected the AI request')
      setAskText('')
      setStatus('AI request sent')
    } finally {
      setAsking(false)
    }
  }

  const download = async (format: ExportFormat): Promise<void> => {
    if (api === undefined) return
    setStatus(`Exporting ${format.toUpperCase()}`)
    await downloadScene(
      format,
      exportFilename(canvas?.canvasPath ?? 'canvas.excalidraw', format),
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
    )
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
        <input
          type="text"
          data-ask-ai-input
          aria-label="Ask AI request"
          placeholder="Ask AI..."
          maxLength={1_000}
          value={askText}
          onChange={event => setAskText(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void askAi().catch(error => {
                setStatus(error instanceof Error ? error.message : String(error))
              })
            }
          }}
        />
        <button
          type="button"
          data-ask-ai
          disabled={syncState !== 'Clean' || askText.trim() === '' || asking}
          onClick={() => void askAi().catch(error => {
            setStatus(error instanceof Error ? error.message : String(error))
          })}
        >
          Ask AI
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
          excalidrawAPI={(value: ExcalidrawImperativeAPI) => {
            apiRef.current = value
            setApi(value)
          }}
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
  void app.sendSizeChanged({ height: INLINE_HEIGHT })
  createRoot(document.getElementById('root')!).render(<Canvas />)
}).catch(error => {
  document.body.textContent = error instanceof Error ? error.message : String(error)
})
