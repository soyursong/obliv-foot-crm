// redpay-reconcile/tier0-hardening.regress.test.ts — Tier0 단일 composite 회귀 고정
//
// T-20260729-foot-REDPAY-TIER0-COMPOSITE-OR-CARD-SAMEDAY (e2e_spec_exempt=ef_only, change-class=no-DDL)
//   DA CONSULT-REPLY: GO (SSOT=da_reply_foot_redpay_tier0_composite_20260728.md,
//   ticket_id=DA-20260728-REDPAY-TIER0-COMPOSITE). 직전 하드닝(TIER0-TRXID-HARDENING,
//   composite Model A = approval_no ∧ tid ∧ amount ∧ +15min)을 아래로 정합 강화(supersede).
//
//   본 파일이 영구 고정하는 불변식(신 semantics):
//     (1) 식별자 단독(approval_no·tid 어느 쪽이든) auto-link 금지 — amount·card·payment·
//         same-day 와 반드시 AND. 식별자는 corroborator 일 뿐 단독 결정권 없음.
//     (2) 식별자 OR-either — approval_no 또는 tid 중 하나만 corroborate 해도(나머지 조건
//         충족 시) tier0 확정. (직전 AND-both 는 supersede)
//     (3) method=='card' ∧ payment_type=='payment' 필수(Q1) — cash/refund 의 stray
//         식별자로 card raw 오링크 차단.
//     (4) 시각창 = same-KST-day + forward(Q4). 15min 아님 — 지연입력도 same-day 면 tier0.
//         ≥2 후보(충돌)는 approved_at 최근접 tie-break, 동률이면 tier4_manual(오링크 0).
//     (5) trxid-exact ① 가지는 현 데이터에서 inert(발화 안 함) — future-proof.
//     (6) refund root 매칭 = trxid 계열 유지(approval_no 미사용) — [정정 T-20260729
//         TRXID-NONUNIQUE-COMPOSITE-CORRECT Q4] bare root_trxid 단독 REJECT →
//         반대부호 ∧ |amount| 동일 ∧ 원거래(payment·reconciled) ∧ 시각순서 로 STRENGTHEN.
//   실행: deno test supabase/functions/redpay-reconcile/tier0-hardening.regress.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findTier0Direct,
  matchTransaction,
  detectRefundNotInCrm,
  type RawTransaction,
  type CrmPayment,
} from "./matcher.ts";

const APPROVED_AT   = "2026-07-28T01:00:00.000Z"; // KST 10:00 (2026-07-28)
const IN_WINDOW     = "2026-07-28T01:05:00.000Z"; // +5min  (same KST day, forward)
const LATE_SAMEDAY  = "2026-07-28T04:30:00.000Z"; // +3.5h  (>15min but same KST day — Q4 win)
const NEXT_KST_DAY  = "2026-07-28T15:30:00.000Z"; // KST 00:30 익일 (same UTC date, 다음 KST 일)
const BEFORE_APPR   = "2026-07-28T00:55:00.000Z"; // approved_at 이전 (backward — 배제)

function rawRow(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    id: "raw-1",
    clinic_id: "clinic-1",
    external_trxid: "TRX-RAW-1",
    external_status: "Y",
    amount: 120000,
    approval_no: "APP123",
    root_trxid: null,
    tid: "TID-A",
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
    created_at: IN_WINDOW,
    external_trxid: null,
    external_approval_no: null,
    external_tid: null,
    reconciled_at: null,
    ...overrides,
  };
}

// ── (2) OR-either — approval_no 단독 corroboration 으로 tier0 확정 ────────────
Deno.test("OR-either: approval_no 만 corroborate(+amount+card+payment+same-day) → tier0 매칭", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  // CRM 에 approval_no 만 일치, tid 미입력(null) — 나머지 composite 조건 충족
  const p = crmPay({ external_approval_no: "APP123", external_tid: null });
  const hits = findTier0Direct(raw, [p]);
  assertEquals(hits.length, 1, "approval_no corroboration 단독으로 composite 성립");
  assertEquals(hits[0].id, p.id);
});

Deno.test("OR-either: tid 만 corroborate(+amount+card+payment+same-day) → tier0 매칭", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const p = crmPay({ external_approval_no: null, external_tid: "TID-A" });
  const hits = findTier0Direct(raw, [p]);
  assertEquals(hits.length, 1, "tid corroboration 단독으로 composite 성립");
  assertEquals(hits[0].id, p.id);
});

// ── (1) 식별자 단독 auto-link 금지 — 나머지 조건 불충족이면 링크 없음 ──────────
Deno.test("불변식: 식별자 일치해도 amount 불일치면 링크 없음(DOSU-CONTAM 경로 차단)", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A", amount: 120000 });
  const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", amount: 999999 });
  assertEquals(findTier0Direct(raw, [p]).length, 0, "amount 불일치 → 식별자 corroborate 무효");
});

Deno.test("불변식: 식별자 corroborate 전무면 링크 없음", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const p = crmPay({ external_approval_no: "APP999", external_tid: "TID-Z" }); // 둘 다 불일치
  assertEquals(findTier0Direct(raw, [p]).length, 0, "approval_no·tid 둘 다 불일치 → 링크 금지");
});

Deno.test("불변식: raw 에 식별자(approval_no·tid) 둘 다 없으면 composite 미진입", () => {
  const raw = rawRow({ approval_no: null, tid: null });
  const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A" });
  assertEquals(findTier0Direct(raw, [p]).length, 0, "corroborator 부재 → tier0 미발화(하위 Tier 로)");
});

