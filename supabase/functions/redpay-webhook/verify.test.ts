// redpay-webhook/verify.test.ts — 서명검증·멱등·라우팅·필터 통합 단위 테스트
//
// T-20260722-foot-REDPAY-WEBHOOK-RECV-EF (e2e_spec_exempt=ef_only)
//   백엔드 EF·UI 무변경 → Playwright 대신 순수함수 통합 테스트로 AC-2/AC-4 검증.
//   실행: deno test supabase/functions/redpay-webhook/verify.test.ts
//   (Deno 미설치 환경에서는 CI/supervisor 측 deno test 로 실행. tsc 빌드에는 미포함.)

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hmacSha256Hex,
  constantTimeEqual,
  verifySignature,
  isPaymentAutoModeOn,
  classifyEvent,
  coerceAmount,
  validateEnvelope,
  normalizeStatus,
  parseTimestamp,
  buildWebhookRawRow,
  type RedpayWebhookData,
} from "./verify.ts";
import {
  centerForMerchant,
  isAllowedBusinessNo,
  normalizeBusinessNo,
} from "../_shared/redpay-foot-merchants.ts";

// 테스트 전용 HMAC 키 픽스처(실 시크릿 아님 — 단위테스트 결정성용 상수).
const HMAC_KEY_FIXTURE = ["unit", "test", "fixture", "key"].join("-");

function baseEnvelope() {
  return {
    event_id: "evt_0001",
    event_type: "payment.approved",
    occurred_at: "2026-07-22T17:00:00+09:00",
    data: {
      business_no: "511-60-00988",
      merchant_id: "1777285001", // foot 26-set
      merchant_name: "오블리브 종로 풋",
      tid: "T0001",
      trxid: "TRX123",
      approval_no: "A987",
      amount: 120000,
      status: "Y",
    },
  };
}

Deno.test("서명: 유효 서명 통과 / 위조 서명 reject", async () => {
  const body = JSON.stringify(baseEnvelope());
  const sig = await hmacSha256Hex(body, HMAC_KEY_FIXTURE);
  assert(await verifySignature(body, sig, HMAC_KEY_FIXTURE), "유효 서명은 통과해야");
  assertFalse(await verifySignature(body, "deadbeef", HMAC_KEY_FIXTURE), "위조 서명은 reject");
  assertFalse(await verifySignature(body, sig, "wrong_secret"), "다른 secret 은 reject");
  assertFalse(await verifySignature(body, null, HMAC_KEY_FIXTURE), "서명 헤더 부재 → reject");
  // 대문자 hex 도 정규화되어 통과
  assert(await verifySignature(body, sig.toUpperCase(), HMAC_KEY_FIXTURE), "대문자 hex 정규화 통과");
});

Deno.test("서명: raw body 재직렬화 민감성(공백 1개만 달라도 불일치)", async () => {
  const body = JSON.stringify(baseEnvelope());
  const sig = await hmacSha256Hex(body, HMAC_KEY_FIXTURE);
  const reserialized = JSON.stringify(JSON.parse(body)) + " ";
  assertFalse(await verifySignature(reserialized, sig, HMAC_KEY_FIXTURE), "재직렬화 바디는 불일치");
});

Deno.test("constant-time 비교: 값·길이", () => {
  assert(constantTimeEqual("abc", "abc"));
  assertFalse(constantTimeEqual("abc", "abd"));
  assertFalse(constantTimeEqual("abc", "abcd"));
});

Deno.test("취소 판별: event_type/status 기준(금액 부호 무관, AC-2.4)", () => {
  assertEquals(classifyEvent("payment.approved"), "approved");
  assertEquals(classifyEvent("payment.cancelled"), "cancelled");
  assertEquals(classifyEvent("payment.canceled"), "cancelled");
  assertEquals(classifyEvent("payment.unknown"), "unsupported");
  // cancelled 이면서 amount 양수여도 cancelled 로 분류
  const cancelEnv = { ...baseEnvelope(), event_type: "payment.cancelled", event_id: "evt_c1" };
  cancelEnv.data = { ...cancelEnv.data, amount: 120000, status: "N" }; // 양수 amount
  const v = validateEnvelope(cancelEnv);
  assert(v.ok);
  if (v.ok) assertEquals(v.kind, "cancelled");
});

Deno.test("amount 강제 정수화", () => {
  assertEquals(coerceAmount(120000), 120000);
  assertEquals(coerceAmount("120,000"), 120000);
  assertEquals(coerceAmount("120000.9"), 120000);
  assertEquals(coerceAmount(null), null);
  assertEquals(coerceAmount("abc"), null);
});

