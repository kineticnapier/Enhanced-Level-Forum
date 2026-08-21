import { extname, basename, dirname, join, resolve } from 'node:path'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeFingering } from './analyzer/fingering-dp.mjs'
import { extractAdofaiPressEventsFromText } from './analyzer/adofai-timing.mjs'

const args = process.argv.slice(2)
const inputPathArg = args.shift()
if (!inputPathArg) {
  console.error('Usage: npm run analyzer:fingering -- <input.adofai|input.json> [output.json] [--assets <dir>] [--output-dir <dir>] [--html <file>] [--stdout] [--no-view]')
  process.exit(2)
}

let legacyOutputPath = null
if (args[0] && !args[0].startsWith('--')) legacyOutputPath = args.shift()
let assetDir = null
let outputDir = null
let explicitHtmlPath = null
let stdout = false
let noView = false
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--assets') assetDir = args[++i]
  else if (arg === '--output-dir') outputDir = args[++i]
  else if (arg === '--html') explicitHtmlPath = args[++i]
  else if (arg === '--stdout') stdout = true
  else if (arg === '--no-view') noView = true
  else throw new Error(`Unknown option: ${arg}`)
}

async function hasReplayAssets(dir) {
  if (!dir) return false
  for (const candidate of [dir, join(dir, 'Texture2D')]) {
    try {
      await access(join(candidate, 'tile_unlit.png'))
      await access(join(candidate, 'planet-red.png'))
      await access(join(candidate, 'planet-blue.png'))
      return true
    } catch {
      // Try the next candidate root.
    }
  }
  return false
}

async function autoDetectAssetDir(inputDir) {
  const bundled = fileURLToPath(new URL('./analyzer/replay-assets/', import.meta.url))
  const envDir = process.env.ELF_ADOFAI_ASSETS ? resolve(process.env.ELF_ADOFAI_ASSETS) : null
  const candidates = [
    envDir,
    join(inputDir, 'Texture2D'),
    inputDir,
    join(process.cwd(), 'Texture2D'),
    process.cwd(),
    bundled,
  ].filter(Boolean)
  for (const candidate of candidates) if (await hasReplayAssets(candidate)) return candidate
  return null
}

const inputPath = resolve(inputPathArg)
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

if (!isAdofai && !legacyOutputPath && !outputDir && !explicitHtmlPath && !stdout) {
  process.stdout.write(serialized)
  process.exit(0)
}

const inputDir = dirname(inputPath)
const stem = basename(inputPath, extname(inputPath))
const targetDir = resolve(outputDir ?? inputDir)
await mkdir(targetDir, { recursive: true })

const resultPath = resolve(legacyOutputPath ?? join(targetDir, `${stem}-result.json`))
await writeFile(resultPath, serialized, 'utf8')
console.log(`Analyzer JSON: ${resultPath}`)

if (stdout) process.stdout.write(serialized)

if (isAdofai && !noView) {
  const replayPath = resolve(explicitHtmlPath ?? join(targetDir, `${stem}-replay.html`))
  const visualizerPath = fileURLToPath(new URL('./visualize-fingering.mjs', import.meta.url))
  const resolvedAssetDir = assetDir ? resolve(assetDir) : await autoDetectAssetDir(inputDir)
  const viewerArgs = [visualizerPath, resultPath, replayPath]
  if (resolvedAssetDir) {
    viewerArgs.push('--assets', resolvedAssetDir)
    console.log(`Replay assets: auto-detected ${resolvedAssetDir}`)
  } else {
    console.log('Replay assets: not found automatically; viewer will use vector fallback')
  }
  const child = spawnSync(process.execPath, viewerArgs, { stdio: 'inherit' })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status ?? 1)
  console.log(`Replay HTML: ${replayPath}`)
}
