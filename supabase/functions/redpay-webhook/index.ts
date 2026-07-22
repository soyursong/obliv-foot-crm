// T-20260722-foot-REDPAY-WEBHOOK-RECV-EF — Edge Function: redpay-webhook (풋센터)
//
// 결제자동화 플랜B. 레드페이(카드결제 단말 회사) → 우리 서버 push 수신단.
//   현행은 redpay-reconcile(폴러/대사, 우리→레드페이 pull)만 존재. 본 EF 는 정반대 방향
//   (레드페이→우리 push) 수신 창구를 신설. 폴러는 백스톱으로 유지(이중화, 상보).
//
//   패턴 정본: longre T-20260607-crm-REDPAY-WEBHOOK-RT(deploy_commit e7a0607) 이식.
//   foot 변형: merchant_id 화이트리스트(26-set)·서울오리진 business_no 방어필터.
//
// ── AC 요약 ───────────────────────────────────────────────────────────────────
//   AC-1 supabase/functions/redpay-webhook/index.ts 신설.
//   AC-2 서명검증(HMAC-SHA256 raw body·constant-time) / event_id·(trxid,status,amount) 멱등 /
//        정상수신 2xx 보장 / 취소 판별=event_type·status(금액부호 금지) /
//        merchant_id 화이트리스트 센터분리(미등록→Slack) / business_no(서울오리진) 방어필터 /
//        원본 payload raw 전량 저장(redpay_raw_transactions.raw_payload = 기존 테이블 재사용).
//   AC-3 payment.approved → 임시 수납 레코드(redpay_raw_transactions, matched_payment_id NULL) 생성.
//        payment.cancelled → 해당 trxid 취소 레코드 적재. (환자-차트 배정 UI = 별도 스펙)
//   AC-4 PAYMENT_AUTO_MODE 피처플래그 ON/OFF. 기본 OFF. 기존 수기입력 흐름 절대 제거 금지.
//
// ── DB 게이트 (db_change) ─────────────────────────────────────────────────────
//   신규 테이블/컬럼/enum 추가 없음. 기존 redpay_raw_transactions(20260607190000_pay_recon_port.sql)
//   재사용 — 유니크 키 (external_trxid,external_status,amount) 가 폴러와 동일 → 폴러/웹훅 이중
//   적재 멱등 충돌 없음(conflict_gate REDEFINITION_RISK 해소). raw_payload JSONB = 전량 저장.
//   ⇒ ADDITIVE-reuse, DA CONSULT 대상 신규 오브젝트 없음(재사용으로 게이트 충족).
//
// ── 환경 변수 ─────────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — 자동 주입
//   REDPAY_WEBHOOK_SECRET   — X-WEBHOOK-SIGNATURE 검증 시크릿(env/vault, 평문 git 금지)
//   PAYMENT_AUTO_MODE       — 'on'(활성) / 그 외(기본 OFF, 수기/폴러 유지). 롤백 스위치.
//   REDPAY_CLINIC_SLUG      — clinic 해석 안정키(기본 'jongno-foot'). business_no mutable 회피.
//   REDPAY_WEBHOOK_BUSINESS_NO_ALLOW — 허용 사업자번호 CSV(미설정 시 REDPAY_BUSINESS_NO fallback)
//   REDPAY_BUSINESS_NO      — 서울오리진 풋 사업자번호(방어필터 fallback allow)
//   REDPAY_ALERT_CHANNEL    — 미등록 merchant 알림 Slack 채널(비면 로그만)
//   REDPAY_SLACK_BOT_TOKEN  — 장쳰봇 토큰

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  centerForMerchant,
  isAllowedBusinessNo,
} from "../_shared/redpay-foot-merchants.ts";
import {
  verifySignature,
  isPaymentAutoModeOn,
  validateEnvelope,
  type RedpayWebhookEnvelope,
  type RedpayWebhookData,
} from "./verify.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDPAY_WEBHOOK_SECRET     = Deno.env.get("REDPAY_WEBHOOK_SECRET") ?? "";
const PAYMENT_AUTO_MODE         = Deno.env.get("PAYMENT_AUTO_MODE") ?? "";
const REDPAY_CLINIC_SLUG        = Deno.env.get("REDPAY_CLINIC_SLUG") ?? "jongno-foot";
const REDPAY_BUSINESS_NO_ALLOW  = Deno.env.get("REDPAY_WEBHOOK_BUSINESS_NO_ALLOW")
  ?? Deno.env.get("REDPAY_BUSINESS_NO") ?? "";
const REDPAY_ALERT_CHANNEL      = Deno.env.get("REDPAY_ALERT_CHANNEL") ?? "";
const REDPAY_SLACK_BOT_TOKEN    = Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LOG = "[redpay-webhook][foot]";

