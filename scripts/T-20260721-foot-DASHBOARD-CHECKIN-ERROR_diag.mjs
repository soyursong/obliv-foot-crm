import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const URL=env.VITE_SUPABASE_URL, ANON=env.VITE_SUPABASE_ANON_KEY, SR=env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL=env.TEST_EMAIL, PW=env.TEST_PASSWORD;
const admin=createClient(URL,SR,{auth:{persistSession:false}});
const cli=createClient(URL,ANON,{auth:{persistSession:false}});

console.log('== 1) sign in as staff ==');
const {data:auth,error:authErr}=await cli.auth.signInWithPassword({email:EMAIL,password:PW});
if(authErr){console.log('AUTH ERR',authErr.message);process.exit(1);}
console.log('signed in uid=',auth.user.id);

// resolve clinic_id from a staff/clinic
const {data:clinics}=await admin.from('clinics').select('id,name,slug').limit(5);
console.log('clinics:',JSON.stringify(clinics));
const clinicId=clinics?.[0]?.id;
console.log('using clinicId=',clinicId);

const today=new Date().toISOString().slice(0,10);

console.log('\n== 2) dialog open reads (authenticated) ==');
const r1=await cli.from('reservations').select('*').eq('clinic_id',clinicId).eq('reservation_date',today).eq('status','confirmed').order('reservation_time',{ascending:true});
console.log('reservations select err=',r1.error?.message ?? 'OK', 'rows=',r1.data?.length);
const r2=await cli.from('customers').select('id, chart_number').limit(3);
console.log('customers select err=',r2.error?.message ?? 'OK');

console.log('\n== 3) next_queue_number RPC (authenticated) ==');
const q=await cli.rpc('next_queue_number',{p_clinic_id:clinicId,p_date:today});
console.log('next_queue_number err=',q.error?.message ?? 'OK','data=',q.data);

console.log('\n== 4) assign_consultant_atomic RPC (authenticated) ==');
const ac=await cli.rpc('assign_consultant_atomic',{p_clinic_id:clinicId,p_date:today});
console.log('assign_consultant_atomic err=',ac.error?.message ?? 'OK','data=',ac.data);

console.log('\n== 5) check_ins INSERT (authenticated, will rollback via service delete) ==');
const ins=await cli.from('check_ins').insert({
  clinic_id:clinicId, customer_id:null, reservation_id:null,
  customer_name:'__DIAG_TEST__', customer_phone:null,
  visit_type:'new', status:'receiving', queue_number:(q.data??9999), consultant_id:ac.data??null,
}).select('id').single();
console.log('check_ins insert err=',ins.error?.message ?? 'OK','id=',ins.data?.id);
console.log('   full error:',JSON.stringify(ins.error));
if(ins.data?.id){ const d=await admin.from('check_ins').delete().eq('id',ins.data.id); console.log('   cleaned up diag row, err=',d.error?.message??'OK'); }

await cli.auth.signOut();
console.log('\nDONE');
