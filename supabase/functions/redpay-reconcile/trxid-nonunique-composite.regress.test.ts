// redpay-reconcile/trxid-nonunique-composite.regress.test.ts — Q2/Q4 regression (DA AC 2항)
//
// ★★ T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT ★★
//   DA CONSULT-REPLY (SSOT=da_decision_foot_redpay_trxid_nonunique_composite_20260729.md,
//   decision_id=DA-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT).
//   verdict = DA GO · CEO면제 · supervisor code-gate. probe RESOLVED(triple-collision 0 both bands).
//
//   §7 AC-2 regression fixture 4항을 assert 로 동봉:
//     (a) 8자형 승인/취소 shared trxid → 2행 유지(각각 독립 처리)·오링크 0.
//     (b) 단형 재사용 trxid 합성(동일 trxid·상이 거래) → composite 가 단일/수동(오링크 아님).
//     (c) Tier0 composite 4조건 전부 요구 · bare trxid auto-link 소멸.
//     (d) refund root = 부호 + |amount| + 시각 disambiguate (root_trxid 단독 REJECT).
//   실행: deno test supabase/functions/redpay-reconcile/trxid-nonunique-composite.regress.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findTier0Direct,
  matchTransaction,
  detectRefundNotInCrm,
  type RawTransaction,
  type CrmPayment,
} from "./matcher.ts";

const APPROVED_AT = "2026-07-29T01:00:00.000Z"; // KST 2026-07-29 10:00

function rawRow(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    id: "raw-1",
    clinic_id: "clinic-1",
    external_trxid: "TRX-RAW-1",
    external_status: "Y",
    amount: 120000,
    approval_no: null,
    root_trxid: null,
    tid: null,
    approved_at: APPROVED_AT,
    matched_payment_id: null,
    raw_payload: null,
    ...overrides,
  };
}

function crmPay(overrides: Partial<CrmPayment>): CrmPayment {
  return {
    id: "pay-1",
    clinic_id: "clinic-1",
    amount: 120000,
    method: "card",
    payment_type: "payment",
    created_at: "2026-07-29T01:05:00.000Z",
    external_trxid: null,
    external_approval_no: null,
    external_tid: null,
    reconciled_at: null,
    ...overrides,
  };
}

// ── (c) bare trxid auto-link 소멸 — 종전 ① trxid-exact 단독 가지 폐기 증명 ──────────
Deno.test("(c1): trxid 만 있고 corroborate 불가 → tier0 auto-link 0 (bare trxid-exact 소멸)", () => {
  // raw 는 trxid 만 보유(approval_no/tid null). CRM 후보는 amount/card/same-day 충족하나
  // 매칭풀 불변식상 external_trxid IS NULL → trxidCorroborates 발화 불가 → tier0 후보 0.
  const raw = rawRow({ external_trxid: "28226869", approval_no: null, tid: null, amount: 100000 });
  const payments = [
    crmPay({ id: "p1", amount: 100000, external_trxid: null, external_approval_no: null, external_tid: null }),
  ];
  assertEquals(findTier0Direct(raw, payments).length, 0, "bare trxid → tier0 발화 불가(하위 Tier 로 강등)");
});

Deno.test("(c2): composite 4조건(식별자·amount·card·payment) 전부 요구 — 하나라도 불충족 시 배제", () => {
  const raw = rawRow({ external_trxid: "T1", approval_no: "APP1", tid: "TID1", amount: 100000 });
  // approval_no 는 corroborate 하지만 method=cash → 배제 (card 필수)
  const cashPay = crmPay({ id: "pCash", amount: 100000, method: "cash", external_approval_no: "APP1" });
  assertEquals(findTier0Direct(raw, [cashPay]).length, 0, "method!=card → tier0 배제");
  // payment_type=refund → 배제
  const refundPay = crmPay({ id: "pRef", amount: 100000, payment_type: "refund", external_approval_no: "APP1" });
  assertEquals(findTier0Direct(raw, [refundPay]).length, 0, "payment_type!=payment → tier0 배제");
  // amount 불일치 → 배제
  const wrongAmt = crmPay({ id: "pAmt", amount: 999999, external_approval_no: "APP1" });
  assertEquals(findTier0Direct(raw, [wrongAmt]).length, 0, "amount 불일치 → tier0 배제");
});

