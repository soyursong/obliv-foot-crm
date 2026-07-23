// redpay-reconcile/matcher.observe.test.ts — 관측행 매칭 제외 술어 단위 테스트
//
// T-20260723-foot-REDPAY-PLANB-OBSERVE-MODE (e2e_spec_exempt=ef_only)
//   폴러(redpay-reconcile)가 웹훅 관측모드 적재행(raw_payload._mode='observe')을
//   매칭/대사 대상에서 제외하는지(실 payments 승격 금지) 순수 술어로 검증.
//   실행: deno test supabase/functions/redpay-reconcile/matcher.observe.test.ts
//
//   ▸ DB-측 제외(PostgREST or-필터 OBSERVE_EXCLUDE_FILTER)는 런타임 통합영역이고,
//     여기서는 JS-측 2차 방어(isObserveRow) 술어의 정확성을 고정한다.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isObserveRow, type RawTransaction } from "./matcher.ts";

function rawRow(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    id: "raw-1",
    clinic_id: "clinic-1",
    external_trxid: "TRX1",
    external_status: "Y",
    amount: 120000,
    approval_no: null,
    root_trxid: null,
    tid: "T0001",
    approved_at: "2026-07-23T06:00:00.000Z",
    matched_payment_id: null,
    ...overrides,
  };
}

Deno.test("isObserveRow: 웹훅 관측행(_mode='observe') → 매칭 제외 대상(true)", () => {
  assert(isObserveRow(rawRow({ raw_payload: { _source: "webhook", _mode: "observe" } })));
  assert(isObserveRow(rawRow({ raw_payload: { _mode: "OBSERVE" } })));
});

Deno.test("isObserveRow: 폴러 원본행(_mode 부재) → 매칭 대상(false)", () => {
  // 폴러 toRawTrxRow 는 raw_payload = 레드페이 원본 트랜잭션(_mode/_source 키 없음).
  assertFalse(isObserveRow(rawRow({ raw_payload: { trxid: "TRX1", status: "Y", amount: 120000 } })));
  assertFalse(isObserveRow(rawRow({ raw_payload: null })));
  assertFalse(isObserveRow(rawRow({ raw_payload: undefined })));
});

Deno.test("isObserveRow: auto 웹훅행(_mode='auto') → 매칭 대상(false)", () => {
  assertFalse(isObserveRow(rawRow({ raw_payload: { _source: "webhook", _mode: "auto" } })));
});

Deno.test("isObserveRow: 배열 필터 — 관측행만 제외, 원본·auto 는 보존", () => {
  const rows = [
    rawRow({ id: "poller", raw_payload: { trxid: "P1" } }),
    rawRow({ id: "observe", raw_payload: { _source: "webhook", _mode: "observe" } }),
    rawRow({ id: "auto", raw_payload: { _source: "webhook", _mode: "auto" } }),
  ];
  const kept = rows.filter((r) => !isObserveRow(r)).map((r) => r.id);
  assertEquals(kept, ["poller", "auto"], "관측행(observe)만 매칭에서 제외");
});
