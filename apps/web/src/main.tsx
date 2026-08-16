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
  ReferenceStatus,
  SessionUser,
} from '@elf/shared'
import { RATING_LEAN_LABELS } from '@elf/shared'
import { api } from './api'
import './styles.css'

type Route = {
  page: 'home' | 'levels' | 'level' | 'references' | 'proposals' | 'proposal' | 'login'
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
  return <span className={`status ${value.toLowerCase()}`}>{value}</span>
}

function ExecutionState({ state, message }: { state: ProposalExecutionState; message: string }) {
  return <span className={`execution execution-${state.toLowerCase()}`} title={message}>{state}</span>
}

function ratingText(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Unrated'
  const row = value as Record<string, unknown>
  if ((row.family === 'P' || row.family === 'G' || row.family === 'U') && Number.isInteger(Number(row.tier))) {
    return `${row.family}${Number(row.tier)}`
  }
  return 'Unrated'
}

function refText(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Reference'
  const row = value as Record<string, unknown>
  const slot = ratingText(row)
  const technique = typeof row.technique === 'string' ? row.technique : 'UNKNOWN'
  const hint = row.positionHint === null || row.positionHint === undefined ? '' : ` · position ${String(row.positionHint)}`
  return `${slot} · ${technique}${hint}`
}

function ProposalChange({ proposal, compact = false }: { proposal: ProposalRow; compact?: boolean }) {
  const p = proposal.payload ?? {}
  if (proposal.type === 'RERATE') {
    return <div className="change-line"><span>{ratingText(p.currentCanonicalRating)}</span><b>→</b><strong>{ratingText(p.proposedRating)}</strong></div>
  }
  if (proposal.type === 'REFERENCE_ADD') {
    return <div className="change-line"><span>no Reference</span><b>→</b><strong>{refText(p.reference)}</strong></div>
  }
  if (proposal.type === 'REFERENCE_MOVE') {
    return <div className="change-line"><span>{refText(p.baselineReference)}</span><b>→</b><strong>{refText(p.targetReference)}</strong></div>
  }
  if (proposal.type === 'REFERENCE_REMOVE') {
    return <div className="change-line"><span>{refText(p.baselineReference)}</span><b>→</b><strong>RETIRED</strong></div>
  }
  if (compact) return null
  return <pre className="payload">{JSON.stringify(p, null, 2)}</pre>
}

function Pagination({ total, offset, limit, onPage }: { total: number; offset: number; limit: number; onPage: (offset: number) => void }) {
  if (total <= limit && offset === 0) return null
  return <div className="pager">
    <button className="ghost" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</button>
    <span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} / ${total}` : '0 / 0'}</span>
    <button className="ghost" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>Next</button>
  </div>
}

function App() {
  const route = useRoute()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const refreshUser = () => api<{ user: SessionUser | null }>('/auth/me')
    .then((x) => setUser(x.user))
    .finally(() => setAuthLoaded(true))

  useEffect(() => { void refreshUser() }, [])

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="#/">ELF <span>Enhanced Level Forum</span></a>
      <nav>
        <a href="#/levels">Levels</a>
        <a href="#/references">References</a>
        <a href="#/proposals">Proposals</a>
      </nav>
      <div className="account">
        {authLoaded && user ? <>
          <span>{user.displayName}<small>{user.role}</small></span>
          <button className="ghost" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null) }}>Logout</button>
        </> : <a href="#/login">Login</a>}
      </div>
    </header>
    <main>
      {route.page === 'home' && <Home />}
      {route.page === 'levels' && <Levels />}
      {route.page === 'level' && route.id && <Level id={route.id} user={user} />}
      {route.page === 'references' && <References />}
      {route.page === 'proposals' && <Proposals user={user} />}
      {route.page === 'proposal' && route.id && <Proposal id={route.id} user={user} />}
      {route.page === 'login' && <Login onLogin={(u) => { setUser(u); location.hash = '#/' }} />}
    </main>
    <footer>Enhanced Level Forum</footer>
  </div>
}

function Home() {
  const [stats, setStats] = useState<PublicStats | null>(null)
  useEffect(() => { void api<PublicStats>('/stats').then(setStats) }, [])
  return <>
    <section className="hero">
      <div>
        <h1>ADOFAI Difficulty Database</h1>
        <p>Community ratings, References, proposals, and level history.</p>
        <div className="actions"><a className="button" href="#/levels">Browse levels</a><a className="button secondary" href="#/proposals">View proposals</a></div>
      </div>
    </section>
    <section className="stats-grid">
      <Stat label="Levels" value={stats?.levels} />
      <Stat label="Active References" value={stats?.activeReferences} />
      <Stat label="Open Proposals" value={stats?.openProposals} />
      <Stat label="Rating Votes" value={stats?.ratingVotes} />
    </section>
  </>
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="stat"><span>{label}</span><strong>{value ?? '—'}</strong></div>
}

function Levels() {
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
      setError(e instanceof Error ? e.message : 'Level search failed')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(0) }, [family, rated, sort])

  return <section>
    <div className="section-head"><div><p className="eyebrow">Database</p><h1>Levels</h1><p className="muted">{data.total} level(s)</p></div></div>
    <div className="filter-panel">
      <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(0)} placeholder="Title / song / creator" />
      <select value={family} onChange={(e) => { setFamily(e.target.value); setTier('') }}><option value="">All families</option><option>P</option><option>G</option><option>U</option></select>
      <input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Tier" />
      <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder="Reference technique" />
      <select value={rated} onChange={(e) => setRated(e.target.value)}><option value="all">Rated + unrated</option><option value="rated">Rated only</option><option value="unrated">Unrated only</option></select>
      <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="rating">Rating order</option><option value="title">Title</option><option value="votes">Most votes</option><option value="recent">Recently updated</option></select>
      <button onClick={() => void load(0)}>Search</button>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Rating</th><th>Song / Level</th><th>Creator</th><th>Evidence</th></tr></thead><tbody>
      {data.levels.map((level) => <tr key={level.id}>
        <td>{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">Unrated</span>}</td>
        <td><a href={`#/levels/${level.id}`}><strong>{level.title}</strong></a><small>{level.song}</small></td>
        <td>{level.creator}</td>
        <td><span>{level.voteCount} votes</span><small>{level.referenceCount} active/review References</small></td>
      </tr>)}
      {!data.levels.length && !loading && <tr><td colSpan={4} className="empty">No levels match these filters.</td></tr>}
    </tbody></table></div>
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x) => void load(x)} />
  </section>
}