Deno.test("payload 검증: 필수 필드", () => {
  assert(validateEnvelope(baseEnvelope()).ok);
  assertFalse(validateEnvelope(null).ok);
  assertFalse(validateEnvelope({ ...baseEnvelope(), event_id: "" }).ok);
  assertFalse(validateEnvelope({ ...baseEnvelope(), event_type: "foo" }).ok);
  const noTrx = baseEnvelope(); noTrx.data.trxid = "";
  assertFalse(validateEnvelope(noTrx).ok);
});

Deno.test("센터 분리: merchant 화이트리스트 (AC-2.5)", () => {
  assertEquals(centerForMerchant("1777285001"), "foot");
  assertEquals(centerForMerchant("1777289013"), "foot");
  assertEquals(centerForMerchant("1777274001"), "body");
  assertEquals(centerForMerchant("9999999999"), "unknown");
  assertEquals(centerForMerchant(null), "unknown");
  assertEquals(centerForMerchant(""), "unknown");
});

Deno.test("business_no 방어 필터 (AC-2.6, 서울오리진)", () => {
  // 미설정 = pass-through(setup-safe)
  assert(isAllowedBusinessNo("511-60-00988", ""));
  // 하이픈 무관 정규화 비교
  assert(isAllowedBusinessNo("511-60-00988", "5116000988"));
  assert(isAllowedBusinessNo("5116000988", "511-60-00988"));
  // 복수 허용(mutable cert 정정 대비 CSV)
  assert(isAllowedBusinessNo("457-60-00988", "511-60-00988,457-60-00988"));
  // 불일치 → drop
  assertFalse(isAllowedBusinessNo("123-45-67890", "511-60-00988"));
  assertEquals(normalizeBusinessNo("511-60-00988"), "5116000988");
});

Deno.test("피처플래그 PAYMENT_AUTO_MODE (AC-4)", () => {
  assert(isPaymentAutoModeOn("on"));
  assert(isPaymentAutoModeOn("ON"));
  assert(isPaymentAutoModeOn("true"));
  assertFalse(isPaymentAutoModeOn("off"));
  assertFalse(isPaymentAutoModeOn(""));
  assertFalse(isPaymentAutoModeOn(undefined));
  assertFalse(isPaymentAutoModeOn("0"));
});

Deno.test("멱등 키 일관성: 동일 event → 동일 (trxid,status,amount)", () => {
  // 웹훅 재수신(레드페이 재시도) 시 동일 payload → 동일 유니크 키 → upsert no-op.
  const e1 = validateEnvelope(baseEnvelope());
  const e2 = validateEnvelope(baseEnvelope());
  assert(e1.ok && e2.ok);
  if (e1.ok && e2.ok) {
    const k1 = `${e1.data.trxid}|${e1.status}|${e1.amount}`;
    const k2 = `${e2.data.trxid}|${e2.status}|${e2.amount}`;
    assertEquals(k1, k2, "동일 이벤트는 동일 멱등 키");
  }
});

// ── DA req d: status 정규화 (data.status 우선 → event_type 파생) ────────────────
Deno.test("status 정규화: data.status 우선, 없거나 비표준이면 event_type 파생", () => {
  assertEquals(normalizeStatus("Y", "approved"), "Y");
  assertEquals(normalizeStatus("n", "approved"), "N");   // 대소문자 무관
  assertEquals(normalizeStatus("M", "cancelled"), "M");
  assertEquals(normalizeStatus("X", "approved"), "X");
  // 비표준/누락 → kind 파생
  assertEquals(normalizeStatus("approved", "approved"), "Y");
  assertEquals(normalizeStatus("", "approved"), "Y");
  assertEquals(normalizeStatus(null, "cancelled"), "N");
  assertEquals(normalizeStatus(undefined, "cancelled"), "N");
});

Deno.test("validateEnvelope: status 누락 시 reject 하지 않고 event_type 파생(폴러 도메인 수렴)", () => {
  const noStatus = baseEnvelope();
  // @ts-expect-error 테스트: status 누락 payload 시뮬레이션
  delete noStatus.data.status;
  const v = validateEnvelope(noStatus);
  assert(v.ok, "status 누락이어도 검증 통과(파생)");
  if (v.ok) assertEquals(v.status, "Y", "approved → Y 파생");

  const cancelNoStatus = { ...baseEnvelope(), event_type: "payment.cancelled", event_id: "evt_cns" };
  cancelNoStatus.data = { ...cancelNoStatus.data };
  // @ts-expect-error 테스트: status 누락
  delete cancelNoStatus.data.status;
  const vc = validateEnvelope(cancelNoStatus);
  assert(vc.ok);
  if (vc.ok) assertEquals(vc.status, "N", "cancelled → N 파생");
});

