import { useEffect, useState } from 'react'
import type { Family, LevelDetail, LevelListItem, RatingQueueItem } from '@elf/shared'
import { api } from './api'
import { useI18n } from './i18n'

const labels = {
  ja: {
    title: '譜面', create: '譜面を新規登録', existing: '登録済み', select: '編集する譜面を選択してください。', saved: '保存しました',
    song: '曲名', artist: 'アーティスト名', creator: '制作者 / チーム名', effecter: 'エフェクター（任意）',
    version: 'バージョン', download: '配布URL（任意）', video: '動画URL（任意）', sha: 'SHA-256（任意）', register: '登録',
    metadata: '基本情報', saveMetadata: '基本情報を保存', unrated: '未評価',
    publishRerate: '確定難易度を変更', ratingRule: '確定難易度は P/G/U の整数段階のみです。', confidence: '確信度 0..1', reason: '変更理由', publish: '難易度を確定',
    queueTitle: '査定募集', queueHelp: '未評価を全部キューに入れず、この現行版だけを明示的に募集します。通常は2票、意見が割れた場合は最大3票でReview Readyになります。',
    queueOpen: '査定募集を開始', queueClose: '募集を終了', queueStatusOpen: '募集中', queueStatusReady: 'Review Ready', queueVotes: '票', queueCandidate: '候補',
    addVersion: '新しいバージョンを追加', addCurrent: '追加して現行版にする', versions: 'バージョン一覧', current: '現在', noSha: 'SHAなし', downloadLink: '配布', videoLink: '動画',
  },
  en: {
    title: 'Levels', create: 'Register level', existing: 'Registered', select: 'Select a level to edit.', saved: 'Saved',
    song: 'Song', artist: 'Artist', creator: 'Creator / team', effecter: 'Effecter (optional)',
    version: 'Version', download: 'Download URL (optional)', video: 'Video URL (optional)', sha: 'SHA-256 (optional)', register: 'Register',
    metadata: 'Metadata', saveMetadata: 'Save metadata', unrated: 'Unrated',
    publishRerate: 'Change canonical rating', ratingRule: 'Canonical ratings are integer P/G/U tiers.', confidence: 'confidence 0..1', reason: 'Reason', publish: 'Publish rating',
    queueTitle: 'Rating round', queueHelp: 'Only this current Version is explicitly opened; Unrated levels are not automatically queued. Two close ratings become Review Ready; disagreement requests up to three.',
    queueOpen: 'Open rating round', queueClose: 'Close round', queueStatusOpen: 'Open', queueStatusReady: 'Review Ready', queueVotes: 'votes', queueCandidate: 'Candidate',
    addVersion: 'Add version', addCurrent: 'Add & make current', versions: 'Versions', current: 'current', noSha: 'no SHA', downloadLink: 'Download', videoLink: 'Video',
  },
} as const

export function LevelManagement() {
  const { locale, t } = useI18n()
  const l = labels[locale]
  const [levels,setLevels]=useState<LevelListItem[]>([])
  const [selected,setSelected]=useState<LevelDetail|null>(null)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  const load=()=>api<{levels:LevelListItem[]}>('/levels?limit=100').then((x)=>setLevels(x.levels))
  useEffect(()=>{void load()},[])
  const choose=async(id:string)=>setSelected(await api<LevelDetail>(`/levels/${id}`))
  const changed=async()=>{setMessage(l.saved);setError('');if(selected)await choose(selected.id);await load()}

  return <>
    <div className="head"><div><p className="eyebrow">{t('head.management')}</p><h1>{l.title}</h1></div></div>
    <div className="split">
      <div className="panel">
        <h2>{l.create}</h2>
        <CreateLevel onCreated={async(id)=>{await load();await choose(id);setMessage(l.saved)}} />
        <h2>{l.existing}</h2>
        <div className="list">{levels.map((level)=><button className={selected?.id===level.id?'selected':''} key={level.id} onClick={()=>void choose(level.id)}>
          <span>{level.currentRating?`${level.currentRating.family}${level.currentRating.tier}`:'—'}</span>
          <strong>{level.song}</strong>
          <small>{level.artist} · {level.creator}{level.effecter?` · FX: ${level.effecter}`:''}</small>
        </button>)}</div>
      </div>
      <div>
        {selected?<LevelEditor level={selected} onChanged={()=>void changed()} onError={setError}/>:<div className="panel"><p>{l.select}</p></div>}
        {message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}
      </div>
    </div>
  </>
}

