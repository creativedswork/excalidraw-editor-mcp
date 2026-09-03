import { randomUUID } from 'node:crypto'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { CanvasDocument } from './canvas-store.js'

function installNodeDomShim(): void {
  if (typeof window !== 'undefined') return

  class NodeElement {}
  class NodeFontFace {
    family: string

    constructor(family: string) {
      this.family = family
    }
  }
  const context = {
    measureText: (text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
    }),
  }

  Object.assign(globalThis, {
    devicePixelRatio: 1,
    Element: NodeElement,
    FontFace: NodeFontFace,
    window: {
      devicePixelRatio: 1,
      location: { origin: 'node://local' },
    },
    document: {
      createElement: (tag: string) => Object.assign(
        new NodeElement(),
        tag === 'canvas' ? { getContext: () => context } : {},
      ),
      documentElement: { getAttribute: () => null },
    },
  })
}

installNodeDomShim()

const {
  convertToExcalidrawElements,
  newElementWith,
  restore,
  restoreElements,
  serializeAsJSON,
} = await import('@excalidraw/excalidraw')

export type ElementReference =
  | { elementId: string }
  | { clientRef: string }

export interface AddElementInput {
  type: 'rectangle' | 'diamond' | 'ellipse' | 'text' | 'line' | 'arrow'
    | 'freedraw' | 'frame' | 'image'
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  label?: { text: string; fontSize?: number }
  points?: number[][]
  pressures?: number[]
  simulatePressure?: boolean
  fileId?: string
  children?: ElementReference[]
  name?: string
  startRef?: ElementReference
  endRef?: ElementReference
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: string
  roughness?: number
  opacity?: number
  roundness?: unknown
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  lineHeight?: number
  startArrowhead?: string | null
  endArrowhead?: string | null
  link?: string | null
  locked?: boolean
  customData?: Record<string, unknown>
}

export interface UpdateElementInput {
  x?: number
  y?: number
  width?: number
  height?: number
  angle?: number
  text?: string
  label?: { text: string; fontSize?: number }
  points?: number[][]
  fileId?: string
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: string
  roughness?: number
  opacity?: number
  roundness?: unknown
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  lineHeight?: number
  startArrowhead?: string | null
  endArrowhead?: string | null
  link?: string | null
  locked?: boolean
  customData?: Record<string, unknown>
}

export type CanvasChange =
  | { op: 'add'; clientRef: string; element: AddElementInput }
  | { op: 'update'; target: ElementReference; patch: UpdateElementInput }
  | { op: 'remove'; target: ElementReference }
  | {
      op: 'set_canvas'
      patch: {
        viewBackgroundColor?: string
        gridSize?: number | null
        gridStep?: number
        gridModeEnabled?: boolean
      }
    }

type OfficialElement = ExcalidrawElement

function resolveReference(
  reference: ElementReference,
  clientRefMap: Record<string, string>,
  ids: Set<string>,
): string {
  const id = 'clientRef' in reference
    ? clientRefMap[reference.clientRef]
    : reference.elementId
  if (id === undefined || !ids.has(id)) throw new Error('element reference does not exist')
  return id
}

function elementSkeleton(
  input: AddElementInput,
  id: string,
  clientRefMap: Record<string, string>,
  ids: Set<string>,
  files: CanvasDocument['files'],
): Record<string, unknown> {
  if (input.type === 'text' && input.text === undefined) {
    throw new Error('text elements require text')
  }
  if (input.type === 'image') {
    if (input.fileId === undefined || files[input.fileId] === undefined) {
      throw new Error('image elements require an existing fileId')
    }
  }
  if (
    (input.type === 'line' || input.type === 'arrow' || input.type === 'freedraw')
    && (input.points === undefined || input.points.length < 2)
  ) {
    throw new Error(`${input.type} elements require at least two points`)
  }
  const {
    startRef,
    endRef,
    children,
    ...properties
  } = input
  return {
    ...properties,
    id,
    x: input.x ?? 0,
    y: input.y ?? 0,
    ...(input.type === 'frame'
      ? {
          children: (children ?? []).map(reference => (
            resolveReference(reference, clientRefMap, ids)
          )),
        }
      : {}),
    ...(startRef === undefined
      ? {}
      : { start: { id: resolveReference(startRef, clientRefMap, ids) } }),
    ...(endRef === undefined
      ? {}
      : { end: { id: resolveReference(endRef, clientRefMap, ids) } }),
  }
}

