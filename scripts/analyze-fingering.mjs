import { readFile, writeFile } from 'node:fs/promises'
import { analyzeFingering } from './analyzer/fingering-dp.mjs'

const [, , inputPath, outputPath] = process.argv
if (!inputPath) {
  console.error('Usage: npm run analyzer:fingering -- <input.json> [output.json]')
  process.exit(2)
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'))
const result = analyzeFingering(raw, raw.options ?? {})
const text = JSON.stringify(result, null, 2) + '\n'
if (outputPath) await writeFile(outputPath, text, 'utf8')
else process.stdout.write(text)
