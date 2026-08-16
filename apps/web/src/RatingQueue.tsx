import React, { useEffect, useMemo, useState } from 'react'
import type { Family, RatingLean, RatingQueueItem, SessionUser } from '@elf/shared'
import { api } from './api'
import { useI18n } from './i18n'
import { RatingGuidePage } from './RatingGuide'
import './rating-queue.css'

type QueueResponse = {
  items: RatingQueueItem[]
  limits: { activeQueue: number; activeClaimsPerRater?: number }
  activeClaims?: number
}

function canRate(user: SessionUser | null) {
  return !!user && ['RATER','REFERENCE_MANAGER','MODERATOR','ADMIN'].includes(user.role)
}

function isStaff(user: SessionUser | null) {
  return !!user && ['MODERATOR','ADMIN'].includes(user.role)
}

function taskIdFromHash() {
  const raw = (location.hash || '#/rating-queue').slice(1).split('?')[0] ?? ''
  const parts = raw.split('/').filter(Boolean)
  return parts[0] === 'rating-queue' && parts[1] ? parts[1] : null
}

export function RatingQueuePage({ user }: { user: SessionUser | null }) {
  const taskId = taskIdFromHash()
  if (taskId === 'guide') return <RatingGuidePage />
  if (taskId) return <RatingTaskPage user={user} id={taskId} />
  return <RatingQueueList user={user} />
}

