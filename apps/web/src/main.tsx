import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  Family,
  LevelDetail,
  LevelListItem,
  ProposalDetail,
  ProposalExecutionState,
  ProposalRow,
  ProposalType,
  ProposalVoteValue,
  PublicStats,
  ReferenceRow,
  SessionUser,
} from '@elf/shared'
import { api } from './api'
import { I18nProvider, LanguageSwitch, useI18n } from './i18n'
import { RatingQueuePage } from './RatingQueue'
import './styles.css'
import './public-level-detail.css'

type Route = {
  page: 'home' | 'levels' | 'level' | 'rating-queue' | 'references' | 'proposals' | 'proposal' | 'login'
  id?: string
}

type PagedLevels = { levels: LevelListItem[]; total: number; limit: number; offset: number }
type PagedReferences = { references: ReferenceRow[]; total: number; limit: number; offset: number }
type PagedProposals = { proposals: ProposalRow[]; total: number; limit: number; offset: number }
type CoverageRow = { family: Family; tier: number; technique: string; active: number; needs_review: number }

const PAGE_SIZE = 30

function parseRoute(): Route {
  const raw = (location.hash || '#/').slice(1)
  const parts = raw.split('/').filter(Boolean)
  if (parts[0] === 'levels' && parts[1]) return { page: 'level', id: parts[1] }
  if (parts[0] === 'levels') return { page: 'levels' }
  if (parts[0] === 'rating-queue') return { page: 'rating-queue' }
  if (parts[0] === 'references') return { page: 'references' }
  if (parts[0] === 'proposals' && parts[1]) return { page: 'proposal', id: parts[1] }
  if (parts[0] === 'proposals') return { page: 'proposals' }
  if (parts[0] === 'login') return { page: 'login' }
  return { page: 'home' }
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute())
  useEffect(() => {
    const onHash = () => setRoute(parseRoute())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return route
}

function RatingBadge({ family, tier }: { family: Family; tier: number }) {
  return <span className={`rating rating-${family.toLowerCase()}`}>{family}{tier}</span>
}

function Status({ value }: { value: string }) {
  const { status } = useI18n()
  return <span className={`status ${value.toLowerCase()}`}>{status(value)}</span>
}

function ExecutionState({ state, message }: { state: ProposalExecutionState; message: string }) {
  const { execution } = useI18n()
  return <span className={`execution execution-${state.toLowerCase()}`} title={message}>{execution(state)}</span>
}

function ratingText(value: unknown, unrated: string): string {
  if (!value || typeof value !== 'object') return unrated
  const row = value as Record<string, unknown>
  if ((row.family === 'P' || row.family === 'G' || row.family === 'U') && Number.isInteger(Number(row.tier))) {
    return `${row.family}${Number(row.tier)}`
  }
  return unrated
}

function ProposalChange({ proposal, compact = false }: { proposal: ProposalRow; compact?: boolean }) {
  const { t } = useI18n()
  const p = proposal.payload ?? {}
  const refText = (value: unknown): string => {
    if (!value || typeof value !== 'object') return t('proposal.reference')
    const row = value as Record<string, unknown>
    const slot = ratingText(row, t('common.unrated'))
    const technique = typeof row.technique === 'string' ? row.technique : 'UNKNOWN'
    const hint = row.positionHint === null || row.positionHint === undefined ? '' : ` · ${t('proposal.position', { value: String(row.positionHint) })}`
    return `${slot} · ${technique}${hint}`
  }
  if (proposal.type === 'RERATE') {
    return <div className="change-line"><span>{ratingText(p.currentCanonicalRating, t('common.unrated'))}</span><b>→</b><strong>{ratingText(p.proposedRating, t('common.unrated'))}</strong></div>
  }
  if (proposal.type === 'REFERENCE_ADD') {
    return <div className="change-line"><span>{t('proposal.noReference')}</span><b>→</b><strong>{refText(p.reference)}</strong></div>
  }
  if (proposal.type === 'REFERENCE_MOVE') {
    return <div className="change-line"><span>{refText(p.baselineReference)}</span><b>→</b><strong>{refText(p.targetReference)}</strong></div>
  }
  if (proposal.type === 'REFERENCE_REMOVE') {
    return <div className="change-line"><span>{refText(p.baselineReference)}</span><b>→</b><strong>{t('proposal.retired')}</strong></div>
  }
  if (compact) return null
  return <pre className="payload">{JSON.stringify(p, null, 2)}</pre>
}

function Pagination({ total, offset, limit, onPage }: { total: number; offset: number; limit: number; onPage: (offset: number) => void }) {
  const { t } = useI18n()
  if (total <= limit && offset === 0) return null
  return <div className="pager">
    <button className="ghost" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>{t('common.previous')}</button>
    <span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} / ${total}` : '0 / 0'}</span>
    <button className="ghost" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>{t('common.next')}</button>
  </div>
}

function App() {
  const { t, role } = useI18n()
  const route = useRoute()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const refreshUser = () => api<{ user: SessionUser | null }>('/auth/me')
    .then((x) => setUser(x.user))
    .finally(() => setAuthLoaded(true))

  useEffect(() => { void refreshUser() }, [])
  const canRate = !!user && ['RATER','REFERENCE_MANAGER','MODERATOR','ADMIN'].includes(user.role)

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="#/">ELF <span>Enhanced Level Forum</span></a>
      <nav>
        <a href="#/levels">{t('nav.levels')}</a>
        {canRate && <a href="#/rating-queue">Rating Queue</a>}
        <a href="#/references">{t('nav.references')}</a>
        <a href="#/proposals">{t('nav.proposals')}</a>
      </nav>
      <div className="account">
        <LanguageSwitch />
        {authLoaded && user ? <>
          <span>{user.displayName}<small>{role(user.role)}</small></span>
          <button className="ghost" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null) }}>{t('auth.logout')}</button>
        </> : <a href="#/login">{t('auth.login')}</a>}
      </div>
    </header>
    <main>
      {route.page === 'home' && <Home />}
      {route.page === 'levels' && <Levels />}
      {route.page === 'level' && route.id && <Level id={route.id} />}
      {route.page === 'rating-queue' && <RatingQueuePage user={user} />}
      {route.page === 'references' && <References />}
      {route.page === 'proposals' && <Proposals user={user} />}
      {route.page === 'proposal' && route.id && <Proposal id={route.id} user={user} />}
      {route.page === 'login' && <Login onLogin={(u) => { setUser(u); location.hash = '#/' }} />}
    </main>
    <footer>Enhanced Level Forum</footer>
  </div>
}

function Home() {
  const { t } = useI18n()
  const [stats, setStats] = useState<PublicStats | null>(null)
  useEffect(() => { void api<PublicStats>('/stats').then(setStats) }, [])
  return <>
    <section className="hero">
      <div>
        <h1>{t('home.title')}</h1>
        <p>{t('home.description')}</p>
        <div className="actions"><a className="button" href="#/levels">{t('home.browseLevels')}</a><a className="button secondary" href="#/proposals">{t('home.viewProposals')}</a></div>
      </div>
    </section>
    <section className="stats-grid">
      <Stat label={t('stats.levels')} value={stats?.levels} />
      <Stat label={t('stats.references')} value={stats?.activeReferences} />
      <Stat label={t('stats.proposals')} value={stats?.openProposals} />
      <Stat label={t('stats.votes')} value={stats?.ratingVotes} />
    </section>
  </>
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="stat"><span>{label}</span><strong>{value ?? '—'}</strong></div>
}

function Levels() {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('')
  const [tier, setTier] = useState('')
  const [technique, setTechnique] = useState('')
  const [rated, setRated] = useState('all')
  const [sort, setSort] = useState('rating')
  const [data, setData] = useState<PagedLevels>({ levels: [], total: 0, limit: PAGE_SIZE, offset: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (nextOffset = 0) => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams({ search, rated, sort, limit: String(PAGE_SIZE), offset: String(nextOffset) })
      if (family) qs.set('family', family)
      if (tier) qs.set('tier', tier)
      if (technique.trim()) qs.set('technique', technique.trim())
      setData(await api<PagedLevels>(`/catalog/levels?${qs}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('levels.searchFailed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(0) }, [family, rated, sort])

  return <section>
    <div className="section-head"><div><p className="eyebrow">{t('common.database')}</p><h1>{t('levels.title')}</h1><p className="muted">{t('levels.count', { count: data.total })}</p></div></div>
    <div className="filter-panel">
      <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(0)} placeholder={t('levels.searchPlaceholder')} />
      <select value={family} onChange={(e) => { setFamily(e.target.value); setTier('') }}><option value="">{t('levels.allFamilies')}</option><option>P</option><option>G</option><option>U</option></select>
      <input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(e.target.value)} placeholder={t('levels.tier')} />
      <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder={t('levels.referenceTechnique')} />
      <select value={rated} onChange={(e) => setRated(e.target.value)}><option value="all">{t('levels.ratedAll')}</option><option value="rated">{t('levels.ratedOnly')}</option><option value="unrated">{t('levels.unratedOnly')}</option></select>
      <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="rating">{t('levels.sortRating')}</option><option value="title">{t('levels.sortTitle')}</option><option value="votes">{t('levels.sortVotes')}</option><option value="recent">{t('levels.sortRecent')}</option></select>
      <button onClick={() => void load(0)}>{t('common.search')}</button>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>{t('levels.colRating')}</th><th>{t('levels.colLevel')}</th><th>{t('levels.colCreator')}</th><th>{t('levels.colEvidence')}</th></tr></thead><tbody>
      {data.levels.map((level) => <tr key={level.id}>
        <td>{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">{t('common.unrated')}</span>}</td>
        <td className="level-list-identity"><a href={`#/levels/${level.id}`}><strong>{level.song}</strong></a><small>{level.artist}</small></td>
        <td>{level.creator}</td>
        <td><span>{t('levels.votes', { count: level.voteCount })}</span><small>{t('levels.references', { count: level.referenceCount })}</small></td>
      </tr>)}
      {!data.levels.length && !loading && <tr><td colSpan={4} className="empty">{t('levels.empty')}</td></tr>}
    </tbody></table></div>
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x) => void load(x)} />
  </section>
}

