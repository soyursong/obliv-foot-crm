// redpay-webhook/non2xx-alert.test.ts — non-2xx 상시 알림 순수 로직 단위 테스트
//
// T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE Part B (e2e_spec_exempt=ef_only)
//   실행: deno test supabase/functions/redpay-webhook/non2xx-alert.test.ts
//   (tsc 빌드 미포함 — CI/supervisor deno test.)

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isNon2xx,
  isRealWebhookDelivery,
  extractErrorSummary,
  buildNon2xxAlertText,
  makeDedup,
} from "./non2xx-alert.ts";

Deno.test("isNon2xx — 2xx 만 false, 나머지 전부 true", () => {
  assertFalse(isNon2xx(200));
  assertFalse(isNon2xx(201));
  assertFalse(isNon2xx(299));
  assert(isNon2xx(400));
  assert(isNon2xx(401)); // 서명불일치(구조적)
  assert(isNon2xx(500)); // db/clinic 장애
  assert(isNon2xx(503)); // 플랫폼(코드가 반환하진 않지만 판별 자체는 non-2xx)
  assert(isNon2xx(199));
});

Deno.test("isRealWebhookDelivery — POST(비-introspection)만 알림 대상", () => {
  assert(isRealWebhookDelivery("POST", false));       // 실제 결제 push
  assertFalse(isRealWebhookDelivery("GET", true));     // introspection
  assertFalse(isRealWebhookDelivery("GET", false));    // 프로브(405)
  assertFalse(isRealWebhookDelivery("HEAD", false));   // 비-POST 노이즈
  assertFalse(isRealWebhookDelivery("OPTIONS", false));
});

Deno.test("extractErrorSummary — error>reason>status 우선, 비JSON은 앞부분 절단", () => {
  assertEquals(extractErrorSummary('{"ok":false,"error":"invalid_signature"}'), "invalid_signature");
  assertEquals(extractErrorSummary('{"ok":true,"status":"ignored_invalid","reason":"missing_trxid"}'), "missing_trxid"); // reason > status
  assertEquals(extractErrorSummary('{"ok":true,"status":"skipped_flag_off"}'), "skipped_flag_off"); // status만 있을 때
  assertEquals(extractErrorSummary('{"ok":false,"reason":"missing_event_id"}'), "missing_event_id");
  assertEquals(extractErrorSummary("not-json-error-text"), "not-json-error-text");
  assertEquals(extractErrorSummary('{"ok":false}'), ""); // 요약키 없음
});

Deno.test("buildNon2xxAlertText — 필수 필드(발생시각·응답코드·trxid/tid·에러요약) 포함", () => {
  const text = buildNon2xxAlertText(
    401, "invalid_signature",
    { eventId: "evt-1", trxid: "TRX9", tid: "1047535845", merchantId: "M1" },
    "2026-07-29T07:43:16.000Z",
  );
  assert(text.includes("401"));
  assert(text.includes("invalid_signature"));
  assert(text.includes("TRX9"));
  assert(text.includes("1047535845"));
  assert(text.includes("2026-07-29T07:43:16.000Z"));
  assert(text.includes("결제 유실 직전 신호"));
  assertFalse(text.includes("묶임")); // suppressedSince=0 이면 묶음 표기 없음
});

Deno.test("buildNon2xxAlertText — 컨텍스트 부재(401 서명단계) ∅ 표기", () => {
  const text = buildNon2xxAlertText(401, "invalid_signature", {}, "2026-07-29T00:00:00Z");
  assert(text.includes("trxid=∅"));
  assert(text.includes("tid=∅"));
});

Deno.test("buildNon2xxAlertText — suppressedSince>0 시 묶음 건수 표기", () => {
  const text = buildNon2xxAlertText(500, "db_upsert_failed", { trxid: "T" }, "t", 4);
  assert(text.includes("동일원인 4건 묶임"));
});

Deno.test("makeDedup — 창 내 동일 key 억제, 창 경과 후 재발송(억제건수 동반)", () => {
  const decide = makeDedup(60_000);
  const key = "500:db_upsert_failed";
  // t=0 최초 → 발송
  assertEquals(decide(key, 0), { send: true, suppressedSince: 0 });
  // t=10s, 30s 동일원인 → 억제(2건)
  assertEquals(decide(key, 10_000).send, false);
  assertEquals(decide(key, 30_000).send, false);
  // t=60s(창 경과) → 재발송 + 억제 2건 동반
  assertEquals(decide(key, 60_000), { send: true, suppressedSince: 2 });
});

Deno.test("makeDedup — 서로 다른 key(응답코드/원인)는 독립 발송(과억제 금지·도달 우선)", () => {
  const decide = makeDedup(60_000);
  assertEquals(decide("401:invalid_signature", 0).send, true);
  assertEquals(decide("500:db_upsert_failed", 100).send, true); // 다른 원인은 즉시 발송
  assertEquals(decide("500:clinic_resolve_failed", 200).send, true);
  // 동일 401 은 창 내 억제
  assertEquals(decide("401:invalid_signature", 300).send, false);
});
