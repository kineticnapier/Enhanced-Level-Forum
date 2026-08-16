import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { LevelDetail, LevelListItem, ProposalRow, ReferenceRow, SessionUser, UserRole } from '@elf/shared'
import { api } from './api'
import { I18nProvider, LanguageSwitch, useI18n } from './i18n'
import { LevelManagement } from './LevelManagement'
import { TufReconciliation } from './TufReconciliation'
import './styles.css'

type Tab = 'overview' | 'levels' | 'references' | 'proposals' | 'users' | 'imports' | 'audit'

function App() {
  const { t, role } = useI18n()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => { void api<{user:SessionUser|null}>('/auth/me').then((x)=>setUser(x.user)).finally(()=>setLoaded(true)) }, [])
  if (!loaded) return <div className="center">{t('common.loading')}</div>
  if (!user) return <Login onLogin={setUser} />
  if (!['REFERENCE_MANAGER','MODERATOR','ADMIN'].includes(user.role)) return <div className="center"><div className="panel"><h1>{t('auth.denied')}</h1><p>{t('auth.deniedDetail',{role:role(user.role)})}</p></div></div>
  const staffTabs: Tab[] = user.role === 'ADMIN'
    ? ['overview','levels','references','proposals','users','imports','audit']
    : user.role === 'MODERATOR'
      ? ['overview','levels','references','proposals','imports','audit']
      : ['overview','references','imports']
  return <div className="admin-shell">
    <aside>
      <div className="brand">ELF <span>Admin</span></div>
      <p className="who">{user.displayName}<small>{role(user.role)}</small></p>
      <LanguageSwitch />
      {staffTabs.map((x)=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{t(`tab.${x}`)}</button>)}
      <button className="logout" onClick={async()=>{await api('/auth/logout',{method:'POST'});setUser(null)}}>{t('auth.logout')}</button>
    </aside>
    <main>{tab==='overview'&&<Overview/>}{tab==='levels'&&<LevelManagement/>}{tab==='references'&&<References/>}{tab==='proposals'&&<Proposals/>}{tab==='users'&&<Users user={user}/>} {tab==='imports'&&<Imports user={user}/>} {tab==='audit'&&<Audit/>}</main>
  </div>
}

function Login({onLogin}:{onLogin:(u:SessionUser)=>void}){
  const { t } = useI18n()
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState('')
  return <div className="center"><div className="panel login"><LanguageSwitch/><p className="eyebrow">{t('auth.staff')}</p><h1>{t('auth.title')}</h1><label>{t('auth.email')}<input value={email} onChange={(e)=>setEmail(e.target.value)}/></label><label>{t('auth.password')}<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label>{error&&<p className="error">{error}</p>}<button onClick={async()=>{try{const x=await api<{user:SessionUser}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(x.user)}catch(e){setError(e instanceof Error?e.message:t('auth.loginFailed'))}}}>{t('auth.login')}</button></div></div>
}

function Overview(){
  const { t }=useI18n(); const [data,setData]=useState<any>(null)
  useEffect(()=>{void api('/admin/overview').then(setData)},[])
  return <><Head title={t('overview.title')}/><div className="stats">{[[t('overview.levels'),data?.levels],[t('overview.review'),data?.references_needing_review],[t('overview.proposals'),data?.open_proposals],[t('overview.users'),data?.users]].map(([k,v])=><div className="stat" key={String(k)}><span>{k}</span><strong>{v??'—'}</strong></div>)}</div><div className="panel"><h2>{t('overview.ruleTitle')}</h2><p>{t('overview.rule')}</p></div></>
}

function Head({title,children}:{title:string;children?:React.ReactNode}){const{t}=useI18n();return <div className="head"><div><p className="eyebrow">{t('head.management')}</p><h1>{title}</h1></div>{children}</div>}

