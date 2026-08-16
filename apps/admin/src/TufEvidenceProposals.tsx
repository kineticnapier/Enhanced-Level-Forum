import { useEffect, useState } from 'react'
import { api } from './api'
import { useI18n } from './i18n'

type Family = 'P' | 'G' | 'U'
type Rating = { family: Family; tier: number }

type ReferenceEvidence = {
  family: Family | null
  tier: number | null
  difficultyLabel: string | null
  type: string
}

type EvidenceRow = {
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
  tuf: { label: string | null; family: Family | null; tier: number | null }
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
  referenceEvidence: ReferenceEvidence[]
  issues: { error: number; warning: number; info: number }
  existingOpenProposalId: string | null
  proposalEligible: boolean
}

type EvidenceResponse = {
  snapshot: { id: string; sourceVersion: string | null; importedAt: string } | null
  total: number
  rows: EvidenceRow[]
}

const PAGE_SIZE = 50

function ratingText(rating: Rating | null, unrated: string): string {
  return rating ? `${rating.family}${rating.tier}` : unrated
}

function tufText(row: EvidenceRow, unrated: string): string {
  return row.tuf.family && row.tuf.tier ? `${row.tuf.family}${row.tuf.tier}` : row.tuf.label ?? unrated
}

export function TufEvidenceProposals() {
  const { t, date } = useI18n()
  const [data,setData]=useState<EvidenceResponse|null>(null)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [actionableOnly,setActionableOnly]=useState(false)
  const [selected,setSelected]=useState<EvidenceRow|null>(null)
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  const load=async(nextOffset=offset,nextSearch=search,nextActionable=actionableOnly)=>{
    setError('')
    const result=await api<EvidenceResponse>(`/admin/imports/tuf/evidence?limit=${PAGE_SIZE}&offset=${nextOffset}&search=${encodeURIComponent(nextSearch)}&actionableOnly=${nextActionable}`)
    setData(result)
    setOffset(nextOffset)
    if(selected&&!result.rows.some((row)=>row.observationId===selected.observationId)){
      setSelected(null);setReason('')
    }else if(selected){
      const refreshed=result.rows.find((row)=>row.observationId===selected.observationId)
      if(refreshed)setSelected(refreshed)
    }
  }

  useEffect(()=>{void load(0,'',false)},[])

  const choose=(row:EvidenceRow)=>{
    setSelected(row);setReason('');setMessage('');setError('')
  }

  const createProposal=async()=>{
    if(!selected)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=await api<{proposal:{id:string;title:string}}>('/admin/imports/tuf/proposals',{
        method:'POST',
        body:JSON.stringify({observationId:selected.observationId,reason:reason.trim()||null}),
      })
      setMessage(t('evidence.created',{id:result.proposal.id,title:result.proposal.title}))
      setReason('')
      await load(offset,search,actionableOnly)
    }catch(e){setError(e instanceof Error?e.message:t('evidence.createFailed'))}
    finally{setBusy(false)}
  }

  return <div className="panel">
    <div className="title-row"><div><p className="eyebrow">{t('evidence.eyebrow')}</p><h2>{t('evidence.title')}</h2></div><strong>{data?t('evidence.linkedCount',{count:data.total}):t('common.loading')}</strong></div>
    <p className="muted">{t('evidence.description')}</p>
    {data?.snapshot&&<p className="muted">{t('tuf.snapshot')}: <code>{data.snapshot.id}</code> · {date(data.snapshot.importedAt)}</p>}
    <div className="grid">
      <input placeholder={t('evidence.searchPlaceholder')} value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void load(0,search,actionableOnly)}}/>
      <button onClick={()=>void load(0,search,actionableOnly)}>{t('common.search')}</button>
    </div>
    <label><input type="checkbox" checked={actionableOnly} onChange={(e)=>{const next=e.target.checked;setActionableOnly(next);void load(0,search,next)}}/> {t('evidence.actionableOnly')}</label>
    {message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}
    {!data?.snapshot?<p>{t('tuf.noSnapshot')}</p>:<div className="split">
      <div>
        <div className="list">{data.rows.map((row)=><button key={row.observationId} className={selected?.observationId===row.observationId?'selected':''} onClick={()=>choose(row)}>
          <span>{tufText(row,t('common.unrated'))}</span>
          <strong>{row.levelTitle}</strong>
          <small>TUF #{row.externalId} · ELF {ratingText(row.elf,t('common.unrated'))}{row.changedSincePrevious?` · ${t('evidence.changedFrom',{from:row.previousTuf?.label??t('common.unknown')})}`:''}{row.referenceEvidence.length?` · ${t('tuf.referencesShort',{count:row.referenceEvidence.length,types:''}).replace(/\s*\(\)$/, '')}`:''}</small>
        </button>)}</div>
        {!data.rows.length&&<p className="muted">{t('evidence.noMatch')}</p>}
        <div className="actions"><button className="secondary" disabled={offset===0} onClick={()=>void load(Math.max(0,offset-PAGE_SIZE),search,actionableOnly)}>{t('common.previous')}</button><span className="muted">{data.total?`${offset+1}–${Math.min(offset+PAGE_SIZE,data.total)} / ${data.total}`:'0 / 0'}</span><button className="secondary" disabled={offset+PAGE_SIZE>=data.total} onClick={()=>void load(offset+PAGE_SIZE,search,actionableOnly)}>{t('common.next')}</button></div>
      </div>
      <div>{selected?<div>
        <h3>{selected.levelTitle}</h3>
        <p>{selected.levelCreator} · TUF #{selected.externalId}</p>
        <div className="title-row"><div><p className="muted">{t('evidence.latest')}</p><b className="big-rating">{tufText(selected,t('common.unrated'))}</b></div><div><p className="muted">{t('evidence.canonical')}</p><b className="big-rating">{ratingText(selected.elf,t('common.unrated'))}</b></div></div>
        {selected.targetVersion?<p className="muted">{t('evidence.targetVersion')}: <b>{selected.targetVersion.label}</b>{selected.targetVersion.isCurrent?` (${t('tuf.versionCurrent')})`:''} · {selected.targetVersion.linkBasis==='EXPLICIT_VERSION'?t('evidence.explicitLink'):t('evidence.currentVersion')} · SHA <code>{selected.targetVersion.sha256??t('evidence.shaNotStored')}</code></p>:<p className="error">{t('evidence.noTargetVersion')}</p>}
        {selected.previousTuf?<p className={selected.changedSincePrevious?'notice':'muted'}>{selected.changedSincePrevious?t('evidence.previousChanged',{from:selected.previousTuf.label??t('common.unrated'),to:selected.tuf.label??t('common.unrated')}):t('evidence.previousUnchanged',{from:selected.previousTuf.label??t('common.unrated'),to:selected.tuf.label??t('common.unrated')})}</p>:<p className="muted">{t('evidence.noPrevious')}</p>}
        <h3>{t('evidence.referenceEvidence')}</h3>
        {selected.referenceEvidence.length?<div>{selected.referenceEvidence.map((ref,index)=><div className="row" key={`${ref.type}-${index}`}><strong>{ref.difficultyLabel??(ref.family&&ref.tier?`${ref.family}${ref.tier}`:'—')}</strong><span>{ref.type}</span></div>)}</div>:<p className="muted">{t('evidence.noReference')}</p>}
        {(selected.issues.error||selected.issues.warning||selected.issues.info)?<p className="muted">{t('evidence.importIssues',{error:selected.issues.error,warning:selected.issues.warning,info:selected.issues.info})}</p>:null}
        {selected.matchesCanonical&&<p className="notice">{t('evidence.matches')}</p>}
        {selected.existingOpenProposalId&&<p className="notice">{t('evidence.openProposal',{id:selected.existingOpenProposalId})}</p>}
        {!selected.tuf.family&&<p className="muted">{t('evidence.specialOnly')}</p>}
        <textarea placeholder={t('evidence.reasonPlaceholder')} value={reason} onChange={(e)=>setReason(e.target.value)}/>
        <button disabled={!selected.proposalEligible||busy} onClick={()=>void createProposal()}>{busy?t('evidence.creating'):t('evidence.createProposal')}</button>
      </div>:<p className="muted">{t('evidence.select')}</p>}</div>
    </div>}
  </div>
}
