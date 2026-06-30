/**
 * T-20260630-foot-CODY-CLINICID-BACKFILL — 증거 심층 프로브 (READ-ONLY, write 0)
 * kyh3858 의 소속 clinic 을 positive 증거로 확정 시도:
 *  ① 등록출처: auth metadata, user_profiles 전체 컬럼, staff 테이블 row(clinic_id)
 *  ② 활동발자국: clinic_id 보유 + user-fk 가진 모든 후보 테이블 광범위 스캔
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
function env(k){ if(process.env[k])return process.env[k]; for(const f of ['.env.local','.env']){ if(!fs.existsSync(f))continue; for(const l of fs.readFileSync(f,'utf8').split('\n')){ const m=l.match(new RegExp(`^${k}=(.*)$`)); if(m)return m[1].trim(); } } return null; }
const db = createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth:{persistSession:false} });
const L=(...a)=>console.log(...a);
const EMAIL='kyh3858@hanmail.net';

// 1) user_profiles 전체 컬럼
const { data: up } = await db.from('user_profiles').select('*').eq('email', EMAIL);
let uid = up?.[0]?.id;
if(!uid){ // email 이 user_profiles 에 없으면 auth 에서 찾기
  const { data: au } = await db.auth.admin.listUsers({ page:1, perPage:1000 });
  const u = (au?.users||[]).find(x=>x.email===EMAIL); uid=u?.id;
}
L('── ① user_profiles row ──'); L(JSON.stringify(up?.[0]||null, null, 2));
L('uid =', uid);

// auth metadata (등록 시 clinic 상속 흔적)
try{
  const { data: au } = await db.auth.admin.getUserById(uid);
  const u = au?.user;
  L('\n── auth.users metadata ──');
  L('  created_at:', u?.created_at, ' last_sign_in:', u?.last_sign_in_at);
  L('  app_metadata:', JSON.stringify(u?.app_metadata));
  L('  user_metadata:', JSON.stringify(u?.user_metadata));
}catch(e){ L('auth getUser err', e.message); }

// 2) staff 테이블 (user_id 기준, name 기준)
L('\n── ② staff 테이블 ──');
const { data: stByUid, error: se } = await db.from('staff').select('*').eq('user_id', uid);
if(se) L('  staff by user_id err:', se.message); else L('  staff(user_id):', JSON.stringify(stByUid, null, 2));
const nm = up?.[0]?.name;
if(nm){ const { data: stByName } = await db.from('staff').select('id,name,role,active,clinic_id,user_id').eq('name', nm); L(`  staff(name=${nm}):`, JSON.stringify(stByName, null, 2)); }

// 3) 광범위 활동 발자국 — clinic_id 보유 테이블 후보 전수
L('\n── ③ 광범위 발자국 스캔 ──');
const CANDIDATE_TABLES = [
  'check_ins','reservations','medical_charts','chart_doctor_memos','handover_notes',
  'customer_consult_memos','customer_resv_consult_memos','customer_special_notes',
  'room_assignments','space_assignments','assignment_runs','timer_records',
  'payments','service_charges','insurance_claims','clinic_events','check_in_room_logs',
  'patient_file_records','prescription_codes','form_submissions','reservation_logs',
];
const FKS = ['created_by','updated_by','performed_by','registrar_id','consultant_id','therapist_id','staff_id','signing_doctor','booked_by','author_id','user_id','assigned_by'];
const hits = {};
for(const t of CANDIDATE_TABLES){
  const { data: sample, error } = await db.from(t).select('*').limit(1);
  if(error) continue;
  const cols = sample?.[0] ? Object.keys(sample[0]) : [];
  const hasClinic = cols.includes('clinic_id');
  const fkCols = FKS.filter(f=>cols.includes(f));
  if(fkCols.length===0) continue;
  for(const fk of fkCols){
    const sel = hasClinic ? 'clinic_id' : fk;
    const { data, error:e2 } = await db.from(t).select(sel).eq(fk, uid).limit(500);
    if(e2||!data||data.length===0) continue;
    const tally={}; if(hasClinic) for(const r of data){ tally[r.clinic_id]=(tally[r.clinic_id]||0)+1; }
    hits[`${t}.${fk}`] = { rows:data.length, clinic_tally: hasClinic?tally:'(no clinic_id col)' };
  }
}
L(JSON.stringify(hits, null, 2));
L('\n발자국 테이블 hit 수:', Object.keys(hits).length);
