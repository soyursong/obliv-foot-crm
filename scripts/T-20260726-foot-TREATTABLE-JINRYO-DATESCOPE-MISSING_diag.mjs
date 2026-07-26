#!/usr/bin/env node
/**
 * T-20260726-foot-TREATTABLE-JINRYO-DATESCOPE-MISSING — READ-ONLY 진단 (service_role)
 *
 * 목적: 치료테이블 [진료] 탭이 7/24·7/25 미노출인 원인을 확정.
 *   [진료] 탭 = DoctorHistorySection.useDoctorHistory —
 *     q1: check_ins WHERE clinic + checked_in_at ∈ [dateT00:00,23:59 KST]
 *         + status != cancelled + status_flag IN ('purple','pink')
 *     q2: 위와 동일 window, status_flag IS NULL 중 status_flag_history 에 purple|pink 이력 有.
 *   → 쿼리는 이미 선택 날짜 스코프. today-only 하드코딩 아님(코드 확인).
 *
 * 대조: 부모 DATA-MISSING check_ins 7/24=25건. anon/RLS 0-row 를 wipe 로 오인 금지 → service_role.
 * PHI 최소조회: id, status, status_flag, checked_in_at, customer_id 존재여부만. 이름 비출력.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });

console.log('=== project ref:', REF, '(service_role) ===\n');

// clinic 목록 (풋 = 종로점 slug obliv-foot 계열)
const { data: clinics } = await admin.from('clinics').select('id, slug, name');
console.log('[clinics]', (clinics ?? []).map((c) => `${c.slug}=${c.id.slice(0, 8)}`).join(', '), '\n');

const DATES = ['2026-07-24', '2026-07-25', '2026-07-26'];
const SELECT = 'id, clinic_id, status, status_flag, status_flag_history, checked_in_at, customer_id';

function bounds(d) {
  return { start: `${d}T00:00:00+09:00`, end: `${d}T23:59:59+09:00` };
}
function historyHadDoctorCall(h) {
  if (!Array.isArray(h) || h.length === 0) return false;
  return h.some((x) => x && (x.flag === 'purple' || x.flag === 'pink'));
}

for (const d of DATES) {
  const { start, end } = bounds(d);
  // 전체 check_ins (status_flag 무관) — 부모 25건 대조용
  const { data: all, error } = await admin
    .from('check_ins')
    .select(SELECT)
    .gte('checked_in_at', start)
    .lte('checked_in_at', end);
  if (error) {
    console.log(`\n### ${d} — query error:`, error.message);
    continue;
  }
  const rows = all ?? [];
  const notCancelled = rows.filter((r) => r.status !== 'cancelled');
  const flagDist = {};
  for (const r of rows) flagDist[String(r.status_flag)] = (flagDist[String(r.status_flag)] ?? 0) + 1;

  // [진료] 탭 필터 재현
  const q1 = notCancelled.filter((r) => r.status_flag === 'purple' || r.status_flag === 'pink');
  const q2 = notCancelled.filter(
    (r) => r.status_flag === null && historyHadDoctorCall(r.status_flag_history),
  );
  const jinryoVisible = q1.length + q2.length;

  // clinic 분포
  const clinicDist = {};
  for (const r of rows) clinicDist[String(r.clinic_id).slice(0, 8)] = (clinicDist[String(r.clinic_id).slice(0, 8)] ?? 0) + 1;

  console.log(`\n### ${d}`);
  console.log(`  check_ins 전체            : ${rows.length}건`);
  console.log(`  status != cancelled       : ${notCancelled.length}건`);
  console.log(`  status_flag 분포          : ${JSON.stringify(flagDist)}`);
  console.log(`  clinic 분포               : ${JSON.stringify(clinicDist)}`);
  console.log(`  ─ [진료] 탭 q1(purple|pink): ${q1.length}건`);
  console.log(`  ─ [진료] 탭 q2(null+이력)  : ${q2.length}건`);
  console.log(`  ▶ [진료] 탭 노출 예상       : ${jinryoVisible}건`);
}

console.log('\n=== done ===');
