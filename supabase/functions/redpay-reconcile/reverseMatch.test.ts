// reverseMatch.test.ts — 역방향 매칭([수납] 저장 훅) 순수 로직 단위테스트
// ════════════════════════════════════════════════════════════════════════════════
// T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD
//   실행: deno test supabase/functions/redpay-reconcile/reverseMatch.test.ts
//
// 고정하는 불변식(DA 착수 AC / E-1·E-2):
//   · 유효창(10분) 닫힌구간 경계 · 승인만(external_status='Y') · 금액 완전일치 · 같은금액 2건+ 모호 스킵
//   · raw.id 앵커(단독 유일키, trxid 단독 금지) · 매출-일자 앵커=approved_at KST · 카드 payment 만 대상
//   · annotate payload shape-parity(matcher.buildMatchedPaymentUpdate) + NULL 덮어쓰기 금지(멱등)

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  REVERSE_MATCH_WINDOW_MS,
  REVERSE_MATCH_RETENTION_MS,
  REVERSE_MATCH_RULE,
  REVERSE_MATCH_EVENT_TYPE,
  isApprovedReverseRaw,
  isObserveRaw,
  isWithinReverseWindow,
  anchorAccountingDateKst,
  selectReverseMatchCandidate,
  buildReverseMatchPaymentUpdate,
  buildReverseClaimUpdate,
  buildReverseClaimRollback,
  buildReverseReconLogRow,
  type ReverseRaw,
  type SavedPayment,
} from "./reverseMatch.ts";

const CLINIC = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-07-30T05:00:00.000Z"); // 기준 저장시각

function raw(over: Partial<ReverseRaw> = {}): ReverseRaw {
  return {
    id: "raw-1",
    clinic_id: CLINIC,
    amount: 50000,
    approved_at: "2026-07-30T04:57:00.000Z", // NOW - 3분 (창 내)
    external_status: "Y",
    matched_payment_id: null,
    external_trxid: "TRX-1",
    approval_no: "APPR-1",
    tid: "TID-1",
    ...over,
  };
}

function payment(over: Partial<SavedPayment> = {}): SavedPayment {
  return {
    id: "pay-1",
    clinic_id: CLINIC,
    amount: 50000,
    method: "card",
    payment_type: "payment",
    created_at: "2026-07-30T05:00:00.000Z",
    ...over,
  };
}

// ── isApprovedReverseRaw (E-2 ①) ────────────────────────────────────────────────
Deno.test("승인 raw만 후보 — external_status='Y' 1급 게이트", () => {
  assert(isApprovedReverseRaw(raw()));
  assertFalse(isApprovedReverseRaw(raw({ external_status: "N" }))); // 취소
  assertFalse(isApprovedReverseRaw(raw({ external_status: "M" }))); // 부분취소
  assertFalse(isApprovedReverseRaw(raw({ external_status: "X" }))); // 오류
  assertFalse(isApprovedReverseRaw(raw({ approved_at: null })));    // 승인시각 부재
  assertFalse(isApprovedReverseRaw(raw({ amount: 0 })));            // amount>0 필수
});

Deno.test("취소 raw는 approved_at 세팅돼 있어도 제외(결제후즉시취소 오연결 차단)", () => {
  assertFalse(isApprovedReverseRaw(raw({ external_status: "N", approved_at: "2026-07-30T04:59:00.000Z" })));
});

Deno.test("observe-mode 적재행은 후보 제외", () => {
  assert(isObserveRaw({ raw_payload: { _mode: "observe" } }));
  assertFalse(isObserveRaw({ raw_payload: { _mode: "auto" } }));
  assertFalse(isObserveRaw({ raw_payload: null }));
  assertFalse(isApprovedReverseRaw(raw({ raw_payload: { _mode: "observe" } })));
});

// ── isWithinReverseWindow (E-1 · 닫힌구간 경계) ──────────────────────────────────
Deno.test("유효창 = [now-10분, now] 닫힌구간", () => {
  assertEquals(REVERSE_MATCH_WINDOW_MS, 10 * 60 * 1000);
  // 창 내부
  assert(isWithinReverseWindow("2026-07-30T04:57:00.000Z", NOW)); // -3분
  // 경계(정확히 10분 전) 포함
  assert(isWithinReverseWindow(new Date(NOW - REVERSE_MATCH_WINDOW_MS).toISOString(), NOW));
  // 경계(now) 포함
  assert(isWithinReverseWindow(new Date(NOW).toISOString(), NOW));
  // 창 밖(10분 1초 초과) 제외
  assertFalse(isWithinReverseWindow(new Date(NOW - REVERSE_MATCH_WINDOW_MS - 1000).toISOString(), NOW));
  // 미래 승인(now 이후) 제외 — forward 방향 위배
  assertFalse(isWithinReverseWindow(new Date(NOW + 1000).toISOString(), NOW));
  assertFalse(isWithinReverseWindow(null, NOW));
});