function Level({ id, user }: { id: string; user: SessionUser | null }) {
  const [level, setLevel] = useState<LevelDetail | null>(null)
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    setError('')
    try {
      const [detail, related] = await Promise.all([
        api<LevelDetail>(`/catalog/levels/${id}`),
        api<PagedProposals>(`/governance/proposals?levelId=${encodeURIComponent(id)}&limit=8`),
      ])
      setLevel(detail); setProposals(related.proposals)
    } catch (e) { setError(e instanceof Error ? e.message : 'Level loading failed') }
  }
  useEffect(() => { void load() }, [id])
  if (error) return <div className="panel error">{error}</div>
  if (!level) return <div className="panel">Loading…</div>
  const canRate = user && ['RATER','REFERENCE_MANAGER','MODERATOR','ADMIN'].includes(user.role)

  return <section>
    <div className="section-head level-head"><div><p className="eyebrow">{level.song}</p><h1>{level.title}</h1><p>by {level.creator}</p></div><div className="level-rating">{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">Unrated</span>}</div></div>
    <div className="fact-row"><span>{level.versions.length} version(s)</span><span>{level.voteCount} current-version vote(s)</span><span>{level.referenceCount} active/review Reference(s)</span><span>{proposals.filter((p) => p.status === 'OPEN').length} open proposal(s)</span></div>

    <div className="two-col">
      <div className="panel"><h2>Versions</h2>{level.versions.map((v) => <div className="version-card" key={v.id}>
        <div><strong>{v.label}</strong>{v.id === level.currentVersionId && <span className="pill">current</span>}</div>
        <div>{v.currentRating ? <RatingBadge family={v.currentRating.family} tier={v.currentRating.tier} /> : <span className="muted">Unrated</span>}</div>
        <code>{v.sha256 ?? 'no sha256'}</code>
        {v.notes && <p>{v.notes}</p>}{v.downloadUrl && <a className="text-link" target="_blank" rel="noreferrer" href={v.downloadUrl}>Download source</a>}
      </div>)}</div>
      <div className="panel"><h2>Rating history</h2>{level.ratingHistory.length ? level.ratingHistory.map((r) => <div className="history" key={r.id}>
        <RatingBadge family={r.family} tier={r.tier} /><strong>{r.versionLabel}</strong><span>{new Date(r.effectiveFrom).toLocaleString()}</span><Status value={r.effectiveTo ? 'CLOSED' : 'ACTIVE'} /><p>{r.reason ?? 'No decision note'}</p>
      </div>) : <p className="muted">No canonical rating history.</p>}</div>
    </div>

    <div className="panel"><h2>Community difficulty evidence</h2>
      {level.voteSummary.length ? <div className="evidence-summary">{level.voteSummary.map((v) => <div key={`${v.family}${v.anchorTier}`}><RatingBadge family={v.family} tier={v.anchorTier} /><strong>n={v.count}</strong><span>median {v.medianEvidence.toFixed(2)}</span></div>)}</div> : <p className="muted">No difficulty votes yet.</p>}
      <p className="note">The decimal evidence score is an aggregation aid only; it is not a canonical difficulty.</p>
      {!!level.ratingVotes.length && <div className="vote-ledger">{level.ratingVotes.map((v) => <article key={`${v.userId}-${v.levelVersionId}-${v.family}`}><div><strong>{v.displayName}</strong><span>{v.versionLabel}</span><RatingBadge family={v.family} tier={v.anchorTier} /></div><p>{RATING_LEAN_LABELS[v.lean]} · confidence {v.confidence}/5</p>{v.comment && <blockquote>{v.comment}</blockquote>}</article>)}</div>}
    </div>

    {canRate && <VoteBox level={level} onSaved={() => { setMessage('Vote saved'); void load() }} />}
    {message && <p className="notice">{message}</p>}

    <div className="two-col">
      <div className="panel"><div className="title-row"><h2>References</h2><a className="text-link" href={`#/references?level=${level.id}`}>Browse all</a></div>{level.references.map((r) => <div className="ref-row" key={r.id}><RatingBadge family={r.family} tier={r.tier} /><div><strong>{r.technique}</strong><small>{r.versionLabel}{r.positionHint === null ? '' : ` · position ${r.positionHint}`}</small></div><Status value={r.status} />{r.notes && <p>{r.notes}</p>}</div>)}{!level.references.length && <p className="muted">Not a Reference.</p>}</div>
      <div className="panel"><div className="title-row"><h2>Related proposals</h2><a className="text-link" href={`#/proposals`}>All proposals</a></div>{proposals.map((p) => <a className="related-proposal" href={`#/proposals/${p.id}`} key={p.id}><div><span className="pill">{p.type}</span><Status value={p.status} /><ExecutionState state={p.executionState} message={p.executionMessage} /></div><strong>{p.title}</strong><ProposalChange proposal={p} compact /></a>)}{!proposals.length && <p className="muted">No proposals for this Level.</p>}</div>
    </div>
  </section>
}