// ── (3) Q1: method/payment_type 필수 — cash/refund stray 식별자 오링크 차단 ────
Deno.test("Q1: cash payment 는 식별자 일치해도 tier0 오링크 안 됨", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const cash = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", method: "cash" });
  assertEquals(findTier0Direct(raw, [cash]).length, 0, "method!=card → 배제");
});

Deno.test("Q1: refund(payment_type) 는 식별자 일치해도 tier0 오링크 안 됨", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const refund = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", payment_type: "refund" });
  assertEquals(findTier0Direct(raw, [refund]).length, 0, "payment_type!=payment → 배제");
});

// ── (4) Q4: same-KST-day + forward. 15min 아님 ───────────────────────────────
Deno.test("Q4: +15min 초과라도 same-KST-day·forward 면 tier0 매칭(지연입력 false-negative 방지)", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const late = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", created_at: LATE_SAMEDAY });
  assertEquals(findTier0Direct(raw, [late]).length, 1, "+3.5h 지연입력도 same-day 면 tier0 확정");
});

Deno.test("Q4: 다음 KST 일 created_at 은 배제(same-day 하드바운드)", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const nextDay = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", created_at: NEXT_KST_DAY });
  assertEquals(findTier0Direct(raw, [nextDay]).length, 0, "다음 KST 일 → 배제");
});

Deno.test("Q4: approved_at 이전(backward) created_at 은 배제(forward-only)", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  const before = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", created_at: BEFORE_APPR });
  assertEquals(findTier0Direct(raw, [before]).length, 0, "approved_at 이전 → 배제");
});

Deno.test("composite: approved_at 없으면 매칭 안 됨(시각창 판정 불가)", () => {
  const raw = rawRow({ approved_at: null });
  const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A" });
  assertEquals(findTier0Direct(raw, [p]).length, 0);
});

// ── (5) trxid-exact ① 가지: 현 데이터에서 inert ──────────────────────────────
Deno.test("trxid-exact 가지는 inert — external_trxid 채워진 payment 는 isUnmatchedCrm 실패", () => {
  const raw = rawRow({ external_trxid: "TRX-RAW-1" });
  const p = crmPay({ external_trxid: "TRX-RAW-1" }); // isUnmatchedCrm(external_trxid===null) 실패
  assertEquals(findTier0Direct(raw, [p]).length, 0, "trxid 채워진 payment 는 후보에서 제외(inert)");
});

Deno.test("trxid 없으면 composite 로 폴백", () => {
  const raw = rawRow({ external_trxid: "", approval_no: "APP123", tid: "TID-A" });
  const full = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", created_at: IN_WINDOW });
  assertEquals(findTier0Direct(raw, [full]).length, 1, "trxid 없으면 composite 진행");
});

// ── (6) refund root_trxid 체이닝 무영향 ──────────────────────────────────────
Deno.test("취소행(N/X/M)은 matchTransaction 진입 前 early-return — predicate 무접점", () => {
  for (const status of ["N", "X", "M"]) {
    const raw = rawRow({ external_status: status });
    const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A" });
    const res = matchTransaction(raw, [p], new Set());
    assertFalse(res.matched, `status=${status} 는 매칭 미진입`);
    assertEquals(res.match_rule, null);
    assertEquals(res.needs_manual, false);
  }
});

Deno.test("refund_not_in_crm 는 trxid 계열(approval_no 미사용) — [Q4 정정] 부호·금액·시각 STRENGTHEN 하 링크", () => {
  // [정정 T-20260729 TRXID-NONUNIQUE-COMPOSITE-CORRECT Q4] bare root_trxid 단독 매칭 REJECT.
  //   여기선 강화된 4조건(반대부호·|amount| 동일·원거래 payment·시각순서)을 모두 충족시켜
  //   trxid 계열 링크가 여전히 성립함을 고정(approval_no 는 여전히 미사용).
  const cancelRaw = rawRow({
    external_status: "N",
    root_trxid: "TRX-ORIG-1",
    external_trxid: "TRX-CANCEL-1",
    approval_no: "APP-DIFFERENT",
    amount: -120000,                     // 취소 = 음수(부호 보존) → 원거래(+)와 반대부호
    approved_at: APPROVED_AT,            // 환불 시각 01:00
  });
  const original = crmPay({
    id: "pay-orig",
    external_trxid: "TRX-ORIG-1",
    amount: 120000,                      // |amount| 동일 · 양수(반대부호)
    payment_type: "payment",
    reconciled_at: "2026-07-28T00:50:00.000Z",
    created_at: "2026-07-28T00:50:00.000Z", // 원거래 ≤ 환불(시각순서)
    external_approval_no: "APP-ORIG",
  });
  const evt = detectRefundNotInCrm(cancelRaw, [original], "#chan");
  assert(evt !== null, "강화조건 충족 → trxid 계열로 원거래 탐지");
  assertEquals(evt!.payment_id, "pay-orig", "approval_no 아닌 trxid 계열로 링크(강화 disambiguate)");
  assertEquals(evt!.event_type, "refund_not_in_crm");
});

// ── 정상 승인행(Y) composite 매칭 (matchTransaction 통합) ─────────────────────
Deno.test("정상 승인행(Y)은 composite 충족 시 tier0_direct 로 매칭", () => {
  const raw = rawRow({ external_status: "Y", approval_no: "APP123", tid: "TID-A", amount: 120000 });
  const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", amount: 120000, created_at: IN_WINDOW });
  const res = matchTransaction(raw, [p], new Set());
  assert(res.matched);
  assertEquals(res.match_rule, "tier0_direct");
  assertEquals(res.payment_id, p.id);
});
