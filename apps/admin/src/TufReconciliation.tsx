import { useEffect, useMemo, useState } from 'react'
import type { LevelDetail, LevelListItem } from '@elf/shared'
import { api } from './api'
import { useI18n } from './i18n'
import { TufEvidenceProposals } from './TufEvidenceProposals'

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

export function TufReconciliation({canCreateLevel=false}:{canCreateLevel?:boolean}) {
  const { t, date } = useI18n()
  const [queue,setQueue]=useState<QueueResponse|null>(null)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [selected,setSelected]=useState<QueueRow|null>(null)
  const [candidateSearch,setCandidateSearch]=useState('')
  const [levels,setLevels]=useState<LevelListItem[]>([])
  const [levelId,setLevelId]=useState('')
  const [detail,setDetail]=useState<LevelDetail|null>(null)
  const [versionId,setVersionId]=useState('')
  const [createSong,setCreateSong]=useState('')
  const [createTitle,setCreateTitle]=useState('')
  const [createCreator,setCreateCreator]=useState('')
  const [createVersionLabel,setCreateVersionLabel]=useState('Original')
  const [createSha,setCreateSha]=useState('')
  const [createUrl,setCreateUrl]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  const clearSelection=()=>{
    setSelected(null);setLevelId('');setDetail(null);setVersionId('');setLevels([])
    setCreateSong('');setCreateTitle('');setCreateCreator('');setCreateVersionLabel('Original');setCreateSha('');setCreateUrl('')
  }

  const loadQueue=async(nextOffset=offset,nextSearch=search)=>{
    setError('')
    const result=await api<QueueResponse>(`/admin/imports/tuf/unlinked?limit=${PAGE_SIZE}&offset=${nextOffset}&search=${encodeURIComponent(nextSearch)}`)
    setQueue(result)
    setOffset(nextOffset)
    if(selected&&!result.rows.some((row)=>row.observationId===selected.observationId))clearSelection()
  }

  useEffect(()=>{void loadQueue(0,'')},[])

  const chooseObservation=(row:QueueRow)=>{
    setSelected(row)
    const initial=(row.title||row.song||'').trim()
    setCandidateSearch(initial)
    setLevels([]);setLevelId('');setDetail(null);setVersionId('');setMessage('');setError('')
    setCreateSong((row.song||row.title||`TUF #${row.externalId}`).trim())
    setCreateTitle((row.title||row.song||`TUF #${row.externalId}`).trim())
    setCreateCreator((row.creator||t('common.unknown')).trim())
    setCreateVersionLabel('Original')
    setCreateSha(row.sha256??'')
    setCreateUrl(row.downloadUrl??'')
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
      setMessage(t('tuf.linked',{id:selected.externalId,title:result.level.title,version:result.version?` / ${result.version.label}`:''}))
      clearSelection()
      await loadQueue(offset,search)
    }catch(e){setError(e instanceof Error?e.message:t('tuf.linkFailed'))}
    finally{setBusy(false)}
  }

  const createLevel=async()=>{
    if(!selected||!canCreateLevel)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=await api<{level:{id:string;title:string};version:{label:string};canonicalRating:null}>('/admin/imports/tuf/create-level',{
        method:'POST',
        body:JSON.stringify({
          observationId:selected.observationId,
          song:createSong,
          title:createTitle,
          creator:createCreator,
          version:{label:createVersionLabel,sha256:createSha||null,downloadUrl:createUrl||null},
        }),
      })
      setMessage(t('tuf.created',{id:selected.externalId,title:result.level.title,version:result.version.label}))
      clearSelection()
      await loadQueue(offset,search)
    }catch(e){setError(e instanceof Error?e.message:t('tuf.createFailed'))}
    finally{setBusy(false)}
  }

  return <>
    <div className="panel">
      <div className="title-row"><div><p className="eyebrow">{t('tuf.queueEyebrow')}</p><h2>{t('tuf.queueTitle')}</h2></div><strong>{queue?t('tuf.unlinkedCount',{count:queue.total}):t('common.loading')}</strong></div>
      <p className="muted">{t('tuf.queueDescription')}</p>
      {queue?.snapshot&&<p className="muted">{t('tuf.snapshot')}: <code>{queue.snapshot.id}</code> · {date(queue.snapshot.importedAt)}</p>}
      <div className="grid"><input placeholder={t('tuf.searchPlaceholder')} value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void loadQueue(0,search)}}/><button onClick={()=>void loadQueue(0,search)}>{t('common.search')}</button></div>
      {message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}
      {!queue?.snapshot?<p>{t('tuf.noSnapshot')}</p>:<div className="split">
        <div>
          <div className="list">{queue.rows.map((row)=><button key={row.observationId} className={selected?.observationId===row.observationId?'selected':''} onClick={()=>chooseObservation(row)}>
            <span>{row.difficultyLabel??'—'}</span><strong>{row.title??row.song??`TUF #${row.externalId}`}</strong><small>#{row.externalId} · {row.creator??t('tuf.creatorUnknown')}{row.referenceCount?` · ${t('tuf.referencesShort',{count:row.referenceCount,types:row.referenceTypes.join(', ')})}`:''}{row.issues.error||row.issues.warning?` · ${t('tuf.issuesShort',{error:row.issues.error,warning:row.issues.warning})}`:''}</small>
          </button>)}</div>
          {!queue.rows.length&&<p className="muted">{t('tuf.noUnlinked')}</p>}
          <div className="actions"><button className="secondary" disabled={offset===0} onClick={()=>void loadQueue(Math.max(0,offset-PAGE_SIZE),search)}>{t('common.previous')}</button><span className="muted">{queue.total?`${offset+1}–${Math.min(offset+PAGE_SIZE,queue.total)} / ${queue.total}`:'0 / 0'}</span><button className="secondary" disabled={offset+PAGE_SIZE>=queue.total} onClick={()=>void loadQueue(offset+PAGE_SIZE,search)}>{t('common.next')}</button></div>
        </div>
        <div>{selected?<div>
          <h3>{selected.title??selected.song??`TUF #${selected.externalId}`}</h3>
          <p><b>{selected.difficultyLabel??t('common.unrated')}</b> · TUF #{selected.externalId} · {selected.creator??t('tuf.creatorUnknown')}</p>
          <p className="muted">SHA-256: <code>{selected.sha256??t('tuf.shaNotSupplied')}</code></p>
          {selected.downloadUrl&&<p className="muted">{t('tuf.downloadPresent')}</p>}
          <h3>{t('tuf.findExisting')}</h3>
          <div className="grid"><input value={candidateSearch} onChange={(e)=>setCandidateSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void searchLevels()}}/><button onClick={()=>void searchLevels()}>{t('tuf.find')}</button></div>
          <select value={levelId} onChange={(e)=>void chooseLevel(e.target.value)}><option value="">{t('tuf.selectLevel')}</option>{levels.map((level)=><option key={level.id} value={level.id}>{level.currentRating?`${level.currentRating.family}${level.currentRating.tier} · `:''}{level.title} · {level.creator}</option>)}</select>
          {detail&&<><h3>{t('tuf.versionLink')}</h3><select value={versionId} onChange={(e)=>setVersionId(e.target.value)}><option value="">{t('tuf.levelOnly')}</option>{detail.versions.map((version)=><option key={version.id} value={version.id}>{version.label}{version.id===detail.currentVersionId?` (${t('tuf.versionCurrent')})`:''} · {version.sha256??t('tuf.versionNoSha')}</option>)}</select><p className="muted">{t('tuf.versionLinkHelp')}</p></>}
          {shaConflict&&<p className="error">{t('tuf.shaConflict')}</p>}
          <button disabled={!levelId||busy||shaConflict} onClick={()=>void link()}>{busy?t('common.working'):t('tuf.link')}</button>
          <h3>{t('tuf.createNew')}</h3>
          {canCreateLevel?<>
            <p className="muted">{t('tuf.createHelp')}</p>
            <input placeholder={t('tuf.createSong')} value={createSong} onChange={(e)=>setCreateSong(e.target.value)}/>
            <input placeholder={t('tuf.createTitle')} value={createTitle} onChange={(e)=>setCreateTitle(e.target.value)}/>
            <input placeholder={t('tuf.createCreator')} value={createCreator} onChange={(e)=>setCreateCreator(e.target.value)}/>
            <div className="grid"><input placeholder={t('tuf.createVersion')} value={createVersionLabel} onChange={(e)=>setCreateVersionLabel(e.target.value)}/><input placeholder={t('tuf.createSha')} value={createSha} onChange={(e)=>setCreateSha(e.target.value)}/></div>
            <input placeholder={t('tuf.createUrl')} value={createUrl} onChange={(e)=>setCreateUrl(e.target.value)}/>
            <button disabled={busy||!createSong.trim()||!createTitle.trim()||!createCreator.trim()||!createVersionLabel.trim()} onClick={()=>void createLevel()}>{busy?t('common.working'):t('tuf.createButton')}</button>
          </>:<p className="muted">{t('tuf.createPermission')}</p>}
        </div>:<p className="muted">{t('tuf.selectUnlinked')}</p>}</div>
      </div>}
    </div>
    <TufEvidenceProposals/>
  </>
}
