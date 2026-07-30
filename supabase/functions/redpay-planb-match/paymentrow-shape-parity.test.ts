// paymentrow-shape-parity.test.ts — 경로A payments INSERT 행 shape-parity 단위 테스트(payload self-test)
//
// T-20260730-foot-REDPAY-PLANB-OPT3-PAYWRITE-BUILD-P2 (e2e_spec_exempt=ef_only, change-class=ADDITIVE/no-DDL)
//   DA AC2: EF INSERT 행 ≡ recordManualPayment(manualPaymentWritePath.ts:107) checkin/single 카드분기 행 필드동형.
//   여기서 그 필드동형 + foot-native 매핑(method='card', pg_provider/method_standard 부재) +
//   매출-일자 앵커(AC6, approved_at) + external_* populate(AC7) + orphan 차단(AC5) 을 고정한다.
//   실행: deno test supabase/functions/redpay-planb-match/paymentrow-shape-parity.test.ts
//
//   ▸ raw-claim/matched 전이/보상 release 의 DB I/O 는 index.ts matchAndRecordPayment 런타임 통합영역이고,
//     여기서는 결정적 행 조립(buildPlanbPaymentRow) 만 고정한다.

import { assertEquals, assertThrows, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPlanbPaymentRow,
  PlanbPaymentBuildError,
  seoulDateOf,
  type PlanbPendingRow,
  type PlanbRawRow,
} from "./paymentRow.ts";

function pending(over: Partial<PlanbPendingRow> = {}): PlanbPendingRow {
  return {
    id: "pending-1",
    clinic_id: "clinic-1",
    customer_id: "cust-1",
    check_in_id: "checkin-1",
    expected_amount: 120000,
    ...over,
  };
}
function raw(over: Partial<PlanbRawRow> = {}): PlanbRawRow {
  return {
    id: "raw-1",
    external_trxid: "TRX-ABC",
    external_status: "Y",
    approval_no: "APPR-001",
    tid: "TID-777",
    approved_at: "2026-07-30T02:15:00.000Z", // = KST 11:15 (2026-07-30)
    received_at: "2026-07-30T02:16:30.000Z",
    ...over,
  };
}
const OPTS = { paymentId: "pay-uuid-1", reconciledAtIso: "2026-07-30T05:00:00.000Z" };

// ── shape-parity: recordManualPayment checkin/single 카드분기 canonical 필드 동형 ──────────────
Deno.test("canonical shape-parity — recordManualPayment 카드분기 필드동형", () => {
  const { row } = buildPlanbPaymentRow(pending(), raw(), OPTS);
  // recordManualPayment(checkin/single) 이 쓰는 canonical 필드와 값·타입 동형.
  assertEquals(row.clinic_id, "clinic-1");
  assertEquals(row.check_in_id, "checkin-1");   // checkin 귀속(pending.check_in_id)
  assertEquals(row.customer_id, "cust-1");
  assertEquals(row.amount, 120000);
  assertEquals(row.method, "card");             // method_standard='card' 의도 = method='card'
  assertEquals(row.installment, 0);
  assertEquals(row.payment_type, "payment");
  assert(typeof row.memo === "string" && row.memo.length > 0);
  assert(typeof row.created_at === "string" && row.created_at.length > 0);
});

// ── foot-native 매핑: pg_provider/method_standard 컬럼 write 금지(부재 컬럼 = INSERT 실패/DDL) ──────
Deno.test("foot-native — pg_provider/method_standard 키 부재(부재 컬럼 write 금지)", () => {
  const { row } = buildPlanbPaymentRow(pending(), raw(), OPTS);
  const keys = Object.keys(row);
  assertEquals(keys.includes("pg_provider"), false);
  assertEquals(keys.includes("method_standard"), false);
  assertEquals(keys.includes("paid_at"), false);
});

