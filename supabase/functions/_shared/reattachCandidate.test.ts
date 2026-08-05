// reattachCandidate.test.ts — 승인번호-NULL 수기수납 재부착 '후보검색만' 순수 로직 전수검증
// deno test 대상 (T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCaseBReceipt,
  isEligibleCandidateRaw,
  kstDateStr,
  receiptAccountingDate,
  selectReattachCandidates,
  validateConfirmPair,
  type CandidateRaw,
  type ManualReceiptRow,
} from "./reattachCandidate.ts";

const CLINIC = "clinic-foot-1";

function receipt(overrides: Partial<ManualReceiptRow> = {}): ManualReceiptRow {
  return {
    id: "pay-1",
    clinic_id: CLINIC,
    amount: 10000,
    method: "card",
    payment_type: "payment",
    status: "active",
    deleted_at: null,
    external_approval_no: null,
    payment_attempt_id: null,
    reconciled_at: null,
    accounting_date: "2026-08-04",
    created_at: "2026-08-04T01:00:00.000Z",
    ...overrides,
  };
}

function raw(overrides: Partial<CandidateRaw> = {}): CandidateRaw {
  return {
    id: "raw-1",
    clinic_id: CLINIC,
    amount: 10000,
    approved_at: "2026-08-04T02:30:00.000Z", // KST 2026-08-04 11:30
    external_status: "Y",
    matched_payment_id: null,
    approval_no: "30001234",
    external_trxid: "TRX-1",
    tid: "1047479470",
    ...overrides,
  };
}

// ── kstDateStr / receiptAccountingDate ─────────────────────────────────────────
Deno.test("kstDateStr: UTC→KST 달력일 경계(+9h)", () => {
  assertEquals(kstDateStr("2026-08-04T14:59:00.000Z"), "2026-08-04"); // KST 23:59
  assertEquals(kstDateStr("2026-08-04T15:00:00.000Z"), "2026-08-05"); // KST 익일 00:00
  assertEquals(kstDateStr(null), null);
});

Deno.test("receiptAccountingDate: accounting_date 우선, 없으면 created_at KST 폴백", () => {
  assertEquals(receiptAccountingDate(receipt({ accounting_date: "2026-08-01" })), "2026-08-01");
  assertEquals(
    receiptAccountingDate(receipt({ accounting_date: null, created_at: "2026-08-04T15:30:00.000Z" })),
    "2026-08-05",
  );
});

// ── Case B 판별 ────────────────────────────────────────────────────────────────
Deno.test("isCaseBReceipt: 승인번호 NULL·non-CAT·미대사 카드수납 = Case B", () => {
  assertEquals(isCaseBReceipt(receipt()), true);
});

Deno.test("isCaseBReceipt: 승인번호 有 = Case A(제외)", () => {
  assertEquals(isCaseBReceipt(receipt({ external_approval_no: "30009999" })), false);
});

Deno.test("isCaseBReceipt: CAT-origin(payment_attempt_id 有) 제외", () => {
  assertEquals(isCaseBReceipt(receipt({ payment_attempt_id: "att-1" })), false);
});

Deno.test("isCaseBReceipt: 이미 대사(reconciled_at 有) 제외", () => {
  assertEquals(isCaseBReceipt(receipt({ reconciled_at: "2026-08-04T05:00:00.000Z" })), false);
});

Deno.test("isCaseBReceipt: 카드 아님/환불/삭제 제외", () => {
  assertEquals(isCaseBReceipt(receipt({ method: "cash" })), false);
  assertEquals(isCaseBReceipt(receipt({ payment_type: "refund" })), false);
  assertEquals(isCaseBReceipt(receipt({ deleted_at: "2026-08-04T06:00:00.000Z" })), false);
});

// ── 후보 raw 자격 ──────────────────────────────────────────────────────────────
Deno.test("isEligibleCandidateRaw: 승인+승인번호+미매칭 = 자격", () => {
  assertEquals(isEligibleCandidateRaw(raw()), true);
});

