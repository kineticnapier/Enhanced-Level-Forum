import app from './index'
import { requireRole } from './auth'
import { withDb } from './db'
import { importTufSnapshot, type TufRawSnapshot } from './importers/tuf'
import { fetchConsistentTufSnapshot } from './importers/tuf-fetch'

type TufImportBody = { rawData?: TufRawSnapshot; sourceVersion?: string | null }

app.post('/api/admin/imports/tuf', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufImportBody>().catch((): TufImportBody => ({}))

  const rawData = body.rawData ?? await fetchConsistentTufSnapshot()
  const result = await withDb(c.env, (db) => importTufSnapshot(db, {
    rawData,
    actorId: user.id,
    sourceVersion: body.sourceVersion ?? null,
  }))

  return c.json(result, 201)
})

app.get('/api/admin/imports/tuf/issues', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim()
  if (!snapshotId) return c.json({ error: 'snapshotId is required' }, 400)

  const issues = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT id,snapshot_id,source,severity,kind,external_id,
              linked_level_id,linked_level_version_id,details,created_at
       FROM import_issues
       WHERE source='TUF' AND snapshot_id=$1
       ORDER BY
         CASE severity WHEN 'ERROR' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
         kind,external_id NULLS LAST,created_at`,
      [snapshotId],
    )
    return result.rows
  })

  return c.json({ issues })
})

app.get('/api/admin/imports/tuf/summary', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim()
  if (!snapshotId) return c.json({ error: 'snapshotId is required' }, 400)

  const summary = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT s.id,s.source,s.source_version,s.imported_at,
              (SELECT count(*)::int FROM external_level_observations x WHERE x.snapshot_id=s.id) AS levels,
              (SELECT count(*)::int FROM external_rating_observations x WHERE x.snapshot_id=s.id) AS ratings,
              (SELECT count(*)::int FROM external_reference_observations x WHERE x.snapshot_id=s.id) AS references,
              (SELECT count(*)::int FROM external_level_observations x WHERE x.snapshot_id=s.id AND x.linked_level_id IS NOT NULL) AS linked_levels,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='INFO') AS info_issues,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='WARNING') AS warning_issues,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='ERROR') AS error_issues
       FROM import_snapshots s
       WHERE s.id=$1 AND s.source='TUF'`,
      [snapshotId],
    )
    return result.rows[0] ?? null
  })

  if (!summary) return c.json({ error: 'TUF snapshot not found' }, 404)
  return c.json({ summary })
})

export default app
