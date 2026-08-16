import type { DbClient } from '../db'
import { inTransaction } from '../db'
import { audit } from '../services'

export class TufReconciliationError extends Error {
  status: 400 | 404 | 409

  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

export type TufUnlinkedRow = {
  observationId: string
  snapshotId: string
  externalId: string
  sha256: string | null
  song: string | null
  title: string | null
  creator: string | null
  downloadUrl: string | null
  difficultyLabel: string | null
  observedAt: string
  referenceCount: number
  referenceTypes: string[]
  issues: { error: number; warning: number; info: number }
}

export type TufUnlinkedResult = {
  snapshot: { id: string; sourceVersion: string | null; importedAt: string } | null
  total: number
  rows: TufUnlinkedRow[]
}

export async function listTufUnlinked(
  db: DbClient,
  input: { snapshotId?: string | null; search?: string; limit?: number; offset?: number },
): Promise<TufUnlinkedResult> {
  const search = input.search?.trim() ?? ''
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const offset = Math.max(input.offset ?? 0, 0)

  const snapshotResult = input.snapshotId
    ? await db.query(
        `SELECT id,source_version,imported_at
         FROM import_snapshots
         WHERE source='TUF' AND id=$1`,
        [input.snapshotId],
      )
    : await db.query(
        `SELECT id,source_version,imported_at
         FROM import_snapshots
         WHERE source='TUF'
         ORDER BY imported_at DESC
         LIMIT 1`,
      )

  if (!snapshotResult.rowCount) {
    if (input.snapshotId) throw new TufReconciliationError(404, 'TUF snapshot not found')
    return { snapshot: null, total: 0, rows: [] }
  }

  const snapshot = snapshotResult.rows[0]
  const where = `o.snapshot_id=$1 AND o.source='TUF' AND o.linked_level_id IS NULL
    AND ($2='' OR o.external_id ILIKE '%' || $2 || '%'
      OR coalesce(o.song,'') ILIKE '%' || $2 || '%'
      OR coalesce(o.title,'') ILIKE '%' || $2 || '%'
      OR coalesce(o.creator,'') ILIKE '%' || $2 || '%')`

  const [countResult, rowsResult] = await Promise.all([
    db.query(`SELECT count(*)::int AS count FROM external_level_observations o WHERE ${where}`, [snapshot.id, search]),
    db.query(
      `SELECT o.id,o.snapshot_id,o.external_id,o.sha256,o.song,o.title,o.creator,o.download_url,
              o.difficulty_label,o.observed_at,
              coalesce(refs.reference_count,0)::int AS reference_count,
              coalesce(refs.reference_types,'{}'::text[]) AS reference_types,
              coalesce(issues.error_count,0)::int AS error_count,
              coalesce(issues.warning_count,0)::int AS warning_count,
              coalesce(issues.info_count,0)::int AS info_count
       FROM external_level_observations o
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS reference_count,
                array_agg(DISTINCT r.reference_type ORDER BY r.reference_type)
                  FILTER (WHERE r.reference_type IS NOT NULL) AS reference_types
         FROM external_reference_observations r
         WHERE r.snapshot_id=o.snapshot_id AND r.source='TUF' AND r.external_id=o.external_id
       ) refs ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE i.severity='ERROR')::int AS error_count,
                count(*) FILTER (WHERE i.severity='WARNING')::int AS warning_count,
                count(*) FILTER (WHERE i.severity='INFO')::int AS info_count
         FROM import_issues i
         WHERE i.snapshot_id=o.snapshot_id AND i.source='TUF' AND i.external_id=o.external_id
       ) issues ON true
       WHERE ${where}
       ORDER BY o.difficulty_label NULLS LAST,o.title NULLS LAST,o.external_id
       LIMIT $3 OFFSET $4`,
      [snapshot.id, search, limit, offset],
    ),
  ])

  return {
    snapshot: { id: snapshot.id, sourceVersion: snapshot.source_version, importedAt: snapshot.imported_at },
    total: countResult.rows[0]?.count ?? 0,
    rows: rowsResult.rows.map((row) => ({
      observationId: row.id,
      snapshotId: row.snapshot_id,
      externalId: row.external_id,
      sha256: row.sha256,
      song: row.song,
      title: row.title,
      creator: row.creator,
      downloadUrl: row.download_url,
      difficultyLabel: row.difficulty_label,
      observedAt: row.observed_at,
      referenceCount: row.reference_count,
      referenceTypes: row.reference_types ?? [],
      issues: { error: row.error_count, warning: row.warning_count, info: row.info_count },
    })),
  }
}

type LinkInput = { observationId: string; levelId: string; levelVersionId?: string | null; actorId: string | null }

async function linkTufObservationInTransaction(db: DbClient, input: LinkInput) {
  const observationResult = await db.query(
    `SELECT id,snapshot_id,external_id,sha256,title,creator,difficulty_label,linked_level_id
     FROM external_level_observations
     WHERE id=$1 AND source='TUF'
     FOR UPDATE`,
    [input.observationId],
  )
  if (!observationResult.rowCount) throw new TufReconciliationError(404, 'TUF observation not found')
  const observation = observationResult.rows[0]
  if (observation.linked_level_id && observation.linked_level_id !== input.levelId) {
    throw new TufReconciliationError(409, 'This TUF observation is already linked to a different ELF level')
  }

  const levelResult = await db.query(
    `SELECT id,song,title,artist,creator,effecter FROM levels WHERE id=$1 AND status<>'ARCHIVED'`,
    [input.levelId],
  )
  if (!levelResult.rowCount) throw new TufReconciliationError(404, 'ELF level not found')
  const level = levelResult.rows[0]

  let version: { id: string; label: string; sha256: string | null } | null = null
  if (input.levelVersionId) {
    const versionResult = await db.query(
      `SELECT id,label,sha256 FROM level_versions WHERE id=$1 AND level_id=$2`,
      [input.levelVersionId, input.levelId],
    )
    if (!versionResult.rowCount) {
      throw new TufReconciliationError(400, 'Selected ELF version does not belong to the selected level')
    }
    const selectedVersion = versionResult.rows[0] as { id: string; label: string; sha256: string | null }
    version = selectedVersion
    if (observation.sha256 && selectedVersion.sha256 && observation.sha256.toLowerCase() !== selectedVersion.sha256.toLowerCase()) {
      throw new TufReconciliationError(409, 'TUF SHA-256 conflicts with the selected ELF version SHA-256')
    }
  }

  const mappingResult = await db.query(
    `INSERT INTO external_level_ids(level_id,source,external_id)
     VALUES ($1,'TUF',$2)
     ON CONFLICT(source,external_id)
     DO UPDATE SET level_id=external_level_ids.level_id
     RETURNING level_id`,
    [input.levelId, observation.external_id],
  )
  if (mappingResult.rows[0]?.level_id !== input.levelId) {
    throw new TufReconciliationError(409, 'This TUF ID is already mapped to a different ELF level')
  }

  await Promise.all([
    db.query(
      `UPDATE external_level_observations
       SET linked_level_id=$1
       WHERE source='TUF' AND external_id=$2`,
      [input.levelId, observation.external_id],
    ),
    db.query(
      `UPDATE external_rating_observations
       SET level_id=$1
       WHERE source='TUF' AND external_id=$2`,
      [input.levelId, observation.external_id],
    ),
    db.query(
      `UPDATE external_reference_observations
       SET linked_level_id=$1
       WHERE source='TUF' AND external_id=$2`,
      [input.levelId, observation.external_id],
    ),
    db.query(
      `UPDATE import_issues
       SET linked_level_id=$1
       WHERE source='TUF' AND external_id=$2`,
      [input.levelId, observation.external_id],
    ),
  ])

  if (version) {
    await Promise.all([
      db.query(
        `UPDATE external_level_observations
         SET linked_level_version_id=$1
         WHERE snapshot_id=$2 AND source='TUF' AND external_id=$3`,
        [version.id, observation.snapshot_id, observation.external_id],
      ),
      db.query(
        `UPDATE external_rating_observations
         SET level_version_id=$1
         WHERE snapshot_id=$2 AND source='TUF' AND external_id=$3`,
        [version.id, observation.snapshot_id, observation.external_id],
      ),
      db.query(
        `UPDATE external_reference_observations
         SET linked_level_version_id=$1
         WHERE snapshot_id=$2 AND source='TUF' AND external_id=$3`,
        [version.id, observation.snapshot_id, observation.external_id],
      ),
      db.query(
        `UPDATE import_issues
         SET linked_level_version_id=$1
         WHERE snapshot_id=$2 AND source='TUF' AND external_id=$3`,
        [version.id, observation.snapshot_id, observation.external_id],
      ),
    ])
  }

  await audit(db, input.actorId, 'TUF_MANUAL_LINK', 'external_level_observation', observation.id, {
    snapshotId: observation.snapshot_id,
    externalId: observation.external_id,
    tufTitle: observation.title,
    tufCreator: observation.creator,
    tufDifficulty: observation.difficulty_label,
    tufSha256: observation.sha256,
    levelId: level.id,
    levelSong: level.song,
    levelTitle: level.title,
    levelArtist: level.artist,
    levelCreator: level.creator,
    levelEffecter: level.effecter,
    levelVersionId: version?.id ?? null,
    levelVersionLabel: version?.label ?? null,
    levelVersionSha256: version?.sha256 ?? null,
  })

  return {
    observation: {
      id: observation.id,
      snapshotId: observation.snapshot_id,
      externalId: observation.external_id,
    },
    level: {
      id: level.id,
      song: level.song,
      title: level.title,
      artist: level.artist,
      creator: level.creator,
      effecter: level.effecter,
    },
    version: version ? { id: version.id, label: version.label, sha256: version.sha256 } : null,
  }
}

export async function linkTufObservation(db: DbClient, input: LinkInput) {
  return inTransaction(db, () => linkTufObservationInTransaction(db, input))
}

export async function createLevelFromTufObservation(
  db: DbClient,
  input: {
    observationId: string
    song?: string | null
    title?: string | null
    artist?: string | null
    creator?: string | null
    effecter?: string | null
    status?: string | null
    versionLabel?: string | null
    sha256?: string | null
    downloadUrl?: string | null
    videoUrl?: string | null
    notes?: string | null
    actorId: string | null
  },
) {
  return inTransaction(db, async () => {
    const observationResult = await db.query(
      `SELECT id,snapshot_id,external_id,sha256,song,title,creator,download_url,difficulty_label,linked_level_id
       FROM external_level_observations
       WHERE id=$1 AND source='TUF'
       FOR UPDATE`,
      [input.observationId],
    )
    if (!observationResult.rowCount) throw new TufReconciliationError(404, 'TUF observation not found')
    const observation = observationResult.rows[0]
    if (observation.linked_level_id) throw new TufReconciliationError(409, 'TUF observation is already linked to an ELF level')

    const existingMapping = await db.query(
      `SELECT level_id FROM external_level_ids WHERE source='TUF' AND external_id=$1 FOR UPDATE`,
      [observation.external_id],
    )
    if (existingMapping.rowCount) {
      throw new TufReconciliationError(409, 'This TUF ID is already mapped to an ELF level; reconcile it instead of creating a duplicate')
    }

    const song = input.song?.trim() || observation.song?.trim() || observation.title?.trim() || `TUF #${observation.external_id}`
    // `title` remains a DB/API compatibility alias. New metadata UI does not ask
    // staff for a second chart title; new records default it to the song name.
    const title = input.title?.trim() || song
    // TUF's current normalized observation does not expose a dedicated artist
    // field, so old clients/imports remain compatible with Unknown while the new
    // staff form asks for the actual artist before creation.
    const artist = input.artist?.trim() || 'Unknown'
    const creator = input.creator?.trim() || observation.creator?.trim() || 'Unknown'
    const effecter = input.effecter?.trim() || null
    const versionLabel = input.versionLabel?.trim() || 'Original'
    const status = input.status?.trim() || 'LISTED'
    if (!['LISTED','UNLISTED','ARCHIVED'].includes(status)) throw new TufReconciliationError(400, 'Invalid level status')

    const suppliedSha = input.sha256 === undefined ? observation.sha256 : input.sha256?.trim() || null
    if (suppliedSha && !/^[a-fA-F0-9]{64}$/.test(suppliedSha)) throw new TufReconciliationError(400, 'sha256 must be 64 hex chars or null')
    if (observation.sha256 && suppliedSha && observation.sha256.toLowerCase() !== suppliedSha.toLowerCase()) {
      throw new TufReconciliationError(409, 'Edited SHA-256 conflicts with the TUF observation; clear it or keep the imported SHA')
    }
    const sha256 = suppliedSha?.toLowerCase() ?? null
    const downloadUrl = input.downloadUrl === undefined ? observation.download_url : input.downloadUrl?.trim() || null
    const videoUrl = input.videoUrl?.trim() || null
    const notes = input.notes?.trim() || null

    const levelResult = await db.query(
      `INSERT INTO levels(song,title,artist,creator,effecter,status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [song, title, artist, creator, effecter, status],
    )
    const level = levelResult.rows[0]
    const versionResult = await db.query(
      `INSERT INTO level_versions(level_id,label,sha256,download_url,video_url,notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [level.id, versionLabel, sha256, downloadUrl, videoUrl, notes],
    )
    const version = versionResult.rows[0]
    await db.query('UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1', [level.id, version.id])

    await audit(db, input.actorId, 'LEVEL_CREATE', 'level', level.id, {
      versionId: version.id,
      source: 'TUF_RECONCILIATION',
      sourceObservationId: observation.id,
      externalId: observation.external_id,
      artist,
      effecter,
    })

    const linked = await linkTufObservationInTransaction(db, {
      observationId: observation.id,
      levelId: level.id,
      levelVersionId: version.id,
      actorId: input.actorId,
    })

    await audit(db, input.actorId, 'TUF_CREATE_LEVEL', 'level', level.id, {
      observationId: observation.id,
      snapshotId: observation.snapshot_id,
      externalId: observation.external_id,
      tufDifficulty: observation.difficulty_label,
      importedSha256: observation.sha256,
      createdVersionId: version.id,
      canonicalRatingCreated: false,
    })

    return {
      ...linked,
      level: { ...linked.level, song, title, artist, creator, effecter, status },
      version: {
        id: version.id,
        label: version.label,
        sha256: version.sha256,
        downloadUrl: version.download_url,
        videoUrl: version.video_url,
        notes: version.notes,
      },
      canonicalRating: null,
    }
  })
}