// ── (b) 단형 재사용 trxid — shared trxid 가 false-merge 를 만들지 않음 ──────────────
Deno.test("(b1): 동일 trxid·상이 amount 2거래 → amount 대조로 각자 정답만(오링크 0)", () => {
  const REUSE = "12345678"; // 단형(8자) 재사용 trxid
  const rawBig = rawRow({ id: "rawBig", external_trxid: REUSE, approval_no: "AP_BIG", tid: "TID_BIG", amount: 500000 });
  const rawSml = rawRow({ id: "rawSml", external_trxid: REUSE, approval_no: "AP_SML", tid: "TID_SML", amount: 30000 });
  const pBig = crmPay({ id: "pBig", amount: 500000, external_approval_no: "AP_BIG", external_tid: "TID_BIG", created_at: "2026-07-29T01:03:00.000Z" });
  const pSml = crmPay({ id: "pSml", amount: 30000, external_approval_no: "AP_SML", external_tid: "TID_SML", created_at: "2026-07-29T01:04:00.000Z" });
  const hitsBig = findTier0Direct(rawBig, [pBig, pSml]);
  assertEquals(hitsBig.length, 1, "shared trxid 여도 amount+식별자로 단일 정답");
  assertEquals(hitsBig[0].id, "pBig");
  const hitsSml = findTier0Direct(rawSml, [pBig, pSml]);
  assertEquals(hitsSml.length, 1);
  assertEquals(hitsSml[0].id, "pSml");
});

Deno.test("(b2): 동일 trxid·동일 amount·corroborator 부재 → tier0 auto-link 0 (false-merge 방지)", () => {
  const REUSE = "12345678";
  const raw = rawRow({ external_trxid: REUSE, approval_no: null, tid: null, amount: 50000 });
  // 두 CRM 결제 모두 amount/card/same-day 충족하나 식별자 corroborate 불가(external_* null)
  const p1 = crmPay({ id: "p1", amount: 50000, created_at: "2026-07-29T01:02:00.000Z" });
  const p2 = crmPay({ id: "p2", amount: 50000, created_at: "2026-07-29T01:03:00.000Z" });
  assertEquals(findTier0Direct(raw, [p1, p2]).length, 0, "재사용 trxid 로 bare 오토링크 절대 없음");
});

// ── (a) 8자형 승인/취소 shared trxid — 각각 독립 처리(2행 유지)·오링크 0 ─────────────
Deno.test("(a): 8자형 shared trxid 승인/취소 → cancel 은 매칭 제외, 승인만 매칭(2행 붕괴 없음)", () => {
  const SHARED = "28226869"; // §1 census 실제 예 — 승인 +968,000 / 취소 −968,000 동일 trxid
  const approvedPay = crmPay({ id: "pApp", amount: 968000, external_approval_no: "APP_X", created_at: "2026-07-29T01:02:00.000Z" });

  // 승인(Y, +) — 정상 매칭 시도
  const rawApprove = rawRow({ id: "rawY", external_trxid: SHARED, external_status: "Y", amount: 968000, approval_no: "APP_X" });
  const resY = matchTransaction(rawApprove, [approvedPay], new Set());
  assertEquals(resY.matched, true, "승인건은 정상 매칭");
  assertEquals(resY.payment_id, "pApp");

  // 취소(N, −) — 동일 trxid 이나 매칭 제외(환불은 detectRefundNotInCrm 별도 경로)
  const rawCancel = rawRow({ id: "rawN", external_trxid: SHARED, external_status: "N", amount: -968000, approval_no: "APP_X", root_trxid: SHARED });
  const resN = matchTransaction(rawCancel, [approvedPay], new Set());
  assertEquals(resN.matched, false, "취소건은 자동매칭 제외(status N)");
  assertEquals(resN.match_rule, null);
  assertEquals(resN.needs_manual, false, "취소는 수동큐도 아님 — 환불추적으로 분리");
});

