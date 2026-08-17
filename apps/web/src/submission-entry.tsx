import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, LanguageSwitch, useI18n } from './i18n'
import { SubmitLevelPage } from './SubmitLevel'
import './styles.css'

function SubmissionOverlay(){
  const { locale }=useI18n()
  const [active,setActive]=useState(location.hash==='#/submit')
  useEffect(()=>{const onHash=()=>setActive(location.hash==='#/submit');addEventListener('hashchange',onHash);return()=>removeEventListener('hashchange',onHash)},[])
  if(!active)return null
  return <div className="submission-route-overlay"><div className="shell"><header className="topbar"><a className="brand" href="#/">ELF <span>Enhanced Level Forum</span></a><nav><a href="#/levels">{locale==='ja'?'譜面':'Levels'}</a><a href="#/submit">{locale==='ja'?'投稿':'Submit'}</a></nav><div className="account"><LanguageSwitch/></div></header><main><SubmitLevelPage/></main><footer>Enhanced Level Forum</footer></div></div>
}

const root=document.createElement('div')
root.id='submission-route-root'
document.body.appendChild(root)
createRoot(root).render(<React.StrictMode><I18nProvider><SubmissionOverlay/></I18nProvider></React.StrictMode>)

function ensureNavLink(){
  const nav=document.querySelector('.topbar nav')
  if(!nav||nav.querySelector('a[href="#/submit"]'))return
  const a=document.createElement('a');a.href='#/submit';a.textContent=document.documentElement.lang==='ja'?'投稿':'Submit';nav.appendChild(a)
}
const observer=new MutationObserver(()=>ensureNavLink())
observer.observe(document.documentElement,{subtree:true,childList:true})
ensureNavLink()
