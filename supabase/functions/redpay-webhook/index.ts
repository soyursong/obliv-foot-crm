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
//   PAYMENT_AUTO_MODE       — 3-state 단일 토글: 'observe'(관측 전용 적재·매칭 미발화) /
//                             'on'|'true'(auto 적재·폴러 매칭) / 그 외(기본 off, 수기/폴러 유지). 롤백 스위치.
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
  resolvePaymentMode,
  validateEnvelope,
  buildWebhookRawRow,
  type RedpayWebhookEnvelope,
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
  const { kind, eventId, data, amount, status } = v;

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

  // ── 6. 피처플래그 (AC-4 + 관측모드) — 3-state: off / observe / auto ──────────────
  //   off     → 적재 skip(수기/폴러 흐름 무영향). 현행 100% 동일(롤백 스위치).
  //   observe → raw 전량 적재 + received_at 기록 + _mode:'observe' 마커. ★ 매칭·payments write 미발화.
  //   auto    → raw 적재(폴러가 후속 매칭). 향후 풀오토(이번 build 범위 밖이나 하위호환 보존).
  const mode = resolvePaymentMode(PAYMENT_AUTO_MODE);
  if (mode === "off") {
    console.log(`${LOG} PAYMENT_AUTO_MODE off → 검증 통과·2xx 응답하되 적재 skip (event_id=${eventId}).`);
    return json(200, { ok: true, status: "skipped_flag_off" });
  }

  // ── 7. 적재 (관측/auto 공통 raw upsert) — 멱등 upsert (AC-2.2 / AC-3) ────────────
  const clinicId = await resolveClinicId();
  if (!clinicId) {
    // clinic 해석 실패 = 일시 장애로 간주 → 500(레드페이 재시도로 유실 방지).
    return json(500, { ok: false, error: "clinic_resolve_failed" });
  }

  // 웹훅 수신시각 = 서버 now(occurred_at 대비 지연 관측 기준). received_at 컬럼(DDL-BUILD)에 기입.
  const receivedAtIso = new Date().toISOString();

  // merge-safe row builder(DA req a/b/c): 폴러 소유 컬럼(tid/root_trxid/matched_payment_id/
  //   match_rule) 미포함 + raw_payload _source:"webhook"+_mode 마커 + approved_at/cancelled_at 한쪽만
  //   + received_at(수신시각). observe 모드는 _mode:'observe' 로 폴러 매칭에서 제외된다.
  const row = buildWebhookRawRow(
    clinicId, kind, status, String(data.trxid).trim(), amount, data, envelope, mode, receivedAtIso,
  );

  // ── ★ AC-2 안전 자기검증 (관측 전용 무접촉 불변식) ──────────────────────────────
  //   observe/auto 공통: 웹훅은 payments/pending_payment 에 write 하지 않는다. row 빌더가
  //   폴러/매칭 소유 컬럼(matched_payment_id/match_rule)을 절대 포함하지 않음을 런타임 재확인.
  //   위반 시 즉시 중단(500) — 관측이 실 매출/매칭을 건드릴 위험을 코드레벨 차단.
  if ("matched_payment_id" in row || "match_rule" in row) {
    console.error(`${LOG}[SAFETY] row 에 매칭 소유 컬럼 혼입 감지 → 적재 중단(관측 무접촉 위반). event_id=${eventId}.`);
    return json(500, { ok: false, error: "observe_safety_violation" });
  }
  if (mode === "observe") {
    console.log(
      `${LOG}[OBSERVE] 관측 전용 적재 — raw+received_at 저장, 매칭(pending_payment)·payments write 미발화(0건). ` +
        `event_id=${eventId} trxid=${row.external_trxid} received_at=${receivedAtIso}.`,
    );
  }
  try {
    // onConflict (external_trxid, external_status, amount) = 폴러와 동일 유니크 키.
    //   ignoreDuplicates:false → onConflict DO UPDATE(longre e7a0607 이식). merge-safe 빌더가
    //   폴러 소유 컬럼을 payload 에서 제외하므로 UPDATE 는 webhook 소유 컬럼만 갱신,
    //   폴러가 채운 tid/root_trxid/matched_payment_id/match_rule 은 보존(클로버 방지).
    //   재전송(동일 event_id)·폴러 선행 적재 모두 동일 행에 수렴 → 이중적재 없음(멱등).
    const { error } = await supabase
      .from("redpay_raw_transactions")
      .upsert(row, {
        onConflict: "external_trxid,external_status,amount",
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`${LOG} upsert 오류 → 500(재시도 유도): ${error.message} (event_id=${eventId}).`);
      return json(500, { ok: false, error: "db_upsert_failed" });
    }
    console.log(
      `${LOG} ${kind} 적재(멱등 upsert, mode=${mode}) — `
        + `trxid=${row.external_trxid} status=${row.external_status} amount=${row.amount} event_id=${eventId}.`,
    );
    return json(200, {
      ok: true,
      status: mode === "observe" ? "observed" : "recorded",
      mode,
      kind,
      event_id: eventId,
    });
  } catch (err) {
    // 예기치 못한 예외도 500 — 유실보다 재시도가 안전(멱등 보장됨).
    console.error(`${LOG} 처리 예외 → 500: ${err instanceof Error ? err.message : String(err)} (event_id=${eventId}).`);
    return json(500, { ok: false, error: "unexpected_error" });
  }
});
