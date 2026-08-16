import type { DbClient } from '../db'
import { inTransaction } from '../db'
import { audit } from '../services'

export class TufEvidenceError extends Error {
  status: 400 | 404 | 409

  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

type Family = 'P' | 'G' | 'U'

type Rating = {
  family: Family
  tier: number
}

export type TufEvidenceRow = {
  observationId: string
  snapshotId: string
  externalId: string
  levelId: string
  levelTitle: string
  levelCreator: string
  targetVersion: {
    id: string
    label: string
    sha256: string | null
    isCurrent: boolean
    linkBasis: 'EXPLICIT_VERSION' | 'LEVEL_CURRENT'
  } | null
  tuf: {
    label: string | null
    family: Family | null
    tier: number | null
  }
  elf: Rating | null
  previousTuf: {
    snapshotId: string
    importedAt: string
    label: string | null
    family: Family | null
    tier: number | null
  } | null
  changedSincePrevious: boolean | null
  matchesCanonical: boolean
  referenceEvidence: Array<{
    family: Family | null
    tier: number | null
    difficultyLabel: string | null
    type: string
  }>
  issues: { error: number; warning: number; info: number }
  existingOpenProposalId: string | null
  proposalEligible: boolean
}

export type TufEvidenceResult = {
  snapshot: { id: string; sourceVersion: string | null; importedAt: string } | null
  total: number
  rows: TufEvidenceRow[]
}

function rating(row: any, familyKey: string, tierKey: string): Rating | null {
  const family = row[familyKey]
  const tier = Number(row[tierKey])
  if ((family === 'P' || family === 'G' || family === 'U') && Number.isInteger(tier) && tier >= 1 && tier <= 30) {
    return { family, tier }
  }
  return null
}

function sameRating(a: Rating | null, b: Rating | null): boolean {
  return !!a && !!b && a.family === b.family && a.tier === b.tier
}

async function resolveSnapshot(
  db: DbClient,
  snapshotId?: string | null,
): Promise<{ id: string; source_version: string | null; imported_at: string } | null> {
  const result = snapshotId
    ? await db.query(
        `SELECT id,source_version,imported_at
         FROM import_snapshots
         WHERE source='TUF' AND id=$1`,
        [snapshotId],
      )
    : await db.query(
        `SELECT id,source_version,imported_at
         FROM import_snapshots
         WHERE source='TUF'
         ORDER BY imported_at DESC
         LIMIT 1`,
      )

  if (!result.rowCount) {
    if (snapshotId) throw new TufEvidenceError(404, 'TUF snapshot not found')
    return null
  }
  return result.rows[0]
}

export async function listTufEvidence(
  db: DbClient,
  input: {
    snapshotId?: string | null
    search?: string
    limit?: number
    offset?: number
    actionableOnly?: boolean
  },
): Promise<TufEvidenceResult> {
  const snapshot = await resolveSnapshot(db, input.snapshotId)
  if (!snapshot) return { snapshot: null, total: 0, rows: [] }

  const search = input.search?.trim() ?? ''
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const offset = Math.max(input.offset ?? 0, 0)
  const actionableOnly = input.actionableOnly ?? false

  const where = `o.snapshot_id=$1
    AND o.source='TUF'
    AND o.linked_level_id IS NOT NULL
    AND ($2='' OR o.external_id ILIKE '%' || $2 || '%'
      OR coalesce(o.song,'') ILIKE '%' || $2 || '%'
      OR coalesce(o.title,'') ILIKE '%' || $2 || '%'
      OR coalesce(o.creator,'') ILIKE '%' || $2 || '%'
      OR coalesce(l.title,'') ILIKE '%' || $2 || '%'
      OR coalesce(l.creator,'') ILIKE '%' || $2 || '%')
    AND ($3::boolean=false OR (
      er.family IS NOT NULL
      AND er.tier IS NOT NULL
      AND coalesce(o.linked_level_version_id,l.current_version_id) IS NOT NULL
      AND (cr.family IS DISTINCT FROM er.family OR cr.tier IS DISTINCT FROM er.tier)
    ))`

  const [countResult, rowsResult] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS count
       FROM external_level_observations o
       JOIN levels l ON l.id=o.linked_level_id
       LEFT JOIN external_rating_observations er
         ON er.snapshot_id=o.snapshot_id AND er.source='TUF' AND er.external_id=o.external_id
       LEFT JOIN canonical_ratings cr
         ON cr.level_version_id=coalesce(o.linked_level_version_id,l.current_version_id)
        AND cr.effective_to IS NULL
       WHERE ${where}`,
      [snapshot.id, search, actionableOnly],
    ),
    db.query(
      `SELECT o.id,o.snapshot_id,o.external_id,o.linked_level_id,o.linked_level_version_id,
              l.title AS level_title,l.creator AS level_creator,l.current_version_id,
              lv.id AS target_version_id,lv.label AS target_version_label,lv.sha256 AS target_version_sha256,
              er.label AS tuf_label,er.family AS tuf_family,er.tier AS tuf_tier,
              cr.family AS elf_family,cr.tier AS elf_tier,
              prev.snapshot_id AS previous_snapshot_id,prev.imported_at AS previous_imported_at,
              prev.label AS previous_tuf_label,prev.family AS previous_tuf_family,prev.tier AS previous_tuf_tier,
              coalesce(refs.items,'[]'::jsonb) AS reference_evidence,
              coalesce(issues.error_count,0)::int AS error_count,
              coalesce(issues.warning_count,0)::int AS warning_count,
              coalesce(issues.info_count,0)::int AS info_count,
              existing.id AS existing_open_proposal_id
       FROM external_level_observations o
       JOIN levels l ON l.id=o.linked_level_id
       LEFT JOIN level_versions lv
         ON lv.id=coalesce(o.linked_level_version_id,l.current_version_id)
       LEFT JOIN external_rating_observations er
         ON er.snapshot_id=o.snapshot_id AND er.source='TUF' AND er.external_id=o.external_id
       LEFT JOIN canonical_ratings cr
         ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
       LEFT JOIN LATERAL (
         SELECT pr.snapshot_id,ps.imported_at,pr.label,pr.family,pr.tier
         FROM external_rating_observations pr
         JOIN import_snapshots ps ON ps.id=pr.snapshot_id
         WHERE pr.source='TUF'
           AND pr.external_id=o.external_id
           AND ps.imported_at < $4::timestamptz
         ORDER BY ps.imported_at DESC
         LIMIT 1
       ) prev ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
                  'family',r.family,
                  'tier',r.tier,
                  'difficultyLabel',r.difficulty_label,
                  'type',r.reference_type
                ) ORDER BY r.family NULLS LAST,r.tier NULLS LAST,r.reference_type) AS items
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
       LEFT JOIN LATERAL (
         SELECT p.id
         FROM proposals p
         WHERE p.level_id=o.linked_level_id
           AND p.type='RERATE'
           AND p.status='OPEN'
           AND p.payload->>'source'='TUF'
           AND p.payload->>'externalId'=o.external_id
           AND p.payload->>'targetLevelVersionId'=coalesce(o.linked_level_version_id,l.current_version_id)::text
           AND p.payload->'proposedRating' @> jsonb_build_object('family',er.family,'tier',er.tier)
         ORDER BY p.created_at DESC
         LIMIT 1
       ) existing ON true
       WHERE ${where}
       ORDER BY
         CASE WHEN er.family IS NOT NULL AND er.tier IS NOT NULL
                    AND (cr.family IS DISTINCT FROM er.family OR cr.tier IS DISTINCT FROM er.tier)
              THEN 0 ELSE 1 END,
         er.family NULLS LAST,er.tier NULLS LAST,l.title,o.external_id
       LIMIT $5 OFFSET $6`,
      [snapshot.id, search, actionableOnly, snapshot.imported_at, limit, offset],
    ),
  ])

  return {
    snapshot: { id: snapshot.id, sourceVersion: snapshot.source_version, importedAt: snapshot.imported_at },
    total: countResult.rows[0]?.count ?? 0,
    rows: rowsResult.rows.map((row) => {
      const tuf = rating(row, 'tuf_family', 'tuf_tier')
      const elf = rating(row, 'elf_family', 'elf_tier')
      const previous = rating(row, 'previous_tuf_family', 'previous_tuf_tier')
      const previousTuf = row.previous_snapshot_id
        ? {
            snapshotId: row.previous_snapshot_id,
            importedAt: row.previous_imported_at,
            label: row.previous_tuf_label,
            family: previous?.family ?? null,
            tier: previous?.tier ?? null,
          }
        : null
      const matchesCanonical = sameRating(tuf, elf)
      const targetVersion = row.target_version_id
        ? {
            id: row.target_version_id,
            label: row.target_version_label,
            sha256: row.target_version_sha256,
            isCurrent: row.target_version_id === row.current_version_id,
            linkBasis: row.linked_level_version_id ? 'EXPLICIT_VERSION' as const : 'LEVEL_CURRENT' as const,
          }
        : null

      return {
        observationId: row.id,
        snapshotId: row.snapshot_id,
        externalId: row.external_id,
        levelId: row.linked_level_id,
        levelTitle: row.level_title,
        levelCreator: row.level_creator,
        targetVersion,
        tuf: { label: row.tuf_label, family: tuf?.family ?? null, tier: tuf?.tier ?? null },
        elf,
        previousTuf,
        changedSincePrevious: previousTuf ? previousTuf.label !== row.tuf_label : null,
        matchesCanonical,
        referenceEvidence: Array.isArray(row.reference_evidence) ? row.reference_evidence : [],
        issues: { error: row.error_count, warning: row.warning_count, info: row.info_count },
        existingOpenProposalId: row.existing_open_proposal_id ?? null,
        proposalEligible: !!targetVersion && !!tuf && !matchesCanonical && !row.existing_open_proposal_id,
      }
    }),
  }
}

async function proposalContext(db: DbClient, observationId: string) {
  const result = await db.query(
    `SELECT o.id,o.snapshot_id,o.external_id,o.linked_level_id,o.linked_level_version_id,
            s.imported_at,l.title AS level_title,l.current_version_id,
            lv.id AS target_version_id,lv.label AS target_version_label,
            er.label AS tuf_label,er.family AS tuf_family,er.tier AS tuf_tier,
            cr.family AS elf_family,cr.tier AS elf_tier
     FROM external_level_observations o
     JOIN import_snapshots s ON s.id=o.snapshot_id AND s.source='TUF'
     LEFT JOIN levels l ON l.id=o.linked_level_id
     LEFT JOIN level_versions lv ON lv.id=coalesce(o.linked_level_version_id,l.current_version_id)
     LEFT JOIN external_rating_observations er
       ON er.snapshot_id=o.snapshot_id AND er.source='TUF' AND er.external_id=o.external_id
     LEFT JOIN canonical_ratings cr
       ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
     WHERE o.id=$1 AND o.source='TUF'`,
    [observationId],
  )
  if (!result.rowCount) throw new TufEvidenceError(404, 'TUF observation not found')
  return result.rows[0]
}

export async function createTufRerateProposal(
  db: DbClient,
  input: { observationId: string; actorId: string; reason?: string | null },
) {
  return inTransaction(db, async () => {
    const row = await proposalContext(db, input.observationId)
    if (!row.linked_level_id) throw new TufEvidenceError(409, 'TUF observation must be linked to an ELF level first')
    if (!row.target_version_id) throw new TufEvidenceError(409, 'Linked ELF level has no target version for a rating proposal')

    const latest = await db.query(
      `SELECT id FROM import_snapshots WHERE source='TUF' ORDER BY imported_at DESC LIMIT 1`,
    )
    if (latest.rows[0]?.id !== row.snapshot_id) {
      throw new TufEvidenceError(409, 'TUF evidence is stale; create proposals only from the latest TUF snapshot')
    }

    const tuf = rating(row, 'tuf_family', 'tuf_tier')
    const elf = rating(row, 'elf_family', 'elf_tier')
    if (!tuf) {
      throw new TufEvidenceError(400, 'This TUF difficulty is not a canonical P/G/U integer tier and cannot create a RERATE proposal')
    }
    if (sameRating(tuf, elf)) {
      throw new TufEvidenceError(409, 'ELF canonical rating already matches the latest TUF P/G/U evidence')
    }

    const duplicateKey = {
      source: 'TUF',
      externalId: row.external_id,
      targetLevelVersionId: row.target_version_id,
      proposedRating: tuf,
    }
    const duplicate = await db.query(
      `SELECT id
       FROM proposals
       WHERE level_id=$1 AND type='RERATE' AND status='OPEN'
         AND payload @> $2::jsonb
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.linked_level_id, JSON.stringify(duplicateKey)],
    )
    if (duplicate.rowCount) {
      throw new TufEvidenceError(409, `An open proposal already covers this TUF evidence (${duplicate.rows[0].id})`)
    }

    const [previousResult, refsResult] = await Promise.all([
      db.query(
        `SELECT pr.snapshot_id,ps.imported_at,pr.label,pr.family,pr.tier
         FROM external_rating_observations pr
         JOIN import_snapshots ps ON ps.id=pr.snapshot_id
         WHERE pr.source='TUF' AND pr.external_id=$1 AND ps.imported_at<$2
         ORDER BY ps.imported_at DESC
         LIMIT 1`,
        [row.external_id, row.imported_at],
      ),
      db.query(
        `SELECT family,tier,difficulty_label,reference_type
         FROM external_reference_observations
         WHERE snapshot_id=$1 AND source='TUF' AND external_id=$2
         ORDER BY family NULLS LAST,tier NULLS LAST,reference_type`,
        [row.snapshot_id, row.external_id],
      ),
    ])

    const previousRow = previousResult.rows[0]
    const previous = previousRow ? rating(previousRow, 'family', 'tier') : null
    const currentText = elf ? `${elf.family}${elf.tier}` : 'Unrated'
    const proposedText = `${tuf.family}${tuf.tier}`
    const sourceReason = `Latest TUF evidence for TUF #${row.external_id} reports ${proposedText}; ELF currently has ${currentText}. External evidence only; human review is required before any canonical rating change.`
    const extraReason = input.reason?.trim()
    const reason = extraReason ? `${sourceReason}\n\n${extraReason}` : sourceReason

    const payload = {
      source: 'TUF',
      sourceSnapshotId: row.snapshot_id,
      sourceObservationId: row.id,
      externalId: row.external_id,
      targetLevelVersionId: row.target_version_id,
      targetLevelVersionLabel: row.target_version_label,
      currentCanonicalRating: elf,
      proposedRating: tuf,
      tufDifficultyLabel: row.tuf_label,
      previousTufRating: previousRow
        ? {
            snapshotId: previousRow.snapshot_id,
            importedAt: previousRow.imported_at,
            label: previousRow.label,
            family: previous?.family ?? null,
            tier: previous?.tier ?? null,
          }
        : null,
      referenceEvidence: refsResult.rows.map((ref) => ({
        family: ref.family,
        tier: ref.tier,
        difficultyLabel: ref.difficulty_label,
        type: ref.reference_type,
      })),
      createdFromExternalEvidence: true,
    }

    const inserted = await db.query(
      `INSERT INTO proposals(type,level_id,title,payload,reason,proposer_id)
       VALUES ('RERATE',$1,$2,$3::jsonb,$4,$5)
       RETURNING *`,
      [
        row.linked_level_id,
        `TUF evidence: ${currentText} → ${proposedText}`,
        JSON.stringify(payload),
        reason,
        input.actorId,
      ],
    )
    const proposal = inserted.rows[0]

    await audit(db, input.actorId, 'PROPOSAL_CREATE', 'proposal', proposal.id, {
      type: 'RERATE',
      source: 'TUF',
      sourceSnapshotId: row.snapshot_id,
      externalId: row.external_id,
      targetLevelVersionId: row.target_version_id,
      proposedRating: tuf,
    })

    return {
      proposal: {
        id: proposal.id,
        type: proposal.type,
        levelId: proposal.level_id,
        title: proposal.title,
        payload: proposal.payload,
        reason: proposal.reason,
        status: proposal.status,
        createdAt: proposal.created_at,
      },
    }
  })
}