function CreateLevel({onCreated}:{onCreated:(id:string)=>void|Promise<void>}) {
  const { locale }=useI18n();const l=labels[locale]
  const [song,setSong]=useState('');const [artist,setArtist]=useState('');const [creator,setCreator]=useState('');const [effecter,setEffecter]=useState('')
  const [version,setVersion]=useState('Original');const [download,setDownload]=useState('');const [video,setVideo]=useState('');const [sha,setSha]=useState('');const [error,setError]=useState('')
  const create=async()=>{setError('');try{const result=await api<{level:{id:string}}>('/admin/levels',{method:'POST',body:JSON.stringify({song,artist,creator,effecter:effecter||null,version:{label:version,downloadUrl:download||null,videoUrl:video||null,sha256:sha||null}})});setSong('');setArtist('');setCreator('');setEffecter('');setVersion('Original');setDownload('');setVideo('');setSha('');await onCreated(result.level.id)}catch(e){setError(e instanceof Error?e.message:String(e))}}
  return <div className="form">
    <input placeholder={`${l.song} *`} value={song} onChange={(e)=>setSong(e.target.value)}/>
    <input placeholder={`${l.artist} *`} value={artist} onChange={(e)=>setArtist(e.target.value)}/>
    <input placeholder={`${l.creator} *`} value={creator} onChange={(e)=>setCreator(e.target.value)}/>
    <input placeholder={l.effecter} value={effecter} onChange={(e)=>setEffecter(e.target.value)}/>
    <input placeholder={`${l.version} *`} value={version} onChange={(e)=>setVersion(e.target.value)}/>
    <input placeholder={l.download} value={download} onChange={(e)=>setDownload(e.target.value)}/>
    <input placeholder={l.video} value={video} onChange={(e)=>setVideo(e.target.value)}/>
    <input placeholder={l.sha} value={sha} onChange={(e)=>setSha(e.target.value)}/>
    {error&&<p className="error">{error}</p>}
    <button disabled={!song.trim()||!artist.trim()||!creator.trim()||!version.trim()} onClick={()=>void create()}>{l.register}</button>
  </div>
}

