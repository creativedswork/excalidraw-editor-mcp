export type EditorSyncState =
  | 'Loading'
  | 'Clean'
  | 'Dirty'
  | 'Saving'
  | 'Conflict'

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