function VoteBox({ level, onSaved }: { level: LevelDetail; onSaved: () => void }) {
  const defaultFamily = level.currentRating?.family ?? 'G'
  const defaultTier = level.currentRating?.tier ?? 1
  const [family, setFamily] = useState<Family>(defaultFamily)
  const [tier, setTier] = useState(defaultTier)
  const [lean, setLean] = useState(0)
  const [confidence, setConfidence] = useState(3)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  return <div className="panel vote-box"><h2>Add / update difficulty evidence</h2><p>Anchor an integer tier, then record only a coarse five-step lean around it.</p><div className="form-grid">
    <label>Family<select value={family} onChange={(e) => setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label>
    <label>Anchor tier<input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(Number(e.target.value))} /></label>
    <label>Lean<select value={lean} onChange={(e) => setLean(Number(e.target.value))}>{[-2,-1,0,1,2].map((x) => <option key={x} value={x}>{RATING_LEAN_LABELS[x as keyof typeof RATING_LEAN_LABELS]}</option>)}</select></label>
    <label>Confidence<select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}>{[1,2,3,4,5].map((x) => <option key={x}>{x}</option>)}</select></label>
  </div><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reason / comparison References" />{error && <p className="error">{error}</p>}<button onClick={async () => { try { await api(`/levels/${level.id}/votes`, { method:'POST', body: JSON.stringify({ family, anchorTier:tier, lean, confidence, comment }) }); setError(''); onSaved() } catch (e) { setError(e instanceof Error ? e.message : 'Vote failed') } }}>Save evidence</button></div>
}

