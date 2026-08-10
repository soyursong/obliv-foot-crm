// Generator for T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A migration (up + rollback).
// Emits archive-first (CREATE TABLE _arch_* AS SELECT) then FK-safe DELETE (children first).
// Run: node scripts/_gen_testacct8_legA_migration.mjs  (writes .sql files, no DB access)
import { writeFileSync } from 'node:fs';
const TS = '20260810220000';
const AP = '_arch_testacct8_';        // archive table prefix
const D = '20260810';                 // archive suffix
const MIG = 'supabase/migrations/'+TS+'_foot_testacct8_legA_cleanup';

const ROOTS = ['21a82994-b231-4bcc-94ff-dd9e6c3a4951','e72022d0-7cf5-4f42-b5e3-b5162005b454','c074025b-cd27-443c-93a9-151d6d4214d4','d7faae9b-8e0b-421a-b68b-483ede6834a3','a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d'];
const R = ROOTS.map(i=>`'${i}'::uuid`).join(', ');
const arch = t => `public.${AP}${t}_${D}`;
const AC = arch('customers'), AR = arch('reservations'), AK = arch('packages'), AI = arch('check_ins');

// archive creation order (parents before children referenced in predicates) + expected N
const ARCHIVE = [
  ['customers',                 `id IN (${R})`, 6],
  ['reservations',              `customer_id IN (${R})`, 7],
  ['packages',                  `customer_id IN (${R})`, 5],
  ['check_ins',                 `customer_id IN (SELECT id FROM ${AC}) OR reservation_id IN (SELECT id FROM ${AR})`, 5],
  ['assignment_actions',        `check_in_id IN (SELECT id FROM ${AI})`, 4],
  ['chart_treatment_requests',  `customer_id IN (SELECT id FROM ${AC}) OR check_in_id IN (SELECT id FROM ${AI})`, 3],
  ['check_in_room_logs',        `check_in_id IN (SELECT id FROM ${AI})`, 6],
  ['check_in_services',         `check_in_id IN (SELECT id FROM ${AI})`, 49],
  ['customer_reservation_memos',`customer_id IN (SELECT id FROM ${AC})`, 1],
  ['customer_treatment_memos',  `customer_id IN (SELECT id FROM ${AC})`, 2],
  ['form_submissions',          `customer_id IN (SELECT id FROM ${AC}) OR check_in_id IN (SELECT id FROM ${AI})`, 3],
  ['health_q_results',          `customer_id IN (SELECT id FROM ${AC})`, 2],
  ['health_q_tokens',           `customer_id IN (SELECT id FROM ${AC})`, 3],
  ['reservation_logs',          `reservation_id IN (SELECT id FROM ${AR})`, 4],
  ['reservation_memo_history',  `reservation_id IN (SELECT id FROM ${AR}) OR check_in_id IN (SELECT id FROM ${AI})`, 2],
  ['status_transitions',        `check_in_id IN (SELECT id FROM ${AI})`, 20],
  ['package_sessions',          `check_in_id IN (SELECT id FROM ${AI}) OR package_id IN (SELECT id FROM ${AK})`, 1],
  ['notification_logs',         `customer_id IN (SELECT id FROM ${AC})`, 11],
  ['phi_access_log',            `customer_id IN (SELECT id FROM ${AC})`, 78],
];
// delete order: children first (topological). notification_logs+phi_access_log are leaves.
const DELETE_ORDER = ['assignment_actions','chart_treatment_requests','check_in_room_logs','check_in_services',
  'customer_reservation_memos','customer_treatment_memos','form_submissions','health_q_results','health_q_tokens',
  'reservation_logs','reservation_memo_history','status_transitions','package_sessions',
  'notification_logs','phi_access_log','check_ins','packages','reservations','customers'];
// delete predicate per table (match archive exactly via _arch table)
const delPred = t => (t==='notification_logs'||t==='phi_access_log')
  ? `customer_id IN (SELECT id FROM ${AC})`
  : `id IN (SELECT id FROM ${arch(t)})`;
const N = Object.fromEntries(ARCHIVE.map(([t,,n])=>[t,n]));
const TOTAL = ARCHIVE.reduce((s,[,,n])=>s+n,0);

