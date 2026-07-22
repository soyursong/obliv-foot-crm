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

// ── 상태 정규화 (AC-2 / DA req d) ─────────────────────────────────────────────
//   external_status 는 폴러(redpay-reconcile)와 반드시 동일 도메인(Y/N/M/X)이어야
//   멱등 유니크 키 (external_trxid,external_status,amount) 로 같은 행에 수렴한다.
//   → data.status 우선(이미 Y/N/M/X 면 그대로), 없거나 비표준이면 event_type(kind) 파생.
//     approved→Y / cancelled→N. (부분환불 M·강제취소 X 는 폴러가 보정.)
export type RedpayExternalStatus = "Y" | "N" | "M" | "X";

export function normalizeStatus(
  rawStatus: string | null | undefined,
  kind: Exclude<RedpayEventKind, "unsupported">,
): RedpayExternalStatus {
  const s = (rawStatus ?? "").trim().toUpperCase();
  if (s === "Y" || s === "N" || s === "M" || s === "X") return s;
  return kind === "approved" ? "Y" : "N";
}

// ── occurred_at 파싱: ISO(오프셋 포함)/KST("YYYY-MM-DD HH:MM:SS") → UTC ISO ──────
//   redpay-reconcile parseKstDatetime 미러(TZ 미명시 → KST +09:00 가정).
export function parseTimestamp(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v || v.startsWith("0000")) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v);
  const iso = hasTz ? v.replace(" ", "T") : (v.replace(" ", "T") + "+09:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── merge-safe webhook → redpay_raw_transactions 행 빌더 (DA req a/b/c) ──────────
//   ⚠ 폴러 소유 컬럼 (tid, root_trxid, matched_payment_id, match_rule) 은 절대 미포함.
//     → onConflict UPDATE 시 폴러가 채운 매칭값을 클로버하지 않는다(longre buildWebhookRawRow 이식).
//   ⚠ raw_payload 는 반드시 { _source:"webhook", ... } 마커로 감싼다(폴러 적재분과 출처 구분·감사).
//   ⚠ approved_at / cancelled_at 는 kind 에 따라 한쪽만 세팅(양쪽 동시 금지).
export function buildWebhookRawRow(
  clinicId: string,
  kind: Exclude<RedpayEventKind, "unsupported">,
  status: RedpayExternalStatus,
  trxid: string,
  amount: number,
  data: RedpayWebhookData,
  envelope: RedpayWebhookEnvelope,
): Record<string, unknown> {
  const occurredIso = kind === "approved"
    ? parseTimestamp(data.approved_at ?? envelope.occurred_at)
    : parseTimestamp(data.cancelled_at ?? envelope.occurred_at);

  const row: Record<string, unknown> = {
    clinic_id:       clinicId,
    external_trxid:  trxid,
    external_status: status,
    // amount 원부호 보존 — 취소 판별은 event_type/status 로 완료(AC-2.4, 부호 무판별).
    amount,
    approval_no:     data.approval_no ?? null,
    // 원본 payload 전량 저장 + webhook 출처 마커(감사·재검증·멱등 추적).
    raw_payload: {
      _source:     "webhook",
      event_id:    envelope.event_id ?? null,
      event_type:  envelope.event_type ?? null,
      occurred_at: envelope.occurred_at ?? null,
      data,
    },
  };

  // 승인=approved_at, 취소=cancelled_at — 서로 다른 컬럼만 세팅(한쪽만, 클로버 방지).
  if (occurredIso) {
    if (kind === "approved") row.approved_at = occurredIso;
    else                     row.cancelled_at = occurredIso;
  }

  return row;
}

/** amount 를 정수로 강제(문자열/부동소수 방어). 파싱 불가 → null. */
export function coerceAmount(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export type ValidationResult =
  | {
      ok: true;
      kind: Exclude<RedpayEventKind, "unsupported">;
      eventId: string;
      data: RedpayWebhookData;
      amount: number;
      status: RedpayExternalStatus;
    }
  | { ok: false; reason: string };

/**
 * payload 필수 필드 검증 + 라우팅.
 *   필수: event_id, event_type(approved|cancelled), data.trxid, amount(정수).
 *   status 는 하드-필수 아님 — data.status 우선, 없거나 비표준이면 event_type 파생(DA req d).
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

  const amount = coerceAmount(data.amount);
  if (amount == null) return { ok: false, reason: "invalid_amount" };

  // data.status 우선 → 없거나 비표준이면 event_type(kind) 파생(폴러와 동일 Y/N/M/X 도메인 수렴).
  const status = normalizeStatus(data.status, kind);

  return { ok: true, kind, eventId, data, amount, status };
}
