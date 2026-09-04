import { createHash } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import type { CanvasDocument, SafeWorkspace } from './canvas-store.js'

export const MAX_ASSET_BYTES = 1024 * 1024
export const MAX_TOTAL_ASSET_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_EDGE = 8192
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

export type SupportedImageMimeType = typeof SUPPORTED_IMAGE_MIME_TYPES[number]

export interface LoadedCanvasAsset {
  assetId: string
  mimeType: SupportedImageMimeType
  width: number
  height: number
  hash: string
  byteLength: number
  dataURL: string
}

function dimensions(width: number, height: number): { width: number; height: number } {
  if (
    width < 1
    || height < 1
    || width > MAX_IMAGE_EDGE
    || height > MAX_IMAGE_EDGE
    || width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `image dimensions must be within ${String(MAX_IMAGE_EDGE)}x${String(MAX_IMAGE_EDGE)} and ${String(MAX_IMAGE_PIXELS)} pixels`,
    )
  }
  return { width, height }
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (
    bytes.length < 33
    || !bytes.subarray(0, 8).equals(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
    || bytes.readUInt32BE(8) !== 13
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) return undefined
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

function gifDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const signature = bytes.toString('ascii', 0, 6)
  if (bytes.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
    return undefined
  }
  return dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (startOfFrame.has(marker)) {
      if (length < 7) break
      return dimensions(
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
      )
    }
    offset += length
  }
  throw new Error('JPEG does not contain valid dimensions')
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (
    bytes.length < 30
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) return undefined
  const chunk = bytes.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return dimensions(readUInt24LE(bytes, 24) + 1, readUInt24LE(bytes, 27) + 1)
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (
    chunk === 'VP8 '
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return dimensions(
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    )
  }
  throw new Error('WebP does not contain valid dimensions')
}

function inspectImage(bytes: Buffer): {
  mimeType: SupportedImageMimeType
  width: number
  height: number
} {
  const png = pngDimensions(bytes)
  if (png !== undefined) return { mimeType: 'image/png', ...png }
  const gif = gifDimensions(bytes)
  if (gif !== undefined) return { mimeType: 'image/gif', ...gif }
  const jpeg = jpegDimensions(bytes)
  if (jpeg !== undefined) return { mimeType: 'image/jpeg', ...jpeg }
  const webp = webpDimensions(bytes)
  if (webp !== undefined) return { mimeType: 'image/webp', ...webp }
  throw new Error(`unsupported image MIME; expected ${SUPPORTED_IMAGE_MIME_TYPES.join(', ')}`)
}

export async function loadWorkspaceImage(
  workspace: SafeWorkspace,
  sourcePath: string,
): Promise<LoadedCanvasAsset> {
  const target = await workspace.existingFile(sourcePath)
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytes: Buffer
  let before: Stats
  try {
    before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(`workspace path is not a regular unlinked file: ${sourcePath}`)
    }
    if (before.size > MAX_ASSET_BYTES) {
      throw new Error(`asset exceeds ${String(MAX_ASSET_BYTES)} bytes`)
    }
    bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.nlink !== 1
    ) {
      throw new Error(`workspace asset changed while reading: ${sourcePath}`)
    }
  } finally {
    await handle.close()
  }
  const published = await lstat(target)
  if (published.dev !== before.dev || published.ino !== before.ino || published.nlink !== 1) {
    throw new Error(`workspace asset path changed while reading: ${sourcePath}`)
  }
  const image = inspectImage(bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  return {
    assetId: hash,
    ...image,
    hash,
    byteLength: bytes.length,
    dataURL: `data:${image.mimeType};base64,${bytes.toString('base64')}`,
  }
}

export function totalAssetBytes(files: CanvasDocument['files']): number {
  let total = 0
  for (const file of Object.values(files)) {
    const dataURL = file !== null && typeof file === 'object'
      ? (file as { dataURL?: unknown }).dataURL
      : undefined
    if (typeof dataURL !== 'string') throw new Error('canvas contains invalid asset data')
    const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataURL)
    if (match === null || match[1]!.length % 4 !== 0) {
      throw new Error('canvas contains invalid base64 asset data')
    }
    total += Buffer.from(match[1]!, 'base64').length
  }
  return total
}
