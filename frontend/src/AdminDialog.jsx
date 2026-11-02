import React, { useEffect, useRef, useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';

export default function AdminDialog({ status, request, onChange, onClose }) {
  const dialog=useRef(null);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return ()=>previous?.focus();},[]);
  async function signIn(event) {
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const next=await request('/api/admin/login',{username,password});setPassword('');onChange(next);
      setMessage('Admin session verified. You can process documents without using paid credits.');
    } catch(failure) {setPassword('');setError(failure.message);}
    finally {setBusy(false);}
  }
  async function signOut() {
    setBusy(true);setError('');
    try {const result=await request('/api/admin/logout',{});onChange(result.billing);setMessage(result.message);}
    catch(failure){setError(failure.message);}
    finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="billing-dialog admin-dialog" aria-labelledby="admin-title" onCancel={onClose}
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="billing-content">
      <button autoFocus className="icon-button close-help" aria-label="Close admin panel" onClick={onClose}><X size={20}/></button>
      <span className="eyebrow">OWNER ACCESS</span><h2 id="admin-title">Admin panel</h2>
      <p>Sign in with the owner account configured privately on your payment server. Admin access uses the same cleanup application without spending document credits.</p>
      {status?.admin ? <>
        <div className="billing-balance"><ShieldCheck size={20}/><strong>Admin access active</strong></div>
        <p>Your session expires at {new Date(status.admin_expires_at*1000).toLocaleTimeString()}. Internet is required to verify access. Signing out restores normal customer credit checks.</p>
        <button className="button button-secondary" disabled={busy} onClick={signOut}>Sign out of admin</button>
      </> : <form onSubmit={signIn}>
        <label htmlFor="admin-user">Admin username</label>
        <input id="admin-user" autoComplete="username" maxLength={100} required value={username} onChange={event=>setUsername(event.target.value)}/>
        <label htmlFor="admin-password">Admin password</label>
        <input id="admin-password" type="password" autoComplete="current-password" maxLength={200} required value={password} onChange={event=>setPassword(event.target.value)}/>
        <button className="button button-primary" disabled={busy||!username.trim()||!password} type="submit">{busy?'Verifying…':'Sign in as admin'}</button>
        <p>Owner accounts are provisioned privately. There is no public registration or default password.</p>
      </form>}
      {error&&<p role="alert" className="billing-error">{error}</p>}
      {message&&<p role="status" className="billing-message">{message}</p>}
    </div>
  </dialog>;
}
