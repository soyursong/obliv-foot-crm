// redpay-reconcile/tier0-hardening.regress.test.ts — Tier0 3단 캐스케이드 회귀 고정
//
// T-20260728-foot-REDPAY-RECONCILE-TIER0-TRXID-HARDENING (e2e_spec_exempt=ef_only, change-class=no-DDL)
//   DA CONSULT-REPLY: GO (SSOT=da_decision_foot_redpay_reconcile_tier0_trxid_hardening_20260728.md)
//   GO 조건②(regression unit test): 아래 4축을 순수 술어로 영구 고정한다.
//     (1) bare approval_no 단독 auto-link 소멸
//     (2) bare tid 단독 auto-link 소멸
//     (3) composite Model A — approval_no ∧ amount ∧ tid ∧ approved_at 윈도 4조건 전부 요구
//     (4) refund root_trxid 체이닝 무영향 (predicate 변경 ↔ 취소링크 무접점)
//   추가: trxid-exact 가지는 현 데이터에서 inert(발화 안 함)임을 고정.
//   실행: deno test supabase/functions/redpay-reconcile/tier0-hardening.regress.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findTier0Direct,
  matchTransaction,
  detectRefundNotInCrm,
  TIER1_WINDOW_MS,
  type RawTransaction,
  type CrmPayment,
} from "./matcher.ts";

const APPROVED_AT = "2026-07-28T01:00:00.000Z";
const IN_WINDOW   = "2026-07-28T01:05:00.000Z";                 // approved_at + 5min (윈도 내)
const OUT_WINDOW  = "2026-07-28T01:20:00.000Z";                 // approved_at + 20min (윈도 밖)

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

// ── (1) bare approval_no 단독 auto-link 소멸 ─────────────────────────────────
Deno.test("bare approval_no 단독으로는 tier0 매칭되지 않는다", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  // CRM 에 approval_no 만 일치, tid/amount/윈도 불충족 (tid null)
  const p = crmPay({ external_approval_no: "APP123", external_tid: null });
  const hits = findTier0Direct(raw, [p]);
  assertEquals(hits.length, 0, "approval_no 단독 일치는 auto-link 금지");
});

// ── (2) bare tid 단독 auto-link 소멸 ─────────────────────────────────────────
Deno.test("bare tid 단독으로는 tier0 매칭되지 않는다", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A" });
  // CRM 에 tid 만 일치, approval_no null
  const p = crmPay({ external_approval_no: null, external_tid: "TID-A" });
  const hits = findTier0Direct(raw, [p]);
  assertEquals(hits.length, 0, "tid 단독 일치는 auto-link 금지");
});

// ── (3) composite Model A — 4조건 전부 요구 ──────────────────────────────────
Deno.test("composite: 4조건 전부 충족 시에만 매칭", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A", amount: 120000 });
  const full = crmPay({
    external_approval_no: "APP123",
    external_tid: "TID-A",
    amount: 120000,
    created_at: IN_WINDOW,
  });
  const hits = findTier0Direct(raw, [full]);
  assertEquals(hits.length, 1, "4조건 전부 충족 → composite 매칭 1건");
  assertEquals(hits[0].id, full.id);
});

Deno.test("composite: 4조건 중 하나라도 불충족이면 매칭 안 됨", () => {
  const raw = rawRow({ approval_no: "APP123", tid: "TID-A", amount: 120000 });
  const base = {
    external_approval_no: "APP123",
    external_tid: "TID-A",
    amount: 120000,
    created_at: IN_WINDOW,
  };
  // tid 불일치
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, external_tid: "TID-B" })]).length, 0, "tid 불일치");
  // approval_no 불일치
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, external_approval_no: "APP999" })]).length, 0, "approval_no 불일치");
  // amount 불일치
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, amount: 130000 })]).length, 0, "amount 불일치");
  // approved_at 윈도 밖 (+20min)
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, created_at: OUT_WINDOW })]).length, 0, "윈도 밖");
});

