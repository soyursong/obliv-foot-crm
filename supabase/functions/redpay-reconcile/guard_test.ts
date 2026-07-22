// guard_test.ts — redpay-reconcile 재잠금(single kill-switch) 회귀 봉쇄
//   실행: deno test supabase/functions/redpay-reconcile/guard_test.ts
//
// ref: T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD (gate#3 3조건 / 조건2 재잠금)
//   match_only 쓰기 경로가 REDPAY_DRY_RUN 을 존중하는지(우회 회귀 방지) 검증.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDryRun, shouldBlockMatchOnlyWrites } from "./guard.ts";

// ── parseDryRun: safe default = true(재잠금) ────────────────────────────────
Deno.test("parseDryRun: 빈값/미설정 = true(safe 재잠금)", () => {
  assertEquals(parseDryRun(""), true);
});
Deno.test("parseDryRun: 'true' = true", () => {
  assertEquals(parseDryRun("true"), true);
});
Deno.test("parseDryRun: 'false' = false(해제)", () => {
  assertEquals(parseDryRun("false"), false);
});
// ⚠ 계약 정직화(fail-open): 잠금은 정확히 "true"(소문자) 또는 미설정일 때만.
//   그 외 비어있지 않은 값(대문자 'TRUE'·'1'·오타 등)은 모두 "해제"로 해석된다
//   (index.ts L109 `(env ?? "true") === "true"` 와 동일 계약). 재잠금 값은 반드시
//   정확히 소문자 `true` 이거나, secret 제거(미설정=기본 잠금)여야 안전하다.
Deno.test("parseDryRun: 정확일치 계약 — 'TRUE'/'1' 은 해제로 해석(대소문자 민감)", () => {
  assertEquals(parseDryRun("TRUE"), false); // 소문자 정확일치만 잠금 → 'TRUE' 는 해제
  assertEquals(parseDryRun("1"), false);
});

// ── shouldBlockMatchOnlyWrites: match_only 쓰기 재잠금 = REDPAY_DRY_RUN 단일 플래그 ──
Deno.test("match_only 쓰기: DRY_RUN=true → 차단(재잠금)", () => {
  assertEquals(shouldBlockMatchOnlyWrites("true"), true);
});
Deno.test("match_only 쓰기: DRY_RUN 미설정 → 차단(safe default)", () => {
  assertEquals(shouldBlockMatchOnlyWrites(""), true);
});
Deno.test("match_only 쓰기: DRY_RUN=false → 허용(gate#3 해제)", () => {
  assertEquals(shouldBlockMatchOnlyWrites("false"), false);
});
// 재잠금 안전값 = 정확히 소문자 "true" 또는 미설정(""). 그 외는 해제로 해석되므로
//   운영 재잠금은 반드시 소문자 true 또는 secret 제거를 사용해야 한다(대문자/공백 주의).
Deno.test("match_only 쓰기: 재잠금 안전값 = 소문자 'true' 또는 미설정만", () => {
  assertEquals(shouldBlockMatchOnlyWrites("true"), true); // 안전 재잠금
  assertEquals(shouldBlockMatchOnlyWrites(""), true);     // 미설정=기본 잠금
  assertEquals(shouldBlockMatchOnlyWrites("true "), false); // 공백 오염 = 해제(주의)
  assertEquals(shouldBlockMatchOnlyWrites("TRUE"), false);  // 대문자 = 해제(주의)
});