function updateElement(
  elements: OfficialElement[],
  id: string,
  patch: UpdateElementInput,
  files: CanvasDocument['files'],
  affected: Set<string>,
): OfficialElement[] {
  const index = elements.findIndex(element => element.id === id && !element.isDeleted)
  if (index < 0) throw new Error(`element does not exist: ${id}`)
  const current = elements[index]
  if (patch.fileId !== undefined && files[patch.fileId] === undefined) {
    throw new Error('image updates require an existing fileId')
  }
  if (patch.text !== undefined && current.type !== 'text') {
    throw new Error('text can only update a text element')
  }
  const { label, ...properties } = patch
  elements[index] = newElementWith(current, {
    ...properties,
    ...(patch.text === undefined ? {} : { originalText: patch.text }),
  } as never)
  affected.add(id)

  if (label !== undefined) {
    const boundTextId = current.boundElements?.find(item => item.type === 'text')?.id
    const textIndex = elements.findIndex(element => (
      element.id === boundTextId
      && element.type === 'text'
      && !element.isDeleted
    ))
    if (textIndex < 0) throw new Error('element does not have a label')
    const text = elements[textIndex]
    elements[textIndex] = newElementWith(text, {
      text: label.text,
      originalText: label.text,
      ...(label.fontSize === undefined ? {} : { fontSize: label.fontSize }),
    } as never)
    affected.add(text.id)
  }
  return elements
}

export function applyOfficialCanvasChanges(
  document: CanvasDocument,
  changes: CanvasChange[],
): {
  document: CanvasDocument
  clientRefMap: Record<string, string>
  affectedElementIds: string[]
  warnings: string[]
} {
  if (changes.length === 0) throw new Error('changes must not be empty')
  const restored = restore(document, null, null, {
    refreshDimensions: false,
    repairBindings: true,
  }) as {
    elements: OfficialElement[]
    appState: Record<string, unknown>
    files: CanvasDocument['files']
  }
  const existingIds = new Set<string>(
    restored.elements.map((element: OfficialElement) => element.id),
  )
  const clientRefMap: Record<string, string> = {}
  for (const change of changes) {
    if (change.op !== 'add') continue
    if (clientRefMap[change.clientRef] !== undefined) {
      throw new Error(`duplicate clientRef: ${change.clientRef}`)
    }
    let id = randomUUID()
    while (existingIds.has(id)) id = randomUUID()
    clientRefMap[change.clientRef] = id
    existingIds.add(id)
  }

  const skeletons = changes.flatMap(change => (
    change.op === 'add'
      ? [elementSkeleton(
          change.element,
          clientRefMap[change.clientRef],
          clientRefMap,
          existingIds,
          document.files,
        )]
      : []
  ))
  const created = convertToExcalidrawElements(
    skeletons as never,
    { regenerateIds: false },
  ) as OfficialElement[]
  let elements = restoreElements(
    [...restored.elements, ...created],
    null,
    { refreshDimensions: false, repairBindings: true },
  ) as OfficialElement[]
  const affected = new Set<string>(
    created.map((element: OfficialElement) => element.id),
  )
  let appState = { ...restored.appState }

  for (const change of changes) {
    if (change.op === 'add') continue
    if (change.op === 'set_canvas') {
      appState = { ...appState, ...change.patch }
      continue
    }
    const id = resolveReference(change.target, clientRefMap, existingIds)
    if (change.op === 'update') {
      elements = updateElement(elements, id, change.patch, document.files, affected)
    } else {
      const index = elements.findIndex(element => element.id === id && !element.isDeleted)
      if (index < 0) throw new Error(`element does not exist: ${id}`)
      elements[index] = newElementWith(elements[index], { isDeleted: true } as never)
      affected.add(id)
    }
  }

  elements = restoreElements(elements, null, {
    refreshDimensions: false,
    repairBindings: true,
  }) as OfficialElement[]
  return {
    document: JSON.parse(serializeAsJSON(
      elements,
      appState,
      restored.files,
      'local',
    )) as CanvasDocument,
    clientRefMap,
    affectedElementIds: [...affected],
    warnings: [],
  }
}

export function officialRoundTrip(): {
  types: string[]
  text: string
  document: {
    type: string
    version: number
    elements: unknown[]
  }
} {
  const created = convertToExcalidrawElements([
    {
      type: 'rectangle',
      x: 80,
      y: 80,
      width: 240,
      height: 120,
      label: { text: 'M0' },
    },
  ])
  const restored = restoreElements(created, null, {
    refreshDimensions: false,
    repairBindings: true,
  })
  const document = JSON.parse(
    serializeAsJSON(restored, {}, {}, 'local'),
  ) as {
    type: string
    version: number
    elements: Array<{ type: string; text?: string }>
  }

  return {
    types: document.elements.map(element => element.type),
    text: document.elements.find(element => element.type === 'text')?.text ?? '',
    document,
  }
}
