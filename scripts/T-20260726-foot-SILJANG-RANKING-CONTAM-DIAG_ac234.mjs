#!/usr/bin/env node
/**
 * T-20260726-foot-SILJANG-RANKING-CONTAM-DIAG — READ-ONLY (AC-2 실행측 / AC-3 origin / AC-4 정정)
 * 데이터소스 = foot_stats_consultant RPC (실장별 실적 = 통계>매출통계 '실장 랭킹' canonical).
 * DML 금지. service_role.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const admin = createClient(g('VITE_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const SONGDO = 'b4dc0de5-f007-4a57-8888-aabbccddeeff'; // songdo-foot
const KIM = '5b3a3a5f-9d14-4099-897b-95c6ae86b763';    // 김수린 (consultant, active=false)
const LEE = 'bf424e1d-4593-4fa6-a54e-d610c32dc13b';    // 이승은 (consultant, active=false)
const won = (n) => (n == null ? '—' : Number(n).toLocaleString('ko-KR') + '원');

// active 맵 (정정 랭킹에서 표기용)
const { data: staffAll } = await admin.from('staff').select('id, name, active, clinic_id').eq('role', 'consultant');
const activeById = Object.fromEntries((staffAll || []).map(s => [s.id, s.active]));

// ── AC-2/AC-4: RPC 를 여러 window 로 호출 → 어떤 window 가 8명·김수린/이승은 재현하는지 ──
const windows = [
  ['오늘(07-26)',       '2026-07-26', '2026-07-26'],
  ['당월MTD(07-01~26)', '2026-07-01', '2026-07-26'],
  ['개원~현재(전기간)',  '2026-01-01', '2026-12-31'],
];

for (const [label, from, to] of windows) {
  const { data, error } = await admin.rpc('foot_stats_consultant', { p_clinic_id: JONGNO, p_from: from, p_to: to });
  if (error) { console.log(`\n[RPC ${label}] ERROR: ${error.message}`); continue; }
  const rows = (data || []).slice().sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
  const total = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  console.log(`\n═══ [AC-4] foot_stats_consultant(jongno-foot, ${from}~${to}) = ${label} : ${rows.length}명 ═══`);
  console.log('  순위 | 실장명 | active | 귀속매출 | 상담건 | 상담객수 | 객단가');
  rows.forEach((r, i) => {
    const act = activeById[r.consultant_id] === false ? '퇴사(비활성)' : (activeById[r.consultant_id] === true ? '재직' : '?');
    const flag = (r.consultant_id === KIM || r.consultant_id === LEE) ? '  ★지목' : '';
    console.log(`  ${i + 1}. ${r.name} | ${act} | ${won(r.total_amount)} | ${r.ticketing_count} | ${r.consulted_customer_count} | ${won(r.avg_amount)}${flag}`);
  });
  console.log(`  ── 실장귀속 합계(attributed): ${won(total)}  (※ 일마감 총매출과 by-design 차이=미귀속분)`);
  // active=true 만 남긴 '현직 실장' 정정본
  const activeRows = rows.filter(r => activeById[r.consultant_id] === true);
  const activeTotal = activeRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  console.log(`  ▷ [정정: 현직 consultant 만] ${activeRows.length}명 / 귀속합계 ${won(activeTotal)} : ${activeRows.map(r => r.name).join(', ')}`);
}

// ── AC-3: 김수린/이승은 origin — consultation check_ins 어느 clinic·언제·몇 건 ──
console.log('\n\n═══ [AC-3] 지목 실장 김수린/이승은 매출/상담 origin 추적 ═══');
for (const [nm, id] of [['김수린', KIM], ['이승은', LEE]]) {
  // consultation 전환된 check_ins (RPC ticketed 기준: to_status='consultation')
  const { data: cis } = await admin
    .from('check_ins')
    .select('id, clinic_id, checked_in_at, customer_id, deleted_at')
    .eq('consultant_id', id);
  const byClinic = {};
  for (const c of (cis || [])) {
    const k = c.clinic_id === JONGNO ? 'jongno-foot' : c.clinic_id === SONGDO ? 'songdo-foot' : c.clinic_id;
    (byClinic[k] ??= []).push(c);
  }
  const dates = (cis || []).map(c => (c.checked_in_at || '').slice(0, 10)).filter(Boolean).sort();
  console.log(`\n  ${nm} (consultant, active=false):`);
  console.log(`    consultant_id 로 배정된 check_ins 총 ${cis?.length || 0}건`);
  for (const [k, arr] of Object.entries(byClinic)) console.log(`      · clinic=${k}: ${arr.length}건 (soft-hidden ${arr.filter(a=>a.deleted_at).length}건)`);
  if (dates.length) console.log(`      · 상담일 범위: ${dates[0]} ~ ${dates[dates.length - 1]}`);
  // 이 상담사에게 RPC 가 귀속시키는 매출이 있는지: 전기간 RPC 행
  const { data: rpcAll } = await admin.rpc('foot_stats_consultant', { p_clinic_id: JONGNO, p_from: '2026-01-01', p_to: '2026-12-31' });
  const row = (rpcAll || []).find(r => r.consultant_id === id);
  console.log(`      · 전기간 RPC 귀속매출: ${row ? won(row.total_amount) : '없음(랭킹 미출현)'} / 상담건 ${row?.ticketing_count ?? 0}`);
}

// ── cross-clinic 오염 최종 판정: 김수린/이승은 이 songdo 나 타 clinic 에 흔적 있나 ──
console.log('\n═══ [AC-2 최종] cross-clinic/cross-CRM 오염 여부 ═══');
console.log(`  RPC foot_stats_consultant 는 전 leg 에서 clinic_id=p_clinic_id 필터 적용(SQL 근거: ci/packages/package_payments/payments/staff 모두).`);
console.log(`  → 지목 실장이 songdo/타clinic origin 인지 위 AC-3 clinic 분포로 확정.`);
console.log('\n=== AC-2/3/4 완료 ===');
