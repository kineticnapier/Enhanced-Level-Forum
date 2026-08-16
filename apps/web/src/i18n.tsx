import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'ja' | 'en'
type Vars = Record<string, string | number>

const ja: Record<string, string> = {
  'language.label': '言語',
  'language.ja': '日本語',
  'language.en': 'English',
  'nav.levels': '譜面',
  'nav.references': '基準譜面',
  'nav.proposals': '提案',
  'auth.login': 'ログイン',
  'auth.logout': 'ログアウト',
  'auth.email': 'メールアドレス',
  'auth.password': 'パスワード',
  'auth.loginFailed': 'ログインに失敗しました',
  'home.title': 'ADOFAI 難易度データベース',
  'home.description': '難易度評価、基準譜面、提案、譜面の更新履歴をまとめて確認できます。',
  'home.browseLevels': '譜面を見る',
  'home.viewProposals': '提案を見る',
  'stats.levels': '譜面数',
  'stats.references': '有効な基準譜面',
  'stats.proposals': '審議中の提案',
  'stats.votes': '難易度評価',
  'common.database': 'データベース',
  'common.search': '検索',
  'common.apply': '適用',
  'common.clear': 'クリア',
  'common.previous': '前へ',
  'common.next': '次へ',
  'common.loading': '読み込み中…',
  'common.unrated': '未評価',
  'common.current': '現在',
  'common.none': 'なし',
  'common.by': '制作: {name}',
  'common.details': '詳細',
  'common.saved': '保存しました',
  'levels.title': '譜面',
  'levels.count': '{count} 件',
  'levels.searchPlaceholder': '譜面名 / 楽曲名 / 制作者',
  'levels.allFamilies': 'すべての系統',
  'levels.tier': '段階',
  'levels.referenceTechnique': '基準譜面の技法',
  'levels.ratedAll': '評価済み + 未評価',
  'levels.ratedOnly': '評価済みのみ',
  'levels.unratedOnly': '未評価のみ',
  'levels.sortRating': '難易度順',
  'levels.sortTitle': '譜面名順',
  'levels.sortVotes': '評価数が多い順',
  'levels.sortRecent': '更新が新しい順',
  'levels.colRating': '難易度',
  'levels.colLevel': '楽曲 / 譜面',
  'levels.colCreator': '制作者',
  'levels.colEvidence': '判断材料',
  'levels.votes': '{count} 件の評価',
  'levels.references': '基準譜面 {count} 件',
  'levels.empty': '条件に一致する譜面がありません。',
  'levels.searchFailed': '譜面の検索に失敗しました',
  'level.loadFailed': '譜面の読み込みに失敗しました',
  'level.versions': '版',
  'level.versionCount': '{count} 版',
  'level.currentVotes': '現行版の評価 {count} 件',
  'level.referenceCount': '基準譜面 {count} 件',
  'level.openProposalCount': '審議中の提案 {count} 件',
  'level.noSha': 'SHA-256 未登録',
  'level.download': '配布元を開く',
  'level.ratingHistory': '難易度の履歴',
  'level.noRatingHistory': '確定難易度の履歴はありません。',
  'level.noDecisionNote': '決定理由なし',
  'level.evidence': 'みんなの難易度評価',
  'level.noVotes': '難易度評価はまだありません。',
  'level.median': '中央値 {value}',
  'level.evidenceNote': '集計で得られる小数値は判断材料であり、確定難易度ではありません。',
  'level.confidence': '確信度 {value}/5',
  'level.references': '基準譜面',
  'level.browseAll': 'すべて見る',
  'level.notReference': '基準譜面には登録されていません。',
  'level.relatedProposals': '関連する提案',
  'level.allProposals': 'すべての提案',
  'level.noProposals': 'この譜面に関する提案はありません。',
  'vote.title': '難易度評価を追加・更新',
  'vote.description': '整数の段階を基準にし、その周辺を5段階の傾きで記録します。',
  'vote.family': '系統',
  'vote.anchorTier': '基準段階',
  'vote.lean': '傾き',
  'vote.confidence': '確信度',
  'vote.comment': '理由 / 比較した基準譜面',
  'vote.save': '評価を保存',
  'vote.failed': '評価の保存に失敗しました',
  'lean.-2': 'かなり低め',
  'lean.-1': 'やや低め',
  'lean.0': '中央',
  'lean.1': 'やや高め',
  'lean.2': 'かなり高め',
  'references.title': '基準譜面',
  'references.eyebrow': '基準譜面も再検討できます',
  'references.count': '{count} 件',
  'references.searchPlaceholder': '譜面 / 楽曲 / 制作者 / 技法',
  'references.technique': '技法',
  'references.allStatuses': 'すべての状態',
  'references.coverage': '配置状況',
  'references.coverageHelp': 'セルを選ぶと一覧を絞り込みます。「!」は要確認の基準譜面がある段階です。',
  'references.slot': '位置',
  'references.levelVersion': '譜面 / 版',
  'references.status': '状態',
  'references.notes': 'メモ',
  'references.noPosition': '位置指定なし',
  'references.position': '位置 {value}',
  'references.searchFailed': '基準譜面の検索に失敗しました',
  'proposals.title': '提案',
  'proposals.eyebrow': '審議',
  'proposals.count': '{count} 件',
  'proposals.searchPlaceholder': '提案 / 譜面 / 理由',
  'proposals.allStatuses': 'すべての状態',
  'proposals.allTypes': 'すべての種類',
  'proposals.create': '提案を作成',
  'proposals.noMatch': '条件に一致する提案がありません。',
  'proposals.loadingFailed': '提案の読み込みに失敗しました',
  'proposals.agree': '賛成',
  'proposals.disagree': '反対',
  'proposals.abstain': '保留',
  'proposals.detailsVote': '詳細 / 投票',
  'proposals.you': '自分: {vote}',
  'proposal.back': '← 提案一覧',
  'proposal.proposedBy': '{name} が提案 · {date}',
  'proposal.proposedChange': '変更内容',
  'proposal.reason': '理由',
  'proposal.decision': '決定',
  'proposal.vote': '投票',
  'proposal.voters': '投票者',
  'proposal.noVotes': 'まだ投票はありません。',
  'proposal.discussion': 'コメント',
  'proposal.noComments': 'コメントはまだありません。',
  'proposal.commentPlaceholder': '補足、比較対象、確認事項など',
  'proposal.postComment': 'コメントを投稿',
  'proposal.loginToVote': '投票するにはログインしてください。',
  'proposal.loginToComment': 'コメントするにはログインしてください。',
  'proposal.votingClosed': '投票は終了しています。',
  'proposal.voteFailed': '投票に失敗しました',
  'proposal.commentFailed': 'コメントの投稿に失敗しました',
  'proposal.loadFailed': '提案の読み込みに失敗しました',
  'proposal.noReference': '基準譜面なし',
  'proposal.reference': '基準譜面',
  'proposal.retired': '廃止',
  'proposal.position': '位置 {value}',
  'proposal.newTitle': '新しい提案',
  'proposal.level': '譜面',
  'proposal.type': '種類',
  'proposal.select': '選択',
  'proposal.proposedFamily': '変更後の系統',
  'proposal.proposedTier': '変更後の段階',
  'proposal.serverBaseline': '現在の確定難易度を、適用時の照合基準としてサーバー側で記録します。',
  'proposal.technique': '技法',
  'proposal.positionLabel': '位置',
  'proposal.noHint': '指定なし',
  'proposal.lower': '低め',
  'proposal.slightlyLower': 'やや低め',
  'proposal.center': '中央',
  'proposal.slightlyHigher': 'やや高め',
  'proposal.higher': '高め',
  'proposal.referenceNotes': '基準譜面のメモ（任意）',
  'proposal.selectReference': '基準譜面を選択',
  'proposal.moveNote': '移動では技法・確信度・メモを維持し、難易度位置だけを変更します。',
  'proposal.targetFamily': '移動先の系統',
  'proposal.targetTier': '移動先の段階',
  'proposal.titlePlaceholder': '提案の題名',
  'proposal.reasonPlaceholder': '理由・比較対象・根拠',
  'proposal.createButton': '提案を作成',
  'proposal.createFailed': '提案の作成に失敗しました',
  'status.ACTIVE': '有効',
  'status.NEEDS_REVIEW': '要確認',
  'status.RETIRED': '廃止',
  'status.OPEN': '審議中',
  'status.APPROVED': '承認',
  'status.REJECTED': '却下',
  'status.WITHDRAWN': '取り下げ',
  'status.CLOSED': '終了',
  'execution.READY': '適用可能',
  'execution.STALE': '情報が古い',
  'execution.INCOMPLETE': '情報不足',
  'execution.STATUS_ONLY': '状態のみ',
  'execution.CLOSED': '終了',
  'proposalType.RERATE': '難易度変更',
  'proposalType.REFERENCE_ADD': '基準譜面を追加',
  'proposalType.REFERENCE_MOVE': '基準譜面を移動',
  'proposalType.REFERENCE_REMOVE': '基準譜面を削除',
  'proposalType.METADATA': '情報修正',
  'proposalType.OTHER': 'その他',
  'role.VIEWER': '閲覧者',
  'role.RATER': '評価者',
  'role.REFERENCE_MANAGER': '基準譜面管理者',
  'role.MODERATOR': 'モデレーター',
  'role.ADMIN': '管理者',
}

