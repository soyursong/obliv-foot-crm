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
  centerForMerchantWithSet,
  deriveFootMerchantSet,
  isAllowedBusinessNo,
  FOOT_MERCHANT_SET,
  type FootMerchantResolution,
} from "../_shared/redpay-foot-merchants.ts";
import {
  verifySignature,
  resolvePaymentMode,
  validateEnvelope,
  buildWebhookRawRow,
  type RedpayWebhookEnvelope,
} from "./verify.ts";
import {
  isNon2xx,
  isRealWebhookDelivery,
  extractErrorSummary,
  buildNon2xxAlertText,
  makeDedup,
  type Non2xxAlertContext,
} from "./non2xx-alert.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("CRM_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDPAY_WEBHOOK_SECRET     = Deno.env.get("REDPAY_WEBHOOK_SECRET") ?? "";
const PAYMENT_AUTO_MODE         = Deno.env.get("PAYMENT_AUTO_MODE") ?? "";
const REDPAY_CLINIC_SLUG        = Deno.env.get("REDPAY_CLINIC_SLUG") ?? "jongno-foot";
const REDPAY_BUSINESS_NO_ALLOW  = Deno.env.get("REDPAY_WEBHOOK_BUSINESS_NO_ALLOW")
  ?? Deno.env.get("REDPAY_BUSINESS_NO") ?? "";
const REDPAY_ALERT_CHANNEL      = Deno.env.get("REDPAY_ALERT_CHANNEL") ?? "";
const REDPAY_SLACK_BOT_TOKEN    = Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ?? "";
// T-20260803-...-UNREG-LINE-ALARM-DAILY-DIGEST: 미등록 회선 알람 cadence 토글(롤백레일).
//   'digest'(기본) = accumulate 만(실시간 Slack 억제) → redpay-unreg-digest 가 하루 1회 요약.
//   'realtime'     = 구 동작(push 당 Slack) 복귀 — 즉시 롤백 스위치.
//   ★ 어느 모드든 accumulate 는 항상 수행(AC5 알림 유실 0 — digest 데이터원 보장).
const REDPAY_UNREG_ALARM_MODE   = (Deno.env.get("REDPAY_UNREG_ALARM_MODE") ?? "digest").trim().toLowerCase();
// T-20260729-...-NON2XX-ALERT-ROOTCAUSE Part B: 동일원인 dedup 창(기본 60s, 짧게 = 도달 우선).
const REDPAY_ALERT_DEDUP_WINDOW_MS = Number(Deno.env.get("REDPAY_ALERT_DEDUP_WINDOW_MS") ?? "") || 60_000;

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

