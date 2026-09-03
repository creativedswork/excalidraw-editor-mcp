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
      op: 'reorder'
      target: ElementReference
      position: 'front' | 'back' | 'before' | 'after'
      relativeTo?: ElementReference
    }
  | { op: 'group'; targets: ElementReference[]; groupId?: string }
  | { op: 'ungroup'; targets: ElementReference[]; groupId?: string }
  | {
      op: 'bind'
      source: ElementReference
      target: ElementReference
      binding: 'start' | 'end' | 'label'
    }
  | {
      op: 'unbind'
      source: ElementReference
      binding: 'start' | 'end' | 'label'
    }
  | {
      op: 'add_to_frame'
      targets: ElementReference[]
      frame: ElementReference
    }
  | { op: 'remove_from_frame'; targets: ElementReference[] }
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

function activeElement(elements: OfficialElement[], id: string): OfficialElement {
  const element = elements.find(candidate => candidate.id === id && !candidate.isDeleted)
  if (element === undefined) throw new Error(`element does not exist: ${id}`)
  return element
}

function replaceElement(
  elements: OfficialElement[],
  id: string,
  updates: Record<string, unknown>,
  affected: Set<string>,
): void {
  const index = elements.findIndex(element => element.id === id && !element.isDeleted)
  if (index < 0) throw new Error(`element does not exist: ${id}`)
  elements[index] = newElementWith(elements[index], updates as never)
  affected.add(id)
}

function withoutBoundElement(
  element: OfficialElement,
  id: string,
): ExcalidrawElement['boundElements'] {
  const next = element.boundElements?.filter(item => item.id !== id) ?? null
  return next?.length === 0 ? null : next
}

function unbindElement(
  elements: OfficialElement[],
  sourceId: string,
  bindingKind: 'start' | 'end' | 'label',
  affected: Set<string>,
): void {
  const source = activeElement(elements, sourceId)
  if (bindingKind === 'label') {
    if (source.type !== 'text') throw new Error('label binding source must be text')
    if (source.containerId !== null) {
      const container = activeElement(elements, source.containerId)
      replaceElement(elements, container.id, {
        boundElements: withoutBoundElement(container, source.id),
      }, affected)
    }
    replaceElement(elements, source.id, { containerId: null }, affected)
    return
  }
  if (source.type !== 'arrow' && source.type !== 'line') {
    throw new Error('endpoint binding source must be an arrow or line')
  }
  const key = bindingKind === 'start' ? 'startBinding' : 'endBinding'
  const current = source[key]
  if (current !== null) {
    const target = activeElement(elements, current.elementId)
    replaceElement(elements, target.id, {
      boundElements: withoutBoundElement(target, source.id),
    }, affected)
  }
  replaceElement(elements, source.id, { [key]: null }, affected)
}

function bindElement(
  elements: OfficialElement[],
  sourceId: string,
  targetId: string,
  bindingKind: 'start' | 'end' | 'label',
  affected: Set<string>,
): void {
  if (sourceId === targetId) throw new Error('an element cannot bind to itself')
  const target = activeElement(elements, targetId)
  unbindElement(elements, sourceId, bindingKind, affected)
  const source = activeElement(elements, sourceId)
  if (bindingKind === 'label') {
    if (source.type !== 'text') throw new Error('label binding source must be text')
    if (!['rectangle', 'diamond', 'ellipse', 'arrow'].includes(target.type)) {
      throw new Error('label target is not a text container')
    }
    const existingLabel = target.boundElements?.find(item => item.type === 'text')
    if (existingLabel !== undefined && existingLabel.id !== source.id) {
      throw new Error('label target already has bound text')
    }
    replaceElement(elements, source.id, { containerId: target.id }, affected)
    replaceElement(elements, target.id, {
      boundElements: [
        ...(target.boundElements ?? []).filter(item => item.id !== source.id),
        { id: source.id, type: 'text' },
      ],
    }, affected)
    return
  }
  if (source.type !== 'arrow' && source.type !== 'line') {
    throw new Error('endpoint binding source must be an arrow or line')
  }
  if (!['rectangle', 'diamond', 'ellipse', 'text', 'image', 'frame'].includes(target.type)) {
    throw new Error('endpoint target is not bindable')
  }
  const key = bindingKind === 'start' ? 'startBinding' : 'endBinding'
  replaceElement(elements, source.id, {
    [key]: { elementId: target.id, focus: 0, gap: 1 },
  }, affected)
  replaceElement(elements, target.id, {
    boundElements: [
      ...(target.boundElements ?? []).filter(item => item.id !== source.id),
      { id: source.id, type: 'arrow' },
    ],
  }, affected)
}

