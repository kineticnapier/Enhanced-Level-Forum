import React, { useEffect, useMemo, useState } from 'react'
import type { RatingQueueItem, SessionUser } from '@elf/shared'
import { api } from './api'
import { useI18n } from './i18n'
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

export function RatingQueuePage({ user }: { user: SessionUser | null }) {
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
    rate: '譜面を開いて査定',
    detail: '譜面を見る',
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
    rate: 'Open level and rate',
    detail: 'View level',
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

  if (!user) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.login}</p><a className="button" href="#/login">Login</a></div></section>
  if (!canRate(user)) return <section><div className="panel"><h1>{copy.title}</h1><p>{copy.denied}</p></div></section>

  const mutate = async (item: RatingQueueItem, action: 'claim' | 'release') => {
    setBusy(item.id); setError('')
    try {
      await api(`/rating-queue/${item.id}/claim`, { method: action === 'claim' ? 'POST' : 'DELETE' })
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
      {mode === 'mine' && <><a className="button" href={`#/levels/${item.levelId}`}>{copy.rate}</a><button className="ghost" disabled={busy === item.id} onClick={() => void mutate(item, 'release')}>{copy.release}</button></>}
      {(mode === 'submitted' || mode === 'review') && <a className="button secondary" href={`#/levels/${item.levelId}`}>{copy.detail}</a>}
    </div>
  </article>

  return <section>
    <div className="section-head"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="muted">{copy.description}</p></div></div>
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
