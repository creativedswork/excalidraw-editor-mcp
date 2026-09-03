import type { CanvasDocument } from './canvas-store.js'

const MAX_INSPECT_TEXT = 500
const DEFAULT_INSPECT_LIMIT = 50

type ElementRecord = Record<string, unknown>

export interface InspectCanvasOptions {
  ids?: string[]
  types?: string[]
  text?: string
  cursor?: string
  limit?: number
}

function record(value: unknown): ElementRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ElementRecord
    : undefined
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function truncatedText(value: unknown): {
  text: string
  truncated: boolean
} | undefined {
  const text = string(value)
  if (text === undefined) return undefined
  return {
    text: text.slice(0, MAX_INSPECT_TEXT),
    truncated: text.length > MAX_INSPECT_TEXT,
  }
}

function binding(value: unknown): ElementRecord | undefined {
  const source = record(value)
  const elementId = string(source?.elementId)
  if (source === undefined || elementId === undefined) return undefined
  return {
    elementId,
    ...(typeof source.focus === 'number' ? { focus: source.focus } : {}),
    ...(typeof source.gap === 'number' ? { gap: source.gap } : {}),
    ...(Array.isArray(source.fixedPoint) ? { fixedPoint: source.fixedPoint } : {}),
  }
}

function inspectSignature(options: InspectCanvasOptions): string {
  return JSON.stringify({
    ids: [...(options.ids ?? [])].sort(),
    types: [...(options.types ?? [])].sort(),
    text: options.text?.toLocaleLowerCase() ?? '',
  })
}

function cursorOffset(cursor: string | undefined, signature: string): number {
  if (cursor === undefined) return 0
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { offset?: unknown; signature?: unknown }
    if (
      !Number.isSafeInteger(parsed.offset)
      || (parsed.offset as number) < 0
      || parsed.signature !== signature
    ) {
      throw new Error()
    }
    return parsed.offset as number
  } catch {
    throw new Error('invalid inspect cursor')
  }
}

function nextCursor(offset: number, signature: string): string {
  return Buffer.from(JSON.stringify({ offset, signature })).toString('base64url')
}

function semanticElement(
  element: ElementRecord,
  label: ElementRecord | undefined,
): Record<string, unknown> {
  const labelText = truncatedText(label?.text ?? label?.originalText)
  const text = truncatedText(element.text ?? element.originalText)
  const styleKeys = [
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'roughness',
    'opacity',
    'roundness',
    'fontSize',
    'fontFamily',
    'textAlign',
    'verticalAlign',
    'lineHeight',
    'locked',
    'link',
  ]
  const style = Object.fromEntries(
    styleKeys.flatMap(key => element[key] === undefined ? [] : [[key, element[key]]]),
  )
  const boundElementIds = Array.isArray(element.boundElements)
    ? element.boundElements.flatMap(item => {
        const id = string(record(item)?.id)
        return id === undefined ? [] : [id]
      })
    : []
  const bindings = {
    ...(string(element.containerId) === undefined
      ? {}
      : { containerId: string(element.containerId) }),
    ...(boundElementIds.length === 0 ? {} : { boundElementIds }),
    ...(binding(element.startBinding) === undefined
      ? {}
      : { start: binding(element.startBinding) }),
    ...(binding(element.endBinding) === undefined
      ? {}
      : { end: binding(element.endBinding) }),
  }

  return {
    id: string(element.id),
    type: string(element.type),
    ...(text === undefined ? {} : {
      text: text.text,
      textTruncated: text.truncated,
    }),
    ...(label === undefined || labelText === undefined ? {} : {
      label: {
        id: string(label.id),
        text: labelText.text,
        truncated: labelText.truncated,
      },
    }),
    bounds: {
      x: number(element.x),
      y: number(element.y),
      width: number(element.width),
      height: number(element.height),
      angle: number(element.angle),
    },
    style,
    groupIds: Array.isArray(element.groupIds)
      ? element.groupIds.filter(id => typeof id === 'string')
      : [],
    frameId: string(element.frameId) ?? null,
    bindings,
  }
}

export function inspectCanvas(
  document: CanvasDocument,
  options: InspectCanvasOptions = {},
): {
  elements: Record<string, unknown>[]
  totalMatched: number
  nextCursor?: string
  truncated: boolean
} {
  const limit = options.limit ?? DEFAULT_INSPECT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('inspect limit must be between 1 and 100')
  }
  const records = document.elements
    .map(record)
    .filter((element): element is ElementRecord => (
      element !== undefined
      && typeof element.id === 'string'
      && typeof element.type === 'string'
      && element.isDeleted !== true
    ))
  const byId = new Map(records.map(element => [element.id as string, element]))
  const foldedLabelIds = new Set<string>()
  const semantic = records.flatMap(element => {
    if (typeof element.containerId === 'string') {
      foldedLabelIds.add(element.id as string)
      return []
    }
    const label = Array.isArray(element.boundElements)
      ? element.boundElements
          .map(item => string(record(item)?.id))
          .map(id => id === undefined ? undefined : byId.get(id))
          .find(candidate => candidate?.type === 'text'
            && candidate.containerId === element.id)
      : undefined
    if (label !== undefined) foldedLabelIds.add(label.id as string)
    return [{ element, label, semantic: semanticElement(element, label) }]
  }).filter(item => !foldedLabelIds.has(item.element.id as string))

  const ids = options.ids === undefined ? undefined : new Set(options.ids)
  const types = options.types === undefined ? undefined : new Set(options.types)
  const text = options.text?.toLocaleLowerCase()
  const filtered = semantic.filter(item => {
    if (ids !== undefined
      && !ids.has(item.element.id as string)
      && !ids.has(item.label?.id as string)) return false
    if (types !== undefined && !types.has(item.element.type as string)) return false
    if (text !== undefined) {
      const content = [
        string(item.element.text),
        string(item.element.originalText),
        string(item.label?.text),
        string(item.label?.originalText),
      ].filter(Boolean).join('\n').toLocaleLowerCase()
      if (!content.includes(text)) return false
    }
    return true
  })
  const signature = inspectSignature(options)
  const offset = cursorOffset(options.cursor, signature)
  if (offset > filtered.length) throw new Error('invalid inspect cursor')
  const elements = filtered
    .slice(offset, offset + limit)
    .map(item => item.semantic)
  const nextOffset = offset + elements.length
  const truncated = nextOffset < filtered.length

  return {
    elements,
    totalMatched: filtered.length,
    ...(truncated ? { nextCursor: nextCursor(nextOffset, signature) } : {}),
    truncated,
  }
}