function References() {
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Reference search failed') }
  }
  useEffect(() => { void api<{ coverage: CoverageRow[] }>('/references/coverage').then((x) => setCoverage(x.coverage)); void load(0) }, [family, status])
  const techniques = useMemo(() => [...new Set(coverage.filter((x) => x.family === family).map((x) => x.technique))].sort(), [coverage, family])
  const chooseCell = (nextTier: number, nextTechnique: string) => { setTier(String(nextTier)); setTechnique(nextTechnique); setTimeout(() => void load(0), 0) }

  return <section>
    <div className="section-head"><div><p className="eyebrow">Anchors are reviewable</p><h1>References</h1><p className="muted">{data.total} matching Reference(s)</p></div></div>
    <div className="filter-panel reference-filters">
      <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(0)} placeholder="Level / song / creator / technique" />
      <select value={family} onChange={(e) => { setFamily(e.target.value as Family); setTier('') }}><option>P</option><option>G</option><option>U</option></select>
      <input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Tier" />
      <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder="Technique" />
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>ACTIVE</option><option>NEEDS_REVIEW</option><option>RETIRED</option></select>
      <button onClick={() => void load(0)}>Apply</button>
      <button className="ghost" onClick={() => { setSearch(''); setTier(''); setTechnique(''); setStatus(''); setTimeout(() => void load(0), 0) }}>Clear</button>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="panel"><h2>Coverage matrix</h2><p className="muted">Click a cell to filter the table. <b>!</b> means the slot has References awaiting review.</p><div className="matrix"><div className="matrix-row head"><span>Technique</span>{Array.from({length:30},(_,i)=><b key={i}>{i+1}</b>)}</div>{techniques.map((tech) => <div className="matrix-row" key={tech}><strong>{tech}</strong>{Array.from({length:30},(_,i)=>{ const t=i+1; const row=coverage.find((x)=>x.family===family&&x.technique===tech&&Number(x.tier)===t); const active=Number(row?.active??0); const review=Number(row?.needs_review??0); return <button type="button" key={t} className={`matrix-cell ${active?'covered':''} ${review?'review-cell':''}`} title={`${family}${t} ${tech}: active ${active}, review ${review}`} onClick={()=>chooseCell(t,tech)}>{active || (review?'!':'·')}</button>})}</div>)}</div></div>
    <div className="table-wrap"><table><thead><tr><th>Slot</th><th>Level / Version</th><th>Technique</th><th>Status</th><th>Notes</th></tr></thead><tbody>{data.references.map((r)=><tr key={r.id}><td><RatingBadge family={r.family} tier={r.tier}/></td><td><a href={`#/levels/${r.levelId}`}><strong>{r.levelTitle}</strong></a><small>{r.song} · {r.creator} · {r.versionLabel}</small></td><td>{r.technique}<small>{r.positionHint===null?'no position hint':`position ${r.positionHint}`}</small></td><td><Status value={r.status}/></td><td>{r.notes??<span className="muted">—</span>}</td></tr>)}</tbody></table></div>
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x)=>void load(x)} />
  </section>
}

function Proposals({ user }: { user: SessionUser | null }) {
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Proposal loading failed') }
  }
  useEffect(() => { void load(0) }, [status, type, user?.id])
  useEffect(() => { if (user) void api<PagedLevels>('/catalog/levels?limit=100&sort=title').then((x) => setLevels(x.levels)) }, [user?.id])

  return <section>
    <div className="section-head"><div><p className="eyebrow">Governance</p><h1>Proposals</h1><p className="muted">{data.total} matching proposal(s)</p></div></div>
    <div className="filter-panel proposal-filters"><input value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&void load(0)} placeholder="Proposal / Level / reason"/><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">All statuses</option><option>OPEN</option><option>APPROVED</option><option>REJECTED</option><option>WITHDRAWN</option></select><select value={type} onChange={(e)=>setType(e.target.value)}><option value="">All types</option>{['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER'].map((x)=><option key={x}>{x}</option>)}</select><button onClick={()=>void load(0)}>Search</button></div>
    {error&&<p className="error">{error}</p>}
    {user && <details className="proposal-create"><summary>Create proposal</summary><ProposalForm levels={levels} onCreated={()=>void load(0)} /></details>}
    <div className="cards proposal-grid">{data.proposals.map((p)=><article className="proposal" key={p.id}>
      <div className="proposal-meta"><span className="pill">{p.type}</span><Status value={p.status}/><ExecutionState state={p.executionState} message={p.executionMessage}/>{p.myVote&&<span className="my-vote">You: {p.myVote}</span>}</div>
      <h3><a href={`#/proposals/${p.id}`}>{p.title}</a></h3><p><a className="text-link" href={`#/levels/${p.levelId}`}>{p.levelTitle}</a> · by {p.proposerName} · {new Date(p.createdAt).toLocaleString()}</p>
      <ProposalChange proposal={p}/><p>{p.reason}</p><div className="votes"><span>Agree <b>{p.agree}</b></span><span>Disagree <b>{p.disagree}</b></span><span>Abstain <b>{p.abstain}</b></span><a className="text-link" href={`#/proposals/${p.id}`}>Details / vote</a></div>
    </article>)}</div>
    {!data.proposals.length&&<p className="empty panel">No proposals match these filters.</p>}
    <Pagination total={data.total} offset={data.offset} limit={data.limit} onPage={(x)=>void load(x)} />
  </section>
}

