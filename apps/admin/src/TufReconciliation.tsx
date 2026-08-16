import { useEffect, useMemo, useState } from 'react'
import type { LevelDetail, LevelListItem } from '@elf/shared'
import { api } from './api'

type QueueRow = {
  observationId: string
  snapshotId: string
  externalId: string
  sha256: string | null
  song: string | null
  title: string | null
  creator: string | null
  downloadUrl: string | null
  difficultyLabel: string | null
  observedAt: string
  referenceCount: number
  referenceTypes: string[]
  issues: { error: number; warning: number; info: number }
}

type QueueResponse = {
  snapshot: { id: string; sourceVersion: string | null; importedAt: string } | null
  total: number
  rows: QueueRow[]
}

const PAGE_SIZE = 50

export function TufReconciliation() {
  const [queue,setQueue]=useState<QueueResponse|null>(null)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [selected,setSelected]=useState<QueueRow|null>(null)
  const [candidateSearch,setCandidateSearch]=useState('')
  const [levels,setLevels]=useState<LevelListItem[]>([])
  const [levelId,setLevelId]=useState('')
  const [detail,setDetail]=useState<LevelDetail|null>(null)
  const [versionId,setVersionId]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  const loadQueue=async(nextOffset=offset,nextSearch=search)=>{
    setError('')
    const result=await api<QueueResponse>(`/admin/imports/tuf/unlinked?limit=${PAGE_SIZE}&offset=${nextOffset}&search=${encodeURIComponent(nextSearch)}`)
    setQueue(result)
    setOffset(nextOffset)
    if(selected&&!result.rows.some((row)=>row.observationId===selected.observationId)){
      setSelected(null);setLevelId('');setDetail(null);setVersionId('')
    }
  }

  useEffect(()=>{void loadQueue(0,'')},[])

  const chooseObservation=(row:QueueRow)=>{
    setSelected(row)
    const initial=(row.title||row.song||'').trim()
    setCandidateSearch(initial)
    setLevels([]);setLevelId('');setDetail(null);setVersionId('');setMessage('');setError('')
    if(initial)void searchLevels(initial)
  }

  const searchLevels=async(query=candidateSearch)=>{
    const result=await api<{levels:LevelListItem[]}>(`/levels?limit=100&search=${encodeURIComponent(query.trim())}`)
    setLevels(result.levels)
  }

  const chooseLevel=async(id:string)=>{
    setLevelId(id);setVersionId('');setMessage('');setError('')
    if(!id){setDetail(null);return}
    setDetail(await api<LevelDetail>(`/levels/${id}`))
  }

  const selectedVersion=useMemo(()=>detail?.versions.find((version)=>version.id===versionId)??null,[detail,versionId])
  const shaConflict=!!(selected?.sha256&&selectedVersion?.sha256&&selected.sha256.toLowerCase()!==selectedVersion.sha256.toLowerCase())

  const link=async()=>{
    if(!selected||!levelId)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=await api<{level:{title:string};version:{label:string}|null}>('/admin/imports/tuf/link',{
        method:'POST',
        body:JSON.stringify({observationId:selected.observationId,levelId,levelVersionId:versionId||null}),
      })
      setMessage(`Linked TUF #${selected.externalId} → ${result.level.title}${result.version?` / ${result.version.label}`:''}`)
      setSelected(null);setLevelId('');setDetail(null);setVersionId('')
      await loadQueue(offset,search)
    }catch(e){setError(e instanceof Error?e.message:'Link failed')}
    finally{setBusy(false)}
  }

  return <div className="panel">
    <div className="title-row"><div><p className="eyebrow">TUF → ELF</p><h2>Reconciliation queue</h2></div><strong>{queue?`${queue.total} unlinked`:'Loading…'}</strong></div>
    <p className="muted">最新TUF snapshotの未リンク譜面だけを表示します。ここで作るのはexternal ID mappingで、canonical ratingやELF Referenceは変更しません。</p>
    {queue?.snapshot&&<p className="muted">Snapshot: <code>{queue.snapshot.id}</code> · {new Date(queue.snapshot.importedAt).toLocaleString()}</p>}
    <div className="grid"><input placeholder="TUF ID / title / song / creator" value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void loadQueue(0,search)}}/><button onClick={()=>void loadQueue(0,search)}>Search</button></div>
    {message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}
    {!queue?.snapshot?<p>No TUF snapshot has been imported yet.</p>:<div className="split">
      <div>
        <div className="list">{queue.rows.map((row)=><button key={row.observationId} className={selected?.observationId===row.observationId?'selected':''} onClick={()=>chooseObservation(row)}>
          <span>{row.difficultyLabel??'—'}</span><strong>{row.title??row.song??`TUF #${row.externalId}`}</strong><small>#{row.externalId} · {row.creator??'unknown'}{row.referenceCount?` · refs ${row.referenceCount} (${row.referenceTypes.join(', ')})`:''}{row.issues.error||row.issues.warning?` · issues E${row.issues.error}/W${row.issues.warning}`:''}</small>
        </button>)}</div>
        {!queue.rows.length&&<p className="muted">No unlinked rows match this search.</p>}
        <div className="actions"><button className="secondary" disabled={offset===0} onClick={()=>void loadQueue(Math.max(0,offset-PAGE_SIZE),search)}>Previous</button><span className="muted">{queue.total?`${offset+1}–${Math.min(offset+PAGE_SIZE,queue.total)} / ${queue.total}`:'0 / 0'}</span><button className="secondary" disabled={offset+PAGE_SIZE>=queue.total} onClick={()=>void loadQueue(offset+PAGE_SIZE,search)}>Next</button></div>
      </div>
      <div>{selected?<div>
        <h3>{selected.title??selected.song??`TUF #${selected.externalId}`}</h3>
        <p><b>{selected.difficultyLabel??'Unrated'}</b> · TUF #{selected.externalId} · {selected.creator??'creator unknown'}</p>
        <p className="muted">SHA-256: <code>{selected.sha256??'not supplied by TUF'}</code></p>
        {selected.downloadUrl&&<p className="muted">Download URL is present in the imported evidence.</p>}
        <h3>Find existing ELF Level</h3>
        <div className="grid"><input value={candidateSearch} onChange={(e)=>setCandidateSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void searchLevels()}}/><button onClick={()=>void searchLevels()}>Find</button></div>
        <select value={levelId} onChange={(e)=>void chooseLevel(e.target.value)}><option value="">Select ELF Level</option>{levels.map((level)=><option key={level.id} value={level.id}>{level.currentRating?`${level.currentRating.family}${level.currentRating.tier} · `:''}{level.title} · {level.creator}</option>)}</select>
        {detail&&<><h3>Version link (optional)</h3><select value={versionId} onChange={(e)=>setVersionId(e.target.value)}><option value="">Level only</option>{detail.versions.map((version)=><option key={version.id} value={version.id}>{version.label}{version.id===detail.currentVersionId?' (current)':''} · {version.sha256??'no SHA'}</option>)}</select><p className="muted">Level-only mapping is persistent for future imports. A Version is attached explicitly only to this snapshot; future imports still require an exact SHA match for automatic Version linkage.</p></>}
        {shaConflict&&<p className="error">Selected Version has a different SHA-256. The API will reject this link.</p>}
        <button disabled={!levelId||busy||shaConflict} onClick={()=>void link()}>{busy?'Linking…':'Link TUF ID to ELF'}</button>
      </div>:<p className="muted">Select an unlinked TUF row.</p>}</div>
    </div>}
  </div>
}