Deno.test("composite: 윈도는 기존 Tier1 forward [approved_at, +15min] 재사용 (신규 윈도 발명 없음)", () => {
  const raw = rawRow({ approved_at: APPROVED_AT });
  const approvedMs = new Date(APPROVED_AT).getTime();
  const base = { external_approval_no: raw.approval_no!, external_tid: raw.tid!, amount: raw.amount };
  // 정확히 경계(+15min) 는 포함, 그 1ms 뒤는 배제
  const atBoundary = new Date(approvedMs + TIER1_WINDOW_MS).toISOString();
  const pastBoundary = new Date(approvedMs + TIER1_WINDOW_MS + 1).toISOString();
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, created_at: atBoundary })]).length, 1, "경계 포함");
  assertEquals(findTier0Direct(raw, [crmPay({ ...base, created_at: pastBoundary })]).length, 0, "경계 초과 배제");
});

Deno.test("composite: approved_at 없으면 매칭 안 됨(윈도 판정 불가)", () => {
  const raw = rawRow({ approved_at: null });
  const p = crmPay({ external_approval_no: raw.approval_no!, external_tid: raw.tid! });
  assertEquals(findTier0Direct(raw, [p]).length, 0);
});

// ── trxid-exact 가지: 현 데이터에서 inert (발화 안 함) ────────────────────────
Deno.test("trxid-exact 가지는 현 데이터에서 inert — external_trxid 채워진 payment 는 isUnmatchedCrm 실패", () => {
  const raw = rawRow({ external_trxid: "TRX-RAW-1" });
  // p.external_trxid 가 채워지면 isUnmatchedCrm(external_trxid===null 요구) 실패 → 후보 아님
  const p = crmPay({ external_trxid: "TRX-RAW-1" });
  const hits = findTier0Direct(raw, [p]);
  assertEquals(hits.length, 0, "trxid 채워진 payment 는 매칭 후보에서 제외(inert)");
});

Deno.test("trxid-exact 가지: 미래 direct-capture 시맨틱 존재 확인 — trxid 일치 predicate 자체는 코드에 있음", () => {
  // isUnmatchedCrm 을 우회할 수 없으므로 실제 매칭은 inert 이나,
  // raw.external_trxid 없는 경우 trxid 가지를 건너뛰고 composite 로 진행하는지만 확인.
  const raw = rawRow({ external_trxid: "", approval_no: "APP123", tid: "TID-A" });
  const full = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", amount: 120000, created_at: IN_WINDOW });
  assertEquals(findTier0Direct(raw, [full]).length, 1, "trxid 없으면 composite 로 폴백");
});

// ── (4) refund root_trxid 체이닝 무영향 ──────────────────────────────────────
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

Deno.test("refund_not_in_crm 는 root_trxid/external_trxid 체이닝 — approval_no 미사용, 하드닝 무영향", () => {
  const cancelRaw = rawRow({
    external_status: "N",
    root_trxid: "TRX-ORIG-1",
    external_trxid: "TRX-CANCEL-1",
    approval_no: "APP-DIFFERENT", // approval_no 가 달라도 링크는 trxid 로 성립해야 함
  });
  const original = crmPay({
    id: "pay-orig",
    external_trxid: "TRX-ORIG-1",
    payment_type: "payment",
    reconciled_at: "2026-07-28T00:50:00.000Z",
    external_approval_no: "APP-ORIG",
  });
  const evt = detectRefundNotInCrm(cancelRaw, [original], "#chan");
  assert(evt !== null, "root_trxid 체이닝으로 원거래 탐지");
  assertEquals(evt!.payment_id, "pay-orig", "approval_no 아닌 trxid 로 링크");
  assertEquals(evt!.event_type, "refund_not_in_crm");
});

// ── 235 정상페어 시맨틱 — 정상 결제행(Y)은 composite 로 정상 매칭, refund 경로 보존 ──
Deno.test("정상 승인행(Y)은 composite 충족 시 tier0_direct 로 매칭", () => {
  const raw = rawRow({ external_status: "Y", approval_no: "APP123", tid: "TID-A", amount: 120000 });
  const p = crmPay({ external_approval_no: "APP123", external_tid: "TID-A", amount: 120000, created_at: IN_WINDOW });
  const res = matchTransaction(raw, [p], new Set());
  assert(res.matched);
  assertEquals(res.match_rule, "tier0_direct");
  assertEquals(res.payment_id, p.id);
});
