import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Family, LevelDetail, LevelListItem, ProposalRow, PublicStats, ReferenceRow, SessionUser } from '@elf/shared'
import { RATING_LEAN_LABELS } from '@elf/shared'
import { api } from './api'
import './styles.css'

type Route = { page: 'home' | 'levels' | 'level' | 'references' | 'proposals' | 'login'; id?: string }

function parseRoute(): Route {
  const raw = (location.hash || '#/').slice(1)
  const parts = raw.split('/').filter(Boolean)
  if (parts[0] === 'levels' && parts[1]) return { page: 'level', id: parts[1] }
  if (parts[0] === 'levels') return { page: 'levels' }
  if (parts[0] === 'references') return { page: 'references' }
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
          <span>{user.displayName} <small>{user.role}</small></span>
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
      {route.page === 'login' && <Login onLogin={(u) => { setUser(u); location.hash = '#/' }} />}
    </main>
    <footer>Canonical difficulty is an integer P/G/U tier. Fine-grained votes are evidence, not an official 100-step scale.</footer>
  </div>
}

function Home() {
  const [stats, setStats] = useState<PublicStats | null>(null)
  useEffect(() => { void api<PublicStats>('/stats').then(setStats) }, [])
  return <>
    <section className="hero">
      <div>
        <p className="eyebrow">Versioned collaborative ADOFAI difficulty database</p>
        <h1>Referenceを固定された「正解」にしない。</h1>
        <p>難易度、投票、Reference、外部データ、Analyzer結果を分離して保存し、判断と履歴を追跡できるフォーラム。</p>
        <div className="actions"><a className="button" href="#/levels">Level database</a><a className="button secondary" href="#/references">Reference coverage</a></div>
      </div>
    </section>
    <section className="stats-grid">
      <Stat label="Levels" value={stats?.levels} />
      <Stat label="Active References" value={stats?.activeReferences} />
      <Stat label="Open Proposals" value={stats?.openProposals} />
      <Stat label="Rating Votes" value={stats?.ratingVotes} />
    </section>
    <section className="panel rule-panel">
      <h2>Data rules</h2>
      <div className="three-col">
        <div><strong>Version first</strong><p>同じ曲でもOriginal/NerfedはSHA付きLevelVersionとして分離。</p></div>
        <div><strong>References can move</strong><p>Reference譜面のrerateを禁止しない。矛盾したReference側をNEEDS_REVIEWへ。</p></div>
        <div><strong>Evidence ≠ decision</strong><p>投票・外部rating・Analyzer予測はcanonical ratingを直接上書きしない。</p></div>
      </div>
    </section>
  </>
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="stat"><span>{label}</span><strong>{value ?? '—'}</strong></div>
}