// ── AC7: Model A ② 주석컬럼 raw 에서 동시 populate + reconciled_at 사전스탬프 ────────────────────
Deno.test("AC7 — external_* + reconciled_at populate(raw 관측)", () => {
  const { row } = buildPlanbPaymentRow(pending(), raw(), OPTS);
  assertEquals(row.external_trxid, "TRX-ABC");
  assertEquals(row.external_approval_no, "APPR-001");
  assertEquals(row.external_status, "Y");
  assertEquals(row.external_tid, "TID-777");
  assertEquals(row.reconciled_at, OPTS.reconciledAtIso); // reconcile 재매칭 skip(orphan 재유입 차단)
});

// ── AC6: 매출-일자 앵커 = raw.approved_at (감지·INSERT 시각 아님) ────────────────────────────
Deno.test("AC6 — created_at = approved_at, accounting_date = approved_at 의 Seoul 달력일", () => {
  const { row } = buildPlanbPaymentRow(pending(), raw(), OPTS);
  assertEquals(row.created_at, "2026-07-30T02:15:00.000Z");   // VAN 승인시각
  assertEquals(row.accounting_date, "2026-07-30");            // KST 달력일(11:15) — 트리거 now() drift 차단
  // reconciled_at(감지시각)·paymentId 는 매출-일자 앵커와 구분됨을 확인.
  assert(row.created_at !== OPTS.reconciledAtIso);
});

Deno.test("AC6 — 일경계 drift: UTC 늦은시각 approved_at 이 KST 익일로 귀속", () => {
  // approved_at = 2026-07-30T15:30:00Z = KST 2026-07-31 00:30 → accounting_date 는 07-31 이어야.
  const { row } = buildPlanbPaymentRow(pending(), raw({ approved_at: "2026-07-30T15:30:00.000Z" }), OPTS);
  assertEquals(row.accounting_date, "2026-07-31");
  assertEquals(seoulDateOf("2026-07-30T15:30:00.000Z"), "2026-07-31");
  // 반대로 KST 자정 직전(UTC 14:59)은 당일.
  assertEquals(seoulDateOf("2026-07-30T14:59:00.000Z"), "2026-07-30");
});

Deno.test("AC6 — approved_at 부재 시 received_at fallback + warning(INSERT 시각 앵커 회피)", () => {
  const { row, warnings } = buildPlanbPaymentRow(
    pending(), raw({ approved_at: null, received_at: "2026-07-30T02:16:30.000Z" }), OPTS);
  assertEquals(row.created_at, "2026-07-30T02:16:30.000Z");
  assertEquals(row.accounting_date, "2026-07-30");
  assert(warnings.length >= 1);
});

// ── AC5: check_in_id 미해소 → orphan payment 차단(throw = INSERT 차단·수동폴백) ─────────────────
Deno.test("AC5 — check_in_id 부재 시 throw(orphan payment 금지)", () => {
  assertThrows(
    () => buildPlanbPaymentRow(pending({ check_in_id: "" as unknown as string }), raw(), OPTS),
    PlanbPaymentBuildError,
  );
});

Deno.test("AC5 — customer_id 부재 시 throw(귀속 불가)", () => {
  assertThrows(
    () => buildPlanbPaymentRow(pending({ customer_id: "" as unknown as string }), raw(), OPTS),
    PlanbPaymentBuildError,
  );
});

Deno.test("금액 부정(<=0) 시 throw", () => {
  assertThrows(() => buildPlanbPaymentRow(pending({ expected_amount: 0 }), raw(), OPTS), PlanbPaymentBuildError);
  assertThrows(() => buildPlanbPaymentRow(pending({ expected_amount: -5 }), raw(), OPTS), PlanbPaymentBuildError);
});

Deno.test("approved_at·received_at 모두 부재 시 throw(매출-일자 앵커 불가)", () => {
  assertThrows(
    () => buildPlanbPaymentRow(pending(), raw({ approved_at: null, received_at: null }), OPTS),
    PlanbPaymentBuildError,
  );
});

// ── claim-first 앵커: payment id = 주입 UUID(raw.matched_payment_id claim 값과 결속) ───────────
Deno.test("claim-first — row.id = 주입 paymentId(claim 앵커 결속)", () => {
  const { row } = buildPlanbPaymentRow(pending(), raw(), OPTS);
  assertEquals(row.id, "pay-uuid-1");
});
