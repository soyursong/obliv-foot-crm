// redpay-reconcile/reconlog-flap-canonical.regress.test.ts
//
// T-20260729-foot-REDPAY-RECONLOG-FLAP-IDEMPOTENCY-GAP (AC-3 하드닝, e2e_spec_exempt=ef_only, no-DDL)
//   canonical reconciliation-state key 접기(후보 A) 회귀 고정. 부모 T-20260725 게이트가
//   raw event_type 값 동일성으로 diff → mf↔mic 왕복을 '전이'로 오판 → flap 로그 41.8만행.
//   하드닝: 비교 축을 canonical macro-state key 동일성으로 교체(불변식 v2).
//
//   SSOT: da_decision_foot_reconlog_flap_canonical_state_fold_20260730.md §3-3 회귀 불변식 R1~R5.
//   실행: deno test supabase/functions/redpay-reconcile/reconlog-flap-canonical.regress.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalReconState,
  planReconLogInserts,
  SUPPRESSIBLE_EVENT_TYPES,
  type ReconEvent,
} from "./matcher.ts";

function evt(overrides: Partial<ReconEvent>): ReconEvent {
  return {
    clinic_id: "clinic-1",
    raw_transaction_id: "raw-1",
    payment_id: null,
    event_type: "match_failed",
    match_rule: null,
    mismatch_reason: null,
    external_trxid: "TRX1",
    external_amount: 120000,
    crm_amount: null,
    alert_payload: null,
    ...overrides,
  };
}

// 런타임 insertReconEvents 와 동형으로 사이클을 돌리는 헬퍼(직전 event_type 원값 갱신).
function runCycles(
  seq: Array<ReconEvent["event_type"]>,
  rawId = "raw-x",
): number {
  const prior = new Map<string, string>();
  let inserted = 0;
  for (const t of seq) {
    const { toInsert } = planReconLogInserts([evt({ raw_transaction_id: rawId, event_type: t })], prior);
    inserted += toInsert.length;
    for (const e of toInsert) if (e.raw_transaction_id) prior.set(e.raw_transaction_id, e.event_type);
  }
  return inserted;
}

// ── canonical 격자(DA §2-1-2) 직접 고정 ──
Deno.test("canonical 격자: mf/mic → 'unmatched', 나머지 identity(★missing_at_van fold 금지)", () => {
  assertEquals(canonicalReconState("match_failed"), "unmatched");
  assertEquals(canonicalReconState("missing_in_crm"), "unmatched");
  // identity — 각자 distinct 상태
  assertEquals(canonicalReconState("auto_matched"), "auto_matched");
  assertEquals(canonicalReconState("missing_at_van"), "missing_at_van"); // ★fold 금지
  assertEquals(canonicalReconState("amount_mismatch"), "amount_mismatch");
  assertEquals(canonicalReconState("refund_not_in_crm"), "refund_not_in_crm");
});

// ── R1 (부모 보존): 동일 sub-label 반복 → 1행 수렴(부모 forensic816 회귀 무) ──
Deno.test("R1: 동일 sub-label(match_failed) N회 반복 → 1행 수렴", () => {
  assertEquals(runCycles(Array(816).fill("match_failed"), "raw-r1"), 1);
});

// ── R2 (실전이 보존): macro 경계를 넘는 전이는 insert ──
Deno.test("R2a: unmatched → auto_matched 전이 → insert 보존", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-r2a", event_type: "auto_matched", match_rule: "tier0_direct" })],
    new Map([["raw-r2a", "match_failed"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

Deno.test("R2b: auto_matched → unmatched(재-open) 전이 → insert 보존", () => {
  // auto_matched 후 다시 match_failed(재-open): canonical 'auto_matched'→'unmatched' 경계 전이.
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-r2b", event_type: "match_failed" })],
    new Map([["raw-r2b", "auto_matched"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

Deno.test("R2c: amount_mismatch 는 distinct 상태(identity) → unmatched 직후 insert 보존", () => {
  // 직전 unmatched(match_failed) → amount_mismatch: canonical 경계 전이 → 보존.
  // (amount_mismatch 는 SUPPRESSIBLE 비대상이라 어차피 무조건 insert — 이중 안전.)
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-r2c", event_type: "amount_mismatch" })],
    new Map([["raw-r2c", "match_failed"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

// ── R3 (신규 억제): mf↔mic 686-cycle 왕복 → canonical 동일 → 1행 수렴 ──
Deno.test("R3: match_failed ↔ missing_in_crm 686-cycle 왕복 → 1행 수렴", () => {
  const seq: Array<ReconEvent["event_type"]> = [];
  for (let i = 0; i < 686; i++) seq.push(i % 2 === 0 ? "match_failed" : "missing_in_crm");
  assertEquals(runCycles(seq, "raw-r3"), 1);
});

Deno.test("R3-batch: same-second dual emission(mf+mic 동일 배치) → 1행", () => {
  // AC-1 census 지문: 지목 raw 가 한 사이클에 mf·mic 동시 발행(only_mic=324, dual=686).
  const { toInsert, suppressed } = planReconLogInserts(
    [
      evt({ raw_transaction_id: "raw-r3b", event_type: "match_failed" }),
      evt({ raw_transaction_id: "raw-r3b", event_type: "missing_in_crm" }),
    ],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 1);
});

// ── R4 (과잉 fold 금지): missing_at_van 은 canonical identity 유지 → 독립 로깅 ──
Deno.test("R4: missing_at_van 은 'unmatched' 로 접히지 않음(별개 술어) — canonical identity", () => {
  // mf 와 missing_at_van 이 canonical 상 다른 key 임을 직접 고정(은폐 0 가드).
  assertEquals(canonicalReconState("missing_at_van") === canonicalReconState("match_failed"), false);
  // missing_at_van 은 SUPPRESSIBLE 비대상 → 억제 게이트를 타지 않고 독립 로깅.
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("missing_at_van"), false);
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: null, event_type: "missing_at_van" })],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

// ── R5 (auto_matched terminal): 무조건 insert(부모 AC-3 유지) ──
Deno.test("R5: auto_matched 는 SUPPRESSIBLE 비대상 → 직전이 auto_matched 여도 무조건 insert", () => {
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("auto_matched"), false);
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-r5", event_type: "auto_matched", match_rule: "tier0_direct" })],
    new Map([["raw-r5", "auto_matched"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

// ── audit 보존: 기록 값은 최초 관측 event_type 원값(canonical 으로 덮어쓰지 않음) ──
Deno.test("audit: 최초 관측 event_type 원값이 그대로 기록(어느 detector 가 최초 flag 했는지 보존)", () => {
  const { toInsert } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-au", event_type: "missing_in_crm" })],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(toInsert[0].event_type, "missing_in_crm"); // 'unmatched' 로 치환되지 않음
});
