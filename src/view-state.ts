export type EditorSyncState =
  | 'Loading'
  | 'Clean'
  | 'Dirty'
  | 'Saving'
  | 'Conflict'

export type EditorAction =
  | 'save'
  | 'saved'
  | 'conflict'
  | 'reload'
  | 'reloaded'
  | 'save-copy'
  | 'copy-saved'

const PERSISTED_APP_STATE_DEFAULTS = {
  gridSize: 20,
  gridStep: 5,
  gridModeEnabled: false,
  viewBackgroundColor: '#ffffff',
} as const

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

export function canvasContentSummary(document: {
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}): string {
  const appState = Object.fromEntries(
    Object.entries(PERSISTED_APP_STATE_DEFAULTS).map(([key, fallback]) => [
      key,
      document.appState[key] ?? fallback,
    ]),
  )
  return JSON.stringify(stableValue({
    elements: document.elements,
    appState,
    files: document.files,
  }))
}

export function editorStateAfterChange(
  state: EditorSyncState,
  baseSummary: string,
  currentSummary: string,
): EditorSyncState {
  if (state === 'Loading' || state === 'Saving' || state === 'Conflict') return state
  return currentSummary === baseSummary ? 'Clean' : 'Dirty'
}

export function reconcileCanvasChange(
  state: EditorSyncState,
  baseSummary: string,
  currentSummary: string,
): { state: EditorSyncState; baseSummary: string } {
  if (state === 'Loading') {
    return { state, baseSummary: currentSummary }
  }
  return {
    state: editorStateAfterChange(state, baseSummary, currentSummary),
    baseSummary,
  }
}

export function editorStateAfterAction(
  state: EditorSyncState,
  action: EditorAction,
): EditorSyncState {
  if ((action === 'save' && state === 'Dirty')
    || (action === 'save-copy' && state === 'Conflict')) return 'Saving'
  if ((action === 'saved' || action === 'copy-saved') && state === 'Saving') return 'Clean'
  if (action === 'conflict' && state === 'Saving') return 'Conflict'
  if (action === 'reload' && state === 'Conflict') return 'Loading'
  if (action === 'reloaded' && state === 'Loading') return 'Clean'
  return state
}

export function externalUpdateAction(
  state: EditorSyncState,
): 'apply' | 'conflict' | 'skip' {
  if (state === 'Clean') return 'apply'
  if (state === 'Dirty' || state === 'Conflict') return 'conflict'
  return 'skip'
}

export function appStateForExternalUpdate(
  remote: Record<string, unknown>,
  current: Record<string, unknown>,
  elements: readonly { id: string; isDeleted?: boolean }[],
): Record<string, unknown> {
  const ids = new Set(elements.filter(element => !element.isDeleted).map(element => element.id))
  const selected = current.selectedElementIds
  const selectedElementIds = selected !== null && typeof selected === 'object'
    ? Object.fromEntries(
        Object.entries(selected).filter(([id, value]) => ids.has(id) && value === true),
      )
    : {}
  return {
    ...remote,
    selectedElementIds,
    ...(current.scrollX === undefined ? {} : { scrollX: current.scrollX }),
    ...(current.scrollY === undefined ? {} : { scrollY: current.scrollY }),
    ...(current.zoom === undefined ? {} : { zoom: current.zoom }),
  }
}

export function conflictCopyPath(canvasPath: string, timestamp = Date.now()): string {
  return canvasPath.replace(
    /\.excalidraw$/,
    `-copy-${String(timestamp)}.excalidraw`,
  )
}

export function savedCanvasModelContext(
  canvasPath: string,
  revision: string,
  selectedIds: readonly string[],
) {
  const separator = canvasPath.lastIndexOf('/')
  const projectPath = separator < 0 ? '.' : canvasPath.slice(0, separator)
  const selection = selectedIds.slice(0, 20).map(id => id.slice(0, 128))
  const structuredContent = {
    canvasPath: canvasPath.slice(0, 512),
    projectPath,
    revision,
    selection,
    state: 'saved',
  }
  return {
    content: [{
      type: 'text' as const,
      text: [
        `Canvas: ${structuredContent.canvasPath}`,
        `Project: ${structuredContent.projectPath}`,
        `Revision: ${revision}`,
        `Selection: ${selection.length === 0 ? '(none)' : selection.join(', ')}`,
        'State: saved',
      ].join('\n'),
    }],
    structuredContent,
  }
}

export function askAiMessage(
  state: EditorSyncState,
  canvasPath: string | undefined,
  revision: string | undefined,
  selectedIds: readonly string[],
  userText: string,
) {
  const request = userText.trim().slice(0, 1_000)
  if (
    state !== 'Clean'
    || canvasPath === undefined
    || revision === undefined
    || request.length === 0
  ) return undefined
  const selection = selectedIds.slice(0, 20).map(id => id.slice(0, 128))
  return {
    role: 'user' as const,
    content: [{
      type: 'text' as const,
      text: [
        `请基于 ${canvasPath.slice(0, 512)} 的 revision ${revision}，`,
        `调整当前选中的 ${selection.length === 0 ? '(none)' : selection.join(', ')}：${request}`,
      ].join('\n'),
    }],
  }
}
