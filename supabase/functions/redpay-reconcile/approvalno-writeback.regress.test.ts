// redpay-reconcile/approvalno-writeback.regress.test.ts — approval_no writeback 회귀 고정
//
// T-20260730-foot-REDPAY-APPROVALNO-WRITEBACK-PAYMENTS
//   DA-20260730-foot-REDPAY-APPROVALNO-WRITEBACK-PAYMENTS (GO — 조건부)
//   SSOT: da_decision_foot_redpay_approvalno_writeback_payments_20260730.md
//
// 근본원인(DIAG-COMPLETE): 매칭 확정 시 index.ts 의 payments UPDATE 가 reconciled_at/
//   external_trxid/external_status 3필드만 승격하고 external_approval_no 를 미승격 →
//   payments.external_approval_no 405건 전건 NULL → 결제내역 화면 '승인번호 없음'.
//   승인번호 자체는 redpay_raw_transactions.approval_no 에 100% 저장·유실0.
//
// 본 파일이 영구 고정하는 불변식(DA 조건):
//   · C1 (원자성): writeback payload 는 reconciled_at + external_trxid 를 external_approval_no 와
//       '동일 객체'로 co-stamp → 단일 UPDATE. external_approval_no 만 별도/선행 write 되는 경로가
//       payload 상 존재하지 않음 → transient window(approval_no≠NULL ∧ reconciled_at=NULL ∧
//       external_trxid=NULL) 불가 → Tier0 pool re-link 불가(구조적).
//   · C4 (순수 단일필드): payload 키는 화이트리스트만 — amount·method·pg_provider·payment_type 등
//       매출/매칭 접점 필드 무접촉.
//   · 유실 방지·멱등: raw.approval_no 가 NULL 이면 external_approval_no 키를 넣지 않음(NULL 덮어쓰기 금지).
//   · re-link 0 (구조): writeback 후 payment 는 external_trxid≠NULL → isUnmatchedCrm=false →
//       findTier0Direct 후보에서 영구 배제.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMatchedPaymentUpdate,
  findTier0Direct,
  type CrmPayment,
  type RawTransaction,
} from "./matcher.ts";

const RECON_NOW = "2026-07-30T05:00:00.000Z";

function rawFixture(over: Partial<RawTransaction> = {}): RawTransaction {
  return {
    id: "raw-1",
    clinic_id: "clinic-foot",
    external_trxid: "TRX0001",
    external_status: "Y",
    amount: 50000,
    approval_no: "APPRV12345",
    root_trxid: null,
    tid: "TID0001",
    approved_at: "2026-07-30T04:59:00.000Z",
    matched_payment_id: null,
    ...over,
  };
}

// ── C1 + populate: approval_no 있을 때 external_approval_no 가 raw 값으로 채워지고, 3필드와 co-stamp ──
Deno.test("C1/populate: approval_no present → external_approval_no + reconciled_at + external_trxid 동일 payload co-stamp", () => {
  const raw = rawFixture({ approval_no: "APPRV99887" });
  const payload = buildMatchedPaymentUpdate(raw, RECON_NOW);

  assertEquals(payload.external_approval_no, "APPRV99887", "raw.approval_no 를 그대로 승격");
  assertEquals(payload.reconciled_at, RECON_NOW, "reconciled_at 동일 payload 에 함께 stamp");
  assertEquals(payload.external_trxid, "TRX0001", "external_trxid 동일 payload 에 함께 stamp");
  assertEquals(payload.external_status, "Y");
  // C1 구조: external_approval_no 가 존재할 때 reconciled_at·external_trxid 도 반드시 non-null 로 동반.
  assert(payload.reconciled_at != null && payload.external_trxid != null,
    "external_approval_no 는 reconciled_at·external_trxid 와 분리 write 될 수 없음(단일 객체)");
});