// ── up.sql ──
let up = `-- T-20260810-foot-TESTACCT-CLEANUP-8ACCT  Leg A — 테스트계정 5이름/6행 archive-first 물리삭제
-- planner NEW-TASK MSG-20260810-164607(승인, 총괄 confirm MSG-20260810-164012-o67t "웅 테스트표시ㄱㄱ")
-- census commit f68b9613 · closure 재검증 + off-git snapshot(sha256 71c1a6b9fd42f33e79c2eacb60b93831d6f2fc7e5eb78d4214e616df089a4e88) 완료.
--
-- 대상 6 customers (Leg A): 풋테스트3 F-4425 · 풋테스트1 F-4427 · 풋서류테스트입니다 F-4468 · 송지현2 F-4692 · 엄경은2 F-4691 · 엄경은2 F-4703(DUMMY)
--   ★ 서류테스트 F-4990 · 총괄테스트중 F-4574 · 서류테스트2 F-5113 = Leg B(is_test), 본 마이그 제외(삭제 금지).
-- 안전근거: 6대상 전건 payments/service_charges/medical_charts/insurance_*/prescriptions/consent_forms 접점 0
--   (LEDGER/MEDICAL GUARD PASS) → 의료법 보존의무 무저촉 → 물리삭제 eligible.
-- FK closure(재귀 resolver): 19 tables / ${TOTAL} rows. children-first topological delete order.
--   ledger/의료 테이블은 closure 전체 깊이에서도 0건(check_in_services/status_transitions 등은 운영·감사 자식이며 매출/의료 아님).
-- 성격: 파괴 DELETE + archive-first(무손실). 신규 스키마(business table) 0. _arch_* 는 복구용 스냅샷 테이블.
-- 멱등: 아카이브 IF NOT EXISTS · DELETE 재실행 시 0-row no-op.
-- 원장 무접점: payments/service_charges/package_payments/package_credit_ledger 미접촉(대상에 부재).
-- dry-run: 무영속(dryrun_lib) — _arch_* prod 부재 + customers 6행 잔존(롤백) post-probe.
-- rollback: ${TS}_foot_testacct8_legA_cleanup.rollback.sql (parents-first INSERT 복원).
-- ★apply = supervisor DB-GATE GO-token 후 db_apply_guard.sh 만(apply_before_go 금지).

BEGIN;

-- ═══ 1) ARCHIVE-FIRST (무손실 스냅샷; parents 먼저 생성해 predicate 의존 성립) ═══
`;
for (const [t,pred,n] of ARCHIVE) {
  up += `CREATE TABLE IF NOT EXISTS ${arch(t)} AS SELECT * FROM public.${t} WHERE ${pred};  -- expect ${n}\n`;
}
up += `
-- ═══ 2) FK-safe DELETE (children first; freeze-set = _arch_* 로 고정) ═══
-- ★★ GATED LEG — form_submissions 는 발행 의무기록 retention guard(trg_form_submissions_published_immutable,
--    의료법 §22/§40 10년보존)로 hard-DELETE 전면차단. 정당 purge = service_role 의 의도적 DISABLE TRIGGER
--    경유(트리거 본문 'DA 명시'). 본 3행(F-4427 printed·doc_serial_seq=74 / F-4692 voided / F-4425 draft)은
--    테스트계정 서류이나 이는 census '발행서류 0건→DA CONSULT N/A' 전제를 뒤집음.
--    ⇒ 이 DISABLE TRIGGER purge 블록의 실행은 DA CONSULT sign-off + planner/총괄 확인 후에만(FOLLOWUP 발행).
--    guard 는 트랜잭션 내에서만 disable→enable(원자 복구). form_submissions_audit_log=0·self-ref=0 확인.
`;
for (const t of DELETE_ORDER) {
  if (t === 'form_submissions') {
    up += `ALTER TABLE public.form_submissions DISABLE TRIGGER trg_form_submissions_published_immutable;  -- DA-sanctioned purge path (GATED)\n`;
    up += `DELETE FROM public.${t} WHERE ${delPred(t)};  -- expect ${N[t]}\n`;
    up += `ALTER TABLE public.form_submissions ENABLE TRIGGER trg_form_submissions_published_immutable;   -- retention guard 즉시 복구\n`;
  } else {
    up += `DELETE FROM public.${t} WHERE ${delPred(t)};  -- expect ${N[t]}\n`;
  }
}
up += `
COMMIT;
-- exact-N POSTCHECK (apply 후): 삭제 총 ${TOTAL}행 / customers 6행 소멸 / _arch_* ${TOTAL}행 보존.
`;

// ── rollback.sql ── (parents first insert = reverse delete order)
const INSERT_ORDER = [...DELETE_ORDER].reverse();
let rb = `-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A
-- _arch_* 스냅샷에서 원본 복원(parents-first INSERT). up.sql 의 정확한 역연산.
-- 주의: 복원 후 _arch_* 테이블은 감사용으로 보존(별도 DROP 마이그로 정리 가능).
BEGIN;
`;
for (const t of INSERT_ORDER) {
  rb += `INSERT INTO public.${t} SELECT * FROM ${arch(t)} ON CONFLICT DO NOTHING;  -- restore ${N[t]}\n`;
}
rb += `COMMIT;\n`;

writeFileSync(MIG+'.sql', up);
writeFileSync(MIG+'.rollback.sql', rb);
console.log('WROTE', MIG+'.sql', '('+up.length+'B)');
console.log('WROTE', MIG+'.rollback.sql', '('+rb.length+'B)');
console.log('TOTAL rows =', TOTAL, '· archive tables =', ARCHIVE.length, '· delete stmts =', DELETE_ORDER.length);
