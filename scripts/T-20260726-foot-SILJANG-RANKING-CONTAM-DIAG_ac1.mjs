#!/usr/bin/env node
/**
 * T-20260726-foot-SILJANG-RANKING-CONTAM-DIAG — READ-ONLY 진단 (AC-1 census + orientation)
 * 총괄 지적: 실장 랭킹에 풋에 없는 직원(김수린/이승은) + 총매출 오류.
 * cross-CRM 도메인 오염(clinic 스코프 위반) 의심.
 * DML 절대 금지. service_role 컨텍스트(RLS bypass)로 실데이터 조회만.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });

console.log('=== project ref:', REF, '(auth-ctx: service_role, RLS bypass) ===\n');

// ── 0) DB 아키텍처: clinics 테이블 (공유 멀티-clinic 여부) ──────────────────────
const { data: clinics, error: cErr } = await admin
  .from('clinics')
  .select('id, slug, name')
  .order('slug');
if (cErr) { console.error('clinics query error', cErr); process.exit(1); }
console.log(`[0] clinics 테이블 (${clinics.length}개 clinic 존재 = ${clinics.length > 1 ? '공유 멀티-clinic DB' : 'foot 단일'}):`);
for (const c of clinics) console.log(`  slug=${c.slug}  id=${c.id}  name=${c.name}  name=${c.name}`);

const footClinic = clinics.find(c => /foot/i.test(c.slug) || /풋/.test(c.name || ''));
console.log(`\n>>> foot clinic 추정: slug=${footClinic?.slug} id=${footClinic?.id}`);
const clinicName = Object.fromEntries(clinics.map(c => [c.id, `${c.slug}`]));

// ── 1) AC-1: staff census (전 clinic, 이름·role·clinic·active) ──────────────────
const { data: staff, error: sErr } = await admin
  .from('staff')
  .select('id, name, role, clinic_id, active')
  .order('clinic_id');
if (sErr) { console.error('staff query error', sErr); process.exit(1); }
console.log(`\n[1] AC-1 staff census: 전체 ${staff.length}명 (전 clinic)`);
const byClinic = {};
for (const s of staff) {
  const k = clinicName[s.clinic_id] ?? `(clinic ${String(s.clinic_id).slice(0,8)})`;
  (byClinic[k] ??= []).push(s);
}
for (const [k, arr] of Object.entries(byClinic)) {
  console.log(`  --- clinic=${k}: ${arr.length}명 ---`);
  for (const s of arr) console.log(`      ${s.name}  role=${s.role}  active=${s.active}  id=${s.id.slice(0,8)}`);
}

// ── 1b) 김수린 / 이승은 실재 + 태깅 clinic ─────────────────────────────────────
console.log(`\n[1b] 지목 직원 김수린/이승은 실재 여부:`);
for (const nm of ['김수린', '이승은']) {
  const hits = staff.filter(s => s.name === nm);
  if (!hits.length) { console.log(`  ${nm}: staff 테이블에 없음`); continue; }
  for (const h of hits) {
    console.log(`  ${nm}: 실재 O  clinic=${clinicName[h.clinic_id] ?? h.clinic_id}  role=${h.role}  active=${h.is_active}  id=${h.id}`);
  }
}

// foot clinic 소속 staff 이름만
const footStaff = staff.filter(s => s.clinic_id === footClinic?.id);
console.log(`\n>>> foot(${footClinic?.slug}) 소속 staff 명단(${footStaff.length}): ${footStaff.map(s=>s.name).join(', ')}`);
console.log('\n=== AC-1 완료 ===');
