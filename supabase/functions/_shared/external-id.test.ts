// external-id.test.ts — resolveBaseCueCardId 단위 테스트
// T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT §3/§4 — emit 시점 cue link 해소 + COMPANION 가드.
// 실행: deno test supabase/functions/_shared/external-id.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveBaseCueCardId, isCompanionExternalId } from "./external-id.ts";

const UUID = "0e1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b";

Deno.test("평문 UUID → base=원본, isCompanion=false (후방호환)", () => {
  const r = resolveBaseCueCardId(UUID);
  assertEquals(r.ok, true);
  assertEquals(r.baseId, UUID);
  assertEquals(r.isCompanion, false);
});

Deno.test("동행 external_id → base 추출 + isCompanion=true (COMPANION 가드 트리거)", () => {
  const r = resolveBaseCueCardId(`${UUID}_comp_2`);
  assertEquals(r.ok, true);
  assertEquals(r.baseId, UUID);
  assertEquals(r.isCompanion, true);
});

Deno.test("비-UUID base → ok=false (permanent DLQ)", () => {
  const r = resolveBaseCueCardId("not-a-uuid_comp_2");
  assertEquals(r.ok, false);
  assertEquals(r.baseId, null);
});

Deno.test("빈 동행 key(_comp_ 뒤 공백) → ok=false", () => {
  const r = resolveBaseCueCardId(`${UUID}_comp_`);
  assertEquals(r.ok, false);
});

Deno.test("prefix 없는 _comp_ → ok=false", () => {
  const r = resolveBaseCueCardId("_comp_x");
  assertEquals(r.ok, false);
});

Deno.test("null/빈문자/비문자 → ok=false (누출가드)", () => {
  assertEquals(resolveBaseCueCardId(null).ok, false);
  assertEquals(resolveBaseCueCardId("").ok, false);
  assertEquals(resolveBaseCueCardId(undefined).ok, false);
  assertEquals(resolveBaseCueCardId(123 as unknown).ok, false);
});

Deno.test("대문자 UUID 도 허용(case-insensitive)", () => {
  const r = resolveBaseCueCardId(UUID.toUpperCase());
  assertEquals(r.ok, true);
  assertEquals(r.isCompanion, false);
});

Deno.test("isCompanionExternalId — _comp_ 포함 판정", () => {
  assertEquals(isCompanionExternalId(`${UUID}_comp_1`), true);
  assertEquals(isCompanionExternalId(UUID), false);
});
