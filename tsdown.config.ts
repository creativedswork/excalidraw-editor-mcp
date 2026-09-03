import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
const excalidrawCss = join(
  dirname(require.resolve('@excalidraw/excalidraw')),
  'index.css',
)

export default defineConfig([
  {
    name: 'excalidraw-editor-mcp/canvas-store',
    entry: { 'canvas-store': 'src/canvas-store.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: false,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'excalidraw-editor-mcp/project-store',
    entry: { 'project-store': 'src/project-store.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: false,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'excalidraw-editor-mcp/server',
    entry: { server: 'src/server.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: false,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'excalidraw-editor-mcp/official',
    entry: { official: 'src/official.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'excalidraw-editor-mcp/view',
    entry: { view: 'src/view.tsx' },
    outDir: 'dist',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    minify: true,
    sourcemap: false,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
    plugins: [{
      name: 'resolve-excalidraw-css',
      resolveId(id) {
        return id === '@excalidraw/excalidraw/index.css'
          ? excalidrawCss
          : null
      },
    }],
    outputOptions: {
      entryFileNames: 'view.js',
      assetFileNames: '[name][extname]',
    },
  },
])