// ── 응답 헬퍼 ─────────────────────────────────────────────────────────────────
//   정상 처리/의도적 drop = 200(레드페이 재시도 불필요). 위조서명 = 401(재시도 무의미).
//   일시 오류(DB 등) = 500(레드페이 재시도로 유실 방지, 최대 3회 1분/5분/30분).
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── Slack 알림 (미등록 merchant) — redpay-reconcile 과 동일 구현 ─────────────────
async function sendSlackMessage(channel: string, text: string, token: string): Promise<boolean> {
  if (!channel || !token) {
    console.warn(`${LOG}[SLACK] 채널/토큰 미설정 → 로그만: ${text}`);
    return false;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(`${LOG}[SLACK] 발송 실패: ${data.error} (channel=${channel})`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG}[SLACK] 발송 예외: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ── KST("YYYY-MM-DD HH:MM:SS") / ISO occurred_at → UTC ISO (redpay-reconcile 미러) ──
function parseTimestamp(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v || v.startsWith("0000")) return null;
  // ISO(오프셋 포함) 는 그대로, "YYYY-MM-DD HH:MM:SS"(KST) 는 +09:00 부착.
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v);
  const iso = hasTz ? v.replace(" ", "T") : (v.replace(" ", "T") + "+09:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── clinic_id 해석(slug 안정키, 요청 단위 캐시) ──────────────────────────────────
let _clinicIdCache: string | null = null;
async function resolveClinicId(): Promise<string | null> {
  if (_clinicIdCache) return _clinicIdCache;
  const { data, error } = await supabase
    .from("clinics").select("id").eq("slug", REDPAY_CLINIC_SLUG).maybeSingle();
  if (error || !data) {
    console.error(`${LOG}[clinic] slug=${REDPAY_CLINIC_SLUG} 해석 실패: ${error?.message ?? "not found"}`);
    return null;
  }
  _clinicIdCache = data.id as string;
  return _clinicIdCache;
}

// ── redpay_raw_transactions 행 빌드 (임시 수납 레코드) ────────────────────────────
//   금액·승인번호·시각·센터(merchant)·단말기(tid) 자동 채움(AC-3). matched_payment_id 는
//   NULL(미배정) — 환자-차트 반자동 배정 UI(별도 스펙)에서 연결. raw_payload = 전량 원본(감사).
function buildRawRow(
  clinicId: string,
  kind: "approved" | "cancelled",
  data: RedpayWebhookData,
  amount: number,
  fullEnvelope: RedpayWebhookEnvelope,
) {
  const trxid = String(data.trxid).trim();
  const status = String(data.status).trim();
  const approvedAt  = kind === "approved"  ? parseTimestamp(data.approved_at ?? fullEnvelope.occurred_at) : parseTimestamp(data.approved_at);
  const cancelledAt = kind === "cancelled" ? parseTimestamp(data.cancelled_at ?? fullEnvelope.occurred_at) : parseTimestamp(data.cancelled_at);
  const rootTrxid = data.root_trxid && String(data.root_trxid).trim() !== "" ? String(data.root_trxid).trim() : null;

  return {
    clinic_id:       clinicId,
    external_trxid:  trxid,
    external_status: status,
    // amount 원부호 보존 — 취소 판별은 status/event_type 로 이미 완료(AC-2.4, 부호 무판별).
    amount,
    approval_no:     data.approval_no ?? null,
    root_trxid:      rootTrxid,
    tid:             data.tid ?? null,
    approved_at:     approvedAt,
    cancelled_at:    cancelledAt,
    // 원본 payload 전량 저장(event_id·occurred_at 포함) — 감사·재검증·멱등 추적.
    raw_payload:     fullEnvelope,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  // ── 1. raw body 원문 확보(재직렬화 금지 — 서명검증은 반드시 원문 기준) ──────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { ok: false, error: "body_read_failed" });
  }

  // ── 2. 서명 검증 (AC-2.1) ─────────────────────────────────────────────────────
  const headerSig = req.headers.get("X-WEBHOOK-SIGNATURE") ?? req.headers.get("x-webhook-signature");
  if (!REDPAY_WEBHOOK_SECRET) {
    // 시크릿 미설정(활성화 전) — 처리 없이 2xx(레드페이 재시도 폭주 방지). 검증 불가이므로 무처리.
    console.warn(`${LOG} REDPAY_WEBHOOK_SECRET 미설정 → 검증 불가, 무처리(200 ignored).`);
    return json(200, { ok: true, status: "ignored_secret_unset" });
  }
  const sigOk = await verifySignature(rawBody, headerSig, REDPAY_WEBHOOK_SECRET);
  if (!sigOk) {
    console.warn(`${LOG} 서명 검증 실패 → 401 reject(위조 의심).`);
    return json(401, { ok: false, error: "invalid_signature" });
  }

  // ── 3. payload 파싱 + 검증 ───────────────────────────────────────────────────
  let envelope: RedpayWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as RedpayWebhookEnvelope;
  } catch {
    console.error(`${LOG} 서명 유효하나 JSON 파싱 불가 → 200 ignored(재시도 무의미).`);
    return json(200, { ok: true, status: "ignored_unparseable" });
  }

  const v = validateEnvelope(envelope);
  if (!v.ok) {
    console.warn(`${LOG} payload 검증 실패(${v.reason}) → 200 ignored.`);
    return json(200, { ok: true, status: "ignored_invalid", reason: v.reason });
  }
  const { kind, eventId, data, amount } = v;

  // ── 4. business_no 방어 필터 (AC-2.6, 서울오리진) ────────────────────────────
  if (!isAllowedBusinessNo(data.business_no, REDPAY_BUSINESS_NO_ALLOW)) {
    console.warn(`${LOG} business_no 방어필터 drop (business_no=${data.business_no ?? "∅"}, event_id=${eventId}).`);
    return json(200, { ok: true, status: "dropped_business_no" });
  }

  // ── 5. 센터 분리 — merchant_id 화이트리스트 (AC-2.5) ─────────────────────────
  const center = centerForMerchant(data.merchant_id);
  if (center === "unknown") {
    // 미등록 merchant → Slack 알림(운영 확인) + 미적재.
    await sendSlackMessage(
      REDPAY_ALERT_CHANNEL,
      `⚠️ [redpay-webhook] 미등록 merchant_id 수신 — 화이트리스트 확인 필요\n`
        + `merchant_id=${data.merchant_id ?? "∅"} / merchant_name=${data.merchant_name ?? "∅"}\n`
        + `tid=${data.tid ?? "∅"} / trxid=${data.trxid ?? "∅"} / event_id=${eventId}\n`
        + `→ registry(redpay_terminal_registry) 등록 여부 확인.`,
      REDPAY_SLACK_BOT_TOKEN,
    );
    console.warn(`${LOG} 미등록 merchant_id=${data.merchant_id ?? "∅"} → Slack 알림 + 미적재.`);
    return json(200, { ok: true, status: "unknown_merchant_alerted" });
  }
  if (center === "body") {
    // 도수(body) 단말 — foot 웹훅 스코프 밖(타 센터) → drop.
    console.log(`${LOG} body 센터 merchant(id=${data.merchant_id}) → foot 스코프 외 drop.`);
    return json(200, { ok: true, status: "dropped_other_center" });
  }

  // ── 6. 피처플래그 (AC-4) — OFF 면 임시 수납 레코드 미생성(수기/폴러 흐름 무영향) ──
  if (!isPaymentAutoModeOn(PAYMENT_AUTO_MODE)) {
    console.log(`${LOG} PAYMENT_AUTO_MODE OFF → 검증 통과·2xx 응답하되 적재 skip (event_id=${eventId}).`);
    return json(200, { ok: true, status: "skipped_flag_off" });
  }

  // ── 7. 적재 (임시 수납 레코드 / 취소 레코드) — 멱등 upsert (AC-2.2 / AC-3) ────────
  const clinicId = await resolveClinicId();
  if (!clinicId) {
    // clinic 해석 실패 = 일시 장애로 간주 → 500(레드페이 재시도로 유실 방지).
    return json(500, { ok: false, error: "clinic_resolve_failed" });
  }

  const row = buildRawRow(clinicId, kind, data, amount, envelope);
  try {
    // onConflict (external_trxid, external_status, amount) = 폴러와 동일 유니크 키.
    //   ignoreDuplicates:true → 중복 event_id 재수신(레드페이 재시도)·폴러 선점 적재 = no-op 멱등.
    const { error, count } = await supabase
      .from("redpay_raw_transactions")
      .upsert(row, {
        onConflict: "external_trxid,external_status,amount",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) {
      console.error(`${LOG} upsert 오류 → 500(재시도 유도): ${error.message} (event_id=${eventId}).`);
      return json(500, { ok: false, error: "db_upsert_failed" });
    }
    const inserted = (count ?? 0) > 0;
    console.log(
      `${LOG} ${kind} 적재 ${inserted ? "신규" : "멱등중복(무시)"} — `
        + `trxid=${row.external_trxid} status=${row.external_status} amount=${row.amount} event_id=${eventId}.`,
    );
    return json(200, {
      ok: true,
      status: inserted ? "recorded" : "duplicate_ignored",
      kind,
      event_id: eventId,
    });
  } catch (err) {
    // 예기치 못한 예외도 500 — 유실보다 재시도가 안전(멱등 보장됨).
    console.error(`${LOG} 처리 예외 → 500: ${err instanceof Error ? err.message : String(err)} (event_id=${eventId}).`);
    return json(500, { ok: false, error: "unexpected_error" });
  }
});