// ── 유실방지·멱등: approval_no NULL 이면 external_approval_no 키 미포함(기존값 NULL 덮어쓰기 금지) ──
Deno.test("no-clobber: raw.approval_no=null → payload 에 external_approval_no 키 없음", () => {
  const raw = rawFixture({ approval_no: null });
  const payload = buildMatchedPaymentUpdate(raw, RECON_NOW);

  assertFalse("external_approval_no" in payload, "approval_no 없으면 external_approval_no 미설정(NULL 미덮어씀)");
  // 나머지 3필드는 종전대로 승격(behavior-preserving).
  assertEquals(payload.reconciled_at, RECON_NOW);
  assertEquals(payload.external_trxid, "TRX0001");
  assertEquals(payload.external_status, "Y");
});

// ── C4 순수 단일필드: payload 키는 화이트리스트만 — 매출/매칭 접점 필드 무접촉 ──
Deno.test("C4: payload 키 = 화이트리스트만 (amount·method·pg_provider·payment_type 무접촉)", () => {
  const withApproval = buildMatchedPaymentUpdate(rawFixture(), RECON_NOW);
  const withoutApproval = buildMatchedPaymentUpdate(rawFixture({ approval_no: null }), RECON_NOW);

  const allowed = new Set(["reconciled_at", "external_trxid", "external_status", "external_approval_no"]);
  for (const k of Object.keys(withApproval)) {
    assert(allowed.has(k), `허용되지 않은 필드 write 시도: ${k}`);
  }
  for (const k of Object.keys(withoutApproval)) {
    assert(allowed.has(k), `허용되지 않은 필드 write 시도(no-approval): ${k}`);
  }
  // 매출/매칭 접점 필드 명시 부재 확인.
  for (const forbidden of ["amount", "method", "pg_provider", "payment_type", "id", "clinic_id"]) {
    assertFalse(forbidden in withApproval, `${forbidden} 무접촉`);
  }
});

// ── 멱등: 동일 입력 → 동일 payload (순수 함수, 재run no-op 근거) ──
Deno.test("idempotent: 동일 raw 재적용 → 동일 payload", () => {
  const raw = rawFixture();
  assertEquals(
    JSON.stringify(buildMatchedPaymentUpdate(raw, RECON_NOW)),
    JSON.stringify(buildMatchedPaymentUpdate(raw, RECON_NOW)),
  );
});

// ── re-link 0 (구조): writeback 후 payment 는 Tier0 후보 pool 에서 영구 배제 ──
Deno.test("re-link 0: writeback 반영된 payment(external_trxid·reconciled_at 채워짐) → findTier0Direct 후보 배제", () => {
  const raw = rawFixture();

  // (a) writeback 前 — 수기입력 approval_no 를 가진 미매칭 payment(reconciled_at·external_trxid NULL)
  //     는 Tier0 corroboration 후보(approval_no 일치). ★Tier0 는 식별자를 이미 가진 payment 만 대상.
  const beforePay: CrmPayment = {
    id: "pay-1",
    clinic_id: "clinic-foot",
    amount: 50000,
    method: "card",
    payment_type: "payment",
    created_at: "2026-07-30T04:59:30.000Z",
    external_trxid: null,
    external_approval_no: raw.approval_no,   // 수기입력 승인번호(corroborator)
    external_tid: null,
    reconciled_at: null,
  };
  assertEquals(findTier0Direct(raw, [beforePay]).length, 1, "writeback 前: 수기 approval_no 미매칭 payment 는 Tier0 후보");

  // (b) writeback payload 를 적용한 payment 상태를 재구성.
  const payload = buildMatchedPaymentUpdate(raw, RECON_NOW);
  const afterPay: CrmPayment = {
    ...beforePay,
    external_trxid: payload.external_trxid as string,
    external_approval_no: (payload.external_approval_no as string) ?? null,
    reconciled_at: payload.reconciled_at as string,
  };

  // (c) writeback 後 — reconciled_at·external_trxid 채워짐 → isUnmatchedCrm=false → 후보 0 (re-link 불가).
  assertEquals(findTier0Direct(raw, [afterPay]).length, 0,
    "writeback 後: reconciled_at·external_trxid 채워진 payment 는 Tier0 pool 에서 영구 배제(re-link 0)");
});