// ── anchorAccountingDateKst (AC4) ────────────────────────────────────────────────
Deno.test("매출-일자 앵커 = approved_at의 KST 일자(감지·저장 시각 아님)", () => {
  // UTC 15:00 = KST 익일 00:00 → 일경계 drift 케이스(본건 최중요)
  assertEquals(anchorAccountingDateKst("2026-07-29T15:30:00.000Z"), "2026-07-30");
  assertEquals(anchorAccountingDateKst("2026-07-30T04:57:00.000Z"), "2026-07-30");
  // UTC 14:59:59 = KST 23:59:59 (전일)
  assertEquals(anchorAccountingDateKst("2026-07-29T14:59:59.000Z"), "2026-07-29");
});

// ── selectReverseMatchCandidate (AC1·AC6·E-2) ────────────────────────────────────
Deno.test("정상 자동연결 — 단일 승인·동금액·창내 후보 1건", () => {
  const d = selectReverseMatchCandidate(payment(), [raw()], NOW);
  assertEquals(d.reason, "matched");
  assertEquals(d.raw?.id, "raw-1");
  assertEquals(d.candidateCount, 1);
});

Deno.test("no-op — 후보 없음(창 밖)", () => {
  const old = raw({ approved_at: new Date(NOW - 20 * 60 * 1000).toISOString() }); // 20분 전(창 밖)
  const d = selectReverseMatchCandidate(payment(), [old], NOW);
  assertEquals(d.reason, "no_candidate");
  assertEquals(d.raw, null);
});

Deno.test("no-op — 금액 불일치", () => {
  const d = selectReverseMatchCandidate(payment({ amount: 60000 }), [raw({ amount: 50000 })], NOW);
  assertEquals(d.reason, "no_candidate");
});

Deno.test("no-op — 다른 clinic", () => {
  const d = selectReverseMatchCandidate(payment(), [raw({ clinic_id: "22222222-2222-2222-2222-222222222222" })], NOW);
  assertEquals(d.reason, "no_candidate");
});

Deno.test("모호 스킵(E-2 ③) — 같은금액 창내 승인 후보 2건+ → ambiguous_multi", () => {
  const d = selectReverseMatchCandidate(
    payment(),
    [raw({ id: "raw-1" }), raw({ id: "raw-2", external_trxid: "TRX-2" })],
    NOW,
  );
  assertEquals(d.reason, "ambiguous_multi");
  assertEquals(d.raw, null);
  assertEquals(d.candidateCount, 2);
});

Deno.test("비대상 결제 — 현금/이체/멤버십·환불은 not_card_payment(no-op)", () => {
  assertEquals(selectReverseMatchCandidate(payment({ method: "cash" }), [raw()], NOW).reason, "not_card_payment");
  assertEquals(selectReverseMatchCandidate(payment({ method: "transfer" }), [raw()], NOW).reason, "not_card_payment");
  assertEquals(selectReverseMatchCandidate(payment({ payment_type: "refund" }), [raw()], NOW).reason, "not_card_payment");
});

Deno.test("이미 매칭된 raw(matched_payment_id≠NULL)는 후보 제외", () => {
  const d = selectReverseMatchCandidate(payment(), [raw({ matched_payment_id: "pay-x" })], NOW);
  assertEquals(d.reason, "no_candidate");
});

Deno.test("멱등(E-2 ④) — used 집합의 raw.id는 재사용 금지(배치 이중매칭 방지)", () => {
  const used = new Set<string>(["raw-1"]);
  const d = selectReverseMatchCandidate(payment(), [raw({ id: "raw-1" })], NOW, used);
  assertEquals(d.reason, "no_candidate"); // raw.id 소비됨 → 후보 아님(trxid 아닌 raw.id 앵커)
});

Deno.test("nowMs 미지정 시 payment.created_at을 기준시각으로 사용", () => {
  const p = payment({ created_at: "2026-07-30T05:00:00.000Z" });
  const d = selectReverseMatchCandidate(p, [raw()]); // nowMs 생략
  assertEquals(d.reason, "matched");
});

