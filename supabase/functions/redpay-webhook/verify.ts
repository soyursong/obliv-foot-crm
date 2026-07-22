// redpay-webhook/verify.ts — 서명검증·멱등·라우팅 순수 함수 모듈
//
// T-20260722-foot-REDPAY-WEBHOOK-RECV-EF (P1, 최필경 C0ATE5P6JTH · 결제자동화 플랜B)
//   longre T-20260607-crm-REDPAY-WEBHOOK-RT(e7a0607) 패턴 이식.
//   Supabase/Deno 런타임 의존을 index.ts 에 격리하고, 검증 가능한 순수 로직만 여기 둔다
//   (redpay-reconcile/guard.ts 와 동일한 "순수함수=단위테스트" 패턴).
//
// ── AC-2 핵심 안전요건 ────────────────────────────────────────────────────────
//   1. 서명검증: X-WEBHOOK-SIGNATURE = HMAC-SHA256(raw body, secret) 소문자 hex.
//      raw body 그대로(재직렬화 금지) + constant-time 비교.
//   2. 멱등: event_id + (trxid,status,amount) 유니크 키(폴러 적재분과 충돌 없음).
//   4. 취소 판별: event_type/status 기준(금액 부호 금지).

// ── HMAC-SHA256 (SubtleCrypto, Deno 내장 — 신규 패키지 없음) ──────────────────
//   send-notification/index.ts 의 hmacSha256 과 동일 구현(소문자 hex).
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time 문자열 비교(타이밍 공격 방어).
 *   길이가 다르면 즉시 false 지만, 같은 길이 케이스는 전 바이트를 XOR 누적해
 *   early-return 없이 비교(AC-2.1 constant-time 요건).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 서명 검증.
 *   rawBody = 수신한 원문 바디 문자열(재직렬화 금지 — 반드시 req.text() 원문).
 *   headerSig = X-WEBHOOK-SIGNATURE 헤더값(소문자 hex 기대).
 *   secret = REDPAY_WEBHOOK_SECRET.
 *   비교는 소문자 정규화 후 constant-time.
 */
export async function verifySignature(
  rawBody: string,
  headerSig: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret || !headerSig) return false;
  const expected = await hmacSha256Hex(rawBody, secret);
  return constantTimeEqual(expected, headerSig.trim().toLowerCase());
}

// ── 피처플래그 (AC-4) ────────────────────────────────────────────────────────
//   PAYMENT_AUTO_MODE — 신규 자동화(push 적재) ON/OFF 토글.
//   기본값 = OFF(safe). 문제 발생 시 즉시 기존 수기/폴러 방식으로 롤백.
//     · OFF → 검증 + 2xx 응답 보장하되 임시 수납 레코드 미생성(수기 흐름 무영향).
//     · ON  → redpay_raw_transactions 로 push 적재(임시 수납 레코드 생성).
export function isPaymentAutoModeOn(envValue: string | null | undefined): boolean {
  return (envValue ?? "").trim().toLowerCase() === "on"
    || (envValue ?? "").trim().toLowerCase() === "true";
}

// ── 이벤트 라우팅 (AC-2.4 / AC-3) ─────────────────────────────────────────────
export type RedpayEventKind = "approved" | "cancelled" | "unsupported";

/**
 * event_type → 처리 종류.
 *   금액 부호로 판별 금지 — event_type(우선) / status 로만 판별(AC-2.4).
 *   payment.cancelled 도 amount 양수일 수 있음.
 */
export function classifyEvent(eventType: string | null | undefined): RedpayEventKind {
  const t = (eventType ?? "").trim().toLowerCase();
  if (t === "payment.approved") return "approved";
  if (t === "payment.cancelled" || t === "payment.canceled") return "cancelled";
  return "unsupported";
}

// ── 웹훅 payload 타입 (레드페이 파트너 API) ───────────────────────────────────
export interface RedpayWebhookData {
  business_no?: string | null;
  merchant_id?: string | null;
  merchant_name?: string | null;
  tid?: string | null;
  trxid?: string | null;
  approval_no?: string | null;
  amount?: number | string | null;
  status?: string | null;
  root_trxid?: string | null;
  cancelled_at?: string | null;
  approved_at?: string | null;
  [key: string]: unknown;
}

export interface RedpayWebhookEnvelope {
  event_id?: string | null;
  event_type?: string | null;
  occurred_at?: string | null;
  data?: RedpayWebhookData | null;
  [key: string]: unknown;
}

/** amount 를 정수로 강제(문자열/부동소수 방어). 파싱 불가 → null. */
export function coerceAmount(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export type ValidationResult =
  | { ok: true; kind: Exclude<RedpayEventKind, "unsupported">; eventId: string; data: RedpayWebhookData; amount: number }
  | { ok: false; reason: string };

/**
 * payload 필수 필드 검증 + 라우팅.
 *   필수: event_id, event_type(approved|cancelled), data.trxid, data.status, amount(정수).
 */
export function validateEnvelope(env: RedpayWebhookEnvelope | null | undefined): ValidationResult {
  if (!env || typeof env !== "object") return { ok: false, reason: "empty_or_non_object_body" };
  const eventId = (env.event_id ?? "").toString().trim();
  if (eventId === "") return { ok: false, reason: "missing_event_id" };

  const kind = classifyEvent(env.event_type);
  if (kind === "unsupported") return { ok: false, reason: `unsupported_event_type:${env.event_type ?? "∅"}` };

  const data = env.data;
  if (!data || typeof data !== "object") return { ok: false, reason: "missing_data" };

  const trxid = (data.trxid ?? "").toString().trim();
  if (trxid === "") return { ok: false, reason: "missing_trxid" };

  const status = (data.status ?? "").toString().trim();
  if (status === "") return { ok: false, reason: "missing_status" };

  const amount = coerceAmount(data.amount);
  if (amount == null) return { ok: false, reason: "invalid_amount" };

  return { ok: true, kind, eventId, data, amount };
}
