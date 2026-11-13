import {supabase} from './supabase';

// No row in reminder_settings means reminders are ON.
export async function getRemindersEnabled():Promise<boolean>{
  if(!supabase)return true;
  const {data,error}=await supabase.from('reminder_settings').select('enabled').maybeSingle();
  if(error)throw new Error(error.message);
  return data?.enabled??true;
}

export async function setRemindersEnabled(enabled:boolean):Promise<void>{
  if(!supabase)throw new Error('Configure Supabase in .env.local first.');
  const {data:{user},error:userError}=await supabase.auth.getUser();
  if(userError||!user)throw new Error('Please sign in again.');
  const {error}=await supabase.from('reminder_settings').upsert({user_id:user.id,enabled,updated_at:new Date().toISOString()});
  if(error)throw new Error(error.message);
}