function Level({ id }: { id: string }) {
  const { t, date, lean, proposalType, locale } = useI18n()
  const [level, setLevel] = useState<LevelDetail | null>(null)
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [error, setError] = useState('')
  const load = async () => {
    setError('')
    try {
      const [detail, related] = await Promise.all([
        api<LevelDetail>(`/catalog/levels/${id}`),
        api<PagedProposals>(`/governance/proposals?levelId=${encodeURIComponent(id)}&limit=8`),
      ])
      setLevel(detail); setProposals(related.proposals)
    } catch (e) { setError(e instanceof Error ? e.message : t('level.loadFailed')) }
  }
  useEffect(() => { void load() }, [id])
  if (error) return <div className="panel error">{error}</div>
  if (!level) return <div className="panel">{t('common.loading')}</div>
  const currentVersion = level.versions.find((version) => version.id === level.currentVersionId) ?? level.versions[0] ?? null
  const copy = locale === 'ja'
    ? { creator:'制作', effecter:'エフェクト', download:'配布ページ', video:'動画を見る', currentVersion:'現行バージョン' }
    : { creator:'Creator', effecter:'Effects', download:'Download', video:'Watch video', currentVersion:'Current version' }

  return <section>
    <div className="level-public-hero">
      <div>
        <p className="level-public-artist">{level.artist}</p>
        <h1>{level.song}</h1>
        <div className="level-public-credits">
          <span><b>{copy.creator}</b>{level.creator}</span>
          {level.effecter && <span><b>{copy.effecter}</b>{level.effecter}</span>}
        </div>
        {(currentVersion?.downloadUrl || currentVersion?.videoUrl) && <div className="level-public-actions">
          {currentVersion.videoUrl && <a className="button" target="_blank" rel="noreferrer" href={currentVersion.videoUrl}>{copy.video}</a>}
          {currentVersion.downloadUrl && <a className="button secondary" target="_blank" rel="noreferrer" href={currentVersion.downloadUrl}>{copy.download}</a>}
        </div>}
      </div>
      <div className="level-public-rating">{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">{t('common.unrated')}</span>}</div>
    </div>

    {currentVersion && <div className="current-version-strip"><span>{copy.currentVersion}</span><strong>{currentVersion.label}</strong><code>{currentVersion.sha256 ?? t('level.noSha')}</code></div>}
    <div className="fact-row"><span>{t('level.versionCount', { count: level.versions.length })}</span><span>{t('level.currentVotes', { count: level.voteCount })}</span><span>{t('level.referenceCount', { count: level.referenceCount })}</span><span>{t('level.openProposalCount', { count: proposals.filter((p) => p.status === 'OPEN').length })}</span></div>

    <div className="two-col">
      <div className="panel"><h2>{t('level.versions')}</h2>{level.versions.map((v) => <div className="version-card" key={v.id}>
        <div><strong>{v.label}</strong>{v.id === level.currentVersionId && <span className="pill">{t('common.current')}</span>}</div>
        <div>{v.currentRating ? <RatingBadge family={v.currentRating.family} tier={v.currentRating.tier} /> : <span className="muted">{t('common.unrated')}</span>}</div>
        <code>{v.sha256 ?? t('level.noSha')}</code>
        {v.notes && <p>{v.notes}</p>}
        {(v.downloadUrl || v.videoUrl) && <div className="version-links">{v.videoUrl && <a className="text-link" target="_blank" rel="noreferrer" href={v.videoUrl}>{copy.video}</a>}{v.downloadUrl && <a className="text-link" target="_blank" rel="noreferrer" href={v.downloadUrl}>{copy.download}</a>}</div>}
      </div>)}</div>
      <div className="panel"><h2>{t('level.ratingHistory')}</h2>{level.ratingHistory.length ? level.ratingHistory.map((r) => <div className="history" key={r.id}>
        <RatingBadge family={r.family} tier={r.tier} /><strong>{r.versionLabel}</strong><span>{date(r.effectiveFrom)}</span><Status value={r.effectiveTo ? 'CLOSED' : 'ACTIVE'} /><p>{r.reason ?? t('level.noDecisionNote')}</p>
      </div>) : <p className="muted">{t('level.noRatingHistory')}</p>}</div>
    </div>

    <div className="panel"><h2>{t('level.evidence')}</h2>
      {level.voteSummary.length ? <div className="evidence-summary">{level.voteSummary.map((v) => <div key={`${v.family}${v.anchorTier}`}><RatingBadge family={v.family} tier={v.anchorTier} /><strong>n={v.count}</strong><span>{t('level.median', { value: v.medianEvidence.toFixed(2) })}</span></div>)}</div> : <p className="muted">{t('level.noVotes')}</p>}
      <p className="note">{t('level.evidenceNote')}</p>
      {!!level.ratingVotes.length && <div className="vote-ledger">{level.ratingVotes.map((v) => <article key={`${v.userId}-${v.levelVersionId}-${v.family}`}><div><strong>{v.displayName}</strong><span>{v.versionLabel}</span><RatingBadge family={v.family} tier={v.anchorTier} /></div><p>{lean(v.lean)} · {t('level.confidence', { value: v.confidence })}</p>{v.comment && <blockquote>{v.comment}</blockquote>}</article>)}</div>}
    </div>

    <div className="two-col">
      <div className="panel"><div className="title-row"><h2>{t('level.references')}</h2><a className="text-link" href={`#/references?level=${level.id}`}>{t('level.browseAll')}</a></div>{level.references.map((r) => <div className="ref-row" key={r.id}><RatingBadge family={r.family} tier={r.tier} /><div><strong>{r.technique}</strong><small>{r.versionLabel}{r.positionHint === null ? '' : ` · ${t('references.position', { value: r.positionHint })}`}</small></div><Status value={r.status} />{r.notes && <p>{r.notes}</p>}</div>)}{!level.references.length && <p className="muted">{t('level.notReference')}</p>}</div>
      <div className="panel"><div className="title-row"><h2>{t('level.relatedProposals')}</h2><a className="text-link" href="#/proposals">{t('level.allProposals')}</a></div>{proposals.map((p) => <a className="related-proposal" href={`#/proposals/${p.id}`} key={p.id}><div><span className="pill">{proposalType(p.type)}</span><Status value={p.status} /><ExecutionState state={p.executionState} message={p.executionMessage} /></div><strong>{p.title}</strong><ProposalChange proposal={p} compact /></a>)}{!proposals.length && <p className="muted">{t('level.noProposals')}</p>}</div>
    </div>
  </section>
}

function References() {
  const { t } = useI18n()
  const params = new URLSearchParams((location.hash.split('?')[1] ?? ''))
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState<Family>('G')
  const [tier, setTier] = useState('')
  const [technique, setTechnique] = useState('')
  const [status, setStatus] = useState('')
  const [levelId] = useState(params.get('level') ?? '')
  const [data, setData] = useState<PagedReferences>({ references: [], total: 0, limit: PAGE_SIZE, offset: 0 })
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [error, setError] = useState('')

  const load = async (nextOffset = 0) => {
    setError('')
    try {
      const qs = new URLSearchParams({ search, family, limit: String(PAGE_SIZE), offset: String(nextOffset) })
      if (tier) qs.set('tier', tier)
      if (technique.trim()) qs.set('technique', technique.trim())
      if (status) qs.set('status', status)
      if (levelId) qs.set('levelId', levelId)
      setData(await api<PagedReferences>(`/catalog/references?${qs}`))
    } catch (e) { setError(e instanceof Error ? e.message : t('references.searchFailed')) }
  }
  useEffect(() => { void api<{ coverage: CoverageRow[] }>('/references/coverage').then((x) => setCoverage(x.coverage)); void load(0) }, [family, status])
  const techniques = useMemo(() => [...new Set(coverage.filter((x) => x.family === family).map((x) => x.technique))].sort(), [coverage, family])
  const chooseCell = (nextTier: number, nextTechnique: string) => { setTier(String(nextTier)); setTechnique(nextTechnique); setTimeout(() => void load(0), 0) }

  return <section>
    <div className="section-head"><div><p className="eyebrow">{t('references.eyebrow')}</p><h1>{t('references.title')}</h1><p className="muted">{t('references.count', { count: data.total })}</p></div></div>
    <div className="filter-panel reference-filters">
      <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(0)} placeholder={t('references.searchPlaceholder')} />
      <select value={family} onChange={(e) => { setFamily(e.target.value as Family); setTier('') }}><option>P</option><option>G</option><option>U</option></select>
      <input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(e.target.value)} placeholder={t('levels.tier')} />
      <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder={t('references.technique')} />
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('references.allStatuses')}</option><option value="ACTIVE">{t('status.ACTIVE')}</option><option value="NEEDS_REVIEW">{t('status.NEEDS_REVIEW')}</option><option value="RETIRED">{t('status.RETIRED')}</option></select>
      <button onClick={() => void load(0)}>{t('common.apply')}</button>
      <button className="ghost" onClick={() => { setSearch(''); setTier(''); setTechnique(''); setStatus(''); setTimeout(() => void load(0), 0) }}>{t('common.clear')}</button>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="panel"><h2>{t('references.coverage')}</h2><p className="muted">{t('references.coverageHelp')}</p><div className="matrix"><div className="matrix-row head"><span>{t('references.technique')}</span>{Array.from({length:30},(_,i)=><b key={i}>{i+1}</b>)}</div>{techniques.map((tech) => <div className="matrix-row" key={tech}><strong>{tech}</strong>{Array.from({length:30},(_,i)=>{ const tTier=i+1; const row=coverage.find((x)=>x.family===family&&x.technique===tech&&Number(x.tier)===tTier); const active=Number(row?.active??0); const review=Number(row?.needs_review??0); return <button type="button" key={tTier} className={`matrix-cell ${active?'covered':''} ${review?'review-cell':''}`} title={`${family}${tTier} ${tech}: active ${active}, review ${review}`} onClick={()=>chooseCell(tTier,tech)}>{active || (review?'!':'·')}</button>})}</div>)}</div></div>
    <div className="table-wrap"><table><thead><tr><th>{t('references.slot')}</th><th>{t('references.levelVersion')}</th><th>{t('references.technique')}</th><th>{t('references.status')}</th><th>{t('references.notes')}</th></tr></thead><tbody>{data.references.map((r)=><tr key={r.id}><td><RatingBadge family={r.family} tier={r.tier}/></td><td><a href={`#/levels/${r.levelId}`}><strong>{r.levelTitle}</strong></a><small>{r.song} · {r.creator} · {r.versionLabel}</small></td><td>{r.technique}<small>{r.positionHint===null?t('references.noPosition'):t('references.position',{value:r.positionHint})}</small></td><td><Status value={r.status}/></td><td>{r.notes??<span className="muted">—</span>}</td></tr>)}</tbody></table></div>
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x)=>void load(x)} />
  </section>
}