// ── T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 허용목록 런타임 지문 (introspection) ──────
//   canonical 계약(scripts/lib/redpay_wl_fingerprint.mjs CANON_SPEC 미러 — 정렬순서/구분자/해시 반드시 동일):
//     trim → drop-empty → dedup → sort(codepoint asc) → join('\n') → SHA-256 소문자 hex.
//   웹훅 EF 는 정적 모듈(FOOT_MERCHANT_SET) 만 읽으므로 merchant 지문만 산출(TID 없음). read-only·no-DB.
function canonicalizeList(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").toString().trim();
    if (s.length > 0) set.add(s);
  }
  return [...set].sort();
}
async function sha256HexOfList(sortedList: string[]): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sortedList.join("\n")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function whitelistFingerprintEf(): Promise<Record<string, unknown>> {
  // A안(RUNTIME-ALIGN): 유효 admit set = registry 런타임 조회 ∪ static floor(fail-open).
  //   introspect 로 registry 정렬 반영·source 확인 → AC-3 evidence(registry-신규 TID 적재 재현) 검증창.
  const resolution = await resolveFootMerchantSet(Date.now());
  const merchantSorted = canonicalizeList(resolution.set);
  const staticSorted = canonicalizeList(FOOT_MERCHANT_SET);
  return {
    subject: "webhook-ef",
    domain: "foot",
    canon_spec: "trim→drop-empty→dedup→sort(codepoint asc)→join('\\n')→sha256-hex",
    tid_source: "n/a",
    // ★ merchant admit = 런타임 registry∪static (A안). resolution_source 로 정렬성공/fail-open 구분.
    merchant_source: resolution.source === "registry-union"
      ? "registry(redpay_terminal_registry,domain=foot,active)∪static-floor"
      : "fallback-static(FOOT_MERCHANT_SET)",
    merchant_resolution_source: resolution.source,
    merchant_registry_count: resolution.registryCount,
    tid_count: 0,
    tid_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // sha256("")
    tid_sorted: [],
    merchant_count: merchantSorted.length,
    merchant_sha256: await sha256HexOfList(merchantSorted),
    merchant_sorted: merchantSorted,
    // static floor 지문(fail-open 기준선·회귀 대조용).
    static_floor_count: staticSorted.length,
    static_floor_sha256: await sha256HexOfList(staticSorted),
    ts: new Date().toISOString(),
  };
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

// ── non-2xx 상시 알림 (T-20260729-...-NON2XX-ALERT-ROOTCAUSE Part B) ──────────────
//   choke point: 핸들러가 반환한 응답이 non-2xx 면 즉시 장쳰봇 명의 슬랙 알림.
//   ★관측 전용 — 알림 실패/예외가 결제 응답(Response)에 절대 영향 주지 않음(호출측이 예외 삼킴).
const _non2xxDedup = makeDedup(REDPAY_ALERT_DEDUP_WINDOW_MS);
async function alertNon2xx(
  status: number,
  bodyText: string,
  ctx: Non2xxAlertContext,
  nowIso: string,
): Promise<void> {
  const errorSummary = extractErrorSummary(bodyText);
  const key = `${status}:${errorSummary}`;
  const decision = _non2xxDedup(key, Date.now());
  if (!decision.send) {
    console.warn(`${LOG}[NON2XX-ALERT] dedup 억제(창 내 동일원인) status=${status} reason=${errorSummary}`);
    return;
  }
  const text = buildNon2xxAlertText(status, errorSummary, ctx, nowIso, decision.suppressedSince);
  const sent = await sendSlackMessage(REDPAY_ALERT_CHANNEL, text, REDPAY_SLACK_BOT_TOKEN);
  console.warn(
    `${LOG}[NON2XX-ALERT] status=${status} reason=${errorSummary} trxid=${ctx.trxid ?? "∅"} ` +
      `tid=${ctx.tid ?? "∅"} slack_sent=${sent} (channel_set=${REDPAY_ALERT_CHANNEL ? "y" : "n"}).`,
  );
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

// ── A안 (T-20260728-foot-REDPAY-WEBHOOK-ALLOWLIST-RUNTIME-ALIGN) — foot admit set 런타임 정렬 ──
//   허용목록(foot admit) 소스를 컴파일타임 상수(code-shadow) → DB redpay_terminal_registry 런타임
//   조회로 전환해 폴러(scripts/…poller.mjs loadRegistryFromDb)·워치독과 SSOT 통일.
//   ★admit 권위 키 = merchant_id (payload data.merchant_id 를 그대로 소비 — TID 아님).
//   ★fail-open 의무: registry read 실패/타임아웃/빈결과 → deriveFootMerchantSet 이 FOOT_MERCHANT_SET
//     으로 graceful fallback(admit 전면차단 금지). union 은 static floor 를 축소하지 않음(under-admit 0).
//   ★per-request query·콜드스타트 지연 완화: 모듈 TTL 캐시 + registry 성공분만 캐시(실패는 즉시 재시도),
//     실패 시 last-known-good 유지(TTL 만료 후에도 stale 재사용 = fail-open 강화).
const FOOT_SET_TTL_MS = 60_000; // 60초 — 폴러 사이클보다 짧게. registry 확장 반영 지연 상한.
let _footSetCache: { res: FootMerchantResolution; loadedAt: number } | null = null;

// registry(domain=foot,active) merchant_id 목록 조회. 실패/빈결과 → null(호출측 fail-open).
async function loadFootMerchantsFromRegistry(): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("redpay_terminal_registry")
      .select("merchant_id")
      .eq("domain", "foot")
      .eq("active", true);
    if (error) {
      console.warn(`${LOG}[REGISTRY] foot merchant 조회 실패 → fail-open(static): ${error.message}`);
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((r) => ((r as { merchant_id?: unknown }).merchant_id ?? "").toString());
  } catch (err) {
    console.warn(`${LOG}[REGISTRY] foot merchant 조회 예외 → fail-open(static): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// 유효 foot admit set 확정 — TTL 캐시 + fail-open. nowMs 주입(테스트 결정성).
async function resolveFootMerchantSet(nowMs: number): Promise<FootMerchantResolution> {
  if (_footSetCache && nowMs - _footSetCache.loadedAt < FOOT_SET_TTL_MS) {
    return _footSetCache.res;
  }
  const rows = await loadFootMerchantsFromRegistry();
  const res = deriveFootMerchantSet(rows);
  if (res.source === "registry-union") {
    _footSetCache = { res, loadedAt: nowMs }; // 성공만 캐시(실패는 다음 요청 재시도)
    return res;
  }
  // registry 미가용(fallback-static): 직전 성공 캐시가 있으면 last-known-good 유지(fail-open 강화).
  if (_footSetCache) return _footSetCache.res;
  return res; // 캐시 없음 → 컴파일타임 FOOT_MERCHANT_SET(현행 동치)
}

async function handleWebhook(req: Request, alertCtx: Non2xxAlertContext): Promise<Response> {
  // ── T-20260728-...-ENVSHADOW-RUNTIME-VALUECHECK: 허용목록 introspection (내부 전용·인증 뒤) ──
  //   GET ?introspect=whitelist + Authorization: Bearer <SERVICE_ROLE_KEY>. 미인증 공개 금지(fail-safe).
  //   결제 수신 POST 경로와 완전 격리(top early-return) — 결제 로직 무영향. read-only·no-DB·no-mutation.
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("introspect") === "whitelist") {
      const auth = req.headers.get("Authorization") ?? "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!SUPABASE_SERVICE_ROLE_KEY || bearer !== SUPABASE_SERVICE_ROLE_KEY) {
        return json(401, { ok: false, error: "unauthorized_introspection" });
      }
      return json(200, { ok: true, fingerprint: await whitelistFingerprintEf() });
    }
    return json(405, { ok: false, error: "method_not_allowed" });
  }
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

  // non-2xx 알림용 컨텍스트 채움(이후 500(clinic/db) 등에서도 trxid/tid 포함되도록 조기 세팅).
  alertCtx.eventId = eventId;
  alertCtx.trxid = data.trxid ?? null;
  alertCtx.tid = data.tid ?? null;
  alertCtx.merchantId = data.merchant_id ?? null;

  // ── 4. business_no 방어 필터 (AC-2.6, 서울오리진) ────────────────────────────
  if (!isAllowedBusinessNo(data.business_no, REDPAY_BUSINESS_NO_ALLOW)) {
    console.warn(`${LOG} business_no 방어필터 drop (business_no=${data.business_no ?? "∅"}, event_id=${eventId}).`);
    return json(200, { ok: true, status: "dropped_business_no" });
  }

  // ── 5. 센터 분리 — merchant_id 화이트리스트 (AC-2.5 / A안 RUNTIME-ALIGN) ─────────
  //   ★admit 판정 키 = payload data.merchant_id (validateEnvelope 가 data 로 전달한 그 값을 그대로 소비).
  //     merchant_id 부재(''/null) → centerForMerchantWithSet 이 'unknown' 반환 → 아래 미등록 경로.
  //     (총괄 최필경 진단 sub-Q: '추출·매핑 단계' — data.merchant_id 가 admit 에 정확히 소비됨을 명시.)
  //   ★A안: foot admit set 을 registry 런타임 조회로 정렬(fail-open static fallback). body/unknown 은 불변.
  const footResolution = await resolveFootMerchantSet(Date.now());
  const center = centerForMerchantWithSet(data.merchant_id, footResolution.set);
  if (center === "unknown") {
    // 미등록 merchant(또는 merchant_id 부재) → 미적재.
    //   ※ merchant_id 부재로 인한 unscopable-quarantine 강화는 SILENT-PATH-HARDEN(경로A)이 담당(경계 조율).
    //
    // T-20260803-...-UNREG-LINE-ALARM-DAILY-DIGEST: 실시간 push-당 Slack(쿨다운 0) 이 재시도 반복으로
    //   스팸(15:52~16:32 5회) → cadence 전환. accumulate(멱등 증분) 는 항상 수행하고(AC5 알림 유실 0),
    //   실시간 Slack 은 REDPAY_UNREG_ALARM_MODE 로만 게이팅(digest 기본=억제 / realtime=구동작 롤백).
    //   미등록→등록 전이 제외·하루 1회 요약 발송은 redpay-unreg-digest EF(cron) 가 담당.
    let accumulated = false;
    try {
      const { error: noteErr } = await supabase.rpc("redpay_note_unregistered_line", {
        p_merchant_id:   data.merchant_id ?? null,
        p_merchant_name: data.merchant_name ?? null,
        p_tid:           data.tid ?? null,
        p_clinic_id:     null,
      });
      if (noteErr) throw new Error(noteErr.message);
      accumulated = true;
    } catch (accErr) {
      // accumulate 실패 = digest 데이터원 유실 위험 → fail-safe 로 즉시 실시간 Slack(AC5 사수).
      console.error(
        `${LOG} 미등록 회선 accumulate 실패 → fail-safe 실시간 알림: `
          + `${accErr instanceof Error ? accErr.message : String(accErr)}`,
      );
    }

    // 실시간 Slack: (a) realtime 모드(구동작 롤백) 또는 (b) accumulate 실패 fail-safe 일 때만.
    if (REDPAY_UNREG_ALARM_MODE === "realtime" || !accumulated) {
      await sendSlackMessage(
        REDPAY_ALERT_CHANNEL,
        `⚠️ [redpay-webhook] 미등록 merchant_id 수신 — 화이트리스트 확인 필요\n`
          + `merchant_id=${data.merchant_id ?? "∅"} / merchant_name=${data.merchant_name ?? "∅"}\n`
          + `tid=${data.tid ?? "∅"} / trxid=${data.trxid ?? "∅"} / event_id=${eventId}\n`
          + `allowlist_source=${footResolution.source}(registry=${footResolution.registryCount})\n`
          + `→ registry(redpay_terminal_registry) 등록 여부 확인.`,
        REDPAY_SLACK_BOT_TOKEN,
      );
    }
    console.warn(
      `${LOG} 미등록 merchant_id=${data.merchant_id ?? "∅"} → 미적재 `
        + `(mode=${REDPAY_UNREG_ALARM_MODE}, accumulated=${accumulated}, `
        + `allowlist_source=${footResolution.source}, registry=${footResolution.registryCount}).`,
    );
    return json(200, {
      ok: true,
      status: accumulated ? "unknown_merchant_accumulated" : "unknown_merchant_alerted",
    });
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
}

// ── choke point (T-20260729-...-NON2XX-ALERT-ROOTCAUSE Part B) ────────────────────
//   handleWebhook 이 반환한 응답을 관측 → 실제 결제 push(POST)가 non-2xx 면 즉시 슬랙 알림.
//   ★알림은 결제 응답을 절대 변형·지연·차단하지 않음: 원 응답을 그대로 반환하고,
//     알림 발송은 clone 한 body 로 별도 수행(예외는 전부 삼켜 결제 경로 무영향).
Deno.serve(async (req: Request): Promise<Response> => {
  const method = req.method;
  let isIntrospection = false;
  try {
    isIntrospection = method === "GET"
      && new URL(req.url).searchParams.get("introspect") === "whitelist";
  } catch { /* URL 파싱 실패 무시 */ }

  const alertCtx: Non2xxAlertContext = {};
  const res = await handleWebhook(req, alertCtx);

  // AC-B1: 실제 웹훅 결제 push(POST)가 non-2xx 반환 시 즉시 알림(introspection/비-POST 프로브 제외).
  if (isNon2xx(res.status) && isRealWebhookDelivery(method, isIntrospection)) {
    try {
      const bodyText = await res.clone().text();
      await alertNon2xx(res.status, bodyText, alertCtx, new Date().toISOString());
    } catch (e) {
      // 알림 실패는 결제 응답에 영향 없음 — 로그만.
      console.error(`${LOG}[NON2XX-ALERT] 알림 처리 예외(응답 무영향): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return res;
});
