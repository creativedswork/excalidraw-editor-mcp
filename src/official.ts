function installNodeDomShim(): void {
  if (typeof window !== 'undefined') return

  class NodeElement {}
  class NodeFontFace {
    constructor(public family: string) {}
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
  restoreElements,
  serializeAsJSON,
} = await import('@excalidraw/excalidraw')

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
