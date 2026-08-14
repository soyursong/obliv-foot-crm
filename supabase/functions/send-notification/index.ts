// T-20260520-crm-MESSAGING-SMS-V1 — Edge Function: send-notification
// T-20260521-crm-SMS-SENDER-SAVE  — admin UI 액션 핸들러 추가 (test_sms)
// T-20260523-crm-MESSAGING-SLA-OPT — AC-1: keep_warm 액션 / AC-2: logNotification UPDATE 경로 보강
// T-20260608-foot-SMS-EF-DEPLOY-VERIFY — manual_send 핸들러 운영 재배포 검증 (deploy marker 2026-06-08)
// T-20260608-foot-SMS-CTXMENU-ALLROLE — manual_send allowedRoles 전직원(8역할) 확대 → FE permissions.ts manual_sms_send 와 role 패리티(AC-5)
//
// 호출 방법:
//   1. Database Webhook: reservations INSERT → 자동 POST (service_role)
//   2. pg_cron 배치 함수: notify_reminders_batch() / notify_retry_failed() via pg_net
//   3. Admin UI (test_sms 액션): AdminSettings > SectionConnection > 연결 테스트 버튼
//
// Request Body (일반 발송):
// {
//   event_type:     'resv_confirm' | 'resv_reminder_d1' | 'resv_reminder_morning' | 'noshow',
//   reservation_id: UUID,
//   clinic_id:      UUID,
//   customer_id:    UUID,
//   recipient_phone?: string,
//   retry_log_id?:  UUID,
// }
//
// Request Body (admin UI 액션):
// {
//   _action:         'test_sms',
//   clinic_id:       UUID,
//   recipient_phone: string,
// }
//
// Auth:
//   - 일반 발송: service_role 키 또는 X-Internal-Cron 헤더
//   - admin UI 액션: admin 역할 user JWT (supabase.auth.getUser() 검증)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── 환경 변수 ─────────────────────────────────────────────────────
const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("CRM_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// ── T-20260814-foot-SENDNOTIF-CRON-SENDLEG-SILENT-STALL — 크론 시크릿 dual-accept (accept-set) ──
// RC(실측 2026-08-14): pg_cron wrapper(notify_reminders_batch / notify_retry_failed)는
//   `X-Internal-Cron = COALESCE(GUC app.cron_secret[NULL], vault internal_cron_secret[=NEW])` 를 송신하는데,
//   본 EF 는 primary INTERNAL_CRON_SECRET(=OLD) 단일값만 대조 → 매 크론 POST 가 401 → logNotification 도달 前
//   반환 → pending row 무진행(recipient_phone/body_rendered/error_code 전부 NULL = silent no-op). = T-20260810
//   VAULT rotation 이 mid-window(vault=NEW / EF primary=OLD / *_NEXT=NEW)로 방치됐고, 종전 "dual-accept" 는
//   env-only no-op(어떤 EF 도 _NEXT 를 코드에서 read 안 함)이었던 것이 근본.
// 봉합: primary + _NEXT 를 모두 읽어 accept-set 을 구성하고, 크론 시크릿이 둘 중 하나와 일치하면 수용한다.
//   → 현재 caller 의 NEW(=_NEXT)를 즉시 수용 → 실 send 재개. revoke 이후(primary=NEW, _NEXT clear)에도 무결.
//   시크릿 write/vault 접촉 0 (env 이름 read 만) → secret 재취급 아님(supervisor secret lane 무저촉).
const INTERNAL_CRON_SECRET      = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
const INTERNAL_CRON_SECRET_NEXT = Deno.env.get("INTERNAL_CRON_SECRET_NEXT") ?? "";
// 빈 문자열 제외(미설정 env 로 인한 우회 차단) — 유효 시크릿만 accept-set 에 편입.
const CRON_ACCEPT_SET: string[] = [INTERNAL_CRON_SECRET, INTERNAL_CRON_SECRET_NEXT].filter((s) => s !== "");
// 크론 시크릿 판정: accept-set 에 하나라도 유효값이 있고, presented 값이 그 집합에 포함되면 true.
function isAcceptedCronSecret(presented: string): boolean {
  return CRON_ACCEPT_SET.length > 0 && presented !== "" && CRON_ACCEPT_SET.includes(presented);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// T-20260608-foot-SMS-CTXMENU-ALLROLE (AC-5): manual_send(대시보드 우클릭 [문자] 수동 1:1 발송)
// 허용 역할 = FE src/lib/permissions.ts ALL_STAFF_ROLES / PERM_MATRIX.manual_sms_send 와 동일 집합(전직원 8역할).
// Deno EF는 src import 불가 → 동일 배열 명시 복제(SSOT는 permissions.ts, 변경 시 양쪽 동기화 필수).
const MANUAL_SEND_ALLOWED_ROLES = [
  "admin", "manager", "director", "consultant", "coordinator", "therapist", "part_lead", "staff",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-internal-cron, x-retry-log-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── 타입 정의 ─────────────────────────────────────────────────────
type EventType =
  | "resv_confirm"
  | "resv_reminder_d1"
  | "resv_reminder_morning"
  | "noshow";

interface SendRequest {
  event_type:     EventType;
  reservation_id: string;
  clinic_id:      string;
  customer_id:    string;
  recipient_phone?: string;
  retry_log_id?:  string;
}

interface WebhookPayload {
  type:   "INSERT" | "UPDATE" | "DELETE";
  table:  string;
  record: {
    id:          string;
    clinic_id:   string;
    customer_id: string;
    status:      string;
  };
}

// ── HMAC-SHA256 서명 (Solapi 인증) ───────────────────────────────
async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder  = new TextEncoder();
  const keyData  = encoder.encode(secret);
  const msgData  = encoder.encode(message);
  const key      = await crypto.subtle.importKey(
    "raw", keyData,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── 치환 변수 렌더 ─────────────────────────────────────────────────
function renderTemplate(
  body: string,
  vars: Record<string, string>
): string {
  let rendered = body;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{${key}}`, value ?? "");
  }
  return rendered;
}

// ── SMS/LMS 채널 결정 (90byte 기준) ───────────────────────────────
function getChannel(body: string): "SMS" | "LMS" {
  const byteLen = new TextEncoder().encode(body).length;
  return byteLen <= 90 ? "SMS" : "LMS";
}

// ── 수신/발신번호 국내 형식 정규화 (T-20260608-foot-RESV-AUTO-SMS-NOFIRE) ──
// Cross-CRM 계약상 customers.phone 은 E.164(+8210…)로 저장되나, Solapi 국내 발송은
// 국내 형식(010…)을 요구한다. E.164(+82/82/0082 prefix)를 그대로 보내면 Solapi가
// statusCode 3058 "전송경로 없음"을 반환(200 수락이나 통신사 미배달)하여
// DB는 'sent'인데 폰엔 미수신되는 무음 실패가 발생. → 발송 경계에서 국내 형식으로 정규화.
function toDomesticKR(raw: string): string {
  let d = (raw ?? "").replace(/[^0-9]/g, "");   // +82-10-1234-5678 → 821012345678
  if (d.startsWith("0082")) d = d.slice(4);     // 0082… 국제접속 prefix 제거 → 1012345678
  if (d.startsWith("82")) d = d.slice(2);       // 821012345678 → 1012345678 (KR 국가코드 제거)
  if (d && !d.startsWith("0")) d = "0" + d;     // 국내 형식 leading-0 복원 → 01012345678
  return d;
}

// ══════════════════════════════════════════════════════════════════
// T-20260804-foot-FOOTCTR-SMS-DUMMY-E2E-PRODLEAK-SEAL — 수신번호 가드 (L1/L2)
// ──────────────────────────────────────────────────────────────────
// RC: E2E 픽스처 phone 'DUMMY-<ts>' 가 send-notification EF 까지 흘러 toDomesticKR() 이
//   'DUMMY-' strip + leading-0 복원으로 **가짜 017 번호**를 조립 → Solapi 가 200 수락(동기) 후
//   async 3032 로 실패하나 DB status='sent' 로 무음 오기록. 근본은 .env.local(PROD) 환경격리
//   갭이나, 확정적 봉합점은 **EF 레벨 수신번호 가드**(★chokepoint) — 실 SOLAPI 호출 이전에
//   비유효 수신번호를 거부하면, E2E 가 PROD 를 때려도 실발신이 원천 차단된다.
//
// L2(정규화 하드닝): toDomesticKR() 은 비정규 입력에도 무조건 leading-0 을 붙여 가짜번호를
//   조립한다(1012345678 정상 vs 1754309876543 쓰레기를 구분 못 함). → 정규화 결과가 유효
//   KR 형식인지 **검증**하는 판정함수를 별도로 두어, 조립된 가짜번호를 걸러낸다.
//
// L1(수신번호 가드): validateRecipient() = (a) DB-인지 더미 sentinel(DUMMY-%) · (b) 영문
//   마커(정상번호엔 영문 없음) · (c) 알려진 placeholder · (d) L2 유효성 미달 → 전부 거부.
//   ★회귀 0 요건: 정상 KR 모바일(010/011/016~019) E.164/국내표기는 100% 통과(false-positive 0).

// 유효 국내 발신대상 형식 (정규화된 국내표기 = digits, leading-0 포함).
//   실발신 가능한 KR 번호만 통과시켜, toDomesticKR 이 조립한 비정상 자릿수 번호를 차단한다.
// ⚠ toDomesticKR() 이 항상 leading-0 을 복원하므로 유효 출력은 전부 '0' 으로 시작한다.
//   (15xx/16xx 대표번호는 SMS 수신 불가 + toDomesticKR 이 0 을 붙여 무효화 → 수신자 패턴에서 제외.)
const KR_NUMBER_PATTERNS: RegExp[] = [
  /^01[016789]\d{7,8}$/,   // 휴대폰 010/011/016/017/018/019 (총 10~11자리) — ★회귀 보호 대상
  /^02\d{7,8}$/,           // 서울 유선 (9~10자리)
  /^0[3-6][0-9]\d{6,8}$/,  // 지역 유선 (031/041/051 …)
  /^070\d{7,8}$/,          // 070 인터넷전화
];
function isPlausibleKRNumber(domestic: string): boolean {
  return KR_NUMBER_PATTERNS.some((re) => re.test(domestic));
}

// L1 수신번호 검증: 원본(raw) 레벨 sentinel/마커 선차단 + 정규화 결과 유효성 검증.
//   reason 코드는 notification_logs.error_code / error_message 로 각인(별도 LOG-CLEANUP 조회키).
const RECIPIENT_BLOCK_REASON = "blocked_invalid_recipient";
function validateRecipient(raw: string): { ok: boolean; domestic: string; reason: string | null } {
  const original = (raw ?? "").trim();
  if (!original) return { ok: false, domestic: "", reason: "empty_recipient" };
  // (a) DB-인지 더미 sentinel — E2E 픽스처 phone LIKE 'DUMMY-%'(is_dummy_phone 판정 대상)
  if (/^DUMMY-/i.test(original)) return { ok: false, domestic: "", reason: "dummy_sentinel" };
  // (b) 영문/비전화 마커 — 정상 전화번호엔 영문이 없다(TEST/문자 혼입 즉시 차단)
  if (/[A-Za-z]/.test(original)) return { ok: false, domestic: "", reason: "non_numeric_marker" };
  // (c) 알려진 placeholder(+821000000000 / 01000000000)
  const digitsOnly = original.replace(/[^0-9]/g, "");
  if (original === "+821000000000" || digitsOnly === "821000000000" || digitsOnly === "01000000000" || digitsOnly === "1000000000") {
    return { ok: false, domestic: "", reason: "placeholder" };
  }
  // (d) L2 — 정규화 결과가 실발신 가능한 유효 KR 형식이 아니면 '가짜번호 조립'으로 판단해 거부.
  const domestic = toDomesticKR(original);
  if (!isPlausibleKRNumber(domestic)) {
    return { ok: false, domestic, reason: `implausible_kr_number:${domestic.length}digits` };
  }
  return { ok: true, domestic, reason: null };
}

// ══════════════════════════════════════════════════════════════════
// T-20260609-foot-MSG-TEMPLATE-MMS Part B: MMS(이미지 첨부) 발송 경로
// ──────────────────────────────────────────────────────────────────
// 발송 분기: image_path(=message-images 버킷 storage 경로)가 있으면 MMS, 없으면 종전 SMS/LMS.
// MMS는 solapi 2-step: ① /storage/v4/files 로 이미지 업로드 → fileId, ② /messages/v4/send 에 imageId 포함.
// ⚠ solapi 계정에 MMS 발신상품이 활성화돼야 동작(미활성 시 graceful 실패+안내). 단가 SMS/LMS와 상이.
// ⚠ image_path 가 없으면 이 경로를 타지 않으므로 기존 SMS/LMS 발송은 100% 무영향(하위호환).

// solapi MMS 규격 가드 (FE 가드와 동일 기준 — 서버측 최종 방어선)
const MMS_MAX_BYTES = 300 * 1024;   // solapi 권장 ≤ 200KB. 약간의 여유(300KB)까지 허용하되 FE는 200KB로 안내.
const MMS_ALLOWED_EXT = [".jpg", ".jpeg"];

// message-images 버킷에서 이미지 download → 규격 검증 → base64
async function loadMmsImage(
  imagePath: string,
): Promise<{ base64: string; name: string } | { error: string }> {
  try {
    const { data, error } = await supabase.storage.from("message-images").download(imagePath);
    if (error || !data) {
      return { error: `MMS 이미지를 찾을 수 없습니다: ${error?.message ?? "not found"}` };
    }
    const buf = new Uint8Array(await data.arrayBuffer());
    if (buf.byteLength === 0) return { error: "MMS 이미지가 비어 있습니다." };
    if (buf.byteLength > MMS_MAX_BYTES) {
      return { error: `MMS 이미지 용량 초과(${Math.round(buf.byteLength / 1024)}KB). 200KB 이하 JPG만 발송 가능합니다.` };
    }
    const lower = imagePath.toLowerCase();
    const looksJpg = MMS_ALLOWED_EXT.some((e) => lower.endsWith(e))
      || data.type === "image/jpeg" || data.type === "image/jpg";
    if (!looksJpg) return { error: "MMS는 JPG 이미지만 발송할 수 있습니다." };

    // Uint8Array → base64 (청크 단위로 안전 변환; spread는 대용량서 스택 초과 위험)
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    const name = imagePath.split("/").pop() ?? "message.jpg";
    return { base64, name };
  } catch (e) {
    return { error: `MMS 이미지 처리 오류: ${String(e)}` };
  }
}

// solapi storage 업로드 → fileId
async function uploadSolapiFile(params: {
  apiKey: string; apiSecret: string; base64: string; name: string;
}): Promise<{ fileId: string | null; errorMessage: string | null }> {
  const { apiKey, apiSecret, base64, name } = params;
  const date      = new Date().toISOString();
  const salt      = crypto.randomUUID().replace(/-/g, "");
  const signature = await hmacSha256(`${date}${salt}`, apiSecret);
  const authHdr   = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  try {
    const res = await fetch("https://api.solapi.com/storage/v4/files", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authHdr },
      body: JSON.stringify({ file: base64, name, type: "MMS" }),
    });
    const body = await res.json();
    console.log("[send-notification] Solapi file upload:", res.status, JSON.stringify(body)?.slice(0, 300));
    if (res.ok && body?.fileId) return { fileId: body.fileId, errorMessage: null };
    return { fileId: null, errorMessage: body?.errorMessage ?? JSON.stringify(body) };
  } catch (e) {
    return { fileId: null, errorMessage: `network error: ${String(e)}` };
  }
}

// ── Solapi SMS/LMS/MMS 발송 헬퍼 ─────────────────────────────────
// imageId 가 주어지면 MMS, subject 는 MMS 제목(선택). 없으면 종전 SMS/LMS.
async function sendSolapi(params: {
  apiKey:       string;
  apiSecret:    string;
  senderNumber: string;
  recipientPhone: string;
  body:         string;
  imageId?:     string | null;
  subject?:     string | null;
}): Promise<{ success: boolean; messageId: string | null; errorMessage: string | null; blocked?: boolean }> {
  const { apiKey, apiSecret, senderNumber, recipientPhone, body, imageId, subject } = params;

  // ── L1 chokepoint (T-20260804-foot-FOOTCTR-SMS-DUMMY-E2E-PRODLEAK-SEAL) ──
  // 모든 발송 경로(test_sms / manual_send / scheduled_send / 자동발송)가 이 함수로 수렴한다.
  // 비유효 수신번호(DUMMY-%/malformed/placeholder)는 **Solapi fetch 이전에** 거부 → 실발신 원천차단.
  // 무음 sent 오기록 근절: blocked=true 로 반환해 호출부가 'sent' 가 아닌 차단 상태로 기록하게 한다.
  const recipCheck = validateRecipient(recipientPhone);
  if (!recipCheck.ok) {
    console.warn(
      `[send-notification][L1-GUARD] BLOCK invalid recipient reason=${recipCheck.reason} ` +
      `raw="${String(recipientPhone ?? "").slice(0, 24)}" → Solapi 미호출(실발신 차단).`
    );
    return {
      success: false,
      messageId: null,
      errorMessage: `${RECIPIENT_BLOCK_REASON}: ${recipCheck.reason}`,
      blocked: true,
    };
  }

  const isMms      = Boolean(imageId);
  const msgType    = isMms ? "MMS" : (getChannel(body) === "SMS" ? "SMS" : "LMS");
  const date       = new Date().toISOString();
  const salt       = crypto.randomUUID().replace(/-/g, "");
  const sigPlain   = `${date}${salt}`;
  const signature  = await hmacSha256(sigPlain, apiSecret);
  const authHdr    = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  const message: Record<string, unknown> = {
    to:   toDomesticKR(recipientPhone),
    from: toDomesticKR(senderNumber),
    text: body,
    type: msgType,
  };
  if (isMms) {
    message.imageId = imageId;
    // MMS subject(제목) 40byte 제한 — 초과 시 안전 절단
    const subj = (subject ?? "").trim();
    if (subj) message.subject = subj.slice(0, 38);
  }

  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": authHdr,
      },
      body: JSON.stringify({ message }),
    });

    const resBody = await res.json();
    console.log("[send-notification] Solapi response:", res.status, JSON.stringify(resBody));

    if (res.ok && (resBody?.messageId || resBody?.groupInfo?.count?.total > 0)) {
      return {
        success:      true,
        messageId:    resBody?.messageId ?? resBody?.groupInfo?.groupId ?? null,
        errorMessage: null,
      };
    } else {
      const errMsg = resBody?.errorMessage ?? JSON.stringify(resBody);
      return { success: false, messageId: null, errorMessage: errMsg };
    }
  } catch (e) {
    return { success: false, messageId: null, errorMessage: `network error: ${String(e)}` };
  }
}

// ── 이미지 첨부 여부에 따라 MMS/SMS-LMS 자동 분기 발송 ────────────
// imagePath 가 있으면: download → solapi 업로드 → MMS 발송. 실패 시 graceful 에러 반환(SMS 강등 안 함 — 의도된 이미지 누락 방지).
async function sendWithOptionalImage(params: {
  apiKey:       string;
  apiSecret:    string;
  senderNumber: string;
  recipientPhone: string;
  body:         string;
  imagePath?:   string | null;
  subject?:     string | null;
}): Promise<{ success: boolean; messageId: string | null; errorMessage: string | null; channel: "sms" | "lms" | "mms" }> {
  const { imagePath } = params;
  if (imagePath) {
    const img = await loadMmsImage(imagePath);
    if ("error" in img) {
      return { success: false, messageId: null, errorMessage: img.error, channel: "mms" };
    }
    const up = await uploadSolapiFile({
      apiKey: params.apiKey, apiSecret: params.apiSecret, base64: img.base64, name: img.name,
    });
    if (!up.fileId) {
      return {
        success: false, messageId: null,
        errorMessage: `MMS 이미지 업로드 실패(solapi MMS 상품 활성 여부 확인): ${up.errorMessage ?? "unknown"}`,
        channel: "mms",
      };
    }
    const r = await sendSolapi({ ...params, imageId: up.fileId });
    return { ...r, channel: "mms" };
  }
  const r = await sendSolapi(params);
  return { ...r, channel: getChannel(params.body).toLowerCase() as "sms" | "lms" };
}

// ── Vault 시크릿 조회 헬퍼 (RPC 경로: service_role env 호환성 회피) ──
async function getVaultSecret(vaultName: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_vault_secret", { p_name: vaultName });
  if (error) {
    console.error("[send-notification] getVaultSecret rpc error:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

// ── JWT 검증 → 허용 role이면 user id 반환 (실패 시 null) ─────────
// T-20260606-foot-CTXMENU-SMS-SEND: manual_send 는 admin/manager 허용해야 하므로
// 단일 admin 고정 대신 허용 role 집합을 받는 형태로 일반화.
async function verifyRoleJwt(jwt: string, allowedRoles: string[]): Promise<string | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return null;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const role = (profile as { role?: string } | null)?.role ?? "";
    return allowedRoles.includes(role) ? user.id : null;
  } catch {
    return null;
  }
}

// ── caller-clinic 격리 검증 (T-20260723-foot-SENDSMS-CALLER-CLINIC-GATE) ──
// 취약점(derm H-1 동형, PRESENT + clinics=2 LIVE): verifyRoleJwt 는 user_profiles.role 만
//   대조하고 caller 의 소속 clinic 을 대조하지 않음 → 검증된 스태프가 임의 body.clinic_id
//   지정 시 그 clinic 의 Vault secret + sender_number 로 provider(Solapi) cross-tenant 발송 가능.
//   (foot manual_send 는 8역할 광범위 허용 → 조직내 노출면이 crm(admin 한정)보다 넓음.)
// 방어: provider·vault 접근 이전에, caller(JWT sub = auth.uid() = userId)의 소속 clinic 이
//   body.clinic_id 와 일치하는지 대조. 미소속이면 false → 호출부에서 403.
// 식별 기준: user_id(JWT sub) — email 단독필터 신뢰 금지(cross_crm_auth_identity_standard).
// 소속 소스 = obliv-foot-crm 실 스키마 실측(derm/crm/scalp 지문 복붙 아님):
//   ① user_profiles.clinic_id == body.clinic_id (단일지점 배정 스태프)
//   ② user_profiles.clinic_id IS NULL + role∈(admin,manager,director) = 다지점 HQ 권한
//      → 전 지점 허용. foot 정본 테넌트 격리 규칙 mc_clinic_isolated_v2 / is_admin_or_manager()
//      (current_user_clinic_id() IS NULL AND role IN ('admin','manager','director')) 와 동형.
//      HQ 계정의 cross-clinic 발송은 설계상 정당 → 회귀 0.
//   ③ staff.user_id == userId AND staff.clinic_id == body.clinic_id (staff 배정 fallback, scalp 동형).
//   셋 중 하나라도 일치하면 통과. clinic_id 가 구체값으로 배정된 스태프가 타 clinic 지정 시만 차단.
// 정당 예외: service_role/크론 발송은 adminUserId=null(userId 미도달) → 호출부에서 게이트 미적용.
const MULTI_CLINIC_HQ_ROLES = ["admin", "manager", "director"];
async function callerBelongsToClinic(userId: string, clinicId: string): Promise<boolean> {
  try {
    const { data: profileRow } = await supabase
      .from("user_profiles")
      .select("clinic_id, role")
      .eq("id", userId)
      .maybeSingle();
    if (profileRow) {
      const p = profileRow as { clinic_id: string | null; role: string | null };
      if (p.clinic_id && p.clinic_id === clinicId) return true;
      // 다지점 HQ 권한(user_profiles.clinic_id NULL + admin/manager/director) → 전 지점 허용
      if (!p.clinic_id && MULTI_CLINIC_HQ_ROLES.includes(p.role ?? "")) return true;
    }

    const { data: staffRow } = await supabase
      .from("staff")
      .select("id")
      .eq("user_id", userId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    return Boolean(staffRow);
  } catch (e) {
    console.error("[send-notification] callerBelongsToClinic error:", String(e));
    return false;
  }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = req.headers.get("X-Internal-Cron") ?? "";

  // ── 페이로드 먼저 파싱 (_action 여부 확인용) ──────────────────
  let bodyJson: Record<string, unknown>;
  try {
    bodyJson = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON", detail: String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ── keep-warm warm-ping (T-20260813-foot-KEEPWARM-SENDNOTIF-WARMPING-NON401) ──
  // pg_cron jobid6 `foot-ef-send-notification-keep-warm` 이 5분마다 anon key Bearer 로
  //   body `{"keep_warm":true}` 를 POST (keep_warm_send_notification() SECDEF fn, 마이그 20260525030000 §10).
  // 목적 = 컨테이너 cold-start 방지(warming)일 뿐 실제 발송·PHI 접근 0.
  // 과거엔 anon Bearer 가 아래 auth 게이트(service_role/X-Internal-Cron)에 걸려 **by-design 401** 을
  //   초당 노이즈로 남겨 edge_logs 401 raw-oracle 를 오염시켰다. → auth 게이트 **이전에** 200 no-op 로 응답해
  //   jobid6 유래 401 raw noise 를 소거한다. rotation 인증축(X-Internal-Cron dual-accept accept-set)과
  //   orthogonal — isCronCall/INTERNAL_CRON_SECRET 로직 무접촉(기능 caller jobid5/9/10 경로 불변).
  //   본 warm-ping 은 부작용 없는 순수 no-op 이므로 인증 불요(PHI/발송/DB write 0).
  if (bodyJson.keep_warm === true) {
    console.log("[send-notification] keep-warm warm-ping (no-op 200) at", new Date().toISOString());
    return new Response(
      JSON.stringify({ ok: true, warmed_at: new Date().toISOString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Auth 결정 ─────────────────────────────────────────────────
  const isServiceRole = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  // T-20260814-…-SILENT-STALL: 단일 primary 대조 → dual-accept(primary + _NEXT) accept-set 대조로 전환.
  //   rotation mid-window(caller=NEW=_NEXT, EF primary=OLD)에서도 크론 POST 를 정상 수용 → 실 send 재개.
  const isCronCall    = isAcceptedCronSecret(cronSecret);
  const isAdminAction = Boolean(bodyJson._action);

  // admin UI 액션은 user JWT도 허용 (role 검증)
  // T-20260606-foot-CTXMENU-SMS-SEND → T-20260608-foot-SMS-CTXMENU-ALLROLE: manual_send 는 전직원(8역할) 허용, 그 외 액션은 admin 한정 유지.
  let adminUserId: string | null = null;
  if (isAdminAction && !isServiceRole && !isCronCall) {
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const jwt = authHeader.slice("Bearer ".length);
    const actionName = String(bodyJson._action);
    const allowedRoles = actionName === "manual_send" ? MANUAL_SEND_ALLOWED_ROLES : ["admin"];
    adminUserId = await verifyRoleJwt(jwt, allowedRoles);
    if (!adminUserId) {
      console.warn(`[send-notification] JWT 검증 실패 action=${actionName} allowed=${allowedRoles.join("/")}`);
      return new Response(JSON.stringify({ error: `Unauthorized: ${allowedRoles.join("/")} role required` }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } else if (!isServiceRole && !isCronCall) {
    // ── T-20260814-…-SILENT-STALL AC-4: silent no-op 재발 차단(에러 스탬프) ──
    // 크론 헤더가 실제로 실려 왔는데 accept-set 과 불일치면 = rotation drift 로 인한 크론 실발송 정체.
    //   종전엔 이 401 이 무징후로 pending row 를 방치(edge_logs 오라클도 by-design keepwarm 401 과 구분 불가)
    //   → 무음 stall. 이제 CRON-SECRET-MISMATCH 태그 error 로 격상해 즉시 관측 가능(edge_logs raw grep 키).
    //   plaintext 미기록: presented/기대값의 길이·개수만 남긴다(시크릿 유출 0).
    if (cronSecret !== "") {
      console.error(
        `[send-notification][CRON-SECRET-MISMATCH] X-Internal-Cron presented but NOT in dual-accept set ` +
        `(primary+_NEXT). VAULT rotation drift 의심 → 크론 실발송 silent stall(pending 무진행). ` +
        `presented_len=${cronSecret.length} accept_set_size=${CRON_ACCEPT_SET.length}. ` +
        `조치: EF env INTERNAL_CRON_SECRET / _NEXT ↔ vault internal_cron_secret 정합 재확인(T-20260810 lane).`
      );
    } else {
      console.warn("[send-notification] Unauthorized call");
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // admin UI 액션 라우팅
  // ══════════════════════════════════════════════════════════════
  if (isAdminAction) {
    const action = String(bodyJson._action);

    // ── test_sms 액션 ──────────────────────────────────────────
    if (action === "test_sms") {
      const clinic_id       = String(bodyJson.clinic_id ?? "");
      // T-20260805-xcrm-SMS-EF-ADMINMANUAL-PRESTRIP-GUARD-BYPASS-SWEEP:
      //   과거 digit pre-strip(.replace(/[^0-9]/g,"")) 이 validateRecipient(sendSolapi L1 chokepoint) **이전에**
      //   raw 마커(DUMMY-<epoch> sentinel·영문마커)를 선파괴 → 남은 epoch digit 이 toDomesticKR 로 leading-0
      //   복원되어 가짜 01x 조립 → isPlausibleKRNumber 통과 → 실발신(무음 sent). 봉합: 원본 보존(.trim()만) 후
      //   가드/발신 경로에 raw 그대로 투입해 chokepoint 가 마커를 보게 한다. digit 정규화는 로깅 전용으로 분리
      //   (recipient_digits) — 가드/발신 경로엔 절대 재투입하지 않는다(pre-strip→guard 경로 0).
      const recipient_phone  = String(bodyJson.recipient_phone ?? "").trim();
      const recipient_digits = recipient_phone.replace(/[^0-9]/g, "");

      if (!clinic_id || !recipient_phone) {
        return new Response(
          JSON.stringify({ success: false, message: "clinic_id, recipient_phone 필수" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── caller-clinic 격리 게이트 (provider·vault 접근 이전) ──
      // adminUserId 가 있으면 user-JWT 도달 경로. service_role/크론은 adminUserId=null → 미적용.
      if (adminUserId && !(await callerBelongsToClinic(adminUserId, clinic_id))) {
        console.warn(`[send-notification] test_sms cross-tenant BLOCK user=${adminUserId} req_clinic=${clinic_id}`);
        return new Response(
          JSON.stringify({ success: false, message: "이 지점의 문자를 발송할 권한이 없습니다." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // capability 조회
      const { data: cap, error: capErr } = await supabase
        .from("clinic_messaging_capability")
        .select("solapi_api_key_vault_name, solapi_secret_vault_name, sender_number")
        .eq("clinic_id", clinic_id)
        .maybeSingle();

      if (capErr || !cap) {
        return new Response(
          JSON.stringify({ success: false, message: "연결 설정 정보를 찾을 수 없습니다" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { solapi_api_key_vault_name, solapi_secret_vault_name, sender_number } = cap as {
        solapi_api_key_vault_name: string | null;
        solapi_secret_vault_name:  string | null;
        sender_number:             string | null;
      };

      if (!solapi_api_key_vault_name || !solapi_secret_vault_name || !sender_number) {
        const missing = [
          !solapi_api_key_vault_name ? "API Key" : null,
          !solapi_secret_vault_name  ? "API Secret" : null,
          !sender_number             ? "발신번호" : null,
        ].filter(Boolean).join(", ");
        return new Response(
          JSON.stringify({
            success: false,
            message: `설정이 완료되지 않았습니다 (미설정: ${missing}). ⓪ 연결 설정에서 먼저 저장하세요.`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 지점명 조회 (테스트 문자 본문에 포함)
      const { data: clinicData } = await supabase
        .from("clinics")
        .select("name")
        .eq("id", clinic_id)
        .maybeSingle();
      const clinicName = (clinicData as { name?: string } | null)?.name ?? "";

      // Vault 시크릿 조회
      const apiKey    = await getVaultSecret(solapi_api_key_vault_name);
      const apiSecret = await getVaultSecret(solapi_secret_vault_name);

      if (!apiKey || !apiSecret) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Vault 시크릿을 찾을 수 없습니다. API Key / Secret을 다시 저장하세요.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 테스트 SMS 발송 (본문 하드코딩 — planner 스펙 2026-05-22)
      const testBody = `[오블리브 ${clinicName}] 문자 연결 테스트입니다.`;
      const result = await sendSolapi({
        apiKey,
        apiSecret,
        senderNumber: sender_number,
        recipientPhone: recipient_phone,
        body: testBody,
      });

      console.log(`[send-notification] test_sms admin=${adminUserId} clinic=${clinic_id} result=`, result);

      // T-20260523-crm-MESSAGING-ADMIN-UI-VERIFY AC-1:
      // test_sms 결과를 notification_logs에 기록 (event_type='test_send', trigger 추적)
      // T-20260804-…-PRODLEAK-SEAL: L1 가드 차단(blocked) 시 'failed'(retry 후보) 대신 'skipped' + error_code.
      const testBlocked = (result as { blocked?: boolean }).blocked === true;
      await supabase.from("notification_logs").insert({
        clinic_id,
        customer_id:      null,
        reservation_id:   null,
        event_type:       "test_send",
        channel:          "sms",
        recipient_phone:  recipient_digits,
        body_rendered:    testBody,
        status:           result.success ? "sent" : (testBlocked ? "skipped" : "failed"),
        solapi_message_id: result.success ? (result.messageId ?? null) : null,
        error_code:       testBlocked ? RECIPIENT_BLOCK_REASON : null,
        error_message:    result.success ? null : (result.errorMessage ?? null),
        sent_at:          result.success ? new Date().toISOString() : null,
      });

      return new Response(
        JSON.stringify({
          success: result.success,
          message: result.success
            ? "전송 완료"
            : (result.errorMessage ?? "발송 실패"),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── manual_send 액션 (T-20260606-foot-CTXMENU-SMS-SEND) ─────
    // 대시보드 고객 우클릭 [문자] → 템플릿 선택·자유편집 후 수동 1:1 발송.
    // 입력: { _action:'manual_send', clinic_id, customer_id, recipient_phone, body, source? }
    // body 는 FE에서 {고객명} 치환·편집 완료된 최종본 → EF는 재렌더하지 않고 그대로 발송.
    // 인증: admin/manager (위 auth 블록에서 검증됨). 업무시간 제약은 의도적 미적용(현장이 명시 발송).
    if (action === "manual_send") {
      const clinic_id       = String(bodyJson.clinic_id ?? "");
      const customer_id     = bodyJson.customer_id ? String(bodyJson.customer_id) : null;
      // T-20260805-xcrm-SMS-EF-ADMINMANUAL-PRESTRIP-GUARD-BYPASS-SWEEP:
      //   test_sms 와 동일 RC — digit pre-strip 이 validateRecipient(sendSolapi L1 chokepoint) 이전에 raw 마커를
      //   선파괴 → DUMMY/영문/조립번호 실발신. 봉합: 발신/가드 경로엔 raw(원본 .trim())를 투입하고, opt_out 매칭·
      //   로깅은 digit 정규화(recipient_digits)로 분리(가드/발신 경로 미투입).
      const recipient_phone  = String(bodyJson.recipient_phone ?? "").trim();
      const recipient_digits = recipient_phone.replace(/[^0-9]/g, "");
      const sendBody        = String(bodyJson.body ?? "").trim();
      const source          = String(bodyJson.source ?? "manual_dashboard");
      // T-20260609-foot-MSG-TEMPLATE-MMS Part B: 이미지 첨부(MMS) — message-images 버킷 storage 경로.
      // 값이 있으면 MMS, 없으면 종전 SMS/LMS (하위호환). 경로 1st 세그먼트=clinic_id (버킷 RLS와 동일 규칙).
      const imagePath       = bodyJson.image_path ? String(bodyJson.image_path).trim() : null;

      if (!clinic_id || !recipient_phone || !sendBody) {
        return new Response(
          JSON.stringify({ success: false, message: "clinic_id, recipient_phone, body 필수" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── caller-clinic 격리 게이트 (provider·vault 접근 이전, ★8역할 광범위 → 필수) ──
      // adminUserId 가 있으면 user-JWT 도달 경로. service_role/크론은 adminUserId=null → 미적용.
      if (adminUserId && !(await callerBelongsToClinic(adminUserId, clinic_id))) {
        console.warn(`[send-notification] manual_send cross-tenant BLOCK user=${adminUserId} req_clinic=${clinic_id}`);
        return new Response(
          JSON.stringify({ success: false, message: "이 지점의 문자를 발송할 권한이 없습니다." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 이미지 경로 격리 가드: 경로 1st 세그먼트가 요청 clinic_id 와 일치해야 함(타지점 이미지 첨부 차단).
      if (imagePath && imagePath.split("/")[0] !== clinic_id) {
        return new Response(
          JSON.stringify({ success: false, message: "이미지 접근 권한이 없습니다(지점 불일치)." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // capability 조회 + 발신/화이트리스트 가드 (자동발송과 동일 정책)
      const { data: mcap, error: mcapErr } = await supabase
        .from("clinic_messaging_capability")
        .select("enabled, solapi_api_key_vault_name, solapi_secret_vault_name, sender_number, solapi_validation_status")
        .eq("clinic_id", clinic_id)
        .maybeSingle();

      if (mcapErr || !mcap) {
        return new Response(
          JSON.stringify({ success: false, message: "연결 설정 정보를 찾을 수 없습니다" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const mc = mcap as {
        enabled: boolean;
        solapi_api_key_vault_name: string | null;
        solapi_secret_vault_name: string | null;
        sender_number: string | null;
        solapi_validation_status: string | null;
      };

      // T-20260731-foot-MSGSET-SENDBLOCK-RECOVER: 비활성화(enabled=false)와 실제 미설정(연결/발신번호 누락)을
      //   구분해 안내한다. 종전엔 두 경우 모두 "미설정 — 먼저 저장하세요"로 표출되어, 발신번호가 이미 저장돼 있고
      //   '발송 활성화' 토글만 꺼져 있는 상태(운영 self-halt)에서 현장이 "이미 저장했는데?"라며 혼선을 겪었다.
      if (!mc.enabled) {
        return new Response(
          JSON.stringify({ success: false, message: "문자 발송이 비활성화되어 있습니다. ⓪ 연결 설정에서 '메시지 발송 활성화'를 켠 뒤 저장하세요." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!mc.solapi_api_key_vault_name || !mc.solapi_secret_vault_name || !mc.sender_number) {
        return new Response(
          JSON.stringify({ success: false, message: "문자 발송 설정이 완료되지 않았습니다 (연결/발신번호 미설정). 메시지 설정에서 먼저 저장하세요." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (mc.solapi_validation_status === "not_registered") {
        return new Response(
          JSON.stringify({ success: false, message: "발신번호가 SOLAPI 화이트리스트에 미등록되어 발송할 수 없습니다." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 수신거부(opt_out) 가드
      const { data: mOpt } = await supabase
        .from("notification_opt_outs")
        .select("id")
        .eq("clinic_id", clinic_id)
        .eq("phone", recipient_digits)
        .maybeSingle();
      if (mOpt) {
        await supabase.from("notification_logs").insert({
          clinic_id, customer_id, reservation_id: null,
          event_type: "manual_send", channel: "sms",
          recipient_phone: recipient_digits, body_rendered: sendBody, status: "opt_out",
          error_message: `${source}: opt_out`, sent_at: null,
        });
        return new Response(
          JSON.stringify({ success: false, message: "수신거부 고객입니다 — 발송이 차단되었습니다." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Vault 시크릿 조회 + 발송
      const mApiKey    = await getVaultSecret(mc.solapi_api_key_vault_name);
      const mApiSecret = await getVaultSecret(mc.solapi_secret_vault_name);
      if (!mApiKey || !mApiSecret) {
        return new Response(
          JSON.stringify({ success: false, message: "Vault 시크릿을 찾을 수 없습니다. API Key/Secret을 다시 저장하세요." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 이미지 첨부 시 MMS, 없으면 종전 SMS/LMS (T-20260609-foot-MSG-TEMPLATE-MMS Part B).
      // MMS 제목(subject)은 본문 첫 줄을 사용(없으면 안내 기본값).
      const mSubject = imagePath
        ? (sendBody.split("\n")[0].trim() || "[오블리브] 안내")
        : null;
      const mResult = await sendWithOptionalImage({
        apiKey: mApiKey,
        apiSecret: mApiSecret,
        senderNumber: mc.sender_number,
        recipientPhone: recipient_phone,
        body: sendBody,
        imagePath,
        subject: mSubject,
      });

      console.log(`[send-notification] manual_send by=${adminUserId} clinic=${clinic_id} cust=${customer_id} mms=${Boolean(imagePath)} result=`, mResult);

      // 발송 이력 적재 (AC-7) — event_type='manual_send', source 는 error_message 프리픽스로 추적.
      // channel: 이미지 첨부 시 'mms', 아니면 sms/lms (sendWithOptionalImage 가 판정).
      // T-20260804-…-PRODLEAK-SEAL: L1 가드 차단 시 'failed' 대신 'skipped' + error_code(재시도 후보 제외).
      const mBlocked = (mResult as { blocked?: boolean }).blocked === true;
      await supabase.from("notification_logs").insert({
        clinic_id,
        customer_id,
        reservation_id: null,
        event_type: "manual_send",
        channel: mResult.channel,
        recipient_phone: recipient_digits,
        body_rendered: sendBody,
        status: mResult.success ? "sent" : (mBlocked ? "skipped" : "failed"),
        solapi_message_id: mResult.success ? (mResult.messageId ?? null) : null,
        error_code: mBlocked ? RECIPIENT_BLOCK_REASON : null,
        error_message: mResult.success ? `${source}` : `${source}: ${mResult.errorMessage ?? "발송 실패"}`,
        sent_at: mResult.success ? new Date().toISOString() : null,
      });

      return new Response(
        JSON.stringify({
          success: mResult.success,
          message: mResult.success ? "문자 발송 완료" : (mResult.errorMessage ?? "발송 실패"),
          channel: mResult.channel.toUpperCase(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── scheduled_send 액션 (T-20260612-foot-SMS-SCHEDULE-SEND-OPTION) ─────
    // 예약(지정시각) 발송. dispatch_scheduled_messages() pg_cron 디스패처가
    // scheduled_messages 행을 'processing' 으로 점유한 뒤 이 액션으로 POST 한다.
    // 입력: { _action:'scheduled_send', scheduled_message_id, clinic_id }
    // 인증: service_role 또는 X-Internal-Cron (위 auth 블록). 사용자 JWT 불가(내부 호출).
    // 무손실: 결과를 반드시 scheduled_messages.status(sent/failed) 로 기록.
    //   (기록 실패 시 reaper 가 10분 후 pending 회수 → 재시도. 중복발송은 'processing' 점유로 차단.)
    if (action === "scheduled_send") {
      if (!isServiceRole && !isCronCall) {
        return new Response(
          JSON.stringify({ success: false, message: "scheduled_send 는 내부 호출 전용입니다." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const schedId = String(bodyJson.scheduled_message_id ?? "");
      if (!schedId) {
        return new Response(
          JSON.stringify({ success: false, message: "scheduled_message_id 필수" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 예약 행 로드 — 'processing' 점유 상태만 발송(중복/취소 방어).
      const { data: schedRow, error: schedErr } = await supabase
        .from("scheduled_messages")
        .select("id, clinic_id, customer_id, recipient_phone, body, image_path, status")
        .eq("id", schedId)
        .maybeSingle();

      if (schedErr || !schedRow) {
        return new Response(
          JSON.stringify({ success: false, message: "예약 발송 건을 찾을 수 없습니다." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const sr = schedRow as {
        id: string; clinic_id: string; customer_id: string | null;
        recipient_phone: string; body: string; image_path: string | null; status: string;
      };

      // 디스패처가 점유(processing)한 건만 처리. 취소/이미처리 → idempotent skip.
      if (sr.status !== "processing") {
        return new Response(
          JSON.stringify({ success: true, skipped: `status=${sr.status}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sClinic = sr.clinic_id;
      // T-20260805-xcrm-SMS-EF-SCHEDSEND-PRESTRIP-GUARD-BYPASS-SWEEP:
      //   admin-manual(test_sms/manual_send)와 동일 RC — digit pre-strip(.replace(/[^0-9]/g,"")) 이
      //   validateRecipient(sendSolapi L1 chokepoint) **이전에** scheduled_messages 저장행의 raw 마커
      //   (DUMMY-<epoch> sentinel·영문마커)를 선파괴 → 남은 epoch 이 toDomesticKR 로 leading-0 복원 →
      //   가짜 01x 조립 → isPlausibleKRNumber 통과 → 무음 실발신. 저장행이 가드 도입 이전 레거시거나
      //   다른 삽입경로로 미검증 저장됐을 수 있어 dispatch-time pre-strip 자체가 우회 벡터.
      //   봉합: 원본(.trim())을 그대로 가드/발신 경로(sendWithOptionalImage→sendSolapi)에 투입해 chokepoint 가
      //   raw 마커를 보게 한다. digit 정규화(sDigits)는 opt_out 매칭·로깅 전용으로 분리(가드/발신 경로 미투입).
      const sPhone  = (sr.recipient_phone ?? "").trim();
      const sDigits = sPhone.replace(/[^0-9]/g, "");
      const sBody   = (sr.body ?? "").trim();
      const sImage  = sr.image_path ? String(sr.image_path).trim() : null;

      // 발송 실패를 scheduled_messages 에 기록하고 응답하는 헬퍼(공통).
      const finalizeSched = async (
        ok: boolean, channel: string, messageId: string | null, errMsg: string | null,
        blocked = false,
      ): Promise<Response> => {
        // notification_logs 적재(수동발송과 동일 스키마, event_type='scheduled_send')
        // T-20260804-…-PRODLEAK-SEAL: L1 가드 차단 시 'failed' 대신 'skipped' + error_code.
        let logId: string | null = null;
        try {
          const { data: logRow } = await supabase.from("notification_logs").insert({
            clinic_id: sClinic,
            customer_id: sr.customer_id,
            reservation_id: null,
            event_type: "scheduled_send",
            channel,
            recipient_phone: sDigits,
            body_rendered: sBody,
            status: ok ? "sent" : (blocked ? "skipped" : "failed"),
            solapi_message_id: ok ? messageId : null,
            error_code: blocked ? RECIPIENT_BLOCK_REASON : null,
            error_message: ok ? "scheduled" : `scheduled: ${errMsg ?? "발송 실패"}`,
            sent_at: ok ? new Date().toISOString() : null,
          }).select("id").maybeSingle();
          logId = (logRow as { id?: string } | null)?.id ?? null;
        } catch (e) {
          console.error("[send-notification] scheduled_send log insert err:", e);
        }
        await supabase.from("scheduled_messages").update({
          status: ok ? "sent" : "failed",
          sent_at: ok ? new Date().toISOString() : null,
          notification_log_id: logId,
          error_message: ok ? null : (errMsg ?? "발송 실패"),
          updated_at: new Date().toISOString(),
        }).eq("id", sr.id);
        return new Response(
          JSON.stringify({ success: ok, channel: channel.toUpperCase(), message: ok ? "예약 발송 완료" : (errMsg ?? "발송 실패") }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      };

      if (!sPhone || !sBody) {
        return await finalizeSched(false, "sms", null, "수신번호 또는 본문 누락");
      }
      // 이미지 격리 가드(타지점 첨부 차단)
      if (sImage && sImage.split("/")[0] !== sClinic) {
        return await finalizeSched(false, "mms", null, "이미지 접근 권한 없음(지점 불일치)");
      }

      // capability + 발신/화이트리스트 가드 (자동/수동발송과 동일 정책)
      const { data: scap } = await supabase
        .from("clinic_messaging_capability")
        .select("enabled, solapi_api_key_vault_name, solapi_secret_vault_name, sender_number, solapi_validation_status")
        .eq("clinic_id", sClinic)
        .maybeSingle();
      const sc = scap as {
        enabled: boolean;
        solapi_api_key_vault_name: string | null;
        solapi_secret_vault_name: string | null;
        sender_number: string | null;
        solapi_validation_status: string | null;
      } | null;
      if (!sc || !sc.enabled || !sc.solapi_api_key_vault_name || !sc.solapi_secret_vault_name || !sc.sender_number) {
        return await finalizeSched(false, "sms", null, "문자 발송 설정 미완료(연결/발신번호)");
      }
      if (sc.solapi_validation_status === "not_registered") {
        return await finalizeSched(false, "sms", null, "발신번호 SOLAPI 화이트리스트 미등록");
      }

      // 수신거부 가드
      const { data: sOpt } = await supabase
        .from("notification_opt_outs")
        .select("id").eq("clinic_id", sClinic).eq("phone", sDigits).maybeSingle();
      if (sOpt) {
        return await finalizeSched(false, "sms", null, "수신거부 고객");
      }

      const sApiKey    = await getVaultSecret(sc.solapi_api_key_vault_name);
      const sApiSecret = await getVaultSecret(sc.solapi_secret_vault_name);
      if (!sApiKey || !sApiSecret) {
        return await finalizeSched(false, "sms", null, "Vault 시크릿 누락");
      }

      const sSubject = sImage ? (sBody.split("\n")[0].trim() || "[오블리브] 안내") : null;
      const sResult = await sendWithOptionalImage({
        apiKey: sApiKey,
        apiSecret: sApiSecret,
        senderNumber: sc.sender_number,
        recipientPhone: sPhone,
        body: sBody,
        imagePath: sImage,
        subject: sSubject,
      });
      console.log(`[send-notification] scheduled_send id=${sr.id} clinic=${sClinic} mms=${Boolean(sImage)} result=`, sResult);
      return await finalizeSched(
        sResult.success, sResult.channel, sResult.messageId, sResult.errorMessage,
        (sResult as { blocked?: boolean }).blocked === true,
      );
    }

    // ── keep_warm 액션 (AC-1: EF keep-warm ping) ────────────────
    // pg_cron이 5분마다 호출 → cold-start 방지 (5s+ 제거)
    // 인증: X-Internal-Cron 헤더 (isCronCall=true → admin JWT 검증 불필요)
    if (action === "keep_warm") {
      console.log("[send-notification] keep_warm ping received at", new Date().toISOString());
      return new Response(
        JSON.stringify({ ok: true, warmed_at: new Date().toISOString() }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 알 수 없는 액션
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 일반 발송 플로우 (기존 코드)
  // ══════════════════════════════════════════════════════════════

  // ── 페이로드 정규화 ──────────────────────────────────────────
  let payload: SendRequest;
  if (bodyJson.type === "INSERT" && bodyJson.table === "reservations" && bodyJson.record) {
    const webhook = bodyJson as unknown as WebhookPayload;
    if (webhook.record.status !== "reserved") {
      return new Response(JSON.stringify({ skipped: "status not reserved" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    payload = {
      event_type:     "resv_confirm",
      reservation_id: webhook.record.id,
      clinic_id:      webhook.record.clinic_id,
      customer_id:    webhook.record.customer_id,
    };
  } else {
    payload = bodyJson as unknown as SendRequest;
  }

  const {
    event_type, reservation_id, clinic_id, customer_id,
    recipient_phone: rawPhone, retry_log_id,
  } = payload;

  console.log(`[send-notification] START event=${event_type} resv=${reservation_id}`);

  // ── 단계 2: clinic_messaging_capability 조회 ──────────────────
  const { data: cap, error: capErr } = await supabase
    .from("clinic_messaging_capability")
    .select("enabled, solapi_api_key_vault_name, solapi_secret_vault_name, sender_number, solapi_validation_status, send_start_hour, send_end_hour, sms_display_name")
    .eq("clinic_id", clinic_id)
    .maybeSingle();

  if (capErr) {
    console.error("[send-notification] cap query error:", capErr);
    return new Response(JSON.stringify({ error: "DB error", detail: capErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  if (!cap || !(cap as { enabled?: boolean }).enabled) {
    console.log(`[send-notification] SKIP: messaging disabled for clinic=${clinic_id}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: rawPhone ?? "", status: "skipped",
      body_rendered: null, error_message: "messaging disabled", retry_log_id });
    return new Response(JSON.stringify({ skipped: "messaging disabled" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const capTyped = cap as {
    enabled:                   boolean;
    solapi_api_key_vault_name: string | null;
    solapi_secret_vault_name:  string | null;
    sender_number:             string | null;
    solapi_validation_status:  string | null;
    send_start_hour:           number;
    send_end_hour:             number;
    sms_display_name:          string | null;
  };

  // ── T-20260523-crm-SENDER-VALIDATE-GUARD AC-1 AC-2: 발신번호 화이트리스트 가드 ──
  // AC-1: not_registered → 발송 차단(fail-close) + failed 로그
  // AC-2: api_unreachable / unchecked / pending / null → fail-open (WARN 로그 + 발송 허용)
  {
    const senderValidStatus = capTyped.solapi_validation_status ?? null;
    if (senderValidStatus === "not_registered") {
      console.warn(
        `[send-notification] BLOCK(AC-1): sender=${capTyped.sender_number} not_registered in SOLAPI whitelist — clinic=${clinic_id}`
      );
      await logNotification({
        clinic_id, customer_id, reservation_id, event_type,
        recipient_phone: rawPhone ?? "",
        status: "failed",
        body_rendered: null,
        error_message: "발신번호 SOLAPI 화이트리스트 미등록 (SENDER-VALIDATE-GUARD AC-1)",
        retry_log_id,
      });
      return new Response(
        JSON.stringify({
          error: "sender_not_registered",
          message: "발신번호가 SOLAPI 화이트리스트에 등록되지 않았습니다. 솔라피 콘솔에서 발신번호를 등록한 뒤 AdminSettings > [재검증]을 클릭하세요.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (senderValidStatus === "api_unreachable" || senderValidStatus === "unchecked" || senderValidStatus === "pending") {
      // AC-2: fail-open — WARN 로그만, 발송 계속 허용
      console.warn(
        `[send-notification] WARN(AC-2 fail-open): sender_validation_status=${senderValidStatus} — clinic=${clinic_id}. 발송 허용.`
      );
    }
  }

  // ── 수신자 전화번호 확인 + 문자수신(opt-in) 필터 ─────────────────
  // T-20260609-foot-CHART-CONSENT-ALIGN-SMS AC-4: 문자수신 거부(sms_opt_in=false) 고객은
  // recipient_phone이 payload로 직접 전달된 경우에도 자동발송에서 제외한다.
  // (기존엔 phone이 없을 때만 opt-in을 조회 → phone 동봉 호출(예: 재시도)이 필터를 우회하던 갭.)
  let recipientPhone = rawPhone ?? null;
  if (customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("phone, sms_opt_in")
      .eq("id", customer_id)
      .maybeSingle();
    if (!recipientPhone) {
      recipientPhone = (cust as { phone?: string } | null)?.phone ?? null;
    }

    // ── 단계 4: sms_opt_in 체크 — 거부(false) 시 자동발송 제외 ─────────
    if (cust && (cust as { sms_opt_in?: boolean }).sms_opt_in === false) {
      console.log(`[send-notification] SKIP: sms_opt_in=false customer=${customer_id}`);
      await logNotification({ clinic_id, customer_id, reservation_id, event_type,
        recipient_phone: recipientPhone ?? "", status: "skipped",
        body_rendered: null, error_message: "sms_opt_in=false", retry_log_id });
      return new Response(JSON.stringify({ skipped: "sms_opt_in=false" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  if (!recipientPhone) {
    console.warn(`[send-notification] SKIP: no phone for customer=${customer_id}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: "", status: "skipped",
      body_rendered: null, error_message: "no recipient phone", retry_log_id });
    return new Response(JSON.stringify({ skipped: "no phone" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ── L1 수신번호 가드 (T-20260804-foot-FOOTCTR-SMS-DUMMY-E2E-PRODLEAK-SEAL) ──
  // 자동발송(DB 웹훅 → customer.phone) 이 **무음 'sent' 오기록**을 낳던 정확한 벡터.
  //   E2E 픽스처가 phone='DUMMY-<ts>' 인 고객에 예약을 만들면 resv_confirm 웹훅이 발화 →
  //   여기서 recipientPhone='DUMMY-…' → 과거엔 그대로 Solapi 로 흘러 가짜 017 발신 → async 3032.
  // 봉합: 유효성 미달 수신번호는 template/vault/Solapi 이전에 status='skipped' + error_code=
  //   'blocked_invalid_recipient' 로 기록하고 종료(무음 sent 근절 + retry 인덱스(failed/pending)
  //   미편입으로 재시도 폭주 방지). ★회귀 0: 정상 KR 모바일은 통과.
  {
    const recipCheck = validateRecipient(recipientPhone);
    if (!recipCheck.ok) {
      console.warn(
        `[send-notification][L1-GUARD] SKIP invalid recipient event=${event_type} ` +
        `customer=${customer_id} reason=${recipCheck.reason} → Solapi 미호출.`
      );
      await logNotification({
        clinic_id, customer_id, reservation_id, event_type,
        recipient_phone: recipientPhone, status: "skipped",
        body_rendered: null,
        error_code: RECIPIENT_BLOCK_REASON,
        error_message: `${RECIPIENT_BLOCK_REASON}: ${recipCheck.reason}`,
        retry_log_id,
      });
      return new Response(
        JSON.stringify({ skipped: RECIPIENT_BLOCK_REASON, reason: recipCheck.reason }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ── 단계 3: notification_opt_outs 체크 ───────────────────────
  const { data: optOut } = await supabase
    .from("notification_opt_outs")
    .select("id")
    .eq("clinic_id", clinic_id)
    .eq("phone", recipientPhone)
    .maybeSingle();

  if (optOut) {
    console.log(`[send-notification] SKIP: opt_out phone=${recipientPhone}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "opt_out",
      body_rendered: null, error_message: "opt_out", retry_log_id });
    return new Response(JSON.stringify({ skipped: "opt_out" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ── 단계 5: 시간 제약 (KST) ───────────────────────────────────
  const nowKST   = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hourKST  = nowKST.getUTCHours();
  const startHour = capTyped.send_start_hour ?? 9;
  const endHour   = capTyped.send_end_hour   ?? 21;

  if (hourKST < startHour || hourKST >= endHour) {
    console.log(`[send-notification] PENDING: outside hours ${hourKST}KST (${startHour}~${endHour})`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "pending",
      body_rendered: null, error_message: `outside business hours: ${hourKST}KST`, retry_log_id });
    return new Response(JSON.stringify({ pending: "outside business hours" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ── 단계 6: 템플릿 조회 + 변수 치환 ─────────────────────────
  // image_path 포함 조회 — 마이그레이션 미적용(컬럼 부재) 환경에선 컬럼 없이 폴백(자동발송 회귀 차단).
  //
  // T-20260725-foot-NOTIF-TEMPLATE-UNIQUE-CONSTRAINT B (읽기경로 channel 필터 하드닝):
  //   기존 조회는 (clinic_id, event_type, is_active) 만 필터 → 동일 (clinic, event) 에
  //   서로 다른 채널의 활성 템플릿이 2개(예: sms + alimtalk) 존재하면 maybeSingle()>1 로
  //   에러 → tmpl=null → 무징후 no-template(부모 T-20260725-foot-SOLAPI-NO-TEMPLATE-RESOLVE-FAIL)
  //   재발. 발송 시점 채널(Phase 1 = Solapi 문자 = sms; sms→lms 는 send-time 본문길이 자동승격,
  //   alimtalk = Phase 2)로 템플릿을 해소하도록 channel 을 명시 필터하여 활성행을 1개로 확정.
  const SEND_CHANNEL = "sms"; // Phase 1 발송 채널(문자). Phase 2 alimtalk 도입 시 발송 채널 파생으로 확장.
  let tmpl: { body: string; channel?: string; image_path?: string | null } | null = null;
  {
    const withImg = await supabase
      .from("notification_templates")
      .select("body, channel, image_path")
      .eq("clinic_id", clinic_id)
      .eq("event_type", event_type)
      .eq("is_active", true)
      .eq("channel", SEND_CHANNEL)
      .maybeSingle();
    if (!withImg.error) {
      tmpl = withImg.data as typeof tmpl;
    } else {
      const base = await supabase
        .from("notification_templates")
        .select("body, channel")
        .eq("clinic_id", clinic_id)
        .eq("event_type", event_type)
        .eq("is_active", true)
        .eq("channel", SEND_CHANNEL)
        .maybeSingle();
      tmpl = base.data as typeof tmpl;
    }
  }

  if (!tmpl) {
    // ── T-20260725-foot-SOLAPI-NO-TEMPLATE-RESOLVE-FAIL ②③ (ADDITIVE·no-DDL) ──
    // ② 원인별 로깅: 레코드無(no_record) vs 비활성(inactive) 구분.
    //    기존엔 둘 다 error_message="no template found"로 뭉개져, 06-25~07-11 no-template
    //    에피소드의 실원인(is_active=false 설정상태)을 로그만으로 판별 불가 → 오진 유발.
    //    is_active 필터 없는 진단 조회 1회(발송 실패 경로에서만) 로 원인축을 로그에 각인.
    let cause: "no_record" | "inactive" = "no_record";
    {
      const probe = await supabase
        .from("notification_templates")
        .select("id, is_active")
        .eq("clinic_id", clinic_id)
        .eq("event_type", event_type);
      const rows = (probe.data ?? []) as Array<{ id: string; is_active: boolean }>;
      if (rows.length > 0) {
        // 행은 존재하는데 is_active=true 조회가 실패 → 활성행이 하나도 없는 '비활성 설정상태'.
        // (활성행이 있는데도 여기 도달했다면 조회오류이므로 보수적으로 no_record 유지.)
        cause = rows.some((r) => r.is_active) ? "no_record" : "inactive";
      }
    }

    // ③ config 재발방지 가드: 자동발송 event_type의 no-template은 설정오류로 인한
    //    무징후 발송중단(30일 집계로만 뒤늦게 드러남 → 이번 오진의 근인)이므로 severity를
    //    console.error 로 격상 + [CONFIG-GUARD] 태깅 → 모니터링/알림이 즉시 포착.
    //    (이 조회분기는 SendRequest.event_type: EventType 자동발송 경로로만 진입 → 전 event_type 대상.)
    const CORE_AUTOMATED: EventType[] = ["resv_confirm", "resv_reminder_d1", "resv_reminder_morning", "noshow"];
    const isCoreAutomated = CORE_AUTOMATED.includes(event_type as EventType);
    const errMsg = `no template found (${cause})`;

    if (isCoreAutomated) {
      console.error(
        `[send-notification][CONFIG-GUARD] core-automated event has NO active template — ` +
        `event=${event_type} clinic=${clinic_id} cause=${cause}. ` +
        `자동발송 무징후 중단: notification_templates(clinic_id,event_type) 활성 템플릿 설정 확인 필요.`
      );
    } else {
      console.warn(`[send-notification] SKIP: no template for event=${event_type} clinic=${clinic_id} cause=${cause}`);
    }
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "failed",
      body_rendered: null, error_message: errMsg, retry_log_id });
    return new Response(JSON.stringify({ failed: "no template", cause }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const { data: resv } = await supabase
    .from("reservations")
    .select(`
      reservation_date, reservation_time,
      customers!inner(name, phone),
      clinics!inner(name)
    `)
    .eq("id", reservation_id)
    .maybeSingle();

  const customerName = (resv?.customers as { name?: string } | null)?.name ?? "";
  const clinicLegalName = (resv?.clinics as { name?: string } | null)?.name ?? "";
  // ── T-20260610-foot-SMS-DISPLAYNAME-SPLIT (AC-3) ──
  // {지점명}: 문자 전용 표시명(sms_display_name) 우선, 빈값/NULL이면 clinics.name(법정서식 전용 불변) fallback.
  // 수동 SMS 모달(AC-1)·템플릿 미리보기(AC-2)와 동일 우선순위 → 미리보기==자동발송 정합.
  const clinicName   = capTyped.sms_display_name || clinicLegalName;
  const resvDate     = resv?.reservation_date
    ? new Date(resv.reservation_date).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
    : "";
  const resvTime     = resv?.reservation_time?.slice(0, 5) ?? "";
  const clinicPhone  = capTyped.sender_number ?? "";

  const bodyRendered = renderTemplate((tmpl as { body: string }).body, {
    "고객명":       customerName,
    "날짜":         resvDate,
    "시간":         resvTime,
    "지점명":       clinicName,
    "지점전화번호": clinicPhone,
  });

  // ── 단계 7: Vault에서 Solapi Secret 조회 ─────────────────────
  const keyVaultName    = capTyped.solapi_api_key_vault_name;
  const secretVaultName = capTyped.solapi_secret_vault_name;
  const senderNumber    = capTyped.sender_number;

  if (!keyVaultName || !secretVaultName || !senderNumber) {
    console.error(`[send-notification] FAIL: Vault/sender not configured clinic=${clinic_id}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "failed",
      body_rendered: bodyRendered, error_message: "Vault or sender not configured", retry_log_id });
    return new Response(JSON.stringify({ failed: "not configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const apiKey    = await getVaultSecret(keyVaultName);
  const apiSecret = await getVaultSecret(secretVaultName);

  if (!apiKey || !apiSecret) {
    console.error(`[send-notification] FAIL: Vault secret not found vault_name=${secretVaultName}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "failed",
      body_rendered: bodyRendered, error_message: "Vault secret missing", retry_log_id });
    return new Response(JSON.stringify({ failed: "vault secret missing" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // ── 단계 8: Solapi 발송 (템플릿 image_path 있으면 MMS, 없으면 SMS/LMS) ──
  // T-20260609-foot-MSG-TEMPLATE-MMS Part B: 템플릿에 약도/약국지도 이미지가 첨부돼 있으면 MMS 전환.
  const tmplImagePath = (tmpl as { image_path?: string | null }).image_path ?? null;
  // 경로 격리 가드(자동발송도 동일): 1st 세그먼트=clinic_id 아니면 이미지 무시하고 텍스트만 발송.
  const safeImagePath = (tmplImagePath && tmplImagePath.split("/")[0] === clinic_id) ? tmplImagePath : null;
  const result  = await sendWithOptionalImage({
    apiKey,
    apiSecret,
    senderNumber,
    recipientPhone,
    body: bodyRendered,
    imagePath: safeImagePath,
    subject: safeImagePath ? (bodyRendered.split("\n")[0].trim() || "[오블리브] 안내") : null,
  });
  const channel = result.channel.toUpperCase();

  const sendStatus: "sent" | "failed" = result.success ? "sent" : "failed";

  // ── 단계 9: notification_logs INSERT ─────────────────────────
  await logNotification({
    clinic_id, customer_id, reservation_id, event_type,
    recipient_phone: recipientPhone,
    status:          sendStatus,
    body_rendered:   bodyRendered,
    solapi_message_id: result.messageId,
    error_message:   result.errorMessage,
    channel:         result.channel,
    retry_log_id,
  });

  console.log(`[send-notification] DONE event=${event_type} status=${sendStatus} channel=${result.channel} msgId=${result.messageId}`);

  return new Response(
    JSON.stringify({ status: sendStatus, message_id: result.messageId, channel }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// ── notification_logs 기록 헬퍼 ──────────────────────────────────
async function logNotification(params: {
  clinic_id:          string;
  customer_id?:       string;
  reservation_id?:    string;
  event_type:         string;
  recipient_phone:    string;
  status:             string;
  body_rendered?:     string | null;
  solapi_message_id?: string | null;
  error_code?:        string | null;
  error_message?:     string | null;
  channel?:           string;
  retry_log_id?:      string;
}) {
  const {
    clinic_id, customer_id, reservation_id, event_type,
    recipient_phone, status, body_rendered,
    solapi_message_id, error_code, error_message, retry_log_id,
  } = params;
  const channel = params.channel ?? "sms";

  try {
    if (retry_log_id) {
      // (AC-2) in-place UPDATE: pre-inserted 'pending' 로그를 최종 상태로 채움
      // trigger가 pre-insert 시 NULL로 남긴 recipient_phone / body_rendered도 같이 기록
      const updatePayload: Record<string, unknown> = {
        status,
        solapi_message_id,
        error_code,
        error_message,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      };
      if (recipient_phone) updatePayload.recipient_phone = recipient_phone;
      if (body_rendered)   updatePayload.body_rendered   = body_rendered;

      const { error } = await supabase
        .from("notification_logs")
        .update(updatePayload)
        .eq("id", retry_log_id);
      if (error) console.error("[send-notification] log update error:", error);
    } else {
      const { error } = await supabase
        .from("notification_logs")
        .insert({
          clinic_id,
          customer_id,
          reservation_id,
          event_type,
          channel,
          recipient_phone,
          body_rendered,
          status,
          solapi_message_id,
          error_code,
          error_message,
          sent_at: status === "sent" ? new Date().toISOString() : null,
        });
      if (error) console.error("[send-notification] log insert error:", error);
    }
  } catch (e) {
    console.error("[send-notification] logNotification exception:", e);
  }
}