function Levels(){
  const { t }=useI18n()
  const [levels,setLevels]=useState<LevelListItem[]>([]); const [selected,setSelected]=useState<LevelDetail|null>(null); const [msg,setMsg]=useState('')
  const load=()=>api<{levels:LevelListItem[]}>('/levels?limit=100').then((x)=>setLevels(x.levels)); useEffect(()=>{void load()},[])
  const choose=async(id:string)=>setSelected(await api<LevelDetail>(`/levels/${id}`))
  return <><Head title={t('levels.title')}/><div className="split"><div className="panel"><h2>{t('levels.create')}</h2><CreateLevel onCreated={()=>void load()}/><h2>{t('levels.existing')}</h2><div className="list">{levels.map((l)=><button className={selected?.id===l.id?'selected':''} key={l.id} onClick={()=>void choose(l.id)}><span>{l.currentRating?`${l.currentRating.family}${l.currentRating.tier}`:'—'}</span><strong>{l.title}</strong><small>{l.creator}</small></button>)}</div></div><div>{selected?<LevelEditor level={selected} onChanged={async()=>{setMsg(t('levels.saved'));await choose(selected.id);await load()}}/>:<div className="panel"><p>{t('levels.select')}</p></div>}{msg&&<p className="notice">{msg}</p>}</div></div></>
}

function CreateLevel({onCreated}:{onCreated:()=>void}){
  const { t }=useI18n()
  const [song,setSong]=useState('');const [title,setTitle]=useState('');const [creator,setCreator]=useState('');const [label,setLabel]=useState('Original');const [sha,setSha]=useState('');const [url,setUrl]=useState('')
  return <div className="form"><input placeholder={t('levels.song')} value={song} onChange={(e)=>setSong(e.target.value)}/><input placeholder={t('levels.levelTitle')} value={title} onChange={(e)=>setTitle(e.target.value)}/><input placeholder={t('levels.creator')} value={creator} onChange={(e)=>setCreator(e.target.value)}/><div className="grid"><input placeholder={t('levels.versionLabel')} value={label} onChange={(e)=>setLabel(e.target.value)}/><input placeholder={t('levels.shaOptional')} value={sha} onChange={(e)=>setSha(e.target.value)}/></div><input placeholder={t('levels.downloadOptional')} value={url} onChange={(e)=>setUrl(e.target.value)}/><button disabled={!song||!title||!creator||!label} onClick={async()=>{await api('/admin/levels',{method:'POST',body:JSON.stringify({song,title,creator,version:{label,sha256:sha||null,downloadUrl:url||null}})});setSong('');setTitle('');setCreator('');setSha('');setUrl('');onCreated()}}>{t('levels.createButton')}</button></div>
}

function LevelEditor({level,onChanged}:{level:LevelDetail;onChanged:()=>void}){
  const { t }=useI18n()
  const currentVersion=level.versions.find((v)=>v.id===level.currentVersionId)??level.versions[0]
  const [family,setFamily]=useState(level.currentRating?.family??'G');const [tier,setTier]=useState(level.currentRating?.tier??1);const [confidence,setConfidence]=useState(level.currentRating?.confidence??'');const [reason,setReason]=useState('')
  const [versionLabel,setVersionLabel]=useState('');const [versionSha,setVersionSha]=useState('');const [versionUrl,setVersionUrl]=useState('')
  return <div className="panel"><div className="title-row"><div><p className="eyebrow">{level.song}</p><h2>{level.title}</h2><p>{level.creator}</p></div><b className="big-rating">{level.currentRating?`${level.currentRating.family}${level.currentRating.tier}`:t('common.unrated')}</b></div><h3>{t('level.publishRerate')}</h3><p className="muted">{t('level.ratingRule')}</p><div className="grid three"><select value={family} onChange={(e)=>setFamily(e.target.value as any)}><option>P</option><option>G</option><option>U</option></select><input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/><input type="number" min="0" max="1" step=".05" placeholder={t('level.confidence')} value={confidence} onChange={(e)=>setConfidence(e.target.value)}/></div><textarea placeholder={t('level.reason')} value={reason} onChange={(e)=>setReason(e.target.value)}/><button disabled={!currentVersion} onClick={async()=>{await api(`/admin/levels/${level.id}/ratings`,{method:'POST',body:JSON.stringify({levelVersionId:currentVersion?.id,family,tier,confidence:confidence===''?null:Number(confidence),reason})});setReason('');onChanged()}}>{t('level.publish')}</button><h3>{t('level.addVersion')}</h3><div className="grid"><input placeholder={t('level.versionExample')} value={versionLabel} onChange={(e)=>setVersionLabel(e.target.value)}/><input placeholder={t('level.sha')} value={versionSha} onChange={(e)=>setVersionSha(e.target.value)}/></div><input placeholder={t('level.download')} value={versionUrl} onChange={(e)=>setVersionUrl(e.target.value)}/><button className="secondary" disabled={!versionLabel} onClick={async()=>{await api(`/admin/levels/${level.id}/versions`,{method:'POST',body:JSON.stringify({label:versionLabel,sha256:versionSha||null,downloadUrl:versionUrl||null,makeCurrent:true})});setVersionLabel('');setVersionSha('');setVersionUrl('');onChanged()}}>{t('level.addCurrent')}</button><h3>{t('level.versions')}</h3>{level.versions.map((v)=><div className="row" key={v.id}><strong>{v.label}</strong>{v.id===level.currentVersionId&&<span className="pill">{t('common.current')}</span>}<code>{v.sha256??t('level.noSha')}</code></div>)}</div>
}

