import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const fontRoot = join(
  dirname(require.resolve('@excalidraw/excalidraw')),
  'fonts',
)
const outputs = ['dist/view.js', 'dist/style.css']
const fontPattern = /\.\/fonts\/[^"'`()\s]+\.woff2/g
const uiFontFamilies = new Set([
  'Assistant',
  'Cascadia',
  'ComicShanns',
  'Excalifont',
  'Lilita',
  'Nunito',
])
const omittedFontFamilies = new Set(['Liberation', 'Virgil', 'Xiaolai'])

for (const output of outputs) {
  let content = await readFile(output, 'utf8')
  const references = new Set(content.match(fontPattern) ?? [])
  for (const reference of references) {
    const relativePath = reference.slice('./fonts/'.length)
    const family = relativePath.split('/', 1)[0]
    if (omittedFontFamilies.has(family)) {
      content = content.replaceAll(reference, 'data:,')
      continue
    }
    if (!uiFontFamilies.has(family)) {
      throw new Error(`unexpected non-UI font reference in ${output}: ${reference}`)
    }
    const font = await readFile(join(fontRoot, relativePath))
    content = content.replaceAll(
      reference,
      `data:font/woff2;base64,${font.toString('base64')}`,
    )
  }
  if (fontPattern.test(content)) {
    throw new Error(`unembedded font reference remains in ${output}`)
  }
  await writeFile(output, content)
}