function RatingQueueList({ user }: { user: SessionUser | null }) {
  const { locale } = useI18n()
  const ja = locale === 'ja'
  const copy = ja ? {
    title: '査定キュー',
    eyebrow: 'Rating Queue',
    description: '未評価譜面すべてではなく、現在募集している譜面だけを表示します。担当は最大5件です。',
    login: '査定キューを見るにはRATERでログインしてください。',
    denied: 'このページはRATER以上が利用できます。',
    mine: '自分の担当',
    open: '査定募集中',
    submitted: '提出済み',
    review: 'Review Ready',
    emptyMine: '現在担当している譜面はありません。',
    emptyOpen: '現在、新しく受けられる査定はありません。',
    emptyReview: '確認待ちの譜面はありません。',
    claim: 'これを査定する',
    release: '担当を外す',
    rate: '査定画面を開く',
    detail: '譜面を見る',
    reviewDetail: '査定内容を確認',
    guide: '査定ガイド',
    progress: (item: RatingQueueItem) => `${item.voteCount}/${item.minVotes} 票`,
    capacity: (item: RatingQueueItem) => `担当中 ${item.activeClaimCount} · 最大 ${item.maxVotes} 票`,
    candidate: '候補',
    consensus: '査定が近いため確認可能',
    disagreement: '意見が割れたためスタッフ確認が必要',
    oneMore: '意見が割れています。あと1人の査定を募集します。',
    needMore: '査定数が不足しています。',
    blind: '外部Ratingはこのキューでは査定材料として表示しません。まず自分の判断を提出します。',
    failed: '査定キューの読み込みに失敗しました',
  } : {
    title: 'Rating Queue',
    eyebrow: 'Rating Queue',
    description: 'Only levels explicitly opened for rating appear here; Unrated does not mean queued. Each rater may hold up to five claims.',
    login: 'Log in with a RATER account to use the rating queue.',
    denied: 'This page requires the RATER role or higher.',
    mine: 'My claims',
    open: 'Open for rating',
    submitted: 'Submitted',
    review: 'Review Ready',
    emptyMine: 'You have no active rating claims.',
    emptyOpen: 'There are no rating items available to claim.',
    emptyReview: 'Nothing is waiting for staff review.',
    claim: 'Claim rating',
    release: 'Release claim',
    rate: 'Open rating task',
    detail: 'View level',
    reviewDetail: 'Inspect rating task',
    guide: 'Rating guide',
    progress: (item: RatingQueueItem) => `${item.voteCount}/${item.minVotes} votes`,
    capacity: (item: RatingQueueItem) => `${item.activeClaimCount} claimed · max ${item.maxVotes} votes`,
    candidate: 'Candidate',
    consensus: 'Ratings are close enough for staff review.',
    disagreement: 'Ratings disagree; staff review is required.',
    oneMore: 'Ratings disagree. One more independent rating is requested.',
    needMore: 'More ratings are required.',
    blind: 'External ratings are not shown in this queue before you submit your own judgment.',
    failed: 'Failed to load rating queue',
  }

  const [data, setData] = useState<QueueResponse>({ items: [], limits: { activeQueue: 30 }, activeClaims: 0 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    if (!canRate(user)) return
    setError('')
    try { setData(await api<QueueResponse>('/rating-queue')) }
    catch (e) { setError(e instanceof Error ? e.message : copy.failed) }
  }
  useEffect(() => { void load() }, [user?.id])

  const mine = useMemo(() => data.items.filter((item) => item.status === 'OPEN' && item.myClaimStatus === 'ACTIVE'), [data.items])
  const submitted = useMemo(() => data.items.filter((item) => item.status === 'OPEN' && item.myVoteSubmitted && item.myClaimStatus !== 'ACTIVE'), [data.items])
  const open = useMemo(() => data.items.filter((item) => item.status === 'OPEN' && item.myClaimStatus !== 'ACTIVE' && !item.myVoteSubmitted), [data.items])
  const review = useMemo(() => data.items.filter((item) => item.status === 'REVIEW_READY'), [data.items])

  if (!user) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.login}</p><div className="rating-login-actions"><a className="button" href="#/login">Login</a><a className="button secondary" href="#/rating-queue/guide">{copy.guide}</a></div></div></section>
  if (!canRate(user)) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.denied}</p><a className="button secondary" href="#/rating-queue/guide">{copy.guide}</a></div></section>

  const mutate = async (item: RatingQueueItem, action: 'claim' | 'release') => {
    setBusy(item.id); setError('')
    try {
      await api(`/rating-queue/${item.id}/claim`, { method: action === 'claim' ? 'POST' : 'DELETE' })
      if (action === 'claim') {
        location.hash = `#/rating-queue/${item.id}`
        return
      }
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy('') }
  }

  const reason = (item: RatingQueueItem) => {
    if (!item.review) return null
    if (item.review.reason === 'CONSENSUS') return copy.consensus
    if (item.review.reason === 'DISAGREEMENT') return copy.disagreement
    if (item.review.reason === 'DISAGREEMENT_NEEDS_ONE_MORE') return copy.oneMore
    return copy.needMore
  }

  const card = (item: RatingQueueItem, mode: 'mine' | 'open' | 'submitted' | 'review') => <article className={`rating-queue-card ${mode}`} key={item.id}>
    <div className="rating-queue-card-main">
      <p className="eyebrow">{item.artist}</p>
      <h3>{item.song}</h3>
      <p>{item.creator}{item.effecter ? ` · FX: ${item.effecter}` : ''}</p>
      <small>{item.versionLabel} · {copy.progress(item)} · {copy.capacity(item)}</small>
      {mode === 'review' && <div className="rating-queue-review">
        <strong>{reason(item)}</strong>
        {item.review?.candidate && <span>{copy.candidate}: {item.review.candidate.family}{item.review.candidate.tier}</span>}
      </div>}
    </div>
    <div className="rating-queue-actions">
      {mode === 'open' && <button disabled={busy === item.id} onClick={() => void mutate(item, 'claim')}>{copy.claim}</button>}
      {mode === 'mine' && <><a className="button" href={`#/rating-queue/${item.id}`}>{copy.rate}</a><button className="ghost" disabled={busy === item.id} onClick={() => void mutate(item, 'release')}>{copy.release}</button></>}
      {mode === 'submitted' && <a className="button secondary" href={`#/levels/${item.levelId}`}>{copy.detail}</a>}
      {mode === 'review' && <a className="button secondary" href={`#/rating-queue/${item.id}`}>{copy.reviewDetail}</a>}
    </div>
  </article>

  return <section>
    <div className="section-head"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="muted">{copy.description}</p></div><a className="button secondary" href="#/rating-queue/guide">{copy.guide}</a></div>
    <p className="note rating-queue-blind">{copy.blind}</p>
    {error && <p className="error">{error}</p>}

    <div className="rating-queue-summary">
      <span>{copy.mine}: <b>{mine.length}</b> / {data.limits.activeClaimsPerRater ?? 5}</span>
      <span>{copy.open}: <b>{open.length}</b></span>
      {isStaff(user) && <span>{copy.review}: <b>{review.length}</b></span>}
    </div>

    <h2>{copy.mine}</h2>
    <div className="rating-queue-grid">{mine.map((item) => card(item, 'mine'))}</div>
    {!mine.length && <p className="muted">{copy.emptyMine}</p>}

    {!!submitted.length && <><h2>{copy.submitted}</h2><div className="rating-queue-grid">{submitted.map((item) => card(item, 'submitted'))}</div></>}

    <h2>{copy.open}</h2>
    <div className="rating-queue-grid">{open.map((item) => card(item, 'open'))}</div>
    {!open.length && <p className="muted">{copy.emptyOpen}</p>}

    {isStaff(user) && <><h2>{copy.review}</h2><div className="rating-queue-grid">{review.map((item) => card(item, 'review'))}</div>{!review.length && <p className="muted">{copy.emptyReview}</p>}</>}
  </section>
}

