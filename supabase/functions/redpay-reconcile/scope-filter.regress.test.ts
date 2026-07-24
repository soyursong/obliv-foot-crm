// redpay-reconcile/scope-filter.regress.test.ts — 풋 스코프 필터 회귀 가드
//
// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트A (Q1 ingest-drop GO · Q3 단일SSOT 정합 + drift-assert)
//   실행: deno test supabase/functions/redpay-reconcile/scope-filter.regress.test.ts
//
//   ▸ [drift-assert] reconcile 경로 merchant set(scope-filter.ts) 이 webhook 경로 SSOT
//     (_shared/redpay-foot-merchants.ts) 와 divergence 하면 실패 → 두 티켓(본 건 over-inclusion,
//     WHITELIST-EXPAND-0723GAP under-inclusion)이 whitelist 를 손댈 때 한쪽만 갱신하는 drift 를 표면화.
//   ▸ [ingest-drop] 도수(body)·미등록(unknown) merchant 는 drop, 풋 merchant 는 keep 을 고정 →
//     62071914(merchant 1777276003, 도수) leak 재유입을 회귀로 봉인.
//   ▸ [ingest-KEEP / staleness-seal] 풋2 VAN merchant 1777285002 는 tidWhitelist 가 비어도 keep,
//     FOOT_MERCHANT_SET size===27 && has(285002) 고정 → EXPAND-0723GAP under-inclusion 회귀 봉인.
//     (drift-assert 는 reconcile↔_shared 대칭만 봄 → 양쪽 동시 stale 시 통과하는 사각지대를,
//      canonical registry loci 수(27) + 285002 membership 고정으로 메운다. FIX-REQUEST §3.)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FOOT_MERCHANT_SET,
  BODY_MERCHANT_SET,
  filterToFootScope,
  centerForRawRow,
} from "./scope-filter.ts";
import {
  FOOT_MERCHANT_SET as SHARED_FOOT,
  BODY_MERCHANT_SET as SHARED_BODY,
} from "../_shared/redpay-foot-merchants.ts";

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── [drift-assert] reconcile merchant set === webhook(_shared) SSOT ──────────────
Deno.test("drift-assert: FOOT merchant set 은 _shared SSOT 와 동일(divergence 감지)", () => {
  assert(
    setsEqual(FOOT_MERCHANT_SET, SHARED_FOOT),
    `FOOT_MERCHANT_SET drift! reconcile=${FOOT_MERCHANT_SET.size} _shared=${SHARED_FOOT.size} ` +
    `— reconcile/webhook whitelist 한쪽만 갱신됨(0723GAP 등). 단일SSOT 정합 복원 필요.`,
  );
});

Deno.test("drift-assert: BODY merchant set 은 _shared SSOT 와 동일", () => {
  assert(
    setsEqual(BODY_MERCHANT_SET, SHARED_BODY),
    `BODY_MERCHANT_SET drift! reconcile=${BODY_MERCHANT_SET.size} _shared=${SHARED_BODY.size}`,
  );
});

Deno.test("FOOT/BODY 대역은 disjoint (겹침 = 도메인 경계 붕괴)", () => {
  for (const m of FOOT_MERCHANT_SET) {
    assert(!BODY_MERCHANT_SET.has(m), `merchant ${m} 이 FOOT·BODY 양쪽에 존재`);
  }
});

// ── [ingest-drop] 62071914 도수 leak 회귀 봉인 ───────────────────────────────────
Deno.test("ingest-drop: 도수(body) merchant 는 drop (62071914 leak 벡터 봉인)", () => {
  const items = [
    { tid: "1000000001", merchant: { id: "1777285001" } }, // 풋 VAN → keep
    { tid: "1047479115", merchant: { id: "1777276003" } }, // 도수(62071914 현장 지문) → drop
    { tid: "1047479115", merchant: { id: "1777276003" } }, // 도수 취소쌍 → drop
  ];
  // tidWhitelist 를 비워도(pass-through 였던 구 버그 조건) merchant-drop 이 도수를 걸러야 한다.
  const { kept, dropped } = filterToFootScope(items, new Set<string>());
  assertEquals(kept.length, 1, "풋 merchant 1건만 keep");
  assertEquals(kept[0].merchant.id, "1777285001");
  assertEquals(dropped.length, 2, "도수 2행 전량 drop");
  for (const d of dropped) assertEquals(d.merchant.id, "1777276003");
});

