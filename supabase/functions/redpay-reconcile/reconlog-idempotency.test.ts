// redpay-reconcile/reconlog-idempotency.test.ts — reconciliation_log state-change 게이트 단위 테스트
//
// T-20260725-foot-REDPAY-RECONLOG-IDEMPOTENCY (e2e_spec_exempt=ef_only, change-class=no-DDL)
//   지속-미매칭 raw 가 사이클마다 match_failed/missing_in_crm 를 '무-상태변화'로 재생성 →
//   로그 무한증식 + count 인플레(forensic816: 1 raw→816행). planReconLogInserts 순수 술어가
//   raw별 '직전 로그 event_type' 과 diff 하여 상태 전이 시에만 insert 하는지 고정한다.
//   실행: deno test supabase/functions/redpay-reconcile/reconlog-idempotency.test.ts
//
//   ▸ DB I/O(prior-log SELECT / INSERT)는 index.ts insertReconEvents 런타임 통합영역이고,
//     여기서는 전이 판정(planReconLogInserts) 술어의 정확성만 고정한다.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planReconLogInserts, SUPPRESSIBLE_EVENT_TYPES, type ReconEvent } from "./matcher.ts";

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

Deno.test("억제 대상 타입 집합 = match_failed / missing_in_crm 한정 (auto_matched 비대상)", () => {
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("match_failed"), true);
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("missing_in_crm"), true);
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("auto_matched"), false);
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("missing_at_van"), false);
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("amount_mismatch"), false);
  assertEquals(SUPPRESSIBLE_EVENT_TYPES.has("refund_not_in_crm"), false);
});

// AC1: raw별 직전 event_type diff, 전이 시에만 insert
Deno.test("AC1: 최초 관측(직전 로그 없음) → insert", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ event_type: "match_failed" })],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

Deno.test("AC1: 직전과 동일 event_type(무-상태변화) → 억제", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-1", event_type: "match_failed" })],
    new Map([["raw-1", "match_failed"]]),
  );
  assertEquals(toInsert.length, 0);
  assertEquals(suppressed, 1);
});

