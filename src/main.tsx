import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {Mail,ArrowLeft} from 'lucide-react';
const App=React.lazy(()=>import('./App'));
import {supabase,configured} from './lib/supabase';
import './styles.css';
function Root(){const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(configured),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[signingIn,setSigningIn]=useState(false);
useEffect(()=>{if(!supabase)return;let live=true;const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{if(live){setSession(s);setLoading(false);if(s)setSigningIn(false)}});supabase.auth.getSession().then(({data,error})=>{if(live){setSession(data.session);setLoading(false);if(error)setMessage(error.message)}}).catch(()=>{if(live){setMessage('Could not load your session. Reload to retry.');setLoading(false)}});return()=>{live=false;subscription.unsubscribe()}},[]);
async function sendLink(e:React.FormEvent){e.preventDefault();if(!supabase)return;setBusy(true);setMessage('');try{const {error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin}});if(error)throw error;setMessage('Check your email for a sign-in link. Open it on this device.');}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
async function google(){if(!supabase)return;setBusy(true);const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});if(error){setMessage(error.message);setBusy(false)}}
if(loading)return <div className="auth-page"><p>Opening Allthatbook…</p></div>;
if(session)return <App key={session.user.id} signedIn/>;
if(signingIn&&configured)return <main className="auth-page"><section className="auth-card"><a href="/" className="brand"><span className="brand-icon">a</span>Allthatbook.</a><h1>Keep your bookings.</h1><p>Sign in to save your bookings to your account.</p><form onSubmit={sendLink}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><button disabled={busy} className="primary"><Mail size={17}/>{busy?'Sending…':'Email me a sign-in link'}</button></form>{import.meta.env.VITE_ENABLE_GOOGLE_AUTH==='true'&&<button className="secondary google-button" disabled={busy} onClick={google}>Continue with Google</button>}<small>No password needed. New users get an account when they confirm their email.</small>{message&&<p className="auth-message" role="status">{message}</p>}<button type="button" className="try-demo" onClick={()=>setSigningIn(false)}><ArrowLeft size={15}/> Back to Allthatbook</button></section></main>;
return <App key="guest" onSignIn={configured?()=>setSigningIn(true):undefined}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={<div className="auth-page">Loading Allthatbook…</div>}><Root/></React.Suspense></React.StrictMode>);