Deno.test("ingest-drop: 미등록(unknown) merchant 도 drop (silent include 금지)", () => {
  const items = [
    { tid: "9999999999", merchant: { id: "1888000000" } }, // 미등록 → drop
    { tid: "1000000002", merchant: { id: "1777289001" } }, // 풋 → keep
  ];
  const { kept, dropped } = filterToFootScope(items, new Set<string>());
  assertEquals(kept.length, 1);
  assertEquals(dropped.length, 1);
  assertEquals(dropped[0].merchant.id, "1888000000");
});

// ── [ingest-KEEP] 285002 풋2 VAN under-inclusion 회귀 봉인 (FIX-REQUEST §3) ───────
Deno.test("ingest-KEEP: 풋2 VAN merchant 1777285002 는 tidWhitelist 비어도 keep (285002 under-inclusion 봉인)", () => {
  const items = [
    { tid: "1047535843", merchant: { id: "1777285002" } }, // 풋2 VAN(EXPAND-0723GAP 편입) → keep
    { tid: "9999999999", merchant: { id: "1777285002" } }, // 285002 + 미등록 TID → merchant 권위 keep
    { tid: null, merchant: { id: "1777285002" } },         // TID 부재라도 merchant 권위 keep
  ];
  // tidWhitelist 를 비워도(TID 폴백 불가 조건) merchant 1차 권위로 285002 를 keep 해야 한다.
  const { kept, dropped } = filterToFootScope(items, new Set<string>());
  assertEquals(kept.length, 3, "285002 3건 전량 merchant 권위 keep (tid 무관)");
  assertEquals(dropped.length, 0, "285002 는 drop 되면 안 됨(under-inclusion 회귀)");
  for (const k of kept) assertEquals(k.merchant!.id, "1777285002");
});

// ── [staleness-seal] SSOT staleness 재발 봉인 (drift-assert 사각지대 보완) ─────────
Deno.test("staleness-seal: FOOT_MERCHANT_SET 은 27-set 이고 285002 를 포함 (양쪽 동시 stale 봉인)", () => {
  assertEquals(FOOT_MERCHANT_SET.size, 27, `FOOT_MERCHANT_SET 은 27-set 이어야 함(현=${FOOT_MERCHANT_SET.size}). EXPAND-0723GAP 285002 편입 누락 의심.`);
  assert(FOOT_MERCHANT_SET.has("1777285002"), "풋2 VAN 1777285002 가 FOOT_MERCHANT_SET 에 없음 — under-inclusion 회귀.");
  assert(SHARED_FOOT.has("1777285002"), "풋2 VAN 1777285002 가 _shared SSOT 에 없음 — webhook path under-inclusion 회귀.");
});

Deno.test("merchant 값 부재 시에만 TID 보조필터로 폴백 (레거시/이상행 유실 방지)", () => {
  const items = [
    { tid: "1000000003", merchant: null },        // merchant 부재 + TID 화이트 → keep(폴백)
    { tid: "8888888888", merchant: null },        // merchant 부재 + TID 비화이트 → drop
    { tid: null, merchant: undefined },           // merchant·TID 모두 부재 → drop
  ];
  const tidW = new Set<string>(["1000000003"]);
  const { kept, dropped } = filterToFootScope(items, tidW);
  assertEquals(kept.length, 1, "merchant 부재 + 화이트 TID 만 폴백 keep");
  assertEquals(kept[0].tid, "1000000003");
  assertEquals(dropped.length, 2);
});

Deno.test("drift: 풋 merchant 인정 + 미등록 TID → drift 표면화 (신규 단말 후보)", () => {
  const items = [
    { tid: "7777777777", merchant: { id: "1777285001" } }, // 풋 merchant, 미등록 TID → keep + drift
  ];
  const tidW = new Set<string>(["1000000001"]); // 다른 풋 TID 만 등록
  const { kept, dropped, drift } = filterToFootScope(items, tidW);
  assertEquals(kept.length, 1, "merchant 권위로 keep");
  assertEquals(dropped.length, 0);
  assertEquals(drift.length, 1, "미등록 TID 는 drift 로 알람");
});

// ── centerForRawRow (raw_payload band → center) ────────────────────────────────
Deno.test("centerForRawRow: 도수 band → 'body', 풋 → 'foot'", () => {
  assertEquals(centerForRawRow({ raw_payload: { merchant: { id: "1777276003" } } }), "body");
  assertEquals(centerForRawRow({ raw_payload: { merchant: { id: "1777285001" } } }), "foot");
});