function LevelEditor({level,onChanged,onError}:{level:LevelDetail;onChanged:()=>void;onError:(value:string)=>void}) {
  const { locale }=useI18n();const l=labels[locale]
  const currentVersion=level.versions.find((v)=>v.id===level.currentVersionId)??level.versions[0]
  const [song,setSong]=useState(level.song);const [artist,setArtist]=useState(level.artist);const [creator,setCreator]=useState(level.creator);const [effecter,setEffecter]=useState(level.effecter??'')
  const [family,setFamily]=useState<Family>(level.currentRating?.family??'G');const [tier,setTier]=useState(level.currentRating?.tier??1);const [confidence,setConfidence]=useState(level.currentRating?.confidence??'');const [reason,setReason]=useState('')
  const [version,setVersion]=useState('');const [download,setDownload]=useState('');const [video,setVideo]=useState('');const [sha,setSha]=useState('')
  const [queue,setQueue]=useState<RatingQueueItem|null>(null)
  const loadQueue=async()=>{if(!currentVersion){setQueue(null);return}const x=await api<{items:RatingQueueItem[]}>('/admin/rating-queue');setQueue(x.items.find((item)=>item.levelVersionId===currentVersion.id)??null)}
  useEffect(()=>{setSong(level.song);setArtist(level.artist);setCreator(level.creator);setEffecter(level.effecter??'')},[level.song,level.artist,level.creator,level.effecter])
  useEffect(()=>{void loadQueue()},[level.id,currentVersion?.id])
  const run=async(action:()=>Promise<unknown>)=>{onError('');try{await action();await loadQueue();onChanged()}catch(e){onError(e instanceof Error?e.message:String(e))}}
  return <div className="panel">
    <div className="title-row"><div><p className="eyebrow">{level.artist}</p><h2>{level.song}</h2><p>{level.creator}{level.effecter?` · FX: ${level.effecter}`:''}</p></div><b className="big-rating">{level.currentRating?`${level.currentRating.family}${level.currentRating.tier}`:l.unrated}</b></div>
    <h3>{l.metadata}</h3>
    <div className="form"><input placeholder={l.song} value={song} onChange={(e)=>setSong(e.target.value)}/><input placeholder={l.artist} value={artist} onChange={(e)=>setArtist(e.target.value)}/><input placeholder={l.creator} value={creator} onChange={(e)=>setCreator(e.target.value)}/><input placeholder={l.effecter} value={effecter} onChange={(e)=>setEffecter(e.target.value)}/><button className="secondary" disabled={!song.trim()||!artist.trim()||!creator.trim()} onClick={()=>void run(()=>api(`/admin/levels/${level.id}`,{method:'PATCH',body:JSON.stringify({song,artist,creator,effecter:effecter||null})}))}>{l.saveMetadata}</button></div>
    <h3>{l.queueTitle}</h3><p className="muted">{l.queueHelp}</p>
    {queue?<div className="row"><strong>{queue.status==='REVIEW_READY'?l.queueStatusReady:l.queueStatusOpen}</strong><span>{queue.voteCount}/{queue.minVotes} {l.queueVotes}</span>{queue.review?.candidate&&<span>{l.queueCandidate}: {queue.review.candidate.family}{queue.review.candidate.tier}</span>}<button className="tiny danger" onClick={()=>void run(()=>api(`/admin/rating-queue/${queue.id}`,{method:'PATCH',body:JSON.stringify({status:'CLOSED'})}))}>{l.queueClose}</button></div>:<button className="secondary" disabled={!currentVersion} onClick={()=>void run(()=>api('/admin/rating-queue',{method:'POST',body:JSON.stringify({levelId:level.id,minVotes:2,maxVotes:3})}))}>{l.queueOpen}</button>}
    <h3>{l.publishRerate}</h3><p className="muted">{l.ratingRule}</p>
    <div className="grid three"><select value={family} onChange={(e)=>setFamily(e.target.value as Family)}><option>P</option><option>G</option><option>U</option></select><input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/><input type="number" min="0" max="1" step=".05" placeholder={l.confidence} value={confidence} onChange={(e)=>setConfidence(e.target.value)}/></div>
    <textarea placeholder={l.reason} value={reason} onChange={(e)=>setReason(e.target.value)}/><button disabled={!currentVersion} onClick={()=>void run(async()=>{await api(`/admin/levels/${level.id}/ratings`,{method:'POST',body:JSON.stringify({levelVersionId:currentVersion?.id,family,tier,confidence:confidence===''?null:Number(confidence),reason})});setReason('')})}>{l.publish}</button>
    <h3>{l.addVersion}</h3>
    <div className="form"><input placeholder={`${l.version} *`} value={version} onChange={(e)=>setVersion(e.target.value)}/><input placeholder={l.download} value={download} onChange={(e)=>setDownload(e.target.value)}/><input placeholder={l.video} value={video} onChange={(e)=>setVideo(e.target.value)}/><input placeholder={l.sha} value={sha} onChange={(e)=>setSha(e.target.value)}/><button className="secondary" disabled={!version.trim()} onClick={()=>void run(async()=>{await api(`/admin/levels/${level.id}/versions`,{method:'POST',body:JSON.stringify({label:version,downloadUrl:download||null,videoUrl:video||null,sha256:sha||null,makeCurrent:true})});setVersion('');setDownload('');setVideo('');setSha('')})}>{l.addCurrent}</button></div>
    <h3>{l.versions}</h3>{level.versions.map((v)=><div className="row" key={v.id}><strong>{v.label}</strong>{v.id===level.currentVersionId&&<span className="pill">{l.current}</span>}<code>{v.sha256??l.noSha}</code><span>{v.downloadUrl&&<a href={v.downloadUrl} target="_blank" rel="noreferrer">{l.downloadLink}</a>}{v.downloadUrl&&v.videoUrl?' · ':''}{v.videoUrl&&<a href={v.videoUrl} target="_blank" rel="noreferrer">{l.videoLink}</a>}</span></div>)}
  </div>
}