function References(){
  const { t, status }=useI18n()
  const [refs,setRefs]=useState<ReferenceRow[]>([]);const [levels,setLevels]=useState<LevelListItem[]>([]);const [levelId,setLevelId]=useState('');const [detail,setDetail]=useState<LevelDetail|null>(null);const [family,setFamily]=useState('G');const [tier,setTier]=useState(1);const [tech,setTech]=useState('TECH');const [hint,setHint]=useState('');const [conf,setConf]=useState('')
  const load=()=>api<{references:ReferenceRow[]}>('/references').then((x)=>setRefs(x.references));useEffect(()=>{void load();void api<{levels:LevelListItem[]}>('/levels?limit=100').then((x)=>setLevels(x.levels))},[]);useEffect(()=>{if(levelId)void api<LevelDetail>(`/levels/${levelId}`).then(setDetail);else setDetail(null)},[levelId])
  return <><Head title={t('references.title')}/><div className="panel"><h2>{t('references.add')}</h2><div className="grid three"><select value={levelId} onChange={(e)=>setLevelId(e.target.value)}><option value="">{t('references.level')}</option>{levels.map((l)=><option key={l.id} value={l.id}>{l.title}</option>)}</select><select value={family} onChange={(e)=>setFamily(e.target.value)}><option>P</option><option>G</option><option>U</option></select><input type="number" min="1" max="30" value={tier} onChange={(e)=>setTier(Number(e.target.value))}/><input value={tech} onChange={(e)=>setTech(e.target.value)} placeholder={t('references.technique')}/><select value={hint} onChange={(e)=>setHint(e.target.value)}><option value="">{t('references.noPosition')}</option><option value="-2">{t('references.lower')}</option><option value="-1">{t('references.slightlyLower')}</option><option value="0">{t('references.center')}</option><option value="1">{t('references.slightlyHigher')}</option><option value="2">{t('references.higher')}</option></select><input type="number" min="0" max="1" step=".05" value={conf} onChange={(e)=>setConf(e.target.value)} placeholder={t('references.confidence')}/></div><button disabled={!detail?.currentVersionId||!tech} onClick={async()=>{await api('/admin/references',{method:'POST',body:JSON.stringify({levelVersionId:detail?.currentVersionId,family,tier,technique:tech,positionHint:hint===''?null:Number(hint),confidence:conf===''?null:Number(conf)})});void load()}}>{t('references.addButton')}</button></div><div className="table"><div className="tr th"><span>{t('references.slot')}</span><span>{t('references.level')}</span><span>{t('references.technique')}</span><span>{t('references.status')}</span><span>{t('references.action')}</span></div>{refs.map((r)=><div className="tr" key={r.id}><span>{r.family}{r.tier}</span><span>{r.levelTitle}</span><span>{r.technique}</span><span>{status(r.status)}</span><span>{r.status!=='RETIRED'&&<><button className="tiny" onClick={async()=>{await api(`/admin/references/${r.id}`,{method:'PATCH',body:JSON.stringify({status:'NEEDS_REVIEW'})});void load()}}>{t('references.review')}</button><button className="tiny danger" onClick={async()=>{await api(`/admin/references/${r.id}`,{method:'PATCH',body:JSON.stringify({status:'RETIRED'})});void load()}}>{t('references.retire')}</button></>}</span></div>)}</div></>
}

