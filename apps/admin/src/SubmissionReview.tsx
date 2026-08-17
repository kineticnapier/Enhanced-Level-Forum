import { useEffect, useState } from 'react'
import { api } from './api'
import { useI18n } from './i18n'

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
  submitterName: string | null
  reviewerName: string | null
  reviewedAt: string | null
  createdLevelId: string | null
  createdAt: string
}

export function SubmissionReview() {
  const { locale } = useI18n()
  const ja = locale === 'ja'
  const copy = ja ? {
    eyebrow:'LEVEL SUBMISSIONS', title:'投稿審査', pending:'保留中', all:'すべて', submitter:'投稿者', version:'版', sha:'SHA-256', links:'リンク', notes:'投稿メモ', reviewNote:'審査メモ', approve:'承認してLevelを作成', reject:'却下', rejectNeed:'却下時は理由を入力してください。', noRows:'対象の投稿はありません。', loading:'読み込み中…', failed:'読み込みに失敗しました', approved:'承認しました。Rating Queueには自動投入されません。', rejected:'却下しました。', download:'配布', video:'動画', created:'作成されたLevel',
  } : {
    eyebrow:'LEVEL SUBMISSIONS', title:'Submission review', pending:'Pending', all:'All', submitter:'Submitter', version:'Version', sha:'SHA-256', links:'Links', notes:'Submission notes', reviewNote:'Review note', approve:'Approve & create Level', reject:'Reject', rejectNeed:'A review note is required when rejecting.', noRows:'No matching submissions.', loading:'Loading…', failed:'Failed to load submissions', approved:'Approved. The Level was not automatically added to the Rating Queue.', rejected:'Rejected.', download:'Download', video:'Video', created:'Created Level',
  }
  const [status,setStatus]=useState<'PENDING'|'ALL'>('PENDING')
  const [rows,setRows]=useState<Submission[]>([])
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  const load=async()=>{setError('');try{const x=await api<{submissions:Submission[]}>(`/admin/submissions?status=${status}`);setRows(x.submissions)}catch(e){setError(e instanceof Error?e.message:copy.failed)}}
  useEffect(()=>{void load()},[status])

  const approve=async(row:Submission)=>{setBusy(row.id);setError('');setMessage('');try{await api(`/admin/submissions/${row.id}/approve`,{method:'POST',body:JSON.stringify({reviewNote:notes[row.id]||null})});setMessage(copy.approved);await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy('')}}
  const reject=async(row:Submission)=>{const note=(notes[row.id]||'').trim();if(!note){setError(copy.rejectNeed);return}setBusy(row.id);setError('');setMessage('');try{await api(`/admin/submissions/${row.id}/reject`,{method:'POST',body:JSON.stringify({reviewNote:note})});setMessage(copy.rejected);await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy('')}}

  return <section>
    <div className="head"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1></div><select value={status} onChange={(e)=>setStatus(e.target.value as 'PENDING'|'ALL')}><option value="PENDING">{copy.pending}</option><option value="ALL">{copy.all}</option></select></div>
    {error&&<p className="error">{error}</p>}{message&&<p className="notice">{message}</p>}
    <div className="cards">{rows.map((row)=><article className="panel" key={row.id}>
      <div className="title-row"><div><p className="eyebrow">{row.artist}</p><h2>{row.song}</h2><p>{row.creator}{row.effecter?` · FX: ${row.effecter}`:''}</p></div><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></div>
      <div className="grid"><p><b>{copy.submitter}</b><br/>{row.submitterName??'—'}</p><p><b>{copy.version}</b><br/>{row.versionLabel}</p></div>
      <p><b>{copy.sha}</b><br/><code>{row.sha256??'—'}</code></p>
      {(row.downloadUrl||row.videoUrl)&&<p><b>{copy.links}</b><br/>{row.downloadUrl&&<a href={row.downloadUrl} target="_blank" rel="noreferrer">{copy.download}</a>}{row.downloadUrl&&row.videoUrl?' · ':''}{row.videoUrl&&<a href={row.videoUrl} target="_blank" rel="noreferrer">{copy.video}</a>}</p>}
      {row.notes&&<p><b>{copy.notes}</b><br/>{row.notes}</p>}
      {row.reviewNote&&row.status!=='PENDING'&&<p><b>{copy.reviewNote}</b><br/>{row.reviewNote}</p>}
      {row.createdLevelId&&<p><a href={`${location.origin.replace('admin','web')}/#/levels/${row.createdLevelId}`} target="_blank" rel="noreferrer">{copy.created}</a></p>}
      {row.status==='PENDING'&&<><textarea maxLength={2000} value={notes[row.id]??''} onChange={(e)=>setNotes((old)=>({...old,[row.id]:e.target.value}))} placeholder={copy.reviewNote}/><div className="actions"><button disabled={busy===row.id} onClick={()=>void approve(row)}>{copy.approve}</button><button className="danger" disabled={busy===row.id} onClick={()=>void reject(row)}>{copy.reject}</button></div></>}
    </article>)}</div>
    {!rows.length&&<div className="panel"><p>{copy.noRows}</p></div>}
  </section>
}
