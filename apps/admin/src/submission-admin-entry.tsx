import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, LanguageSwitch, useI18n } from './i18n'
import { SubmissionReview } from './SubmissionReview'
import './styles.css'
import './submission-admin.css'

function SubmissionAdminOverlay(){
  const { locale }=useI18n()
  const [active,setActive]=useState(location.hash==='#/submissions')

  useEffect(()=>{
    const onHash=()=>setActive(location.hash==='#/submissions')
    addEventListener('hashchange',onHash)
    return()=>removeEventListener('hashchange',onHash)
  },[])

  useEffect(()=>{
    const ensureButton=()=>{
      const aside=document.querySelector('.admin-shell aside')
      if(!aside||aside.querySelector('[data-submission-review]'))return
      const logout=aside.querySelector('.logout')
      const button=document.createElement('button')
      button.dataset.submissionReview='true'
      button.textContent=locale==='ja'?'投稿審査':'Submissions'
      button.onclick=()=>{location.hash='#/submissions'}
      aside.insertBefore(button,logout)
      aside.querySelectorAll('button:not([data-submission-review])').forEach((node)=>{
        node.addEventListener('click',()=>{if(location.hash==='#/submissions')history.replaceState(null,'',location.pathname+location.search)})
      })
    }
    const observer=new MutationObserver(ensureButton)
    observer.observe(document.documentElement,{subtree:true,childList:true})
    ensureButton()
    return()=>observer.disconnect()
  },[locale])

  if(!active)return null
  return <div className="submission-admin-overlay">
    <div className="admin-shell">
      <aside><div className="brand">ELF <span>Admin</span></div><LanguageSwitch/><button onClick={()=>{history.replaceState(null,'',location.pathname+location.search);setActive(false)}}>{locale==='ja'?'管理画面へ戻る':'Back to admin'}</button></aside>
      <main><SubmissionReview/></main>
    </div>
  </div>
}

const root=document.createElement('div')
root.id='submission-admin-root'
document.body.appendChild(root)
createRoot(root).render(<React.StrictMode><I18nProvider><SubmissionAdminOverlay/></I18nProvider></React.StrictMode>)
