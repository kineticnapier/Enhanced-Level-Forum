import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import { resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg
const databaseUrl = await resolveDatabaseUrl()
const client = new Client({ connectionString: databaseUrl })
await client.connect()
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
  const dir = resolve('db/migrations')
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
  for (const filename of files) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename])
    if (exists.rowCount) {
      console.log(`skip ${filename}`)
      continue
    }
    const sql = await readFile(resolve(dir, filename), 'utf8')
    console.log(`apply ${filename}`)
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [filename])
  }
  console.log('migrations complete')
} finally {
  await client.end()
}
