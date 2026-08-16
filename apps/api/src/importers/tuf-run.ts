import type { Env } from '../env'
import { withDb } from '../db'
import { fetchConsistentTufSnapshot } from './tuf-fetch'
import { importTufSnapshot, type TufRawSnapshot } from './tuf'

export type TufImportExecutionSource = 'MANUAL' | 'SCHEDULED' | 'SYSTEM'

type RunTufImportInput = {
  actorId: string | null
  rawData?: TufRawSnapshot
  sourceVersion?: string | null
  executionSource: TufImportExecutionSource
  auditMetadata?: Record<string, unknown>
}

/**
 * Shared TUF import execution path for both staff-triggered imports and Cron.
 * This function only fetches/stores external observations; canonical ELF data
 * remains outside the importer boundary.
 */
export async function runTufImport(env: Env, input: RunTufImportInput) {
  const rawData = input.rawData ?? await fetchConsistentTufSnapshot()
  return withDb(env, (db) => importTufSnapshot(db, {
    rawData,
    actorId: input.actorId,
    sourceVersion: input.sourceVersion ?? null,
    executionSource: input.executionSource,
    auditMetadata: input.auditMetadata,
  }))
}
