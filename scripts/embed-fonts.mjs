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

for (const output of outputs) {
  let content = await readFile(output, 'utf8')
  const references = new Set(content.match(fontPattern) ?? [])
  for (const reference of references) {
    const font = await readFile(join(fontRoot, reference.slice('./fonts/'.length)))
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
