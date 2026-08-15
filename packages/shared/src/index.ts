export const FAMILIES = ['P', 'G', 'U'] as const
export type Family = (typeof FAMILIES)[number]

export const USER_ROLES = ['VIEWER', 'RATER', 'REFERENCE_MANAGER', 'MODERATOR', 'ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const REFERENCE_STATUSES = ['ACTIVE', 'NEEDS_REVIEW', 'RETIRED'] as const
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number]

export const PROPOSAL_STATUSES = ['OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const PROPOSAL_TYPES = ['RERATE', 'REFERENCE_ADD', 'REFERENCE_MOVE', 'REFERENCE_REMOVE', 'METADATA', 'OTHER'] as const
export type ProposalType = (typeof PROPOSAL_TYPES)[number]

export const RATING_LEANS = [-2, -1, 0, 1, 2] as const
export type RatingLean = (typeof RATING_LEANS)[number]

export const RATING_LEAN_LABELS: Record<RatingLean, string> = {
  [-2]: 'かなり下寄り',
  [-1]: 'やや下寄り',
  [0]: '妥当',
  [1]: 'やや上寄り',
  [2]: 'かなり上寄り',
}

/**
 * Evidence-only score used for aggregation/plots. It is deliberately not a
 * canonical difficulty. Canonical ratings stay integer P/G/U tiers.
 */
export function voteEvidenceScore(anchorTier: number, lean: RatingLean): number {
  return anchorTier + lean * 0.2
}

export function familyTierLabel(family: Family, tier: number): string {
  return `${family}${tier}`
}

export interface SessionUser {
  id: string
  email: string
  displayName: string
  role: UserRole
}

export interface PublicStats {
  levels: number
  activeReferences: number
  openProposals: number
  ratingVotes: number
}

export interface LevelListItem {
  id: string
  song: string
  title: string
  creator: string
  status: string
  currentVersionId: string | null
  currentRating: { family: Family; tier: number; confidence: number | null } | null
  voteCount: number
}

export interface LevelDetail extends LevelListItem {
  versions: Array<{
    id: string
    label: string
    sha256: string | null
    downloadUrl: string | null
    notes: string | null
    createdAt: string
  }>
  ratingHistory: Array<{
    id: string
    levelVersionId: string
    family: Family
    tier: number
    confidence: number | null
    reason: string | null
    effectiveFrom: string
    effectiveTo: string | null
  }>
  voteSummary: Array<{
    family: Family
    anchorTier: number
    count: number
    medianEvidence: number
    meanEvidence: number
  }>
  references: Array<{
    id: string
    family: Family
    tier: number
    technique: string
    positionHint: RatingLean | null
    status: ReferenceStatus
    confidence: number | null
  }>
}

export interface ReferenceRow {
  id: string
  levelId: string
  levelVersionId: string
  levelTitle: string
  family: Family
  tier: number
  technique: string
  positionHint: RatingLean | null
  status: ReferenceStatus
  confidence: number | null
  notes: string | null
}

export interface ProposalRow {
  id: string
  type: ProposalType
  levelId: string
  levelTitle: string
  title: string
  payload: Record<string, unknown>
  reason: string
  status: ProposalStatus
  proposerName: string
  createdAt: string
  agree: number
  disagree: number
  abstain: number
  decisionReason: string | null
}