function Proposals(){
  const { t, status:statusLabel, proposalType }=useI18n()
  const [rows,setRows]=useState<ProposalRow[]>([]);const [message,setMessage]=useState('');const [error,setError]=useState('');const [busyId,setBusyId]=useState('')
  const load=()=>api<{proposals:ProposalRow[]}>('/proposals').then((x)=>setRows(x.proposals));useEffect(()=>{void load()},[])
  const decide=async(p:ProposalRow,status:'APPROVED'|'REJECTED')=>{setBusyId(p.id);setMessage('');setError('');try{const result=await api<{execution?:{type?:string;rating?:{family?:string;tier?:number};staleReferenceIds?:string[];referenceId?:string}|null}>(`/admin/proposals/${p.id}/decision`,{method:'PATCH',body:JSON.stringify({status,reason:status==='APPROVED'?t('proposals.approvedReason'):t('proposals.rejectedReason')})});if(status==='APPROVED'&&result.execution?.type==='RERATE'){setMessage(t('proposals.appliedRerate',{rating:`${result.execution.rating?.family??''}${result.execution.rating?.tier??''}`,count:result.execution.staleReferenceIds?.length??0}))}else if(status==='APPROVED'&&result.execution?.type?.startsWith('REFERENCE_')){setMessage(t('proposals.appliedReference',{type:proposalType(result.execution.type),id:result.execution.referenceId??''}))}else{setMessage(`${p.title}: ${statusLabel(status)}`)}await load()}catch(e){setError(e instanceof Error?e.message:t('proposals.decisionFailed'))}finally{setBusyId('')}}
  const applyLabel=(p:ProposalRow)=>p.type==='RERATE'?t('proposals.approveRerate'):p.type.startsWith('REFERENCE_')?t('proposals.approveReference'):t('proposals.approve')
  return <><Head title={t('proposals.title')}/>{message&&<p className="notice">{message}</p>}{error&&<p className="error">{error}</p>}<div className="cards">{rows.map((p)=><div className="panel" key={p.id}><div className="title-row"><div><span className="pill">{proposalType(p.type)}</span><h2>{p.title}</h2><p>{p.levelTitle} · {p.proposerName}</p></div><strong>{statusLabel(p.status)}</strong></div><p>{p.reason}</p><p className="muted">{t('proposals.agree')} {p.agree} / {t('proposals.disagree')} {p.disagree} / {t('proposals.abstain')} {p.abstain}</p>{p.status==='OPEN'&&<div className="actions"><button disabled={busyId===p.id} onClick={()=>void decide(p,'APPROVED')}>{busyId===p.id?t('proposals.applying'):applyLabel(p)}</button><button className="danger" disabled={busyId===p.id} onClick={()=>void decide(p,'REJECTED')}>{t('proposals.reject')}</button></div>}</div>)}</div></>
}