function Proposals({ user }: { user: SessionUser | null }) {
  const { t, date, proposalType } = useI18n()
  const [data, setData] = useState<PagedProposals>({ proposals: [], total: 0, limit: 25, offset: 0 })
  const [levels, setLevels] = useState<LevelListItem[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('OPEN')
  const [type, setType] = useState('')
  const [error, setError] = useState('')
  const load = async (nextOffset = 0) => {
    setError('')
    try {
      const qs = new URLSearchParams({ search, limit: '25', offset: String(nextOffset) })
      if (status) qs.set('status', status)
      if (type) qs.set('type', type)
      setData(await api<PagedProposals>(`/governance/proposals?${qs}`))
    } catch (e) { setError(e instanceof Error ? e.message : t('proposals.loadingFailed')) }
  }
  useEffect(() => { void load(0) }, [status, type, user?.id])
  useEffect(() => { if (user) void api<PagedLevels>('/catalog/levels?limit=100&sort=title').then((x) => setLevels(x.levels)) }, [user?.id])

  return <section>
    <div className="section-head"><div><p className="eyebrow">{t('proposals.eyebrow')}</p><h1>{t('proposals.title')}</h1><p className="muted">{t('proposals.count', { count: data.total })}</p></div></div>
    <div className="filter-panel proposal-filters"><input value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&void load(0)} placeholder={t('proposals.searchPlaceholder')}/><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">{t('proposals.allStatuses')}</option>{['OPEN','APPROVED','REJECTED','WITHDRAWN'].map((x)=><option key={x} value={x}>{t(`status.${x}`)}</option>)}</select><select value={type} onChange={(e)=>setType(e.target.value)}><option value="">{t('proposals.allTypes')}</option>{['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER'].map((x)=><option key={x} value={x}>{proposalType(x)}</option>)}</select><button onClick={()=>void load(0)}>{t('common.search')}</button></div>
    {error&&<p className="error">{error}</p>}
    {user && <details className="proposal-create"><summary>{t('proposals.create')}</summary><ProposalForm levels={levels} onCreated={()=>void load(0)} /></details>}
    <div className="cards proposal-grid">{data.proposals.map((p)=><article className="proposal" key={p.id}>
      <div className="proposal-meta"><span className="pill">{proposalType(p.type)}</span><Status value={p.status}/><ExecutionState state={p.executionState} message={p.executionMessage}/>{p.myVote&&<span className="my-vote">{t('proposals.you',{vote:t(`proposals.${p.myVote.toLowerCase()}`)})}</span>}</div>
      <h3><a href={`#/proposals/${p.id}`}>{p.title}</a></h3><p><a className="text-link" href={`#/levels/${p.levelId}`}>{p.levelTitle}</a> · {p.proposerName} · {date(p.createdAt)}</p>
      <ProposalChange proposal={p}/><p>{p.reason}</p><div className="votes"><span>{t('proposals.agree')} <b>{p.agree}</b></span><span>{t('proposals.disagree')} <b>{p.disagree}</b></span><span>{t('proposals.abstain')} <b>{p.abstain}</b></span><a className="text-link" href={`#/proposals/${p.id}`}>{t('proposals.detailsVote')}</a></div>
    </article>)}</div>
    {!data.proposals.length&&<p className="empty panel">{t('proposals.noMatch')}</p>}
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x)=>void load(x)} />
  </section>
}

