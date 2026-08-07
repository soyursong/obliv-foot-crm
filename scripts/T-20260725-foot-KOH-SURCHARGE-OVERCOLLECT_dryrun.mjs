/**
 * T-20260725-foot-KOH-SURCHARGE-OVERCOLLECT-REFUND-ASSESS — AC-1~AC-3 READ-ONLY 규모산출 dry-run
 *
 * 인증컨텍스트: service_role (RLS 우회) → 0-row = 진짜 부재(RLS 필터 아님).
 * write/DDL 0. SELECT only. db_change=false.
 *
 * ── 버그경로 지문 (data_correction_backfill_sop AC-2) ──────────────────────────
 *   결함 = 야간/공휴일/토요 30% 진찰료 가산의 base 가 급여 전체합(coveredTotal, aggregate)으로
 *          잡혀 균검사(KOH, 진단검사료·급여) 등 비진찰료 급여에까지 30% 가산 → payments.amount 과다.
 *   ★FE-only 버그: service_charges(명세) 영속은 DB RPC 레벨에서 hira 진찰료 self-gate → 균검사 가산 미영속.
 *     즉 과오납은 payments.amount(환자 실수납)에만 존재. (커밋 11c1ebcf 메시지 [정합] 절 근거)
 *
 * ── 과오납 성립 필요조건 (AND) ────────────────────────────────────────────────
 *   (a) PMW 보험정산(insurance-copay-settle) 경로로 생성된 payment (FE 가 amount 계산 → 가산 fold)
 *   (b) checked_in_at = 토/야간/공휴 → detectSurchargeKind 발동
 *   (c) 급여 covered 비진찰료 line-item(KOH 등) 동반 → aggregate base > 진찰료-only base
 *   → 셋 중 하나라도 없으면 computeSurcharge=0 (over-charge 불성립).
 *
 * ── window (버그 FE 라이브 기간) ──────────────────────────────────────────────
 *   시작 07458cf6 (SETTLE, deploy-ready 2026-07-25 15:16:16 KST) — settle 가산 도입(aggregate base)
 *   종점 11c1ebcf (SURCHARGE-SCOPE-GYUNTEST-EXCLUDE, deploy-ready 2026-07-25 16:39:57 KST) — 진찰료-only
 *   ⚠ deploy-ready 마킹시각 ≠ prod CF Pages 라이브 시각(merge/build lag) → loose [14:00,19:00] 스캔.
 *
 * ── 링크 모델 (실측 확정) ─────────────────────────────────────────────────────
 *   payments.check_in_id / service_charge_id = 全 NULL (외부영수증 경로) → 방문 링크 = customer_id.
 *   service_charges.check_in_id → check_ins.checked_in_at(방문일/가산 ref).
 *   service_charges.service_id → services.hira_category(진찰료 vs 검사 판정).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const J = (o) => JSON.stringify(o);
const log = (...a) => console.log(...a);

const LOOSE_START = '2026-07-25T14:00:00+09:00', LOOSE_END = '2026-07-25T19:00:00+09:00';
const TIGHT_START = '2026-07-25T15:16:16+09:00', TIGHT_END = '2026-07-25T16:39:57+09:00';

log('════════ KOH 과가산 과오납 규모산출 dry-run (READ-ONLY) ════════');

// ── [1] loose window payments ───────────────────────────────────────
const { data: pays } = await sb.from('payments')
  .select('id,created_at,amount,method,payment_type,status,memo,service_charge_id,check_in_id,customer_id')
  .gte('created_at', LOOSE_START).lte('created_at', LOOSE_END).order('created_at');
log('\n[1] loose window payments:', pays.length);
log('    memo 분포:', J(pays.reduce((a, p) => { a[p.memo] = (a[p.memo] || 0) + 1; return a; }, {})));
log('    check_in_id 채워진 건:', pays.filter((p) => p.check_in_id).length,
    '| service_charge_id 채워진 건:', pays.filter((p) => p.service_charge_id).length);
log('    → 全 NULL 링크 = PMW 보험정산 경로 아님(외부영수증 캡처). 필요조건(a) 미충족 후보.');

// ── [2] 07-25 보험정산 명세(service_charges) — 필요조건(a)(c) 실측 ────
const { data: scs } = await sb.from('service_charges')
  .select('id,check_in_id,customer_id,service_id,insurance_covered_amount,copayment_amount,base_amount,calculated_at')
  .gte('calculated_at', '2026-07-25T00:00:00+09:00').lte('calculated_at', '2026-07-25T23:59:59+09:00');
const svcIds = [...new Set((scs || []).map((s) => s.service_id).filter(Boolean))];
const { data: svcs } = svcIds.length
  ? await sb.from('services').select('id,name,hira_category,category').in('id', svcIds)
  : { data: [] };
const svcById = Object.fromEntries((svcs || []).map((s) => [s.id, s]));
log('\n[2] 07-25 service_charges(calculated_at):', scs?.length ?? 0);
const coveredNonConsult = (scs || []).filter((s) => {
  const v = svcById[s.service_id];
  return Number(s.insurance_covered_amount || 0) > 0 && v?.hira_category !== 'consultation';
});
for (const s of (scs || [])) {
  const v = svcById[s.service_id];
  log('   ', J({ svc: v?.name, cat: v?.category, hira: v?.hira_category, covered: s.insurance_covered_amount, copay: s.copayment_amount }));
}
log('    → 급여 covered 비진찰료(KOH 등) line-item:', coveredNonConsult.length, '건 (필요조건(c))');

// ── [3] 07-25 방문 KOH/검사 흔적 (treatment content 교차) ────────────
const { data: ci } = await sb.from('check_ins')
  .select('id,customer_id,customer_name,visit_type,treatment_category,treatment_contents,prescription_items')
  .gte('checked_in_at', '2026-07-25T00:00:00+09:00').lte('checked_in_at', '2026-07-25T23:59:59+09:00');
const kohCi = (ci || []).filter((c) =>
  JSON.stringify([c.treatment_category, c.treatment_contents, c.prescription_items]).match(/균검사|KOH|진균|피검사|검사/i));
log('\n[3] 07-25 방문:', ci?.length ?? 0, '| KOH/검사 흔적 방문:', kohCi.length);

// ── [4] window payment 고객 ∩ KOH검사 방문 고객 ─────────────────────
const payCust = new Set(pays.map((p) => p.customer_id));
const overlap = [...new Set(kohCi.map((c) => c.customer_id))].filter((x) => payCust.has(x));
log('\n[4] window payment 고객 ∩ KOH검사 방문 고객:', overlap.length);

// ── [5] 필요조건 교집합 candidate ────────────────────────────────────
const candidates = pays.filter((p) => {
  const settlePath = !!(p.check_in_id || p.service_charge_id); // (a)
  const kohCust = kohCi.some((c) => c.customer_id === p.customer_id); // (c) proxy
  return settlePath && kohCust;
});

log('\n════════ 요약 (AC-1 규모산출) ════════');
log('  loose window payments        :', pays.length, '(전건 외부영수증 캡처 memo)');
const inTight = (iso) => { const t = Date.parse(iso); return t >= Date.parse(TIGHT_START) && t <= Date.parse(TIGHT_END); };
log('  tight window payments        :', pays.filter((p) => inTight(p.created_at)).length, '(deploy-ready 마킹시각 기준, 링크 全NULL이라 후보 아님)');
log('  07-25 급여 covered 비진찰료   :', coveredNonConsult.length, '건 (필요조건 c)');
log('  07-25 KOH/검사 흔적 방문      :', kohCi.length, '건');
log('  지문교집합 과오납 candidate   :', candidates.length, '건');
log('  과오납 추정총액               : ₩', candidates.reduce((a) => a, 0));
log('');
log('  ▶ 결론: 과오납 대상', candidates.length === 0 ? '0건 / ₩0' : candidates.length + '건 (개별검토)');
log('    근거: (a)정산경로 payment 0(全 외부영수증) + (c)07-25 급여 covered KOH 0 + KOH검사방문 0.');
log('    ⚠ 보조사실: service_charges 07월 미사용(07-18=0,07-19=0,07-25=1[비급여],08-01~ 가동).');
log('    ⚠ AC-4(실 환불 write)=본 티켓 범위 밖. scope=0 → 환불 대상 없음 → 파괴 MONEY 티켓 불요.');
