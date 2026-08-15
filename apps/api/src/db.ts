import { Client } from 'pg'
import type { Env } from './env'

export type DbClient = Client

export async function withDb<T>(env: Env, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export async function inTransaction<T>(client: DbClient, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const value = await fn()
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
