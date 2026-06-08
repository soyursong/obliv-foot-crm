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

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// ── 환경 변수 ─────────────────────────────────────────────────────
const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_SECRET     = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

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
  let d = (raw ?? "").replace(/[^0-9]/g, "");   // +82 10-1234-5678 → 821012345678
  if (d.startsWith("0082")) d = d.slice(4);     // 0082… 국제접속 prefix 제거 → 1012345678
  if (d.startsWith("82")) d = d.slice(2);       // 821012345678 → 1012345678 (KR 국가코드 제거)
  if (d && !d.startsWith("0")) d = "0" + d;     // 국내 형식 leading-0 복원 → 01012345678
  return d;
}

// ── Solapi SMS 발송 헬퍼 ─────────────────────────────────────────
async function sendSolapi(params: {
  apiKey:       string;
  apiSecret:    string;
  senderNumber: string;
  recipientPhone: string;
  body:         string;
}): Promise<{ success: boolean; messageId: string | null; errorMessage: string | null }> {
  const { apiKey, apiSecret, senderNumber, recipientPhone, body } = params;

  const msgType    = getChannel(body) === "SMS" ? "SMS" : "LMS";
  const date       = new Date().toISOString();
  const salt       = crypto.randomUUID().replace(/-/g, "");
  const sigPlain   = `${date}${salt}`;
  const signature  = await hmacSha256(sigPlain, apiSecret);
  const authHdr    = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  const solapiPayload = {
    message: {
      to:   toDomesticKR(recipientPhone),
      from: toDomesticKR(senderNumber),
      text: body,
      type: msgType,
    }
  };

  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": authHdr,
      },
      body: JSON.stringify(solapiPayload),
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

  // ── Auth 결정 ─────────────────────────────────────────────────
  const isServiceRole = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const isCronCall    = INTERNAL_CRON_SECRET !== "" && cronSecret === INTERNAL_CRON_SECRET;
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
    console.warn("[send-notification] Unauthorized call");
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
      const recipient_phone = String(bodyJson.recipient_phone ?? "").replace(/[^0-9]/g, "");

      if (!clinic_id || !recipient_phone) {
        return new Response(
          JSON.stringify({ success: false, message: "clinic_id, recipient_phone 필수" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      await supabase.from("notification_logs").insert({
        clinic_id,
        customer_id:      null,
        reservation_id:   null,
        event_type:       "test_send",
        channel:          "sms",
        recipient_phone:  recipient_phone,
        body_rendered:    testBody,
        status:           result.success ? "sent" : "failed",
        solapi_message_id: result.success ? (result.messageId ?? null) : null,
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
      const recipient_phone = String(bodyJson.recipient_phone ?? "").replace(/[^0-9]/g, "");
      const sendBody        = String(bodyJson.body ?? "").trim();
      const source          = String(bodyJson.source ?? "manual_dashboard");

      if (!clinic_id || !recipient_phone || !sendBody) {
        return new Response(
          JSON.stringify({ success: false, message: "clinic_id, recipient_phone, body 필수" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      if (!mc.enabled || !mc.solapi_api_key_vault_name || !mc.solapi_secret_vault_name || !mc.sender_number) {
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
        .eq("phone", recipient_phone)
        .maybeSingle();
      if (mOpt) {
        await supabase.from("notification_logs").insert({
          clinic_id, customer_id, reservation_id: null,
          event_type: "manual_send", channel: "sms",
          recipient_phone, body_rendered: sendBody, status: "opt_out",
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

      const mResult = await sendSolapi({
        apiKey: mApiKey,
        apiSecret: mApiSecret,
        senderNumber: mc.sender_number,
        recipientPhone: recipient_phone,
        body: sendBody,
      });

      console.log(`[send-notification] manual_send by=${adminUserId} clinic=${clinic_id} cust=${customer_id} result=`, mResult);

      // 발송 이력 적재 (AC-7) — event_type='manual_send', source 는 error_message 프리픽스로 추적
      await supabase.from("notification_logs").insert({
        clinic_id,
        customer_id,
        reservation_id: null,
        event_type: "manual_send",
        channel: getChannel(sendBody).toLowerCase(),
        recipient_phone,
        body_rendered: sendBody,
        status: mResult.success ? "sent" : "failed",
        solapi_message_id: mResult.success ? (mResult.messageId ?? null) : null,
        error_message: mResult.success ? `${source}` : `${source}: ${mResult.errorMessage ?? "발송 실패"}`,
        sent_at: mResult.success ? new Date().toISOString() : null,
      });

      return new Response(
        JSON.stringify({
          success: mResult.success,
          message: mResult.success ? "문자 발송 완료" : (mResult.errorMessage ?? "발송 실패"),
          channel: getChannel(sendBody),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    .select("enabled, solapi_api_key_vault_name, solapi_secret_vault_name, sender_number, solapi_validation_status, send_start_hour, send_end_hour")
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

  // ── 수신자 전화번호 확인 ───────────────────────────────────────
  let recipientPhone = rawPhone ?? null;
  if (!recipientPhone) {
    const { data: cust } = await supabase
      .from("customers")
      .select("phone, sms_opt_in")
      .eq("id", customer_id)
      .maybeSingle();
    recipientPhone = (cust as { phone?: string } | null)?.phone ?? null;

    // ── 단계 4: sms_opt_in 체크 ─────────────────────────────────
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
  const { data: tmpl } = await supabase
    .from("notification_templates")
    .select("body, channel")
    .eq("clinic_id", clinic_id)
    .eq("event_type", event_type)
    .eq("is_active", true)
    .order("channel")
    .maybeSingle();

  if (!tmpl) {
    console.warn(`[send-notification] SKIP: no template for event=${event_type} clinic=${clinic_id}`);
    await logNotification({ clinic_id, customer_id, reservation_id, event_type,
      recipient_phone: recipientPhone, status: "failed",
      body_rendered: null, error_message: "no template found", retry_log_id });
    return new Response(JSON.stringify({ failed: "no template" }), {
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
  const clinicName   = (resv?.clinics   as { name?: string } | null)?.name ?? "";
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

  // ── 단계 8: Solapi SMS/LMS API 호출 ─────────────────────────
  const channel = getChannel(bodyRendered);
  const result  = await sendSolapi({
    apiKey,
    apiSecret,
    senderNumber,
    recipientPhone,
    body: bodyRendered,
  });

  const sendStatus: "sent" | "failed" = result.success ? "sent" : "failed";

  // ── 단계 9: notification_logs INSERT ─────────────────────────
  await logNotification({
    clinic_id, customer_id, reservation_id, event_type,
    recipient_phone: recipientPhone,
    status:          sendStatus,
    body_rendered:   bodyRendered,
    solapi_message_id: result.messageId,
    error_message:   result.errorMessage,
    retry_log_id,
  });

  console.log(`[send-notification] DONE event=${event_type} status=${sendStatus} msgId=${result.messageId}`);

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
  retry_log_id?:      string;
}) {
  const {
    clinic_id, customer_id, reservation_id, event_type,
    recipient_phone, status, body_rendered,
    solapi_message_id, error_code, error_message, retry_log_id,
  } = params;

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
          channel: "sms",
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
