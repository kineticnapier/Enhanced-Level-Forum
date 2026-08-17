import { useEffect, useState } from 'react'
import type { SessionUser } from '@elf/shared'
import { api } from './api'
import { useI18n } from './i18n'
import './submit-level.css'

type Submission = {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  song: string
  artist: string
  creator: string
  effecter: string | null
  versionLabel: string
  sha256: string | null
  downloadUrl: string | null
  videoUrl: string | null
  notes: string | null
  reviewNote: string | null
  reviewerName: string | null
  createdLevelId: string | null
  createdAt: string
}

export function SubmitLevelPage() {
  const { locale, date } = useI18n()
  const ja = locale === 'ja'
  const copy = ja ? {
    eyebrow: 'LEVEL SUBMISSION', title: '譜面を投稿', help: '投稿はまずスタッフ確認に入ります。承認後にLevel / Versionとして登録されますが、Rating Queueには自動投入されません。',
    login: '投稿するにはログインしてください。', loginButton: 'ログイン / アカウント作成', song: '曲名', artist: 'アーティスト名', creator: '制作者 / チーム名', effecter: 'エフェクター（任意）', version: 'バージョン', download: '配布URL（任意）', video: '動画URL（任意）', sha: 'SHA-256（任意）', notes: '補足（任意）', submit: '投稿する', pendingLimit: '同時に保留できる投稿は5件までです。', history: '自分の投稿', none: 'まだ投稿はありません。', withdraw: '取り下げ', review: 'スタッフメモ', approved: '登録されたLevelを見る', sent: '投稿しました。スタッフ確認待ちです。', failed: '投稿に失敗しました', loading: '読み込み中…',
  } : {
    eyebrow: 'LEVEL SUBMISSION', title: 'Submit a level', help: 'Submissions are reviewed by staff first. Approval creates an ELF Level / Version, but does not automatically place it in the Rating Queue.',
    login: 'Log in to submit a level.', loginButton: 'Login / create account', song: 'Song', artist: 'Artist', creator: 'Creator / team', effecter: 'Effecter (optional)', version: 'Version', download: 'Download URL (optional)', video: 'Video URL (optional)', sha: 'SHA-256 (optional)', notes: 'Notes (optional)', submit: 'Submit', pendingLimit: 'You may have up to 5 pending submissions at once.', history: 'My submissions', none: 'No submissions yet.', withdraw: 'Withdraw', review: 'Staff note', approved: 'View created Level', sent: 'Submitted. It is now waiting for staff review.', failed: 'Submission failed', loading: 'Loading…',
  }

  const [user,setUser]=useState<SessionUser|null>(null)
  const [loaded,setLoaded]=useState(false)
  const [rows,setRows]=useState<Submission[]>([])
  const [song,setSong]=useState(''); const [artist,setArtist]=useState(''); const [creator,setCreator]=useState(''); const [effecter,setEffecter]=useState('')
  const [versionLabel,setVersionLabel]=useState('Original'); const [downloadUrl,setDownloadUrl]=useState(''); const [videoUrl,setVideoUrl]=useState(''); const [sha256,setSha256]=useState(''); const [notes,setNotes]=useState('')
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('')

  const loadMine=async()=>{if(!user)return;const x=await api<{submissions:Submission[]}>('/submissions/mine');setRows(x.submissions)}
  useEffect(()=>{void api<{user:SessionUser|null}>('/auth/me').then((x)=>setUser(x.user)).finally(()=>setLoaded(true))},[])
  useEffect(()=>{if(user)void loadMine()},[user?.id])

  const submit=async()=>{
    setBusy(true);setError('');setMessage('')
    try{
      await api('/submissions',{method:'POST',body:JSON.stringify({song,artist,creator,effecter:effecter||null,versionLabel,downloadUrl:downloadUrl||null,videoUrl:videoUrl||null,sha256:sha256||null,notes:notes||null})})
      setSong('');setArtist('');setCreator('');setEffecter('');setVersionLabel('Original');setDownloadUrl('');setVideoUrl('');setSha256('');setNotes('');setMessage(copy.sent);await loadMine()
    }catch(e){setError(e instanceof Error?e.message:copy.failed)}finally{setBusy(false)}
  }
  const withdraw=async(id:string)=>{setError('');try{await api(`/submissions/${id}/withdraw`,{method:'POST'});await loadMine()}catch(e){setError(e instanceof Error?e.message:String(e))}}

  if(!loaded)return <div className="submission-panel panel">{copy.loading}</div>
  if(!user)return <section className="submission-page"><div className="submission-panel panel"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.login}</p><a className="button" href="#/login">{copy.loginButton}</a></div></section>

  return <section className="submission-page">
    <div className="section-head"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="muted">{copy.help}</p></div></div>
    <div className="submission-grid">
      <div className="panel submission-form">
        <label>{copy.song} *<input maxLength={300} value={song} onChange={(e)=>setSong(e.target.value)}/></label>
        <label>{copy.artist} *<input maxLength={300} value={artist} onChange={(e)=>setArtist(e.target.value)}/></label>
        <label>{copy.creator} *<input maxLength={300} value={creator} onChange={(e)=>setCreator(e.target.value)}/></label>
        <label>{copy.effecter}<input maxLength={300} value={effecter} onChange={(e)=>setEffecter(e.target.value)}/></label>
        <label>{copy.version} *<input maxLength={120} value={versionLabel} onChange={(e)=>setVersionLabel(e.target.value)}/></label>
        <label>{copy.download}<input type="url" value={downloadUrl} onChange={(e)=>setDownloadUrl(e.target.value)}/></label>
        <label>{copy.video}<input type="url" value={videoUrl} onChange={(e)=>setVideoUrl(e.target.value)}/></label>
        <label>{copy.sha}<input maxLength={64} value={sha256} onChange={(e)=>setSha256(e.target.value)}/></label>
        <label>{copy.notes}<textarea maxLength={2000} value={notes} onChange={(e)=>setNotes(e.target.value)}/></label>
        <p className="note">{copy.pendingLimit}</p>{error&&<p className="error">{error}</p>}{message&&<p className="notice">{message}</p>}
        <button disabled={busy||!song.trim()||!artist.trim()||!creator.trim()||!versionLabel.trim()} onClick={()=>void submit()}>{busy?copy.loading:copy.submit}</button>
      </div>
      <div className="panel"><h2>{copy.history}</h2>{rows.length?<div className="submission-list">{rows.map((row)=><article key={row.id}>
        <div className="title-row"><div><strong>{row.song}</strong><small>{row.artist} · {row.creator} · {row.versionLabel}</small></div><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></div>
        <p className="muted">{date(row.createdAt)}</p>{row.reviewNote&&<p><b>{copy.review}:</b> {row.reviewNote}</p>}
        <div className="actions">{row.status==='PENDING'&&<button className="ghost" onClick={()=>void withdraw(row.id)}>{copy.withdraw}</button>}{row.createdLevelId&&<a className="button secondary" href={`#/levels/${row.createdLevelId}`}>{copy.approved}</a>}</div>
      </article>)}</div>:<p className="muted">{copy.none}</p>}</div>
    </div>
  </section>
}