function VoteButtons({ proposal, user, onChanged }: { proposal: ProposalRow; user: SessionUser | null; onChanged: () => void }) {
  const [error,setError]=useState('')
  if (!user) return <p className="muted"><a className="text-link" href="#/login">Login</a> to vote.</p>
  if (proposal.status !== 'OPEN') return <p className="muted">Voting is closed.</p>
  const cast=async(vote:ProposalVoteValue)=>{try{await api(`/governance/proposals/${proposal.id}/vote`,{method:'POST',body:JSON.stringify({vote})});setError('');onChanged()}catch(e){setError(e instanceof Error?e.message:'Vote failed')}}
  return <div><div className="vote-actions">{(['AGREE','DISAGREE','ABSTAIN'] as ProposalVoteValue[]).map((v)=><button key={v} className={proposal.myVote===v?'selected-vote':'ghost'} onClick={()=>void cast(v)}>{v}</button>)}</div>{error&&<p className="error">{error}</p>}</div>
}

function Proposal({ id, user }: { id: string; user: SessionUser | null }) {
  const [detail,setDetail]=useState<ProposalDetail|null>(null)
  const [comment,setComment]=useState('')
  const [error,setError]=useState('')
  const load=async()=>{setError('');try{setDetail(await api<ProposalDetail>(`/governance/proposals/${id}`))}catch(e){setError(e instanceof Error?e.message:'Proposal loading failed')}}
  useEffect(()=>{void load()},[id,user?.id])
  if(error)return <div className="panel error">{error}</div>
  if(!detail)return <div className="panel">Loading…</div>
  const p=detail.proposal
  const addComment=async()=>{if(!comment.trim())return;try{await api(`/governance/proposals/${id}/comments`,{method:'POST',body:JSON.stringify({body:comment})});setComment('');await load()}catch(e){setError(e instanceof Error?e.message:'Comment failed')}}
  return <section>
    <a className="back-link" href="#/proposals">← Proposals</a>
    <div className="section-head proposal-head"><div><div className="proposal-meta"><span className="pill">{p.type}</span><Status value={p.status}/><ExecutionState state={p.executionState} message={p.executionMessage}/></div><h1>{p.title}</h1><p><a className="text-link" href={`#/levels/${p.levelId}`}>{p.levelTitle}</a> · proposed by {p.proposerName} · {new Date(p.createdAt).toLocaleString()}</p></div></div>
    <div className={`execution-box execution-box-${p.executionState.toLowerCase()}`}><strong>{p.executionState}</strong><p>{p.executionMessage}</p></div>
    <div className="two-col">
      <div className="panel"><h2>Proposed change</h2><ProposalChange proposal={p}/><h3>Reason</h3><p className="long-text">{p.reason}</p>{p.decisionReason&&<><h3>Decision</h3><p>{p.decisionReason}</p><p className="muted">{p.decidedByName??'Staff'} · {p.decidedAt?new Date(p.decidedAt).toLocaleString():''}</p></>}</div>
      <div className="panel"><h2>Vote</h2><div className="big-votes"><div><strong>{p.agree}</strong><span>Agree</span></div><div><strong>{p.disagree}</strong><span>Disagree</span></div><div><strong>{p.abstain}</strong><span>Abstain</span></div></div><VoteButtons proposal={p} user={user} onChanged={()=>void load()}/><h3>Voters</h3>{detail.votes.length?<div className="voter-list">{detail.votes.map((v)=><div key={v.userId}><strong>{v.displayName}</strong><span className={`vote-value vote-${v.vote.toLowerCase()}`}>{v.vote}</span></div>)}</div>:<p className="muted">No votes yet.</p>}</div>
    </div>
    <div className="panel"><h2>Discussion</h2>{detail.comments.length?<div className="comments">{detail.comments.map((c)=><article key={c.id}><div><strong>{c.displayName}</strong><time>{new Date(c.createdAt).toLocaleString()}</time></div><p>{c.body}</p></article>)}</div>:<p className="muted">No comments yet.</p>}{user?<div className="comment-form"><textarea value={comment} onChange={(e)=>setComment(e.target.value)} maxLength={4000} placeholder="Add context, comparisons, or review notes"/><button disabled={!comment.trim()} onClick={()=>void addComment()}>Post comment</button></div>:<p className="muted"><a className="text-link" href="#/login">Login</a> to join the discussion.</p>}</div>
  </section>
}

