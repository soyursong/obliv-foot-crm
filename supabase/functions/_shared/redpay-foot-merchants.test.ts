// _shared/redpay-foot-merchants.test.ts — A안 RUNTIME-ALIGN 런타임 admit set 정렬 단위 테스트
//
// T-20260728-foot-REDPAY-WEBHOOK-ALLOWLIST-RUNTIME-ALIGN (P2, 최필경 C0ATE5P6JTH)
//   웹훅 EF 허용목록(foot admit)을 컴파일타임 상수(code-shadow) → registry 런타임 조회로 정렬.
//   순수함수(deriveFootMerchantSet / centerForMerchantWithSet) 계약 검증.
//   실행: deno test supabase/functions/_shared/redpay-foot-merchants.test.ts
//   (e2e_spec_exempt=ef_only — Playwright 대신 순수함수 self-test 로 AC-1/AC-2 회귀 검증.)

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  centerForMerchant,
  centerForMerchantWithSet,
  deriveFootMerchantSet,
  FOOT_MERCHANT_SET,
  BODY_MERCHANT_SET,
} from "./redpay-foot-merchants.ts";

// 컴파일타임 set 대표값(회귀 대조).
const STATIC_FOOT = "1777285001";      // FOOT_MERCHANT_SET 에 존재
const BODY_ONE = "1777274001";         // BODY_MERCHANT_SET 에 존재
// registry 에만 있고 컴파일타임 FOOT_MERCHANT_SET 에는 없는 신규 foot merchant(A안 핵심 대상).
const REGISTRY_NEW_FOOT = "1777289099";

Deno.test("deriveFootMerchantSet — registry 미가용(null) → fail-open static floor 동치", () => {
  const r = deriveFootMerchantSet(null);
  assertEquals(r.source, "fallback-static");
  assertEquals(r.registryCount, 0);
  // 유효 set == FOOT_MERCHANT_SET (현행 100% 동일 admit surface).
  assertEquals(r.set.size, FOOT_MERCHANT_SET.size);
  for (const m of FOOT_MERCHANT_SET) assert(r.set.has(m));
});

Deno.test("deriveFootMerchantSet — registry 빈배열 → fail-open static floor", () => {
  const r = deriveFootMerchantSet([]);
  assertEquals(r.source, "fallback-static");
  assertEquals(r.set.size, FOOT_MERCHANT_SET.size);
});

Deno.test("deriveFootMerchantSet — registry 로우 존재 → registry ∪ static union", () => {
  const r = deriveFootMerchantSet([REGISTRY_NEW_FOOT, STATIC_FOOT, "  ", null, STATIC_FOOT]);
  assertEquals(r.source, "registry-union");
  // trim/dedup/drop-empty 후 유효 registry 값 = {REGISTRY_NEW_FOOT, STATIC_FOOT} = 2.
  assertEquals(r.registryCount, 2);
  // static floor 전량 포함(under-admit 0) + registry-신규 포함.
  for (const m of FOOT_MERCHANT_SET) assert(r.set.has(m), `static ${m} 누락`);
  assert(r.set.has(REGISTRY_NEW_FOOT), "registry-신규 merchant 미포함");
  // union 크기 = static + 신규 1개(STATIC_FOOT 는 이미 static 에 포함되어 중복 아님).
  assertEquals(r.set.size, FOOT_MERCHANT_SET.size + 1);
});

Deno.test("centerForMerchantWithSet — registry-신규 merchant admit(foot) 재현 (A안 핵심 AC-3)", () => {
  const r = deriveFootMerchantSet([REGISTRY_NEW_FOOT]);
  // registry 정렬 전(static-only)에는 unknown 이던 신규 merchant 가...
  assertEquals(centerForMerchantWithSet(REGISTRY_NEW_FOOT, FOOT_MERCHANT_SET), "unknown");
  // ...registry 런타임 조회 후 foot 로 admit → 더 이상 '미등록' drop 아님.
  assertEquals(centerForMerchantWithSet(REGISTRY_NEW_FOOT, r.set), "foot");
});

Deno.test("centerForMerchantWithSet — body/unknown 경로 불변(회귀 0)", () => {
  const r = deriveFootMerchantSet([REGISTRY_NEW_FOOT]);
  assertEquals(centerForMerchantWithSet(STATIC_FOOT, r.set), "foot");
  assertEquals(centerForMerchantWithSet(BODY_ONE, r.set), "body");        // 타 센터 drop 불변
  assertEquals(centerForMerchantWithSet("9999999999", r.set), "unknown"); // 진짜 미등록 → 여전히 unknown
});

Deno.test("centerForMerchantWithSet — merchant_id 부재('' / null) → unknown (sub-Q: 추출·소비 확인)", () => {
  // 총괄 최필경 진단 sub-Q: merchant_id 가 admit 판정 키. 부재 시 admit 불가 → unknown → 미적재.
  const r = deriveFootMerchantSet([REGISTRY_NEW_FOOT]);
  assertEquals(centerForMerchantWithSet("", r.set), "unknown");
  assertEquals(centerForMerchantWithSet(null, r.set), "unknown");
  assertEquals(centerForMerchantWithSet(undefined, r.set), "unknown");
  assertEquals(centerForMerchantWithSet("   ", r.set), "unknown"); // whitespace-only → trim → unknown
});

Deno.test("centerForMerchant(레거시) == centerForMerchantWithSet(static) — 하위호환 계약 보존", () => {
  const samples = [STATIC_FOOT, BODY_ONE, REGISTRY_NEW_FOOT, "", null, undefined, "9999999999"];
  for (const s of samples) {
    assertEquals(
      centerForMerchant(s),
      centerForMerchantWithSet(s, FOOT_MERCHANT_SET),
      `legacy drift @ ${String(s)}`,
    );
  }
});

Deno.test("over-admit 가드 — union 은 foot 도메인만 확장(body merchant 를 foot 로 admit 하지 않음)", () => {
  // registry 응답에 (가상) body merchant 가 섞여도 그것을 foot 로 admit 하는 게 아니라,
  // deriveFootMerchantSet 은 domain=foot 쿼리 결과만 받는 계약. 여기서는 body merchant 를 넣으면
  // 단지 foot set 에 추가될 뿐이나 — 호출측(EF)은 domain=foot 로만 조회하므로 실제로는 발생 불가.
  // 계약 문서화: body merchant 가 foot registry 에 존재하지 않음을 전제로 한다.
  for (const b of BODY_MERCHANT_SET) {
    assertFalse(FOOT_MERCHANT_SET.has(b), `static set 에 body merchant ${b} 오염`);
  }
});