const en: Record<string, string> = {
  ...ja,
  'language.label': 'Language', 'language.ja': '日本語', 'language.en': 'English',
  'nav.levels': 'Levels', 'nav.references': 'References', 'nav.proposals': 'Proposals',
  'auth.login': 'Login', 'auth.logout': 'Logout', 'auth.email': 'Email', 'auth.password': 'Password', 'auth.loginFailed': 'Login failed',
  'home.title': 'ADOFAI Difficulty Database', 'home.description': 'Community ratings, References, proposals, and level history.', 'home.browseLevels': 'Browse levels', 'home.viewProposals': 'View proposals',
  'stats.levels': 'Levels', 'stats.references': 'Active References', 'stats.proposals': 'Open Proposals', 'stats.votes': 'Rating Votes',
  'common.database': 'Database', 'common.search': 'Search', 'common.apply': 'Apply', 'common.clear': 'Clear', 'common.previous': 'Previous', 'common.next': 'Next', 'common.loading': 'Loading…', 'common.unrated': 'Unrated', 'common.current': 'current', 'common.none': 'None', 'common.by': 'by {name}', 'common.details': 'Details', 'common.saved': 'Saved',
  'levels.title': 'Levels', 'levels.count': '{count} level(s)', 'levels.searchPlaceholder': 'Title / song / creator', 'levels.allFamilies': 'All families', 'levels.tier': 'Tier', 'levels.referenceTechnique': 'Reference technique', 'levels.ratedAll': 'Rated + unrated', 'levels.ratedOnly': 'Rated only', 'levels.unratedOnly': 'Unrated only', 'levels.sortRating': 'Rating order', 'levels.sortTitle': 'Title', 'levels.sortVotes': 'Most votes', 'levels.sortRecent': 'Recently updated', 'levels.colRating': 'Rating', 'levels.colLevel': 'Song / Level', 'levels.colCreator': 'Creator', 'levels.colEvidence': 'Evidence', 'levels.votes': '{count} votes', 'levels.references': '{count} active/review References', 'levels.empty': 'No levels match these filters.', 'levels.searchFailed': 'Level search failed',
  'level.loadFailed': 'Level loading failed', 'level.versions': 'Versions', 'level.versionCount': '{count} version(s)', 'level.currentVotes': '{count} current-version vote(s)', 'level.referenceCount': '{count} active/review Reference(s)', 'level.openProposalCount': '{count} open proposal(s)', 'level.noSha': 'no sha256', 'level.download': 'Download source', 'level.ratingHistory': 'Rating history', 'level.noRatingHistory': 'No canonical rating history.', 'level.noDecisionNote': 'No decision note', 'level.evidence': 'Community difficulty evidence', 'level.noVotes': 'No difficulty votes yet.', 'level.median': 'median {value}', 'level.evidenceNote': 'The decimal evidence score is an aggregation aid only; it is not a canonical difficulty.', 'level.confidence': 'confidence {value}/5', 'level.references': 'References', 'level.browseAll': 'Browse all', 'level.notReference': 'Not a Reference.', 'level.relatedProposals': 'Related proposals', 'level.allProposals': 'All proposals', 'level.noProposals': 'No proposals for this Level.',
  'vote.title': 'Add / update difficulty evidence', 'vote.description': 'Anchor an integer tier, then record only a coarse five-step lean around it.', 'vote.family': 'Family', 'vote.anchorTier': 'Anchor tier', 'vote.lean': 'Lean', 'vote.confidence': 'Confidence', 'vote.comment': 'Reason / comparison References', 'vote.save': 'Save evidence', 'vote.failed': 'Vote failed',
  'lean.-2': 'much lower', 'lean.-1': 'slightly lower', 'lean.0': 'center', 'lean.1': 'slightly higher', 'lean.2': 'much higher',
  'references.title': 'References', 'references.eyebrow': 'Anchors are reviewable', 'references.count': '{count} matching Reference(s)', 'references.searchPlaceholder': 'Level / song / creator / technique', 'references.technique': 'Technique', 'references.allStatuses': 'All statuses', 'references.coverage': 'Coverage matrix', 'references.coverageHelp': 'Click a cell to filter the table. ! means the slot has References awaiting review.', 'references.slot': 'Slot', 'references.levelVersion': 'Level / Version', 'references.status': 'Status', 'references.notes': 'Notes', 'references.noPosition': 'no position hint', 'references.position': 'position {value}', 'references.searchFailed': 'Reference search failed',
  'proposals.title': 'Proposals', 'proposals.eyebrow': 'Governance', 'proposals.count': '{count} matching proposal(s)', 'proposals.searchPlaceholder': 'Proposal / Level / reason', 'proposals.allStatuses': 'All statuses', 'proposals.allTypes': 'All types', 'proposals.create': 'Create proposal', 'proposals.noMatch': 'No proposals match these filters.', 'proposals.loadingFailed': 'Proposal loading failed', 'proposals.agree': 'Agree', 'proposals.disagree': 'Disagree', 'proposals.abstain': 'Abstain', 'proposals.detailsVote': 'Details / vote', 'proposals.you': 'You: {vote}',
  'proposal.back': '← Proposals', 'proposal.proposedBy': 'proposed by {name} · {date}', 'proposal.proposedChange': 'Proposed change', 'proposal.reason': 'Reason', 'proposal.decision': 'Decision', 'proposal.vote': 'Vote', 'proposal.voters': 'Voters', 'proposal.noVotes': 'No votes yet.', 'proposal.discussion': 'Discussion', 'proposal.noComments': 'No comments yet.', 'proposal.commentPlaceholder': 'Add context, comparisons, or review notes', 'proposal.postComment': 'Post comment', 'proposal.loginToVote': 'Login to vote.', 'proposal.loginToComment': 'Login to join the discussion.', 'proposal.votingClosed': 'Voting is closed.', 'proposal.voteFailed': 'Vote failed', 'proposal.commentFailed': 'Comment failed', 'proposal.loadFailed': 'Proposal loading failed', 'proposal.noReference': 'no Reference', 'proposal.reference': 'Reference', 'proposal.retired': 'RETIRED', 'proposal.position': 'position {value}', 'proposal.newTitle': 'New proposal', 'proposal.level': 'Level', 'proposal.type': 'Type', 'proposal.select': 'Select', 'proposal.proposedFamily': 'Proposed family', 'proposal.proposedTier': 'Proposed tier', 'proposal.serverBaseline': 'The server captures the current canonical slot as the execution baseline.', 'proposal.technique': 'Technique', 'proposal.positionLabel': 'Position', 'proposal.noHint': 'No hint', 'proposal.lower': 'lower', 'proposal.slightlyLower': 'slightly lower', 'proposal.center': 'center', 'proposal.slightlyHigher': 'slightly higher', 'proposal.higher': 'higher', 'proposal.referenceNotes': 'Reference notes (optional)', 'proposal.selectReference': 'Select Reference', 'proposal.moveNote': 'Move preserves technique/confidence/notes and changes only slot/position.', 'proposal.targetFamily': 'Target family', 'proposal.targetTier': 'Target tier', 'proposal.titlePlaceholder': 'Proposal title', 'proposal.reasonPlaceholder': 'Reason / comparisons / evidence', 'proposal.createButton': 'Create proposal', 'proposal.createFailed': 'Proposal creation failed',
  'status.ACTIVE': 'Active', 'status.NEEDS_REVIEW': 'Needs review', 'status.RETIRED': 'Retired', 'status.OPEN': 'Open', 'status.APPROVED': 'Approved', 'status.REJECTED': 'Rejected', 'status.WITHDRAWN': 'Withdrawn', 'status.CLOSED': 'Closed',
  'execution.READY': 'Ready', 'execution.STALE': 'Stale', 'execution.INCOMPLETE': 'Incomplete', 'execution.STATUS_ONLY': 'Status only', 'execution.CLOSED': 'Closed',
  'proposalType.RERATE': 'Rerate', 'proposalType.REFERENCE_ADD': 'Add Reference', 'proposalType.REFERENCE_MOVE': 'Move Reference', 'proposalType.REFERENCE_REMOVE': 'Remove Reference', 'proposalType.METADATA': 'Metadata', 'proposalType.OTHER': 'Other',
  'role.VIEWER': 'Viewer', 'role.RATER': 'Rater', 'role.REFERENCE_MANAGER': 'Reference Manager', 'role.MODERATOR': 'Moderator', 'role.ADMIN': 'Admin',
}

function detectLocale(): Locale {
  const stored = localStorage.getItem('elf_locale')
  if (stored === 'ja' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Vars) => string
  date: (value: string | Date) => string
  status: (value: string) => string
  execution: (value: string) => string
  proposalType: (value: string) => string
  role: (value: string) => string
  lean: (value: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const setLocale = (next: Locale) => { localStorage.setItem('elf_locale', next); setLocaleState(next) }
  const value = useMemo<I18nValue>(() => {
    const dict = locale === 'ja' ? ja : en
    const t = (key: string, vars?: Vars) => interpolate(dict[key] ?? en[key] ?? key, vars)
    return {
      locale, setLocale, t,
      date: (value) => new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
      status: (value) => t(`status.${value}`),
      execution: (value) => t(`execution.${value}`),
      proposalType: (value) => t(`proposalType.${value}`),
      role: (value) => t(`role.${value}`),
      lean: (value) => t(`lean.${value}`),
    }
  }, [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n()
  return <select className="locale-switch" aria-label={t('language.label')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
    <option value="ja">{t('language.ja')}</option>
    <option value="en">{t('language.en')}</option>
  </select>
}
