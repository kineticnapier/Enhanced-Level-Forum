import { useEffect, useState } from 'react'
import { api } from './api'

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

function ratingText(rating: Rating | null): string {
  return rating ? `${rating.family}${rating.tier}` : 'Unrated'
}

function tufText(row: EvidenceRow): string {
  return row.tuf.family && row.tuf.tier ? `${row.tuf.family}${row.tuf.tier}` : row.tuf.label ?? 'Unrated'
}

export function TufEvidenceProposals() {
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
      setMessage(`Created proposal ${result.proposal.id}: ${result.proposal.title}`)
      setReason('')
      await load(offset,search,actionableOnly)
    }catch(e){setError(e instanceof Error?e.message:'Proposal creation failed')}
    finally{setBusy(false)}
  }

  return <div className="panel">
    <div className="title-row"><div><p className="eyebrow">TUF evidence</p><h2>Linked rating evidence</h2></div><strong>{data?`${data.total} linked`:'Loading…'}</strong></div>
    <p className="muted">最新TUF snapshotとELF canonical ratingを比較します。ここから作るのはRERATE proposalだけで、canonical rating自体は変更しません。</p>
    {data?.snapshot&&<p className="muted">Snapshot: <code>{data.snapshot.id}</code> · {new Date(data.snapshot.importedAt).toLocaleString()}</p>}
    <div className="grid">
      <input placeholder="TUF ID / TUF title / ELF title / creator" value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void load(0,search,actionableOnly)}}/>
      <button onClick={()=>void load(0,search,actionableOnly)}>Search</button>
    </div>
    <label><input type="checkbox" checked={actionableOnly} onChange={(e)=>{const next=e.target.checked;setActionableOnly(next);void load(0,search,next)}}/> Show only rating differences that can create a proposal</label>
    {message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}
    {!data?.snapshot?<p>No TUF snapshot has been imported yet.</p>:<div className="split">
      <div>
        <div className="list">{data.rows.map((row)=><button key={row.observationId} className={selected?.observationId===row.observationId?'selected':''} onClick={()=>choose(row)}>
          <span>{tufText(row)}</span>
          <strong>{row.levelTitle}</strong>
          <small>TUF #{row.externalId} · ELF {ratingText(row.elf)}{row.changedSincePrevious?` · TUF changed from ${row.previousTuf?.label??'unknown'}`:''}{row.referenceEvidence.length?` · refs ${row.referenceEvidence.length}`:''}</small>
        </button>)}</div>
        {!data.rows.length&&<p className="muted">No linked TUF evidence matches this filter.</p>}
        <div className="actions"><button className="secondary" disabled={offset===0} onClick={()=>void load(Math.max(0,offset-PAGE_SIZE),search,actionableOnly)}>Previous</button><span className="muted">{data.total?`${offset+1}–${Math.min(offset+PAGE_SIZE,data.total)} / ${data.total}`:'0 / 0'}</span><button className="secondary" disabled={offset+PAGE_SIZE>=data.total} onClick={()=>void load(offset+PAGE_SIZE,search,actionableOnly)}>Next</button></div>
      </div>
      <div>{selected?<div>
        <h3>{selected.levelTitle}</h3>
        <p>{selected.levelCreator} · TUF #{selected.externalId}</p>
        <div className="title-row"><div><p className="muted">TUF latest</p><b className="big-rating">{tufText(selected)}</b></div><div><p className="muted">ELF canonical</p><b className="big-rating">{ratingText(selected.elf)}</b></div></div>
        {selected.targetVersion?<p className="muted">Target version: <b>{selected.targetVersion.label}</b>{selected.targetVersion.isCurrent?' (current)':''} · {selected.targetVersion.linkBasis==='EXPLICIT_VERSION'?'explicit TUF version link':'current ELF version'} · SHA <code>{selected.targetVersion.sha256??'not stored'}</code></p>:<p className="error">This ELF level has no target version.</p>}
        {selected.previousTuf?<p className={selected.changedSincePrevious?'notice':'muted'}>Previous TUF snapshot: {selected.previousTuf.label??'Unrated'} → {selected.tuf.label??'Unrated'}{selected.changedSincePrevious?' (changed)':' (unchanged)'}</p>:<p className="muted">No previous TUF rating observation is stored for this ID.</p>}
        <h3>TUF Reference evidence</h3>
        {selected.referenceEvidence.length?<div>{selected.referenceEvidence.map((ref,index)=><div className="row" key={`${ref.type}-${index}`}><strong>{ref.difficultyLabel??(ref.family&&ref.tier?`${ref.family}${ref.tier}`:'—')}</strong><span>{ref.type}</span></div>)}</div>:<p className="muted">No TUF Reference entry in this snapshot.</p>}
        {(selected.issues.error||selected.issues.warning||selected.issues.info)?<p className="muted">Import issues: E{selected.issues.error} / W{selected.issues.warning} / I{selected.issues.info}</p>:null}
        {selected.matchesCanonical&&<p className="notice">ELF already matches this TUF P/G/U rating. No rerate proposal is needed.</p>}
        {selected.existingOpenProposalId&&<p className="notice">An open proposal already covers this target: <code>{selected.existingOpenProposalId}</code></p>}
        {!selected.tuf.family&&<p className="muted">Special/non-PGU TUF labels are evidence only and cannot be converted into an ELF canonical RERATE proposal.</p>}
        <textarea placeholder="Additional review context (optional). Source evidence is added automatically." value={reason} onChange={(e)=>setReason(e.target.value)}/>
        <button disabled={!selected.proposalEligible||busy} onClick={()=>void createProposal()}>{busy?'Creating…':'Create RERATE proposal from TUF evidence'}</button>
      </div>:<p className="muted">Select linked TUF evidence to compare it with ELF.</p>}</div>
    </div>}
  </div>
}
