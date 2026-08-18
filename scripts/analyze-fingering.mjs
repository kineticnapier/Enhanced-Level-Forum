import { extname } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { analyzeFingering } from './analyzer/fingering-dp.mjs'
import { extractAdofaiPressEventsFromText } from './analyzer/adofai-timing.mjs'

const [, , inputPath, outputPath] = process.argv
if (!inputPath) {
  console.error('Usage: npm run analyzer:fingering -- <input.adofai|input.json> [output.json]')
  process.exit(2)
}

const text = await readFile(inputPath, 'utf8')
const isAdofai = extname(inputPath).toLowerCase() === '.adofai'
let analyzerInput
let timing = null

if (isAdofai) {
  analyzerInput = extractAdofaiPressEventsFromText(text)
  timing = analyzerInput.timing
} else {
  analyzerInput = JSON.parse(text)
}

const result = analyzeFingering(analyzerInput, analyzerInput.options ?? {})
const output = timing ? { ...result, timing } : result
const serialized = JSON.stringify(output, null, 2) + '\n'
if (outputPath) await writeFile(outputPath, serialized, 'utf8')
else process.stdout.write(serialized)
