#!/usr/bin/env node
// PRESTATE PROBE — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(b) apply-JIT 재요청 동봉용.
// READ-ONLY. supervisor fresh 무영속 재현 판정시점 prestate 대조 근거.
// 목적: A-a apply(15:52 80행 삭제) 이후 실질변동 반영한 현 prod 상태 실측 →
//       A-b 대상 2행(F-4425/F-4692)이 여전히 live·삭제 미집행(apply_before_go 준수)임을 확증.
import { q } from './dryrun_lib.mjs';

const ROOTS = "'21a82994-b231-4bcc-94ff-dd9e6c3a4951','d7faae9b-8e0b-421a-b68b-483ede6834a3'"; // F-4425 draft · F-4692 voided
const FS2 = "'755ac489-a262-48a8-bad0-2f03142c992a','b0edd82a-0d86-4a80-af21-04391d0f1b92'";
const F4427_FS = "'b4a36c4e-f5a8-4afb-8f87-b581f152050e'"; // F-4427 printed serial74 — 절대 미포함
const AA_ROOTS = "'F-4691','F-4703','F-4468'"; // Leg A-(a) 이미 삭제 종결(chart_number 기준 참고)

const probe = async (label, sql) => {
  const r = await q(sql);
  console.log(`\n■ ${label}`);
  console.log(JSON.stringify(r, null, 2));
  return r;
};

console.log('════ Leg A-(b) PRESTATE PROBE (READ-ONLY) ════');
console.log('probe_time_utc(server):', JSON.stringify(await q('SELECT now() AT TIME ZONE \'UTC\' AS utc, now() AT TIME ZONE \'Asia/Seoul\' AS kst;')));

// 1) A-b 대상 2 customers live 잔존 (apply 미집행)
await probe('A-b 대상 customers live (expect 2: F-4425 draft, F-4692 voided)',
  `SELECT id, chart_number, name, is_test, is_simulation, created_at FROM public.customers WHERE id IN (${ROOTS}) ORDER BY chart_number;`);

// 2) 대상 form_submissions 2행 = serial-NULL·never-issued (retention firewall clear)
await probe('A-b 대상 form_submissions (expect 2: draft+voided, doc_serial_seq NULL)',
  `SELECT id, customer_id, status, doc_serial_seq, rx_issue_seq, is_deleted, created_at FROM public.form_submissions WHERE id IN (${FS2}) ORDER BY status;`);

// 3) F-4427 fs leak guard: b4a36c4e 는 대상 2 customer 소유 아님 (별개·printed·serial 보유)
await probe('F-4427 fs b4a36c4e (leak-guard: NOT owned by A-b targets · printed · serial NOT NULL)',
  `SELECT id, customer_id, status, doc_serial_seq, (customer_id IN (${ROOTS})) AS owned_by_ab_target FROM public.form_submissions WHERE id = ${F4427_FS};`);

// 4) retention 트리거 현재 enabled ('O')
await probe("retention trigger tgenabled (expect 'O' enabled)",
  `SELECT t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='form_submissions' AND t.tgname='trg_form_submissions_published_immutable';`);

// 5) FK closure prestate counts (up.sql expect: closure 51 + notif 5 + phi 35 = 91)
await probe('FK closure prestate counts (up.sql expected 총 91행)',
  `WITH cust AS (SELECT id FROM public.customers WHERE id IN (${ROOTS})),
        resv AS (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM cust)),
        ci AS (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM cust) OR reservation_id IN (SELECT id FROM resv))
   SELECT
     (SELECT count(*) FROM cust) AS customers,
     (SELECT count(*) FROM resv) AS reservations,
     (SELECT count(*) FROM public.packages WHERE customer_id IN (SELECT id FROM cust)) AS packages,
     (SELECT count(*) FROM ci) AS check_ins,
     (SELECT count(*) FROM public.assignment_actions WHERE check_in_id IN (SELECT id FROM ci)) AS assignment_actions,
     (SELECT count(*) FROM public.chart_treatment_requests WHERE customer_id IN (SELECT id FROM cust) OR check_in_id IN (SELECT id FROM ci)) AS chart_treatment_requests,
     (SELECT count(*) FROM public.check_in_room_logs WHERE check_in_id IN (SELECT id FROM ci)) AS check_in_room_logs,
     (SELECT count(*) FROM public.check_in_services WHERE check_in_id IN (SELECT id FROM ci)) AS check_in_services,
     (SELECT count(*) FROM public.customer_treatment_memos WHERE customer_id IN (SELECT id FROM cust)) AS customer_treatment_memos,
     (SELECT count(*) FROM public.form_submissions WHERE customer_id IN (SELECT id FROM cust) OR check_in_id IN (SELECT id FROM ci)) AS form_submissions,
     (SELECT count(*) FROM public.health_q_results WHERE customer_id IN (SELECT id FROM cust)) AS health_q_results,
     (SELECT count(*) FROM public.health_q_tokens WHERE customer_id IN (SELECT id FROM cust)) AS health_q_tokens,
     (SELECT count(*) FROM public.reservation_logs WHERE reservation_id IN (SELECT id FROM resv)) AS reservation_logs,
     (SELECT count(*) FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM resv) OR check_in_id IN (SELECT id FROM ci)) AS reservation_memo_history,
     (SELECT count(*) FROM public.status_transitions WHERE check_in_id IN (SELECT id FROM ci)) AS status_transitions,
     (SELECT count(*) FROM public.notification_logs WHERE customer_id IN (SELECT id FROM cust) OR reservation_id IN (SELECT id FROM resv)) AS notification_logs,
     (SELECT count(*) FROM public.phi_access_log WHERE customer_id IN (SELECT id FROM cust)) AS phi_access_log;`);

// 6) ledger/medical guard = 전건 0 (재무·의무기록 무접점)
await probe('LEDGER/MEDICAL guard (expect ALL 0)',
  `WITH cust AS (SELECT id FROM public.customers WHERE id IN (${ROOTS}))
   SELECT
     (SELECT count(*) FROM public.payments WHERE customer_id IN (SELECT id FROM cust)) AS payments,
     (SELECT count(*) FROM public.service_charges sc WHERE sc.check_in_id IN (SELECT ci.id FROM public.check_ins ci WHERE ci.customer_id IN (SELECT id FROM cust))) AS service_charges,
     (SELECT count(*) FROM public.package_payments WHERE package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM cust))) AS package_payments,
     (SELECT count(*) FROM public.medical_charts WHERE customer_id IN (SELECT id FROM cust)) AS medical_charts,
     (SELECT count(*) FROM public.prescriptions WHERE customer_id IN (SELECT id FROM cust)) AS prescriptions,
     (SELECT count(*) FROM public.consent_forms WHERE customer_id IN (SELECT id FROM cust)) AS consent_forms;`);

// 7) A-a 3행 이미 삭제 종결 확증 (live 0 — supersede 재확인)
await probe('Leg A-(a) 3행 live 잔존 (expect 0 — 이미 삭제 종결 06:52Z)',
  `SELECT count(*) AS live_aa_roots FROM public.customers WHERE chart_number IN (${AA_ROOTS});`);

// 8) archive 오브젝트 prod 부재 (apply 미집행 = _arch_ab_* 없어야 함)
await probe('_arch_testacct8_ab_* prod 부재 (expect absent — apply_before_go 준수)',
  `SELECT to_regclass('public._arch_testacct8_ab_customers_20260811') AS arch_customers, to_regclass('public._arch_testacct8_ab_form_submissions_20260811') AS arch_fs;`);

console.log('\n════ PRESTATE PROBE END (READ-ONLY · DELETE/DDL/WRITE 0) ════');