function Users({user}:{user:SessionUser}){
  const { t, role:roleLabel }=useI18n(); const [rows,setRows]=useState<any[]>([]);const [email,setEmail]=useState('');const [name,setName]=useState('');const [password,setPassword]=useState('');const [role,setRole]=useState<UserRole>('VIEWER')
  const load=()=>api<{users:any[]}>('/admin/users').then((x)=>setRows(x.users));useEffect(()=>{if(user.role==='ADMIN')void load()},[user.role]);if(user.role!=='ADMIN')return <><Head title={t('users.title')}/><div className="panel">{t('users.adminOnly')}</div></>;const roles:UserRole[]=['VIEWER','RATER','REFERENCE_MANAGER','MODERATOR','ADMIN']
  return <><Head title={t('users.title')}/><div className="panel"><h2>{t('users.create')}</h2><div className="grid"><input placeholder={t('users.email')} value={email} onChange={(e)=>setEmail(e.target.value)}/><input placeholder={t('users.displayName')} value={name} onChange={(e)=>setName(e.target.value)}/><input type="password" placeholder={t('users.password')} value={password} onChange={(e)=>setPassword(e.target.value)}/><select value={role} onChange={(e)=>setRole(e.target.value as UserRole)}>{roles.map((r)=><option key={r} value={r}>{roleLabel(r)}</option>)}</select></div><button disabled={!email||!name||!password} onClick={async()=>{await api('/admin/users',{method:'POST',body:JSON.stringify({email,displayName:name,password,role})});setEmail('');setName('');setPassword('');void load()}}>{t('users.createButton')}</button></div><div className="table"><div className="tr th"><span>{t('users.email')}</span><span>{t('users.name')}</span><span>{t('users.role')}</span><span>{t('users.change')}</span><span></span></div>{rows.map((u)=><div className="tr" key={u.id}><span>{u.email}</span><span>{u.display_name}</span><span>{roleLabel(u.role)}</span><span><select defaultValue={u.role} onChange={async(e)=>{await api(`/admin/users/${u.id}/role`,{method:'PATCH',body:JSON.stringify({role:e.target.value})});void load()}}>{roles.map((r)=><option key={r} value={r}>{roleLabel(r)}</option>)}</select></span><span/></div>)}</div></>
}

function Imports({user}:{user:SessionUser}){
  const { t, date }=useI18n(); const [rows,setRows]=useState<any[]>([]);const [source,setSource]=useState('TUF');const [version,setVersion]=useState('');const [raw,setRaw]=useState('{}');const [error,setError]=useState('')
  const load=()=>api<{snapshots:any[]}>('/admin/import-snapshots').then((x)=>setRows(x.snapshots));useEffect(()=>{void load()},[]);const canCreateLevel=user.role==='MODERATOR'||user.role==='ADMIN'
  return <><Head title={t('imports.title')}/><TufReconciliation canCreateLevel={canCreateLevel}/><div className="panel"><h2>{t('imports.storeRaw')}</h2><p className="muted">{t('imports.rawHelp')}</p><div className="grid"><input value={source} onChange={(e)=>setSource(e.target.value)}/><input placeholder={t('imports.sourceVersion')} value={version} onChange={(e)=>setVersion(e.target.value)}/></div><textarea value={raw} onChange={(e)=>setRaw(e.target.value)}/>{error&&<p className="error">{error}</p>}<button onClick={async()=>{try{const parsed=JSON.parse(raw);await api('/admin/import-snapshots',{method:'POST',body:JSON.stringify({source,sourceVersion:version||null,rawData:parsed})});setError('');void load()}catch(e){setError(e instanceof Error?e.message:t('imports.invalidJson'))}}}>{t('imports.store')}</button></div><div className="table"><div className="tr th"><span>{t('imports.source')}</span><span>{t('imports.version')}</span><span>{t('imports.importedAt')}</span><span></span><span></span></div>{rows.map((r)=><div className="tr" key={r.id}><span>{r.source}</span><span>{r.source_version??'—'}</span><span>{date(r.imported_at)}</span><span/><span/></div>)}</div></>
}

function Audit(){
  const { t, date }=useI18n(); const [rows,setRows]=useState<any[]>([]);useEffect(()=>{void api<{audit:any[]}>('/admin/audit').then((x)=>setRows(x.audit))},[])
  return <><Head title={t('audit.title')}/><div className="table"><div className="tr th"><span>{t('audit.time')}</span><span>{t('audit.actor')}</span><span>{t('audit.action')}</span><span>{t('audit.target')}</span><span>{t('audit.details')}</span></div>{rows.map((r)=><div className="tr" key={r.id}><span>{date(r.created_at)}</span><span>{r.actor_name??'system'}</span><span>{r.action}</span><span>{r.entity_type}</span><code>{JSON.stringify(r.details)}</code></div>)}</div></>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><I18nProvider><App/></I18nProvider></React.StrictMode>)