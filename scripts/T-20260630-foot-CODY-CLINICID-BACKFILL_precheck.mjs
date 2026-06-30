/**
 * T-20260630-foot-CODY-CLINICID-BACKFILL — APPLY PRECHECK (READ-ONLY, prod write 0)
 *
 * 현장확인 수신(2026-07-01): 김연희 coordinator = 종로(jongno-foot) 74967aea-a60b-4da3-a0e7-9c997a930bc8.
 * apply 직전 supervisor DB 게이트 핸드오프 전, 삼중가드 기대행수(정확 1행)와 타깃 clinic 정합을 read-only 재확인.
 *
 * 안전: 오직 SELECT (service_role REST). prod write 0.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const TARGET_ID = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
const TARGET_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (종로/서울 오리진점)
const OTHER_CLINIC_ID = 'b4dc0de5-f007-4a57-8888-aabbccddeeff';  // songdo-foot (격리검증 참조)

let fail = 0;
const ok  = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); fail++; };

async function main() {
  console.log('── [A] 타깃 clinic 정합 (종로) ──');
  const { data: clinic, error: cErr } = await db.from('clinics').select('id,name,slug').eq('id', TARGET_CLINIC_ID).maybeSingle();
  if (cErr) { bad('clinic 조회 오류: ' + cErr.message); }
  else if (!clinic) { bad('TARGET_CLINIC_ID 미존재: ' + TARGET_CLINIC_ID); }
  else if (clinic.slug !== 'jongno-foot') { bad(`slug 불일치: 기대 jongno-foot, 실제 ${clinic.slug}`); }
  else ok(`clinic 확정: ${clinic.name} / ${clinic.slug} / ${clinic.id}`);

  console.log('── [B] 삼중가드 기대행수 (id + role=coordinator + clinic_id IS NULL) ──');
  const { data: guarded, error: gErr } = await db.from('user_profiles')
    .select('id,email,role,clinic_id')
    .eq('id', TARGET_ID).eq('role', 'coordinator').is('clinic_id', null);
  if (gErr) { bad('삼중가드 조회 오류: ' + gErr.message); }
  else if (guarded.length !== 1) { bad(`기대 1행, 실제 ${guarded.length}행 — apply 중단 사유`); }
  else {
    const r = guarded[0];
    ok(`삼중가드 정확 1행: ${r.email} / role=${r.role} / clinic_id=${r.clinic_id}`);
    if (r.email !== 'kyh3858@hanmail.net') bad(`email 불일치: ${r.email}`);
  }

  console.log('── [C] 잔존 NULL coordinator/staff 무회귀 (전수) ──');
  const { data: nulls, error: nErr } = await db.from('user_profiles')
    .select('id,email,role').is('clinic_id', null);
  if (nErr) { bad('NULL 전수 조회 오류: ' + nErr.message); }
  else {
    const coordNulls = nulls.filter(r => r.role === 'coordinator');
    ok(`user_profiles clinic_id IS NULL 총 ${nulls.length}건 (coordinator ${coordNulls.length}건)`);
    if (coordNulls.length !== 1) bad(`coordinator NULL 기대 1건, 실제 ${coordNulls.length}건`);
  }

  console.log('\n── 결과 ──');
  if (fail === 0) {
    console.log('✅ PRECHECK PASS — supervisor DB 게이트 핸드오프 가능. apply 기대 정확 1행.');
    console.log(`   TARGET_CLINIC_ID=${TARGET_CLINIC_ID} (jongno-foot/종로), 격리검증 참조 타clinic=${OTHER_CLINIC_ID} (songdo-foot/송도)`);
  } else {
    console.log(`❌ PRECHECK FAIL — ${fail}건. apply 보류.`);
    process.exit(2);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