function Levels() {
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('')
  const [levels, setLevels] = useState<LevelListItem[]>([])
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ search })
      if (family) qs.set('family', family)
      const data = await api<{ levels: LevelListItem[] }>(`/levels?${qs}`)
      setLevels(data.levels)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [family])
  return <section>
    <div className="section-head"><div><p className="eyebrow">Database</p><h1>Levels</h1></div></div>
    <div className="filters"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} placeholder="曲名・譜面名・作者" /><select value={family} onChange={(e) => setFamily(e.target.value)}><option value="">All</option><option>P</option><option>G</option><option>U</option></select><button onClick={() => void load()}>Search</button></div>
    <div className="table-wrap"><table><thead><tr><th>Rating</th><th>Song / Level</th><th>Creator</th><th>Votes</th></tr></thead><tbody>
      {levels.map((level) => <tr key={level.id}><td>{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">Unrated</span>}</td><td><a href={`#/levels/${level.id}`}><strong>{level.title}</strong></a><small>{level.song}</small></td><td>{level.creator}</td><td>{level.voteCount}</td></tr>)}
      {!levels.length && !loading && <tr><td colSpan={4} className="empty">No levels</td></tr>}
    </tbody></table></div>
  </section>
}

function Level({ id, user }: { id: string; user: SessionUser | null }) {
  const [level, setLevel] = useState<LevelDetail | null>(null)
  const [message, setMessage] = useState('')
  const load = () => api<LevelDetail>(`/levels/${id}`).then(setLevel)
  useEffect(() => { void load() }, [id])
  if (!level) return <div className="panel">Loading…</div>
  const canRate = user && ['RATER','REFERENCE_MANAGER','MODERATOR','ADMIN'].includes(user.role)
  return <section>
    <div className="section-head"><div><p className="eyebrow">{level.song}</p><h1>{level.title}</h1><p>by {level.creator}</p></div><div>{level.currentRating ? <RatingBadge family={level.currentRating.family} tier={level.currentRating.tier} /> : <span className="muted">Unrated</span>}</div></div>
    <div className="two-col">
      <div className="panel"><h2>Current / history</h2>{level.ratingHistory.map((r) => <div className="history" key={r.id}><RatingBadge family={r.family} tier={r.tier} /><span>{new Date(r.effectiveFrom).toLocaleString()}</span><span>{r.effectiveTo ? 'closed' : 'current'}</span><p>{r.reason ?? '—'}</p></div>)}</div>
      <div className="panel"><h2>Community evidence</h2>{level.voteSummary.length ? level.voteSummary.map((v) => <div className="summary-row" key={`${v.family}${v.anchorTier}`}><RatingBadge family={v.family} tier={v.anchorTier} /><span>n={v.count}</span><span>median evidence {v.medianEvidence.toFixed(2)}</span></div>) : <p className="muted">No votes yet.</p>}<p className="note">小数は投票集約用の補助値です。canonical difficultyではありません。</p></div>
    </div>
    {canRate && <VoteBox level={level} onSaved={() => { setMessage('Vote saved'); void load() }} />}
    {message && <div className="notice">{message}</div>}
    <div className="two-col">
      <div className="panel"><h2>References</h2>{level.references.map((r) => <div className="ref-row" key={r.id}><RatingBadge family={r.family} tier={r.tier} /><strong>{r.technique}</strong><span className={`status ${r.status.toLowerCase()}`}>{r.status}</span></div>)}{!level.references.length && <p className="muted">Not a reference.</p>}</div>
      <div className="panel"><h2>Versions</h2>{level.versions.map((v) => <div className="version" key={v.id}><strong>{v.label}</strong>{v.id === level.currentVersionId && <span className="pill">current</span>}<code>{v.sha256 ?? 'no sha256'}</code>{v.downloadUrl && <a target="_blank" rel="noreferrer" href={v.downloadUrl}>Download source</a>}</div>)}</div>
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
  return <div className="panel vote-box"><h2>Difficulty evidence</h2><p>正式値を小数で入力せず、整数tierをanchorにして5段階の寄り方を記録します。</p><div className="form-grid"><label>Family<select value={family} onChange={(e) => setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label><label>Anchor tier<input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(Number(e.target.value))} /></label><label>Lean<select value={lean} onChange={(e) => setLean(Number(e.target.value))}>{[-2,-1,0,1,2].map((x) => <option key={x} value={x}>{RATING_LEAN_LABELS[x as keyof typeof RATING_LEAN_LABELS]}</option>)}</select></label><label>Confidence<select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}>{[1,2,3,4,5].map((x)=><option key={x}>{x}</option>)}</select></label></div><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="根拠・比較したReferenceなど" /><button onClick={async () => { await api(`/levels/${level.id}/votes`, { method:'POST', body: JSON.stringify({ family, anchorTier:tier, lean, confidence, comment }) }); onSaved() }}>Save vote</button></div>
}

function References() {
  const [refs, setRefs] = useState<ReferenceRow[]>([])
  const [coverage, setCoverage] = useState<any[]>([])
  const [family, setFamily] = useState('G')
  useEffect(() => {
    void Promise.all([
      api<{ references: ReferenceRow[] }>(`/references?family=${family}`).then((x) => setRefs(x.references)),
      api<{ coverage: any[] }>('/references/coverage').then((x) => setCoverage(x.coverage)),
    ])
  }, [family])
  const techniques = useMemo(() => [...new Set(coverage.filter((x) => x.family === family).map((x) => x.technique))].sort(), [coverage, family])
  return <section><div className="section-head"><div><p className="eyebrow">Anchors are reviewable</p><h1>References</h1></div><select value={family} onChange={(e)=>setFamily(e.target.value)}><option>P</option><option>G</option><option>U</option></select></div>
    <div className="panel"><h2>Coverage matrix</h2><div className="matrix"><div className="matrix-row head"><span>Technique</span>{Array.from({length:20},(_,i)=><b key={i}>{i+1}</b>)}</div>{techniques.map((tech) => <div className="matrix-row" key={tech}><strong>{tech}</strong>{Array.from({length:20},(_,i)=>{ const tier=i+1; const row=coverage.find((x)=>x.family===family && x.technique===tech && x.tier===tier); const active=row?.active??0; const review=row?.needs_review??0; return <span key={tier} className={active ? 'covered' : review ? 'review-cell' : ''} title={`${family}${tier} ${tech}: active ${active}, review ${review}`}>{active || (review ? '!' : '·')}</span> })}</div>)}</div><p className="note">空白領域と重複領域を可視化するための表。position hintは正式な細分難易度ではありません。</p></div>
    <div className="table-wrap"><table><thead><tr><th>Slot</th><th>Level</th><th>Technique</th><th>Status</th></tr></thead><tbody>{refs.map((r)=><tr key={r.id}><td><RatingBadge family={r.family} tier={r.tier}/></td><td><a href={`#/levels/${r.levelId}`}>{r.levelTitle}</a></td><td>{r.technique}</td><td><span className={`status ${r.status.toLowerCase()}`}>{r.status}</span></td></tr>)}</tbody></table></div>
  </section>
}

function Proposals({ user }: { user: SessionUser | null }) {
  const [rows, setRows] = useState<ProposalRow[]>([])
  const [levels, setLevels] = useState<LevelListItem[]>([])
  const load = () => api<{ proposals: ProposalRow[] }>('/proposals').then((x)=>setRows(x.proposals))
  useEffect(()=>{ void load(); if(user) void api<{levels:LevelListItem[]}>('/levels?limit=100').then((x)=>setLevels(x.levels)) },[user])
  return <section><div className="section-head"><div><p className="eyebrow">Governance</p><h1>Proposals</h1></div></div>{user && <ProposalForm levels={levels} onCreated={()=>void load()} />}
    <div className="cards">{rows.map((p)=><article className="proposal" key={p.id}><div><span className="pill">{p.type}</span><span className={`status ${p.status.toLowerCase()}`}>{p.status}</span></div><h3>{p.title}</h3><p><a href={`#/levels/${p.levelId}`}>{p.levelTitle}</a> · by {p.proposerName}</p><p>{p.reason}</p><div className="votes"><span>Agree {p.agree}</span><span>Disagree {p.disagree}</span><span>Abstain {p.abstain}</span>{user && p.status==='OPEN' && <>{['AGREE','DISAGREE','ABSTAIN'].map((v)=><button className="ghost" key={v} onClick={async()=>{await api(`/proposals/${p.id}/votes`,{method:'POST',body:JSON.stringify({vote:v})});void load()}}>{v}</button>)}</>}</div></article>)}</div>
  </section>
}

function ProposalForm({ levels, onCreated }: { levels: LevelListItem[]; onCreated:()=>void }) {
  const [levelId,setLevelId]=useState(''); const [type,setType]=useState('RERATE'); const [title,setTitle]=useState(''); const [reason,setReason]=useState('')
  return <div className="panel"><h2>New proposal</h2><div className="form-grid"><label>Level<select value={levelId} onChange={(e)=>setLevelId(e.target.value)}><option value="">Select</option>{levels.map((l)=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label><label>Type<select value={type} onChange={(e)=>setType(e.target.value)}>{['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER'].map((x)=><option key={x}>{x}</option>)}</select></label></div><input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Proposal title"/><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="理由・比較対象・根拠"/><button disabled={!levelId||!title||!reason} onClick={async()=>{await api('/proposals',{method:'POST',body:JSON.stringify({levelId,type,title,reason,payload:{}})});setTitle('');setReason('');onCreated()}}>Create</button></div>
}

function Login({ onLogin }: { onLogin:(u:SessionUser)=>void }) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState('')
  return <section className="narrow"><div className="panel"><h1>Login</h1><label>Email<input value={email} onChange={(e)=>setEmail(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} /></label>{error&&<p className="error">{error}</p>}<button onClick={async()=>{try{const r=await api<{user:SessionUser}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(r.user)}catch(e){setError(e instanceof Error?e.message:'Login failed')}}}>Login</button></div></section>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
