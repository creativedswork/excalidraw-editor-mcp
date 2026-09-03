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

const PERSISTED_APP_STATE_KEYS = [
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'viewBackgroundColor',
] as const

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
  const appState = Object.fromEntries(PERSISTED_APP_STATE_KEYS.flatMap(key => (
    document.appState[key] === undefined ? [] : [[key, document.appState[key]]]
  )))
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
