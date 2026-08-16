import type { Env } from '../env'
import { withDb } from '../db'
import { audit } from '../services'
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
 * Shared TUF import execution path for staff/service jobs.
 * This function only fetches and stores external observations. Canonical ELF
 * ratings and References remain outside the importer boundary.
 */
export async function runTufImport(env: Env, input: RunTufImportInput) {
  const rawData = input.rawData ?? await fetchConsistentTufSnapshot()
  return withDb(env, async (db) => {
    const result = await importTufSnapshot(db, {
      rawData,
      actorId: input.actorId,
      sourceVersion: input.sourceVersion ?? null,
    })

    if (input.executionSource === 'SCHEDULED') {
      await audit(db, null, 'TUF_SCHEDULED_IMPORT', 'import_snapshot', result.snapshot.id, {
        executionSource: 'SCHEDULED',
        ...input.auditMetadata,
        summary: result.summary,
      })
    }

    return result
  })
}