Deno.test("AC1: 전이(match_failed → missing_in_crm) → insert", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-1", event_type: "missing_in_crm" })],
    new Map([["raw-1", "match_failed"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
  assertEquals(toInsert[0].event_type, "missing_in_crm");
});

// AC3: auto_matched 는 terminal — 억제 비대상, 직전이 무엇이든 무조건 insert
Deno.test("AC3: 미매칭 → 해소(match_failed → auto_matched) 전이는 insert", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-1", event_type: "auto_matched", match_rule: "tier0_direct" })],
    new Map([["raw-1", "match_failed"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

Deno.test("AC3: auto_matched 는 직전이 auto_matched 여도 억제 비대상(무조건 insert)", () => {
  // auto_matched 는 SUPPRESSIBLE 아님 → diff 게이트를 타지 않는다(terminal 특성상 재유입은 없으나 술어상 억제 X).
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: "raw-1", event_type: "auto_matched", match_rule: "tier0_direct" })],
    new Map([["raw-1", "auto_matched"]]),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

// raw_transaction_id 없는 CRM-앵커 이벤트(missing_at_van)는 억제 비대상
Deno.test("raw 없는 이벤트(missing_at_van, CRM 앵커) → 억제 비대상(무조건 insert)", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [evt({ raw_transaction_id: null, event_type: "missing_at_van" })],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 0);
});

// 배치-내 동일 raw·동일타입 중복도 1건으로 억제
Deno.test("배치-내 동일 raw·동일 match_failed 3건(직전 없음) → 최초 1건만 insert, 2건 억제", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [
      evt({ raw_transaction_id: "raw-1", event_type: "match_failed" }),
      evt({ raw_transaction_id: "raw-1", event_type: "match_failed" }),
      evt({ raw_transaction_id: "raw-1", event_type: "match_failed" }),
    ],
    new Map(),
  );
  assertEquals(toInsert.length, 1);
  assertEquals(suppressed, 2);
});

// AC4: forensic816 재현 — 1 raw 가 816 사이클 지속-미매칭 → 로그 행수가 전이 실횟수(1)로 수렴
Deno.test("AC4: forensic816 — 지속-미매칭 raw 816 사이클 반복 시 로그행이 전이횟수(1)로 수렴", () => {
  const priorEventType = new Map<string, string>();
  let totalInserted = 0;

  // 816 사이클: 매 사이클 동일 raw 에 대해 match_failed 재생성(구 bare .insert 라면 816행 적재)
  for (let cycle = 0; cycle < 816; cycle++) {
    const events = [evt({ raw_transaction_id: "raw-forensic", event_type: "match_failed" })];
    const { toInsert } = planReconLogInserts(events, priorEventType);
    totalInserted += toInsert.length;
    // 런타임 insertReconEvents 와 동형: insert 된 raw 의 직전 event_type 을 갱신(다음 사이클 diff 근거)
    for (const e of toInsert) {
      if (e.raw_transaction_id) priorEventType.set(e.raw_transaction_id, e.event_type);
    }
  }

  // 구현 전: 816행. 구현 후: 전이 실횟수(최초 관측 1회) 로 수렴.
  assertEquals(totalInserted, 1, "지속-미매칭 raw 의 로그행은 전이 실횟수(1)로 수렴해야 함");
});

// AC4 확장: 상태가 실제로 왕복(flap)하면 각 전이가 로그로 남는다(append-only 이력 보존)
Deno.test("AC4-flap: match_failed ↔ missing_in_crm 왕복 4회 → 전이 4회 모두 로그", () => {
  const priorEventType = new Map<string, string>();
  const sequence = ["match_failed", "missing_in_crm", "match_failed", "missing_in_crm"];
  let totalInserted = 0;

  for (const t of sequence) {
    const events = [evt({ raw_transaction_id: "raw-flap", event_type: t as ReconEvent["event_type"] })];
    const { toInsert } = planReconLogInserts(events, priorEventType);
    totalInserted += toInsert.length;
    for (const e of toInsert) {
      if (e.raw_transaction_id) priorEventType.set(e.raw_transaction_id, e.event_type);
    }
  }

  assertEquals(totalInserted, 4, "실 상태 전이는 억제되지 않고 append-only 로 모두 기록");
});

// 혼합 배치: 억제 대상 + 비억제 타입 공존 시 각각 올바르게 분기
Deno.test("혼합 배치: match_failed(무변화 억제) + auto_matched(insert) + missing_in_crm(전이 insert)", () => {
  const { toInsert, suppressed } = planReconLogInserts(
    [
      evt({ raw_transaction_id: "raw-A", event_type: "match_failed" }),   // 직전 동일 → 억제
      evt({ raw_transaction_id: "raw-B", event_type: "auto_matched", match_rule: "tier0_direct" }), // 비억제 → insert
      evt({ raw_transaction_id: "raw-C", event_type: "missing_in_crm" }), // 전이 → insert
    ],
    new Map([
      ["raw-A", "match_failed"],
      ["raw-C", "match_failed"],
    ]),
  );
  assertEquals(suppressed, 1);
  assertEquals(toInsert.map((e) => e.raw_transaction_id).sort(), ["raw-B", "raw-C"]);
});

// AC2: 순수 술어는 입력 priorEventType 맵을 변형하지 않는다(호출측 append-only 소스 보존)
Deno.test("AC2: 입력 priorEventType 맵 불변(호출측 소스 보존)", () => {
  const prior = new Map([["raw-1", "match_failed"]]);
  planReconLogInserts(
    [evt({ raw_transaction_id: "raw-1", event_type: "missing_in_crm" })],
    prior,
  );
  assertEquals(prior.get("raw-1"), "match_failed", "입력 맵은 변형되지 않아야 함");
  assertEquals(prior.size, 1);
});
