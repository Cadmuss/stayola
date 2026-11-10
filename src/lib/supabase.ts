import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL?.trim();
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configured=!!url&&!!key&&!url.includes('YOUR_PROJECT')&&!key.includes('YOUR_PUBLISHABLE_KEY');
// Only the public/publishable key belongs here. RLS enforces data ownership.
export const supabase=configured?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
