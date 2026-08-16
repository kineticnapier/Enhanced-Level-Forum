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
 * Service execution path for TUF imports that do not originate from a browser
 * session. It reuses the same stable fetcher and external-observation importer
 * as the staff-triggered route.
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
      try {
        await audit(db, null, 'TUF_SCHEDULED_IMPORT', 'import_snapshot', result.snapshot.id, {
          executionSource: 'SCHEDULED',
          ...input.auditMetadata,
          summary: result.summary,
        })
      } catch (error) {
        // importTufSnapshot already writes its authoritative TUF_IMPORT audit row
        // inside the import transaction. Do not turn a supplemental marker
        // failure into a failed Cron run after the snapshot has committed.
        console.error('[TUF cron] failed to write scheduled audit marker', error)
      }
    }

    return result
  })
}