// ── (d) refund root disambiguate — 부호 + |amount| + 시각 ─────────────────────────
const CH = "#test-alert";
function reconciledPay(overrides: Partial<CrmPayment>): CrmPayment {
  return crmPay({
    external_trxid: "REUSE",
    reconciled_at: "2026-07-29T00:50:00.000Z",
    amount: 968000,
    created_at: "2026-07-29T00:50:00.000Z",
    ...overrides,
  });
}
function refundRaw(overrides: Partial<RawTransaction>): RawTransaction {
  return rawRow({
    external_status: "N",
    external_trxid: "REUSE",
    root_trxid: "REUSE",
    amount: -968000,
    approved_at: "2026-07-29T01:00:00.000Z",
    ...overrides,
  });
}

Deno.test("(d1): |amount| 불일치 원거래 후보는 배제 — 정답만 매칭", () => {
  const good = reconciledPay({ id: "pGood", amount: 968000 });
  const wrongAmt = reconciledPay({ id: "pWrong", amount: 500000 });
  const evt = detectRefundNotInCrm(refundRaw({}), [good, wrongAmt], CH);
  assert(evt !== null, "환불 미반영 이벤트 발생");
  assertEquals(evt!.payment_id, "pGood", "|amount| 동일 원거래만 매칭");
});

Deno.test("(d2): 같은 부호(환불과 동일 −) 후보 배제 — 반대부호만 원거래", () => {
  const sameSign = reconciledPay({ id: "pNeg", amount: -968000 }); // 환불과 동일 부호
  const evt = detectRefundNotInCrm(refundRaw({}), [sameSign], CH);
  assertEquals(evt, null, "반대부호 아님 → 원거래 아님 → 이벤트 없음");
});

Deno.test("(d3): 시각순서 위반(원거래가 환불보다 나중) 후보 배제", () => {
  const after = reconciledPay({ id: "pAfter", created_at: "2026-07-29T02:00:00.000Z" }); // 환불(01:00) 이후
  const evt = detectRefundNotInCrm(refundRaw({}), [after], CH);
  assertEquals(evt, null, "원거래.created_at > 환불.approved_at → 배제");
});

Deno.test("(d4): 동일 trxid 재사용 원거래 다수 → 최근접-직전 tiebreak", () => {
  const near = reconciledPay({ id: "pNear", created_at: "2026-07-29T00:58:00.000Z" }); // −2min
  const far = reconciledPay({ id: "pFar", created_at: "2026-07-29T00:40:00.000Z" });  // −20min
  const evt = detectRefundNotInCrm(refundRaw({}), [far, near], CH);
  assert(evt !== null);
  assertEquals(evt!.payment_id, "pNear", "환불 시각에 가장 근접한 직전 원거래 선택");
});

Deno.test("(d5): 동률 시각(모호) → 수동(payment_id null, 오원거래 오링크 금지)", () => {
  const SAME = "2026-07-29T00:55:00.000Z";
  const p1 = reconciledPay({ id: "p1", created_at: SAME });
  const p2 = reconciledPay({ id: "p2", created_at: SAME });
  const evt = detectRefundNotInCrm(refundRaw({}), [p1, p2], CH);
  assert(evt !== null, "이벤트는 발생(취소 자체는 surface)");
  assertEquals(evt!.payment_id, null, "동률 모호 → 어느 원거래에도 오링크 금지");
  assert(evt!.mismatch_reason?.includes("모호"), "수동 확인 사유 명시");
});

Deno.test("(d6): root_trxid 단독으로는 매칭하지 않음 — 부호·금액·시각 전부 요구(REJECT bare)", () => {
  // 동일 trxid 이나 |amount| 다르고 부호 같은 후보만 존재 → 종전(단독) 이면 매칭됐을 것을 REJECT.
  const bareOnly = reconciledPay({ id: "pBare", amount: -111, created_at: "2026-07-29T02:00:00.000Z" });
  const evt = detectRefundNotInCrm(refundRaw({}), [bareOnly], CH);
  assertEquals(evt, null, "trxid 일치만으로는 원거래 확정 금지(bare root_trxid REJECT)");
});