function VoteButtons({ proposal, user, onChanged }: { proposal: ProposalRow; user: SessionUser | null; onChanged: () => void }) {
  const { t } = useI18n()
  const [error,setError]=useState('')
  if (!user) return <p className="muted"><a className="text-link" href="#/login">{t('auth.login')}</a> — {t('proposal.loginToVote')}</p>
  if (proposal.status !== 'OPEN') return <p className="muted">{t('proposal.votingClosed')}</p>
  const cast=async(vote:ProposalVoteValue)=>{try{await api(`/governance/proposals/${proposal.id}/vote`,{method:'POST',body:JSON.stringify({vote})});setError('');onChanged()}catch(e){setError(e instanceof Error?e.message:t('proposal.voteFailed'))}}
  return <div><div className="vote-actions">{(['AGREE','DISAGREE','ABSTAIN'] as ProposalVoteValue[]).map((v)=><button key={v} className={proposal.myVote===v?'selected-vote':'ghost'} onClick={()=>void cast(v)}>{t(`proposals.${v.toLowerCase()}`)}</button>)}</div>{error&&<p className="error">{error}</p>}</div>
}

function Proposal({ id, user }: { id: string; user: SessionUser | null }) {
  const { t, date, proposalType } = useI18n()
  const [detail,setDetail]=useState<ProposalDetail|null>(null)
  const [comment,setComment]=useState('')
  const [error,setError]=useState('')
  const load=async()=>{setError('');try{setDetail(await api<ProposalDetail>(`/governance/proposals/${id}`))}catch(e){setError(e instanceof Error?e.message:t('proposal.loadFailed'))}}
  useEffect(()=>{void load()},[id,user?.id])
  if(error)return <div className="panel error">{error}</div>
  if(!detail)return <div className="panel">{t('common.loading')}</div>
  const p=detail.proposal
  const addComment=async()=>{if(!comment.trim())return;try{await api(`/governance/proposals/${id}/comments`,{method:'POST',body:JSON.stringify({body:comment})});setComment('');await load()}catch(e){setError(e instanceof Error?e.message:t('proposal.commentFailed'))}}
  return <section>
    <a className="back-link" href="#/proposals">{t('proposal.back')}</a>
    <div className="section-head proposal-head"><div><div className="proposal-meta"><span className="pill">{proposalType(p.type)}</span><Status value={p.status}/><ExecutionState state={p.executionState} message={p.executionMessage}/></div><h1>{p.title}</h1><p><a className="text-link" href={`#/levels/${p.levelId}`}>{p.levelTitle}</a> · {t('proposal.proposedBy',{name:p.proposerName,date:date(p.createdAt)})}</p></div></div>
    <div className={`execution-box execution-box-${p.executionState.toLowerCase()}`}><strong><ExecutionState state={p.executionState} message={p.executionMessage}/></strong><p>{p.executionMessage}</p></div>
    <div className="two-col">
      <div className="panel"><h2>{t('proposal.proposedChange')}</h2><ProposalChange proposal={p}/><h3>{t('proposal.reason')}</h3><p className="long-text">{p.reason}</p>{p.decisionReason&&<><h3>{t('proposal.decision')}</h3><p>{p.decisionReason}</p><p className="muted">{p.decidedByName??'Staff'} · {p.decidedAt?date(p.decidedAt):''}</p></>}</div>
      <div className="panel"><h2>{t('proposal.vote')}</h2><div className="big-votes"><div><strong>{p.agree}</strong><span>{t('proposals.agree')}</span></div><div><strong>{p.disagree}</strong><span>{t('proposals.disagree')}</span></div><div><strong>{p.abstain}</strong><span>{t('proposals.abstain')}</span></div></div><VoteButtons proposal={p} user={user} onChanged={()=>void load()}/><h3>{t('proposal.voters')}</h3>{detail.votes.length?<div className="voter-list">{detail.votes.map((v)=><div key={v.userId}><strong>{v.displayName}</strong><span className={`vote-value vote-${v.vote.toLowerCase()}`}>{t(`proposals.${v.vote.toLowerCase()}`)}</span></div>)}</div>:<p className="muted">{t('proposal.noVotes')}</p>}</div>
    </div>
    <div className="panel"><h2>{t('proposal.discussion')}</h2>{detail.comments.length?<div className="comments">{detail.comments.map((c)=><article key={c.id}><div><strong>{c.displayName}</strong><time>{date(c.createdAt)}</time></div><p>{c.body}</p></article>)}</div>:<p className="muted">{t('proposal.noComments')}</p>}{user?<div className="comment-form"><textarea value={comment} onChange={(e)=>setComment(e.target.value)} maxLength={4000} placeholder={t('proposal.commentPlaceholder')}/><button disabled={!comment.trim()} onClick={()=>void addComment()}>{t('proposal.postComment')}</button></div>:<p className="muted"><a className="text-link" href="#/login">{t('auth.login')}</a> — {t('proposal.loginToComment')}</p>}</div>
  </section>
}