function removeElement(
  elements: OfficialElement[],
  id: string,
  affected: Set<string>,
): void {
  const removed = activeElement(elements, id)
  const removedIds = new Set([removed.id])
  for (const item of removed.boundElements ?? []) {
    const bound = elements.find(element => element.id === item.id && !element.isDeleted)
    if (bound?.type === 'text' && bound.containerId === removed.id) {
      replaceElement(elements, bound.id, { isDeleted: true }, affected)
      removedIds.add(bound.id)
    }
  }
  replaceElement(elements, removed.id, { isDeleted: true }, affected)

  for (const element of [...elements]) {
    if (element.isDeleted || removedIds.has(element.id)) continue
    const updates: Record<string, unknown> = {}
    if (element.frameId !== null && removedIds.has(element.frameId)) {
      updates.frameId = null
    }
    if (element.type === 'text'
      && element.containerId !== null
      && removedIds.has(element.containerId)) {
      updates.containerId = null
    }
    if ((element.type === 'arrow' || element.type === 'line')) {
      if (element.startBinding !== null
        && removedIds.has(element.startBinding.elementId)) updates.startBinding = null
      if (element.endBinding !== null
        && removedIds.has(element.endBinding.elementId)) updates.endBinding = null
    }
    if (element.boundElements?.some(item => removedIds.has(item.id))) {
      const boundElements = element.boundElements.filter(item => !removedIds.has(item.id))
      updates.boundElements = boundElements.length === 0 ? null : boundElements
    }
    if (Object.keys(updates).length > 0) {
      replaceElement(elements, element.id, updates, affected)
    }
  }
}

function reorderElement(
  elements: OfficialElement[],
  id: string,
  position: 'front' | 'back' | 'before' | 'after',
  relativeId: string | undefined,
  affected: Set<string>,
): OfficialElement[] {
  const source = activeElement(elements, id)
  if ((position === 'before' || position === 'after') && relativeId === undefined) {
    throw new Error(`${position} reorder requires relativeTo`)
  }
  if ((position === 'front' || position === 'back') && relativeId !== undefined) {
    throw new Error(`${position} reorder does not accept relativeTo`)
  }
  const next = elements.filter(element => element.id !== id)
  let index = position === 'back' ? 0 : next.length
  if (relativeId !== undefined) {
    activeElement(elements, relativeId)
    index = next.findIndex(element => element.id === relativeId)
    if (index < 0) throw new Error(`element does not exist: ${relativeId}`)
    if (position === 'after') index += 1
  }
  next.splice(index, 0, source)
  return next.map(element => {
    if (element.isDeleted) return element
    affected.add(element.id)
    return newElementWith(element, { index: null } as never)
  })
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
    if (change.op === 'group' || change.op === 'ungroup') {
      const ids = change.targets.map(target => (
        resolveReference(target, clientRefMap, existingIds)
      ))
      if (ids.length < 2) throw new Error(`${change.op} requires at least two elements`)
      const targets = ids.map(id => activeElement(elements, id))
      if (change.op === 'group') {
        const groupId = change.groupId ?? randomUUID()
        for (const target of targets) {
          if (target.groupIds.includes(groupId)) throw new Error('element is already in group')
          replaceElement(elements, target.id, {
            groupIds: [...target.groupIds, groupId],
          }, affected)
        }
      } else {
        const common = change.groupId ?? [...targets[0].groupIds]
          .reverse()
          .find(groupId => targets.every(target => target.groupIds.includes(groupId)))
        if (common === undefined) throw new Error('elements do not share a group')
        for (const target of targets) {
          replaceElement(elements, target.id, {
            groupIds: target.groupIds.filter(groupId => groupId !== common),
          }, affected)
        }
      }
      continue
    }
    if (change.op === 'bind') {
      bindElement(
        elements,
        resolveReference(change.source, clientRefMap, existingIds),
        resolveReference(change.target, clientRefMap, existingIds),
        change.binding,
        affected,
      )
      continue
    }
    if (change.op === 'unbind') {
      unbindElement(
        elements,
        resolveReference(change.source, clientRefMap, existingIds),
        change.binding,
        affected,
      )
      continue
    }
    if (change.op === 'add_to_frame') {
      const frameId = resolveReference(change.frame, clientRefMap, existingIds)
      const frame = activeElement(elements, frameId)
      if (frame.type !== 'frame') throw new Error('frame reference must identify a frame')
      for (const target of change.targets) {
        const targetId = resolveReference(target, clientRefMap, existingIds)
        if (targetId === frameId) throw new Error('a frame cannot contain itself')
        replaceElement(elements, targetId, { frameId }, affected)
      }
      continue
    }
    if (change.op === 'remove_from_frame') {
      for (const target of change.targets) {
        replaceElement(
          elements,
          resolveReference(target, clientRefMap, existingIds),
          { frameId: null },
          affected,
        )
      }
      continue
    }
    if (change.op === 'reorder') {
      elements = reorderElement(
        elements,
        resolveReference(change.target, clientRefMap, existingIds),
        change.position,
        change.relativeTo === undefined
          ? undefined
          : resolveReference(change.relativeTo, clientRefMap, existingIds),
        affected,
      )
      continue
    }
    const id = resolveReference(change.target, clientRefMap, existingIds)
    if (change.op === 'update') {
      elements = updateElement(elements, id, change.patch, document.files, affected)
    } else {
      removeElement(elements, id, affected)
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
