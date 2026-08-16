import { useEffect, useState } from 'react'
import { api } from './api'
import { useI18n } from './i18n'

type CronStatus = {
  source: string
  schedule: string
  nextScheduledAt: string
  trackingAvailable: boolean
  health: 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'MIGRATION_REQUIRED'
  crawl: null | {
    crawlId: string
    nextOffset: number
    observedTotal: number | null
    stagedLevels: number
    progress: number | null
    startedAt: string
    updatedAt: string
  }
  lastRun: null | {
    at: string
    status: 'PROGRESS' | 'DEFERRED' | 'RESET' | 'BUSY' | 'IMPORTED' | 'FAILED' | null
    reason: string | null
    pagesFetched: number | null
    consecutiveDeferred: number
    snapshotId: string | null
  }
  latestSnapshot: null | {
    id: string
    importedAt: string
    levels: number
    ratings: number
    references: number
  }
}

export function TufCronStatus() {
  const { locale, date } = useI18n()
  const ja = locale === 'ja'
  const copy = ja ? {
    title: 'TUF Cron Status',
    help: '15分ごと・最大1000 levelsのTUF incremental crawlが実際に動いているかをDBの状態から確認します。',
    refresh: '更新',
    lastTick: '最終Tick',
    status: '状態',
    progress: 'クロール進捗',
    staged: '取得済み',
    latest: '最新Snapshot',
    deferred: '連続Deferred',
    next: '次回予定',
    schedule: 'Cron',
    unknown: 'まだ実行記録がありません',
    noSnapshot: 'まだSnapshotがありません',
    migration: 'Cron状態追跡用Migrationが未適用です。production:setupを先に実行してください。',
    failed: 'Cron状態の取得に失敗しました',
    levels: 'levels',
  } : {
    title: 'TUF Cron Status',
    help: 'Shows whether the 15-minute TUF incremental crawl (up to 1000 levels per tick) is actually progressing, using persisted database state.',
    refresh: 'Refresh',
    lastTick: 'Last tick',
    status: 'Status',
    progress: 'Crawl progress',
    staged: 'Staged',
    latest: 'Latest snapshot',
    deferred: 'Consecutive deferred',
    next: 'Next tick',
    schedule: 'Cron',
    unknown: 'No scheduled run has been recorded yet.',
    noSnapshot: 'No TUF snapshot yet.',
    migration: 'The Cron status migration has not been applied. Run production:setup before deploying.',
    failed: 'Failed to load Cron status',
    levels: 'levels',
  }

  const [status, setStatus] = useState<CronStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ status: CronStatus }>('/admin/imports/tuf/cron-status')
      setStatus(result.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.failed)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => clearInterval(timer)
  }, [])

  const progress = status?.crawl
    ? `${status.crawl.nextOffset} / ${status.crawl.observedTotal ?? '?'}${status.crawl.progress === null ? '' : ` (${(status.crawl.progress * 100).toFixed(1)}%)`}`
    : '—'
  const latest = status?.latestSnapshot
    ? `${date(status.latestSnapshot.importedAt)} · ${status.latestSnapshot.levels} ${copy.levels}`
    : copy.noSnapshot
  const healthClass = (status?.health ?? 'UNKNOWN').toLowerCase().replace('_', '-')

  return <div className="panel tuf-cron-panel">
    <div className="title-row">
      <div><p className="eyebrow">Scheduled Import</p><h2>{copy.title}</h2><p>{copy.help}</p></div>
      <div className="tuf-cron-head-actions">
        <span className={`cron-health ${healthClass}`}>{status?.health ?? 'UNKNOWN'}</span>
        <button className="secondary" disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
      </div>
    </div>

    {error && <p className="error">{error}</p>}
    {status && !status.trackingAvailable && <p className="error">{copy.migration}</p>}

    <div className="tuf-cron-stats">
      <div><span>{copy.lastTick}</span><strong>{status?.lastRun ? date(status.lastRun.at) : copy.unknown}</strong></div>
      <div><span>{copy.status}</span><strong>{status?.lastRun?.status ?? '—'}</strong></div>
      <div><span>{copy.progress}</span><strong>{progress}</strong></div>
      <div><span>{copy.staged}</span><strong>{status?.crawl?.stagedLevels ?? 0}</strong></div>
      <div><span>{copy.latest}</span><strong>{latest}</strong></div>
      <div><span>{copy.deferred}</span><strong>{status?.lastRun?.consecutiveDeferred ?? 0}</strong></div>
      <div><span>{copy.next}</span><strong>{status ? date(status.nextScheduledAt) : '—'}</strong></div>
      <div><span>{copy.schedule}</span><strong><code>{status?.schedule ?? '*/15 * * * *'}</code></strong></div>
    </div>

    {status?.lastRun?.reason && <p className="cron-reason"><strong>{status.lastRun.status}:</strong> {status.lastRun.reason}</p>}
  </div>
}
