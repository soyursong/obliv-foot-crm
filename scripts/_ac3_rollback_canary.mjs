import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const e=readFileSync('.env.local','utf8');const p=k=>(e.match(new RegExp(`^${k}=(.+)$`,'m'))?.[1]??'').trim();
const sb=createClient(p('VITE_SUPABASE_URL'),p('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const ID='2fb4885d-7a96-4881-8859-c0645724ea75';
const {data,error}=await sb.from('reservations').update({status:'confirmed',cancelled_at:null,cancel_reason:null}).eq('id',ID).select('id,status,cancelled_at').single();
console.log(error?('ROLLBACK FAIL: '+error.message):('ROLLBACK OK: '+JSON.stringify(data)));