// ── occurred_at 파싱 ─────────────────────────────────────────────────────────
Deno.test("parseTimestamp: ISO(오프셋) 그대로 / KST 무TZ → +09:00 / 빈값·0000 → null", () => {
  assertEquals(parseTimestamp("2026-07-22T17:00:00+09:00"), "2026-07-22T08:00:00.000Z");
  assertEquals(parseTimestamp("2026-07-22 17:00:00"), "2026-07-22T08:00:00.000Z"); // KST 가정
  assertEquals(parseTimestamp(""), null);
  assertEquals(parseTimestamp(null), null);
  assertEquals(parseTimestamp("0000-00-00 00:00:00"), null);
});

// ── DA req a/b/c: merge-safe webhook row builder ─────────────────────────────
Deno.test("buildWebhookRawRow (DA req a): 폴러 소유 컬럼 미포함(클로버 방지)", () => {
  const env = baseEnvelope();
  const v = validateEnvelope(env);
  assert(v.ok);
  if (!v.ok) return;
  const row = buildWebhookRawRow("clinic-uuid", v.kind, v.status, String(v.data.trxid), v.amount, v.data, env);
  // 폴러(redpay-reconcile)가 채우는 컬럼은 절대 포함되면 안 됨.
  assertFalse("tid" in row, "tid 미포함");
  assertFalse("root_trxid" in row, "root_trxid 미포함");
  assertFalse("matched_payment_id" in row, "matched_payment_id 미포함");
  assertFalse("match_rule" in row, "match_rule 미포함");
  // webhook 소유 컬럼은 포함.
  assertEquals(row.external_trxid, "TRX123");
  assertEquals(row.external_status, "Y");
  assertEquals(row.amount, 120000);
  assertEquals(row.approval_no, "A987");
  assertEquals(row.clinic_id, "clinic-uuid");
});

Deno.test("buildWebhookRawRow (DA req b): raw_payload _source:'webhook' 마커 + 원본 전량", () => {
  const env = baseEnvelope();
  const v = validateEnvelope(env);
  assert(v.ok);
  if (!v.ok) return;
  const row = buildWebhookRawRow("clinic-uuid", v.kind, v.status, String(v.data.trxid), v.amount, v.data, env);
  const rp = row.raw_payload as Record<string, unknown>;
  assertEquals(rp._source, "webhook", "출처 마커 필수");
  assertEquals(rp.event_id, "evt_0001");
  assertEquals(rp.event_type, "payment.approved");
  assertEquals(rp.occurred_at, "2026-07-22T17:00:00+09:00");
  assert(rp.data && typeof rp.data === "object", "data 전량 중첩");
});

Deno.test("buildWebhookRawRow (DA req c): approved_at / cancelled_at 한쪽만 세팅", () => {
  // approved → approved_at 만
  const apEnv = baseEnvelope();
  const av = validateEnvelope(apEnv);
  assert(av.ok);
  if (av.ok) {
    const row = buildWebhookRawRow("c", av.kind, av.status, String(av.data.trxid), av.amount, av.data, apEnv);
    assert("approved_at" in row, "approved 는 approved_at 세팅");
    assertFalse("cancelled_at" in row, "approved 는 cancelled_at 미세팅");
  }
  // cancelled → cancelled_at 만 (payload 에 approved_at 이 섞여 있어도)
  const base = baseEnvelope();
  const cnEnv = {
    event_id: "evt_cn1",
    event_type: "payment.cancelled",
    occurred_at: "2026-07-22T18:00:00+09:00",
    data: { ...base.data, status: "N", approved_at: "2026-07-22T17:00:00+09:00" } as RedpayWebhookData,
  };
  const cv = validateEnvelope(cnEnv);
  assert(cv.ok);
  if (cv.ok) {
    const row = buildWebhookRawRow("c", cv.kind, cv.status, String(cv.data.trxid), cv.amount, cv.data, cnEnv);
    assert("cancelled_at" in row, "cancelled 는 cancelled_at 세팅");
    assertFalse("approved_at" in row, "cancelled 는 approved_at 미세팅(양쪽 동시 금지)");
  }
});
