import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/adoforum'

export function parseEnvText(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export async function readEnvFile(path = resolve(ROOT_DIR, '.env')) {
  try {
    return parseEnvText(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function resolveDatabaseUrl() {
  const fileEnv = await readEnvFile()
  return process.env.DATABASE_URL?.trim() || fileEnv.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL
}