function ProposalForm({ levels, onCreated }: { levels: LevelListItem[]; onCreated:()=>void }) {
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
  const create=async()=>{if(!detail)return;setError('');let payload:Record<string,unknown>={};if(type==='RERATE'){payload={targetLevelVersionId:detail.currentVersionId,currentCanonicalRating:detail.currentRating?{family:detail.currentRating.family,tier:detail.currentRating.tier}:null,proposedRating:{family,tier}}}else if(type==='REFERENCE_ADD'){payload={levelVersionId:detail.currentVersionId,reference:{family,tier,technique,positionHint:hint===''?null:Number(hint),confidence:confidence===''?null:Number(confidence),notes:notes||null}}}else if(type==='REFERENCE_MOVE'){payload={referenceId,target:{family,tier,positionHint:hint===''?null:Number(hint)}}}else if(type==='REFERENCE_REMOVE'){payload={referenceId}}try{await api('/proposals',{method:'POST',body:JSON.stringify({levelId,type,title,reason,payload})});setTitle('');setReason('');setNotes('');setReferenceId('');setError('');onCreated()}catch(e){setError(e instanceof Error?e.message:'Proposal creation failed')}}

  return <div className="panel proposal-form"><h2>New proposal</h2><div className="form-grid"><label>Level<select value={levelId} onChange={(e)=>setLevelId(e.target.value)}><option value="">Select</option>{levels.map((l)=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label><label>Type<select value={type} onChange={(e)=>{setType(e.target.value as ProposalType);setReferenceId('');setError('')}}>{['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER'].map((x)=><option key={x}>{x}</option>)}</select></label></div>
    {type==='RERATE'&&<div className="form-grid"><label>Proposed family<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>Proposed tier<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label></div>}
    {type==='REFERENCE_ADD'&&<><p className="note">The server captures the current canonical slot as the execution baseline.</p><div className="form-grid"><label>Family<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>Tier<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label><label>Technique<input value={technique} onChange={(e)=>setTechnique(e.target.value)}/></label><label>Position<select value={hint} onChange={(e)=>setHint(e.target.value)}><option value="">No hint</option><option value="-2">lower</option><option value="-1">slightly lower</option><option value="0">center</option><option value="1">slightly higher</option><option value="2">higher</option></select></label><label>Confidence<input type="number" min="0" max="1" step=".05" value={confidence} onChange={(e)=>setConfidence(e.target.value)}/></label></div><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Reference notes (optional)"/></>}
    {(type==='REFERENCE_MOVE'||type==='REFERENCE_REMOVE')&&<label>Reference<select value={referenceId} onChange={(e)=>setReferenceId(e.target.value)}><option value="">Select Reference</option>{refs.map((r)=><option key={r.id} value={r.id}>{r.family}{r.tier} · {r.technique} · {r.status}</option>)}</select></label>}
    {type==='REFERENCE_MOVE'&&selectedRef&&<><p className="note">Move preserves technique/confidence/notes and changes only slot/position.</p><div className="form-grid"><label>Target family<select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>Target tier<input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/></label><label>Position<select value={hint} onChange={(e)=>setHint(e.target.value)}><option value="">No hint</option><option value="-2">lower</option><option value="-1">slightly lower</option><option value="0">center</option><option value="1">slightly higher</option><option value="2">higher</option></select></label></div></>}
    <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Proposal title"/><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="理由・比較対象・根拠"/>{error&&<p className="error">{error}</p>}<button disabled={!canSubmit} onClick={()=>void create()}>Create proposal</button></div>
}

function Login({ onLogin }: { onLogin:(u:SessionUser)=>void }) {
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  return <section className="narrow"><div className="panel"><h1>Login</h1><label>Email<input value={email} onChange={(e)=>setEmail(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} /></label>{error&&<p className="error">{error}</p>}<button onClick={async()=>{try{const r=await api<{user:SessionUser}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(r.user)}catch(e){setError(e instanceof Error?e.message:'Login failed')}}}>Login</button></div></section>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