function ProposalForm({ levels, onCreated }: { levels: LevelListItem[]; onCreated:()=>void }) {
  const { t, proposalType } = useI18n()
  const [levelId,setLevelId]=useState('')
  const [detail,setDetail]=useState<LevelDetail|null>(null)
  const [type,setType]=useState<ProposalType>('RERATE')
  const [title,setTitle]=useState('')
  const [reason,setReason]=useState('')
  const [error,setError]=useState('')
  const [family,setFamily]=useState<Family>('G')
  const [tier,setTier]=useState(1)
  const [referenceId,setReferenceId]=useState('')
  const [technique,setTechnique]=useState('TECH')
  const [hint,setHint]=useState('')
  const [confidence,setConfidence]=useState('')
  const [notes,setNotes]=useState('')

  useEffect(()=>{if(!levelId){setDetail(null);setReferenceId('');return}void api<LevelDetail>(`/catalog/levels/${levelId}`).then((x)=>{setDetail(x);setReferenceId('');setFamily(x.currentRating?.family??'G');setTier(x.currentRating?.tier??1)})},[levelId])
  const refs=detail?.references.filter((r)=>r.status!=='RETIRED')??[]
  const selectedRef=refs.find((r)=>r.id===referenceId)??null
  useEffect(()=>{if(selectedRef&&type==='REFERENCE_MOVE'){setFamily(detail?.currentRating?.family??selectedRef.family);setTier(detail?.currentRating?.tier??selectedRef.tier);setHint(selectedRef.positionHint===null?'':String(selectedRef.positionHint))}},[referenceId,type])
  const needsRef=type==='REFERENCE_MOVE'||type==='REFERENCE_REMOVE'
  const needsRating=type==='RERATE'||type==='REFERENCE_ADD'||type==='REFERENCE_MOVE'
  const canSubmit=!!levelId&&!!title.trim()&&!!reason.trim()&&(!needsRef||!!referenceId)&&(!needsRating||!!detail?.currentVersionId)
  const create=async()=>{if(!detail)return;setError('');let payload:Record<string,unknown>={};if(type==='RERATE'){payload={targetLevelVersionId:detail.currentVersionId,currentCanonicalRating:detail.currentRating?{family:detail.currentRating.family,tier:detail.currentRating.tier}:null,proposedRating:{family,tier}}}else if(type==='REFERENCE_ADD'){payload={levelVersionId:detail.currentVersionId,reference:{family,tier,technique,positionHint:hint===''?null:Number(hint),confidence:confidence===''?null:Number(confidence),notes:notes||null}}}else if(type==='REFERENCE_MOVE'){payload={referenceId,target:{family,tier,positionHint:hint===''?null:Number(hint)}}}else if(type==='REFERENCE_REMOVE'){payload={referenceId}}try{await api('/proposals',{method:'POST',body:JSON.stringify({levelId,type,title,reason,payload})});setTitle('');setReason('');setNotes('');setReferenceId('');setError('');onCreated()}catch(e){setError(e instanceof Error?e.message:t('proposal.createFailed'))}}

  return <div className="panel proposal-form"><h2>{t('proposal.newTitle')}</h2><div className="form-grid"><label>{t('proposal.level')}<select value={levelId} onChange={(e)=>setLevelId(e.target.value)}><option value="">{t('proposal.select')}</option>{levels.map((l)=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label><label>{t('proposal.type')}<select value={type} onChange={(e)=>{setType(e.target.value as ProposalType);setReferenceId('');setError('')}}>{(['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER'] as ProposalType[]).map((x)=><option key={x} value={x}>{proposalType(x)}</option>)}</select></label></div>
    {type==='RERATE'&&<div className="form-grid"><label>{t('proposal.proposedFamily')}<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>{t('proposal.proposedTier')}<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label></div>}
    {type==='REFERENCE_ADD'&&<><p className="note">{t('proposal.serverBaseline')}</p><div className="form-grid"><label>{t('vote.family')}<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>{t('levels.tier')}<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label><label>{t('proposal.technique')}<input value={technique} onChange={(e)=>setTechnique(e.target.value)}/></label><label>{t('proposal.positionLabel')}<select value={hint} onChange={(e)=>setHint(e.target.value)}><option value="">{t('proposal.noHint')}</option><option value="-2">{t('proposal.lower')}</option><option value="-1">{t('proposal.slightlyLower')}</option><option value="0">{t('proposal.center')}</option><option value="1">{t('proposal.slightlyHigher')}</option><option value="2">{t('proposal.higher')}</option></select></label><label>{t('vote.confidence')}<input type="number" min="0" max="1" step=".05" value={confidence} onChange={(e)=>setConfidence(e.target.value)}/></label></div><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder={t('proposal.referenceNotes')}/></>}
    {(type==='REFERENCE_MOVE'||type==='REFERENCE_REMOVE')&&<label>{t('proposal.reference')}<select value={referenceId} onChange={(e)=>setReferenceId(e.target.value)}><option value="">{t('proposal.selectReference')}</option>{refs.map((r)=><option key={r.id} value={r.id}>{r.family}{r.tier} · {r.technique} · {t(`status.${r.status}`)}</option>)}</select></label>}
    {type==='REFERENCE_MOVE'&&selectedRef&&<><p className="note">{t('proposal.moveNote')}</p><div className="form-grid"><label>{t('proposal.targetFamily')}<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>{t('proposal.targetTier')}<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label><label>{t('proposal.positionLabel')}<select value={hint} onChange={(e)=>setHint(e.target.value)}><option value="">{t('proposal.noHint')}</option><option value="-2">{t('proposal.lower')}</option><option value="-1">{t('proposal.slightlyLower')}</option><option value="0">{t('proposal.center')}</option><option value="1">{t('proposal.slightlyHigher')}</option><option value="2">{t('proposal.higher')}</option></select></label></div></>}
    <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder={t('proposal.titlePlaceholder')}/><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder={t('proposal.reasonPlaceholder')}/>{error&&<p className="error">{error}</p>}<button disabled={!canSubmit} onClick={()=>void create()}>{t('proposal.createButton')}</button></div>
}

function Login({ onLogin }: { onLogin:(u:SessionUser)=>void }) {
  const { t, locale } = useI18n()
  const [mode,setMode]=useState<'login'|'register'>('login')
  const [email,setEmail]=useState('')
  const [displayName,setDisplayName]=useState('')
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const copy=locale==='ja' ? {
    login:'ログイン', register:'アカウント作成', displayName:'表示名', confirm:'パスワード（確認）',
    registerHelp:'新規アカウントは閲覧者（VIEWER）として作成されます。RATERへの昇格は管理者が行います。',
    passwordHelp:'パスワードは12文字以上にしてください。', mismatch:'パスワードが一致しません。',
    registerFailed:'アカウント作成に失敗しました', switchLogin:'すでにアカウントがある', switchRegister:'アカウントを作る',
  } : {
    login:'Login', register:'Create account', displayName:'Display name', confirm:'Confirm password',
    registerHelp:'New accounts are created as VIEWER. An administrator must promote an account before it can rate as a RATER.',
    passwordHelp:'Use a password with at least 12 characters.', mismatch:'Passwords do not match.',
    registerFailed:'Account creation failed', switchLogin:'I already have an account', switchRegister:'Create an account',
  }
  const switchMode=(next:'login'|'register')=>{setMode(next);setError('');setConfirm('')}
  const submit=async()=>{
    setError('')
    if(mode==='register'&&password!==confirm){setError(copy.mismatch);return}
    setBusy(true)
    try{
      const endpoint=mode==='register'?'/auth/register':'/auth/login'
      const body=mode==='register'?{email,displayName,password}:{email,password}
      const r=await api<{user:SessionUser}>(endpoint,{method:'POST',body:JSON.stringify(body)})
      onLogin(r.user)
    }catch(e){setError(e instanceof Error?e.message:(mode==='register'?copy.registerFailed:t('auth.loginFailed')))}
    finally{setBusy(false)}
  }
  return <section className="narrow"><div className="panel">
    <div className="actions auth-mode-actions"><button className={mode==='login'?'':'ghost'} onClick={()=>switchMode('login')}>{copy.login}</button><button className={mode==='register'?'':'ghost'} onClick={()=>switchMode('register')}>{copy.register}</button></div>
    <h1>{mode==='login'?copy.login:copy.register}</h1>
    {mode==='register'&&<p className="note">{copy.registerHelp}</p>}
    <label>{t('auth.email')}<input type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} /></label>
    {mode==='register'&&<label>{copy.displayName}<input maxLength={80} autoComplete="nickname" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} /></label>}
    <label>{t('auth.password')}<input type="password" autoComplete={mode==='register'?'new-password':'current-password'} value={password} onChange={(e)=>setPassword(e.target.value)} /></label>
    {mode==='register'&&<><label>{copy.confirm}<input type="password" autoComplete="new-password" value={confirm} onChange={(e)=>setConfirm(e.target.value)} /></label><p className="muted">{copy.passwordHelp}</p></>}
    {error&&<p className="error">{error}</p>}
    <button disabled={busy||!email||!password||(mode==='register'&&(!displayName.trim()||!confirm))} onClick={()=>void submit()}>{busy?t('common.loading'):(mode==='login'?copy.login:copy.register)}</button>
    <p className="muted auth-switch-copy">{mode==='login'?<button className="ghost" onClick={()=>switchMode('register')}>{copy.switchRegister}</button>:<button className="ghost" onClick={()=>switchMode('login')}>{copy.switchLogin}</button>}</p>
  </div></section>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><I18nProvider><App /></I18nProvider></React.StrictMode>)
