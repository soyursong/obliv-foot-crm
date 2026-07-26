#!/usr/bin/env node
/**
 * T-20260726-foot-TREATTABLE-JINRYOTAB-DATESCOPE-EXPAND — READ-ONLY 검증 (service_role)
 *
 * 목적: 배포된 fix(ff9f35b8, JINRYO-DATESCOPE-MISSING)의 q2 확장 로직을 그대로 재현해,
 *   7/24·7/25 [진료] 탭이 이제 실제로 몇 건 노출되는지 확정한다.
 *   (기존 _diag.mjs 는 구 q2 = null+이력 만 계산 → dark_gray+이력 recapture 를 검증 못함)
 *
 * 배포된 DoctorHistorySection.useDoctorHistory 재현:
 *   q1: not cancelled + status_flag IN ('purple','pink')
 *   q2: not cancelled + status_flag NOT IN ('purple','pink') + status_flag_history 에 purple|pink 이력 有
 *       (null·dark_gray·기타 terminal 전부 포함 — 이것이 fix 의 핵심)
 *   merge: id Set dedup
 *
 * 인증컨텍스트: service_role (Silent 0-Row Read 표준 — anon/RLS 0-row 오인 배제).
 * PHI 최소: id/status/status_flag/history 존재여부만. 이름 비출력.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });

console.log('=== project ref:', REF, '(service_role) — DEPLOYED FIX 재현 검증 ===\n');

const DATES = ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
const SELECT = 'id, clinic_id, status, status_flag, status_flag_history, checked_in_at';

const bounds = (d) => ({ start: `${d}T00:00:00+09:00`, end: `${d}T23:59:59+09:00` });
const hadDoctorCall = (h) =>
  Array.isArray(h) && h.some((x) => x && (x.flag === 'purple' || x.flag === 'pink'));

for (const d of DATES) {
  const { start, end } = bounds(d);
  const { data: all, error } = await admin
    .from('check_ins')
    .select(SELECT)
    .gte('checked_in_at', start)
    .lte('checked_in_at', end);
  if (error) {
    console.log(`\n### ${d} — query error:`, error.message);
    continue;
  }
  const rows = (all ?? []).filter((r) => r.status !== 'cancelled');

  const q1 = rows.filter((r) => r.status_flag === 'purple' || r.status_flag === 'pink');
  // 배포된 fix 의 q2: 현재 flag 가 purple|pink 아님 + 진료콜 이력 有
  const q2 = rows.filter(
    (r) => !(r.status_flag === 'purple' || r.status_flag === 'pink') && hadDoctorCall(r.status_flag_history),
  );
  const merged = new Set([...q1, ...q2].map((r) => r.id));

  // q2 를 현재 flag 별로 쪼개 recapture 근거 확인
  const q2ByFlag = {};
  for (const r of q2) q2ByFlag[String(r.status_flag)] = (q2ByFlag[String(r.status_flag)] ?? 0) + 1;

  console.log(`### ${d}`);
  console.log(`  비취소 check_ins           : ${rows.length}건`);
  console.log(`  q1(현재 purple|pink)       : ${q1.length}건`);
  console.log(`  q2(비-call flag + 진료콜이력): ${q2.length}건  by-flag=${JSON.stringify(q2ByFlag)}`);
  console.log(`  ▶ [진료] 탭 노출(배포fix)   : ${merged.size}건\n`);
}

console.log('=== done ===');
