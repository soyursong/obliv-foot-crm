/**
 * T-20260617-foot-DUMMY-CLEANUP-MAYJUN — Stage 1 v2 TIERED 인벤토리 (READ-ONLY)
 *
 * v1(_inventory) 결과 재해석:
 *   - 이름/전화 패턴 단독 분류는 false +/- 가 큼(테스트가 동물·과일·연예인명 사용 / 실환자도 패턴 적중).
 *   - 깨끗한 판별키 = is_simulation=TRUE  ∪  created_by ∈ 테스트시드계정.
 *   - 나머지(sim=false & created_by 비테스트)는 테스트·실환자 혼재 → 현장확인 필수.
 *
 * 산출:
 *   Tier A (high-confidence 테스트): is_simulation=TRUE OR created_by∈TEST_ACCOUNTS
 *   Tier B (애매, 현장확인 필수)    : 그 외 윈도 고객 — 패턴마커(name/phone/memo)는 hint 로만 부착
 *   실환자 가드: 알려진 3인 + memo 에 체험단/치료사/실장/대리신청 등 실운영 신호
 *
 * ⚠ READ-ONLY. SELECT only.
 * 실행: node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_tiered.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } },
);
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const WIN_FROM = '2026-04-30T15:00:00Z';
const WIN_TO   = '2026-06-17T15:00:00Z';
const TEST_ACCOUNTS = ['dummy-seed-20260526', 'TEST-20260615', 'test-dummy', 'test-seed-20260525'];

const REAL_KNOWN = ['윤민희', '김진화', '이시형'];
const REAL_MEMO_RX = /체험단|치료사|치료샘|실장|대리신청|대리\s*신청|선생님/;
const T = (ts) => (ts ? new Date(new Date(ts).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '-');
const NAME_RX = /테스트|더미|홍길동|가나다|검증|차트테스트|^차트|test|dummy|asdf|ㅁㄴㅇ|qa-|e2e|desk-|crossacct|fixture|신규고객_|단계이동_|결제수단_|결제실행_|^힐러\d|^초진환자\d|번$/i;
const PHONE_TEST = (p) => {
  if (!p) return false; const d = String(p);
  return /0000|1111|2222|3333|4444|5555|6666|7777|8888|9999|1234|99990|99005|99006|99007|90010|90020/.test(d)
    || /(\d)\1{5,}/.test(d.replace(/^\+?82/, ''));
};
const MEMO_RX = /TEST|DUMMY|더미|테스트|QA|FIXTURE/i;

const CUST_REF_TABLES = ['reservations', 'check_ins', 'payments', 'packages', 'package_payments', 'medical_charts', 'consent_forms', 'checklists', 'clinical_images', 'insurance_claims', 'insurance_documents', 'insurance_receipts', 'form_submissions', 'health_q_results', 'health_q_tokens', 'customer_special_notes', 'customer_treatment_memos', 'chart_doctor_memos', 'message_logs', 'notification_logs', 'notification_opt_outs', 'scheduled_messages', 'prescriptions', 'rx_audit_log', 'payment_code_claims', 'service_charges'];

async function countIn(table, col, ids) {
  if (!ids.length) return 0;
  let total = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { count, error } = await sb.from(table).select(col, { count: 'exact', head: true }).in(col, ids.slice(i, i + 100));
    if (error) return `ERR:${(error.code || '?')}`;
    total += count ?? 0;
  }
  return total;
}
async function fetchAll(table, sel, f) {
  let all = [], from = 0;
  for (;;) { const { data, error } = await f(sb.from(table).select(sel)).range(from, from + 999); if (error) throw new Error(`${table}: ${error.message}`); all = all.concat(data ?? []); if (!data || data.length < 1000) break; from += 1000; }
  return all;
}

async function main() {
  console.log(`== Stage1 v2 TIERED 인벤토리 (READ-ONLY) == 윈도 2026-05-01~06-17 KST\n`);
  const customers = await fetchAll('customers', 'id, name, phone, visit_type, is_simulation, memo, created_by, created_at',
    (q) => q.eq('clinic_id', CLINIC).gte('created_at', WIN_FROM).lt('created_at', WIN_TO).order('created_at'));
  console.log(`윈도 내 고객 총 ${customers.length}건\n`);

  const rows = customers.map((c) => {
    const tA = c.is_simulation === true || TEST_ACCOUNTS.includes(c.created_by);
    const realKnown = REAL_KNOWN.includes((c.name ?? '').trim());
    const realMemo = c.memo && REAL_MEMO_RX.test(c.memo);
    const hints = [];
    if (c.name && NAME_RX.test(c.name)) hints.push('name');
    if (PHONE_TEST(c.phone)) hints.push('phone');
    if (c.memo && MEMO_RX.test(c.memo)) hints.push('memo');
    let tier;
    if (realKnown) tier = 'REAL-GUARD';
    else if (tA) tier = 'A';
    else tier = 'B';
    return { ...c, tier, hints, realKnown, realMemo, tA };
  });

  const tierA = rows.filter((r) => r.tier === 'A');
  const tierB = rows.filter((r) => r.tier === 'B');
  const realGuard = rows.filter((r) => r.tier === 'REAL-GUARD');
  const bWithHint = tierB.filter((r) => r.hints.length > 0);
  const bNoHint = tierB.filter((r) => r.hints.length === 0);
  const bRealMemo = tierB.filter((r) => r.realMemo);

  console.log(`── TIER 분해 ──`);
  console.log(`  Tier A (high-confidence 테스트: is_simulation=TRUE ∪ created_by∈테스트계정): ${tierA.length}`);
  console.log(`     · is_simulation=TRUE: ${tierA.filter((r) => r.is_simulation === true).length}`);
  console.log(`     · created_by 테스트계정: ${tierA.filter((r) => TEST_ACCOUNTS.includes(r.created_by)).length}`);
  console.log(`  Tier B (애매·현장확인 필수: sim=false & 비테스트 계정): ${tierB.length}`);
  console.log(`     · 패턴 hint 있음(테스트 의심): ${bWithHint.length}`);
  console.log(`     · hint 없음(실환자 의심, but 미검출 테스트 포함 가능): ${bNoHint.length}`);
  console.log(`     · ⚠ memo 실운영신호(체험단/치료사/실장/대리신청): ${bRealMemo.length}`);
  console.log(`  REAL-GUARD (알려진 실환자, 절대제외): ${realGuard.length} → ${realGuard.map((r) => r.name).join(', ')}`);

  // 연관 레코드 카운트 — Tier A 기준 / 전체후보(A+B) 기준
  const aIds = tierA.map((r) => r.id);
  const abIds = [...tierA, ...tierB].map((r) => r.id);
  console.log(`\n── 연관 레코드 카운트 (Tier A ${aIds.length} customer_id) ──`);
  const refA = {};
  for (const t of CUST_REF_TABLES) { refA[t] = await countIn(t, 'customer_id', aIds); if (refA[t] !== 0) console.log(`  ${t}: ${refA[t]}`); }

  console.log(`\n── daily_closings (5/1~6/17, 집계 1행/일) ──`);
  const { data: dc } = await sb.from('daily_closings').select('close_date,status,single_cash_total,actual_card_total').eq('clinic_id', CLINIC).gte('close_date', '2026-05-01').lte('close_date', '2026-06-17').order('close_date');
  (dc ?? []).forEach((r) => console.log(`  ${r.close_date} status=${r.status}`));

  // 파일 산출 (evidence JSON + 현장확인용 roster MD)
  mkdirSync('db-gate', { recursive: true });
  const ev = {
    ticket: 'T-20260617-foot-DUMMY-CLEANUP-MAYJUN', stage: 1, read_only: true, measured_at: new Date().toISOString(),
    clinic_id: CLINIC, window_kst: '2026-05-01 ~ 2026-06-17',
    window_total: customers.length,
    tier_a_count: tierA.length, tier_b_count: tierB.length, real_guard_count: realGuard.length,
    tier_b_with_hint: bWithHint.length, tier_b_no_hint: bNoHint.length, tier_b_real_memo: bRealMemo.length,
    test_accounts: TEST_ACCOUNTS,
    related_counts_tierA: refA,
    real_guard: realGuard.map((r) => ({ id: r.id, name: r.name, phone: r.phone })),
    tier_a: tierA.map((r) => ({ id: r.id, name: r.name, phone: r.phone, created_at: r.created_at, is_sim: r.is_simulation, created_by: r.created_by })),
    tier_b: tierB.map((r) => ({ id: r.id, name: r.name, phone: r.phone, created_at: r.created_at, hints: r.hints, real_memo: r.realMemo, memo: r.memo })),
  };
  writeFileSync('db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_tiered.json', JSON.stringify(ev, null, 2));

  // Roster MD — 현장(김주연 총괄) 확인용
  let md = `# 5~6월 더미 cleanup — 현장 확인용 명단 (Stage1, READ-ONLY 산출)\n\n`;
  md += `- clinic: jongno-foot · 기간: 2026-05-01~06-17 · 윈도 고객 ${customers.length}명\n`;
  md += `- **Tier A (확실한 테스트 ${tierA.length}명)**: 시뮬레이션 마크 or 테스트 생성계정 → 삭제 안전(현장 OK 시 일괄)\n`;
  md += `- **Tier B (애매 ${tierB.length}명)**: 한 건씩 눈으로 확인 필요 (테스트·실환자 섞임)\n`;
  md += `- **실환자 보호 ${realGuard.length}명**: ${realGuard.map((r) => r.name).join(', ')} — 삭제 금지\n\n`;
  md += `## ⚠ Tier B 중 실환자 의심(메모에 체험단/치료사/실장 등) — 삭제 제외 권고\n`;
  bRealMemo.forEach((r) => { md += `- ${r.name} | ${r.phone ?? '-'} | ${T(r.created_at)} | memo: ${r.memo}\n`; });
  md += `\n## Tier B 전체 (한 건씩 확인) — hint=테스트의심표식\n`;
  tierB.sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((r) => {
    md += `- [${r.hints.length ? '테스트의심' : '확인要'}] ${r.name} | ${r.phone ?? '-'} | ${T(r.created_at)}${r.hints.length ? ' | hint=' + r.hints.join('+') : ''}${r.memo ? ' | memo=' + r.memo : ''}\n`;
  });
  md += `\n## Tier A (확실한 테스트 ${tierA.length}명) — 요약 (전체는 JSON)\n`;
  tierA.slice(0, 40).forEach((r) => { md += `- ${r.name} | ${r.phone ?? '-'} | ${T(r.created_at)} | ${r.is_simulation ? 'sim' : r.created_by}\n`; });
  md += `- … 외 ${Math.max(0, tierA.length - 40)}명 (JSON 참조)\n`;
  writeFileSync('db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_roster.md', md);

  console.log(`\n📄 db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_tiered.json`);
  console.log(`📄 db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage1_roster.md (현장확인용)`);
  console.log(`\n===SUMMARY=== 윈도 ${customers.length} = TierA ${tierA.length} + TierB ${tierB.length} + 실환자가드 ${realGuard.length}`);
  console.log(`TierB 중 실운영메모 ${bRealMemo.length} → ${bRealMemo.map((r) => r.name).join(', ')}`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