// ── buildReverseMatchPaymentUpdate (AC2·AC4·Model A ② · 멱등) ─────────────────────
Deno.test("annotate payload — shape-parity + external_tid 포함, method/amount 무접촉", () => {
  const p = buildReverseMatchPaymentUpdate(raw(), "2026-07-30T05:00:00.000Z");
  assertEquals(p.reconciled_at, "2026-07-30T05:00:00.000Z");
  assertEquals(p.external_status, "Y");
  assertEquals(p.external_trxid, "TRX-1");
  assertEquals(p.external_approval_no, "APPR-1");
  assertEquals(p.external_tid, "TID-1");
  // 매출·매칭 predicate 필드 무접촉(populate 만)
  assertFalse("method" in p);
  assertFalse("amount" in p);
  assertFalse("payment_type" in p);
  // accounting_date 는 기본 미포함(SSOT confirm 게이트)
  assertFalse("accounting_date" in p);
});

Deno.test("annotate payload — raw 원천 값 부재 시 키 생략(NULL 덮어쓰기 금지, 멱등)", () => {
  const p = buildReverseMatchPaymentUpdate(
    raw({ approval_no: null, tid: null, external_trxid: null }),
    "2026-07-30T05:00:00.000Z",
  );
  assertFalse("external_approval_no" in p);
  assertFalse("external_tid" in p);
  assertFalse("external_trxid" in p);
  assertEquals(p.reconciled_at, "2026-07-30T05:00:00.000Z"); // 항상 stamp
  assertEquals(p.external_status, "Y");
});

Deno.test("annotate payload — includeAccountingDate=true 시 AC4 앵커일자 stamp", () => {
  const p = buildReverseMatchPaymentUpdate(
    raw({ approved_at: "2026-07-29T15:30:00.000Z" }),
    "2026-07-30T05:00:00.000Z",
    true,
  );
  assertEquals(p.accounting_date, "2026-07-30"); // approved_at KST 일자(감지시각 아님)
});

// ── write-path 오케스트레이션 helper (D1~D3) ─────────────────────────────────────
Deno.test("D1 claim payload — matched_payment_id + match_rule='reverse_susu_hook'", () => {
  assertEquals(REVERSE_MATCH_RULE, "reverse_susu_hook");
  const c = buildReverseClaimUpdate("pay-99");
  assertEquals(c.matched_payment_id, "pay-99");
  assertEquals(c.match_rule, "reverse_susu_hook"); // forward tier0~4 와 분리(provenance)
});

Deno.test("D2 rollback payload — raw 링크만 원복(payment 삭제 필드 없음)", () => {
  const rb = buildReverseClaimRollback();
  assertEquals(rb.matched_payment_id, null);
  assertEquals(rb.match_rule, null);
  // ★payment 를 지우거나 amount/method 를 건드리는 키가 절대 없어야 함(D2 annotate-on-existing).
  assertEquals(Object.keys(rb).sort(), ["match_rule", "matched_payment_id"]);
});

Deno.test("AC8 reconlog row — event_type='reverse_matched'(신규 값) + shape parity", () => {
  assertEquals(REVERSE_MATCH_EVENT_TYPE, "reverse_matched");
  const row = buildReverseReconLogRow(
    raw({ id: "raw-7", clinic_id: CLINIC, amount: 50000, external_trxid: "TRX-7" }),
    payment({ id: "pay-7", amount: 50000 }),
  );
  assertEquals(row.event_type, "reverse_matched");   // auto_matched/manual_matched 와 3-provenance 분리
  assertEquals(row.match_rule, "reverse_susu_hook");
  assertEquals(row.raw_transaction_id, "raw-7");
  assertEquals(row.payment_id, "pay-7");
  assertEquals(row.external_amount, 50000);
  assertEquals(row.crm_amount, 50000);
  assertEquals(row.center, "foot");                  // center NOT NULL 폴백(멀티센터 스코핑)
  assertEquals(row.mismatch_reason, null);
});

Deno.test("E-1 (b) 보관창 상수 = 1h(유효창 10분과 별개 축)", () => {
  assertEquals(REVERSE_MATCH_RETENTION_MS, 60 * 60 * 1000);
  assertEquals(REVERSE_MATCH_WINDOW_MS, 10 * 60 * 1000);
  // 보관창(후보 pool 조회창) > 유효창(자동대조 신뢰창) — 목적 상이(E-1 2축 분리).
  assert(REVERSE_MATCH_RETENTION_MS > REVERSE_MATCH_WINDOW_MS);
});
