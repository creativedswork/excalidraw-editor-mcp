import { App } from '@modelcontextprotocol/ext-apps'
import {
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import './styles.css'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string
    __EXCALIDRAW_M0__?: {
      elementCount: () => number
      selectedIds: () => string[]
      displayMode: () => string
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

  useEffect(() => {
    if (api === undefined) return
    window.__EXCALIDRAW_M0__ = {
      elementCount: () => api.getSceneElements().length,
      selectedIds: () => Object.keys(api.getAppState().selectedElementIds),
      displayMode: () => displayMode,
    }
    return () => {
      delete window.__EXCALIDRAW_M0__
    }
  }, [api, displayMode])

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

  return (
    <main data-excalidraw-m0 data-display-mode={displayMode}>
      <div className="m0-canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={{
            elements: convertToExcalidrawElements([{
              type: 'rectangle',
              id: 'm0-seed',
              x: 160,
              y: 140,
              width: 260,
              height: 140,
              backgroundColor: '#a5d8ff',
              fillStyle: 'solid',
              label: { text: 'Excalidraw M0' },
            }], { regenerateIds: false }),
            appState: {
              viewBackgroundColor: '#f8f9fa',
              currentItemFontFamily: 5,
            },
            scrollToContent: true,
          }}
          langCode="en"
          name="Excalidraw M0"
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
        <output data-m0-status>{status}</output>
      </nav>
    </main>
  )
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