function RatingTaskPage({ user, id }: { user: SessionUser | null; id: string }) {
  const { locale, lean: leanLabel } = useI18n()
  const ja = locale === 'ja'
  const copy = ja ? {
    title: '譜面査定', back: '← 査定キューへ', guide: '査定ガイド', login: '査定するにはRATERでログインしてください。', denied: 'RATER以上の権限が必要です。',
    version: '対象バージョン', sha: 'SHA-256', noSha: 'SHAなし', download: '配布ページ', video: '動画を見る', level: '譜面表示を開く',
    blind: 'この画面では、他人の査定・確定難易度・TUFなどの外部Ratingを査定前に表示しません。',
    claimNeeded: 'この譜面を担当してから査定を送信できます。', claim: 'この譜面を担当する', release: '担当を外す',
    submitted: 'このバージョンへの査定は提出済みです。', reviewReady: 'この査定ラウンドはスタッフ確認待ちです。',
    family: '難易度帯', tier: '基準Tier', lean: 'Tier内の位置', confidence: '確信度', comment: 'コメント（任意）', submit: '査定を提出',
    failed: '査定タスクの読み込みに失敗しました',
  } : {
    title: 'Rate level', back: '← Rating Queue', guide: 'Rating guide', login: 'Log in with a RATER account to rate this level.', denied: 'This task requires RATER or higher.',
    version: 'Target version', sha: 'SHA-256', noSha: 'no SHA', download: 'Download', video: 'Watch video', level: 'Open level display',
    blind: 'This task does not show peer ratings, the confirmed rating, or external/TUF rating evidence before submission.',
    claimNeeded: 'Claim this task before submitting a rating.', claim: 'Claim this task', release: 'Release claim',
    submitted: 'You already submitted a rating for this Version.', reviewReady: 'This rating round is waiting for staff review.',
    family: 'Family', tier: 'Anchor tier', lean: 'Position within tier', confidence: 'Confidence', comment: 'Comment (optional)', submit: 'Submit rating',
    failed: 'Failed to load rating task',
  }

  const [item, setItem] = useState<RatingQueueItem | null>(null)
  const [family, setFamily] = useState<Family>('G')
  const [tier, setTier] = useState(1)
  const [lean, setLean] = useState<RatingLean>(0)
  const [confidence, setConfidence] = useState(3)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!canRate(user)) return
    setError('')
    try {
      const result = await api<{ item: RatingQueueItem }>(`/rating-queue/${id}`)
      setItem(result.item)
    } catch (e) { setError(e instanceof Error ? e.message : copy.failed) }
  }
  useEffect(() => { void load() }, [id, user?.id])

  if (!user) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.login}</p><div className="rating-login-actions"><a className="button" href="#/login">Login</a><a className="button secondary" href="#/rating-queue/guide">{copy.guide}</a></div></div></section>
  if (!canRate(user)) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.denied}</p><a className="button secondary" href="#/rating-queue/guide">{copy.guide}</a></div></section>
  if (error && !item) return <section><div className="rating-task-nav"><a className="back-link" href="#/rating-queue">{copy.back}</a><a className="text-link" href="#/rating-queue/guide">{copy.guide}</a></div><div className="panel error">{error}</div></section>
  if (!item) return <section><div className="panel">Loading…</div></section>

  const claimed = item.myClaimStatus === 'ACTIVE'
  const submitted = item.myVoteSubmitted || item.myClaimStatus === 'SUBMITTED'
  const open = item.status === 'OPEN'

  const claim = async () => {
    setBusy(true); setError('')
    try { await api(`/rating-queue/${item.id}/claim`, { method: 'POST' }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const release = async () => {
    setBusy(true); setError('')
    try { await api(`/rating-queue/${item.id}/claim`, { method: 'DELETE' }); location.hash = '#/rating-queue' }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await api(`/rating-queue/${item.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ family, anchorTier: tier, lean, confidence, comment }),
      })
      location.hash = '#/rating-queue'
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return <section className="rating-task-page">
    <div className="rating-task-nav"><a className="back-link" href="#/rating-queue">{copy.back}</a><a className="text-link" href="#/rating-queue/guide">{copy.guide}</a></div>
    <div className="rating-task-head panel">
      <div>
        <p className="eyebrow">{item.artist}</p>
        <h1>{item.song}</h1>
        <p>{item.creator}{item.effecter ? ` · FX: ${item.effecter}` : ''}</p>
      </div>
      <div className="rating-task-version"><span>{copy.version}</span><strong>{item.versionLabel}</strong><code>{item.sha256 ?? copy.noSha}</code></div>
      <div className="rating-task-links">
        {item.videoUrl && <a className="button" href={item.videoUrl} target="_blank" rel="noreferrer">{copy.video}</a>}
        {item.downloadUrl && <a className="button secondary" href={item.downloadUrl} target="_blank" rel="noreferrer">{copy.download}</a>}
        <a className="button ghost" href={`#/levels/${item.levelId}`}>{copy.level}</a>
      </div>
    </div>

    <p className="note rating-queue-blind">{copy.blind} <a className="text-link" href="#/rating-queue/guide">{copy.guide}</a></p>
    {error && <p className="error">{error}</p>}

    {!open && <div className="panel"><strong>{copy.reviewReady}</strong></div>}
    {submitted && <div className="panel"><strong>{copy.submitted}</strong></div>}
    {open && !submitted && !claimed && <div className="panel"><p>{copy.claimNeeded}</p><button disabled={busy} onClick={() => void claim()}>{copy.claim}</button></div>}

    {open && claimed && !submitted && <div className="panel rating-task-form">
      <div className="form-grid">
        <label>{copy.family}<select value={family} onChange={(e) => setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select></label>
        <label>{copy.tier}<input type="number" min="1" max="30" value={tier} onChange={(e) => setTier(Number(e.target.value))} /></label>
        <label>{copy.lean}<select value={lean} onChange={(e) => setLean(Number(e.target.value) as RatingLean)}>{([-2,-1,0,1,2] as RatingLean[]).map((value) => <option key={value} value={value}>{leanLabel(value)}</option>)}</select></label>
        <label>{copy.confidence}<select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} placeholder={copy.comment} />
      <div className="rating-task-submit"><button disabled={busy} onClick={() => void submit()}>{copy.submit}</button><button className="ghost" disabled={busy} onClick={() => void release()}>{copy.release}</button></div>
    </div>}
  </section>
}