Deno.test("isEligibleCandidateRaw: 승인번호 NULL/공백 제외(채울 값이 없음)", () => {
  assertEquals(isEligibleCandidateRaw(raw({ approval_no: null })), false);
  assertEquals(isEligibleCandidateRaw(raw({ approval_no: "   " })), false);
});

Deno.test("isEligibleCandidateRaw: 취소(N)·이미매칭·observe 제외", () => {
  assertEquals(isEligibleCandidateRaw(raw({ external_status: "N" })), false);
  assertEquals(isEligibleCandidateRaw(raw({ matched_payment_id: "pay-x" })), false);
  assertEquals(isEligibleCandidateRaw(raw({ raw_payload: { _mode: "observe" } })), false);
});

// ── 후보검색(candidate-only) ───────────────────────────────────────────────────
Deno.test("selectReattachCandidates: 금액+일자 일치 후보 반환", () => {
  const out = selectReattachCandidates(receipt(), [raw()]);
  assertEquals(out.map((r) => r.id), ["raw-1"]);
});

Deno.test("selectReattachCandidates: ★후보 1건이어도 자동확정하지 않고 목록으로만 반환(candidate-only 핵심)", () => {
  // reverseMatch 는 1건이면 auto-pick 하지만, 본 함수는 '선택'하지 않고 후보 배열을 그대로 노출한다.
  const out = selectReattachCandidates(receipt(), [raw()]);
  assertEquals(out.length, 1); // 반환은 후보 목록 — 호출부가 auto-write 하지 않음(사람 confirm 전용).
});

Deno.test("selectReattachCandidates: 동일 금액 하루 다건(오탐 방지) — 복수 후보 전부 나열, 자동확정 없음", () => {
  const raws = [
    raw({ id: "raw-a", approved_at: "2026-08-04T02:00:00.000Z", approval_no: "30001111" }),
    raw({ id: "raw-b", approved_at: "2026-08-04T03:00:00.000Z", approval_no: "30002222" }),
    raw({ id: "raw-c", approved_at: "2026-08-04T04:00:00.000Z", approval_no: "30003333" }),
  ];
  const out = selectReattachCandidates(receipt(), raws);
  // 3건 모두 후보로 나열(자동으로 아무 건에도 안 붙음) + 승인시각 asc 정렬.
  assertEquals(out.map((r) => r.id), ["raw-a", "raw-b", "raw-c"]);
});

Deno.test("selectReattachCandidates: 다른 금액/다른 일자/다른 clinic 제외", () => {
  const raws = [
    raw({ id: "diff-amt", amount: 20000 }),
    raw({ id: "diff-day", approved_at: "2026-08-05T02:30:00.000Z" }),
    raw({ id: "diff-clinic", clinic_id: "clinic-foot-2" }),
  ];
  assertEquals(selectReattachCandidates(receipt(), raws), []);
});

Deno.test("selectReattachCandidates: 후보 0건 = 빈 배열('후보 없음', 신규 생성 금지)", () => {
  assertEquals(selectReattachCandidates(receipt(), []), []);
});

// ── confirm 재검증(오연결 차단) ────────────────────────────────────────────────
Deno.test("validateConfirmPair: 유효 후보 raw_id → 그 raw 반환", () => {
  const chosen = validateConfirmPair(receipt(), "raw-1", [raw()]);
  assertEquals(chosen?.id, "raw-1");
});

Deno.test("validateConfirmPair: 후보 집합에 없는 raw_id → null(fabricate 차단)", () => {
  assertEquals(validateConfirmPair(receipt(), "raw-unknown", [raw()]), null);
});

Deno.test("validateConfirmPair: receipt 가 Case A(승인번호 有)면 confirm 거부", () => {
  assertEquals(
    validateConfirmPair(receipt({ external_approval_no: "30009999" }), "raw-1", [raw()]),
    null,
  );
});
