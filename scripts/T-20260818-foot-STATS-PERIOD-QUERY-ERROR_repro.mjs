#!/usr/bin/env node
/**
 * T-20260818-foot-STATS-PERIOD-QUERY-ERROR — READ-ONLY 재현
 * 통계 각 탭 fetch 를 기간 조합(정상/장기간/월경계/역순)으로 호출 → 어느 조회가 오류내는지 특정.
 * PHI 미출력 — 행수/에러코드만.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const admin = createClient(g('VITE_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const { data: clinics } = await admin.from('clinics').select('id, slug, name');
const clinic = (clinics || []).find(c => /jongno|종로|foot/i.test(`${c.slug} ${c.name}`)) || (clinics || [])[0];
const CLINIC = clinic?.id;
console.log('target clinic:', CLINIC, clinic?.slug, clinic?.name, '\n');

const RPCS = [
  ['foot_stats_revenue',            (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
  ['foot_stats_by_category',        (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
  ['foot_stats_consultant_admin',   (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
  ['foot_stats_noshow_returning',   (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
  ['foot_stats_therapist_summary',  (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
  ['foot_stats_therapist_services', (f,t)=>({p_clinic_id:CLINIC,p_from:f,p_to:t})],
];

async function rpc(name, args) {
  const t0 = Date.now();
  const { data, error } = await admin.rpc(name, args);
  const ms = Date.now() - t0;
  if (error) return `ERR ${ms}ms code=${error.code} ${(error.message||'').slice(0,90)}`;
  return `ok ${ms}ms rows=${(data||[]).length}`;
}

// check_ins 페이지네이션(weekly AOV) 재현
async function checkinPage(f,t){
  const t0=Date.now();
  const { data, error } = await admin.from('check_ins')
    .select('customer_id, checked_in_at').eq('clinic_id',CLINIC)
    .is('deleted_at',null).neq('status','cancelled')
    .gte('checked_in_at',`${f}T00:00:00+09:00`).lte('checked_in_at',`${t}T23:59:59+09:00`).range(0,999);
  const ms=Date.now()-t0;
  return error?`ERR ${ms}ms code=${error.code} ${(error.message||'').slice(0,90)}`:`ok ${ms}ms rows=${(data||[]).length}`;
}

const RANGES = [
  ['정상 이번달', '2026-08-01', '2026-08-18'],
  ['장기간 92d',  '2026-05-18', '2026-08-18'],
  ['월경계',      '2026-07-15', '2026-08-15'],
  ['역순 from>to','2026-08-18', '2026-08-01'],
  ['단일일',      '2026-08-18', '2026-08-18'],
  ['연경계',      '2025-12-15', '2026-01-15'],
];

for (const [label,f,t] of RANGES) {
  console.log(`\n=== ${label}  ${f} ~ ${t} ===`);
  for (const [name,mk] of RPCS) {
    console.log(`  ${name.padEnd(32)} ${await rpc(name, mk(f,t))}`);
  }
  console.log(`  ${'check_ins(weeklyAOV)'.padEnd(32)} ${await checkinPage(f,t)}`);
}
console.log('\nDONE.');
