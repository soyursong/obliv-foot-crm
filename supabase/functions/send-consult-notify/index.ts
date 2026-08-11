// T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY — Edge Function: send-consult-notify
//
// 변경2: 금일 배분 이력 [확정] 버튼 클릭 시에만 상담대기방(C0B4HEC9SHH)으로 Slack 발송.
//   현행 자동 즉시발송은 prod 미배선(factual_check 결과 — chat.postMessage 코드 부재)이었으므로
//   '제거할 자동발송'이 아니라 '확정 게이트로 신규 배선'. 배정 발생 시 자동발송 없음, 오직 이 EF 만 발송.
//
// 발송 포맷(총괄 확정):  <@담당실장SlackID> [고객명]님 [유입경로] 상담 대기중
//   담당실장 = check_ins.consultant_id → staff.slack_user_id (없으면 6명 매핑 상수 fallback, 그래도 없으면 이름 텍스트).
//   [고객명] = check_ins.customer_name(server-authoritative). [유입경로] = 클라이언트 바인딩 축 라벨(TM/인바운드/워크인 등).
//
// 멱등(변경2 상태모델, DA R3 3-state NULL→'sending'→'sent'):
//   조건부 UPDATE(WHERE consult_notify_status IS NULL)로 'sending' claim → rows-affected=1 일 때만 Slack post →
//   성공 시 'sent'(+sent_at,slack_ts) 승격. 0이면 이미 claim/발송 → skip(재클릭·새로고침·다중사용자 이중발송 차단).
//   claim↔post 사이 크래시 시 false-'sent'(무발송) 대신 'sending' 잔류(sweep/재확정 복구). Slack 실패 시 'sending'→NULL 롤백 → 재시도.
//
// 매출귀속 RED LINE(INV-1): consultant_id / customers.assigned_consultant_id 무접촉. 발송상태 컬럼만 write.
//
// Auth: 유효 CRM staff role JWT(FE ROLE-OPEN 패리티) + caller-clinic 격리(send-notification 동형).
//   ⚠ T-20260730-foot-ASSIGN-CONFIRM-EF-NON2XX-COORD-DIAG (P0 핫픽스): FE↔EF authz drift 해소.
//   34a11ce2(T-20260729-foot-CONFIRM-BTN-ROLE-OPEN, 총괄 지시 '접근제어 완화')가 FE [확정] 버튼 role gate
//   (canEditDistribution=admin/manager/director)를 제거 → 코디네이터 포함 전 역할 표시+클릭. 그러나 본 EF 는
//   구 allowlist(admin/manager/director) 유지 → coordinator 클릭 시 403 "non-2xx status code" 팝업(현장 장애).
//   → EF allowlist 를 FE ROLE-OPEN 결정(이미 총괄 승인)과 동기화. 테넌트 안전은 callerBelongsToClinic(clinic 격리)이
//     계속 강제(불변). 신규 권한 창설 아님 — 기결정 sync. RLS/GRANT/DDL 무변경(EF app-layer only, service_role write).
//
// Request Body:
//   { check_in_id: UUID, clinic_id: UUID, inflow?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── 환경 변수 ─────────────────────────────────────────────────────
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("CRM_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// 장쳰봇 토큰 — 전용 미설정 시 redpay-reconcile 과 동일 장쳰봇 토큰 재사용(단일 봇).
const SLACK_BOT_TOKEN =
  Deno.env.get("CONSULT_NOTIFY_SLACK_BOT_TOKEN") ??
  Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ??
  "";
// 상담대기방(총괄 확정) — 오버라이드 불가피 시 env, 기본 티켓 정본 채널.
const CONSULT_WAIT_CHANNEL = Deno.env.get("CONSULT_NOTIFY_CHANNEL") ?? "C0B4HEC9SHH";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── 6명 실장 ↔ Slack ID 매핑 (변경1 — 총괄 확정, staff.slack_user_id 미매핑 시 fallback) ──
//   SSOT 는 src/lib/siljangSlack.ts (FE 변경1). Deno EF 는 src import 불가 → 동일 표 명시 복제(변경 시 양쪽 동기화).
//   키 = 실장 표시명에서 ' 실장' suffix 제거한 이름(엄경은/송지현/…). staff.name 또는 display_name 어느 쪽이든 매칭.
const SILJANG_SLACK_MAP: Record<string, string> = {
  "엄경은": "U0B4JFD5Z6V",
  "송지현": "U0B4BSU84E9",
  "정연주": "U0B49P7JB3P",
  "강경민": "U0BFYC35B0X",
  "김지윤": "U0B902NG8JF",
  "김주연": "U0ATDB587PV",
  // T-20260731-foot-TMNOTIFY-CHOIHH-SLACKID-MAP — 최현희 실장 실제 멤버 ID(총괄 재확인, 봇 ID·기존 6명 무충돌). SSOT 동기화.
  "최현희": "U0BKRDWDG9Z",
  // T-20260805-foot-CONSULT-SLACKID-MAP-SELFSERVICE — 상담실장 2명 추가(총괄 확정, 봇 ID·기존 7명 무충돌 grep 검증). SSOT 동기화.
  "진이서": "U0BM25FTBFZ",
  "송민근": "U0BMKHRLCJV",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// T-20260730-foot-ASSIGN-CONFIRM-EF-NON2XX-COORD-DIAG: FE ROLE-OPEN(34a11ce2) 패리티 — cross_crm_data_contract
//   staff role 8종 전체 허용(유효 role guard 유지 → null/잡값 role 은 여전히 거부). 클리닉 격리는 별도로 강제.
const CONFIRM_ALLOWED_ROLES = [
  "admin", "manager", "director", "coordinator", "consultant", "therapist", "staff", "tm",
];
const MULTI_CLINIC_HQ_ROLES = ["admin", "manager", "director"];

interface ConfirmRequest {
  check_in_id: string;
  clinic_id: string;
  inflow?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── JWT 검증 → 허용 role 이면 user id 반환 (send-notification verifyRoleJwt 동형) ─────
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

// ── caller-clinic 격리 (send-notification callerBelongsToClinic 동형) ────────────
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
    console.error("[send-consult-notify] callerBelongsToClinic error:", String(e));
    return false;
  }
}

// ── Slack API 발송 (redpay-reconcile sendSlackMessage 동형) ──────────────────────
async function sendSlackMessage(channel: string, text: string, token: string): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json() as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) {
      console.error(`[send-consult-notify][SLACK] 발송 실패: ${data.error} (channel=${channel})`);
      return { ok: false, error: data.error };
    }
    console.log(`[send-consult-notify][SLACK] 발송 성공 → channel=${channel} ts=${data.ts ?? "?"}`);
    return { ok: true, ts: data.ts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[send-consult-notify][SLACK] 발송 예외: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** 실장 이름 정규화 — ' 실장'/'실장' suffix 제거 후 매핑 조회용 키. */
function nameKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s*실장\s*$/u, "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: ConfirmRequest;
  try {
    body = await req.json() as ConfirmRequest;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const checkInId = String(body.check_in_id ?? "").trim();
  const clinicId  = String(body.clinic_id ?? "").trim();
  const inflowRaw = String(body.inflow ?? "").trim();
  if (!checkInId || !clinicId) return json({ error: "check_in_id·clinic_id 필수" }, 400);

  // ── Auth ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const jwt = authHeader.slice("Bearer ".length);
  const userId = await verifyRoleJwt(jwt, CONFIRM_ALLOWED_ROLES);
  if (!userId) return json({ error: `Unauthorized: ${CONFIRM_ALLOWED_ROLES.join("/")} role required` }, 403);
  if (!(await callerBelongsToClinic(userId, clinicId))) {
    console.warn(`[send-consult-notify] cross-tenant BLOCK user=${userId} req_clinic=${clinicId}`);
    return json({ error: "clinic 소속 불일치" }, 403);
  }

  // ── 배정 건 로드 (clinic 스코프) ────────────────────────────────
  const { data: ci, error: ciErr } = await supabase
    .from("check_ins")
    .select("id, clinic_id, customer_name, consultant_id, consult_notify_status")
    .eq("id", checkInId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (ciErr) return json({ error: `조회 실패: ${ciErr.message}` }, 500);
  if (!ci) return json({ error: "배정 건을 찾을 수 없습니다." }, 404);

  const row = ci as { customer_name: string; consultant_id: string | null; consult_notify_status: string | null };
  if (!row.consultant_id) return json({ error: "상담 담당(실장)이 배정되지 않았습니다." }, 409);
  if (row.consult_notify_status === "sent") {
    return json({ ok: true, alreadySent: true, message: "이미 발송된 건입니다." });
  }

  // ── 봇 토큰 미설정 → claim 이전에 조기 차단(불필요한 claim/rollback churn 방지). ──
  if (!SLACK_BOT_TOKEN) {
    console.error("[send-consult-notify] SLACK_BOT_TOKEN 미설정 — 발송 불가(claim 미실행)");
    return json({ error: "발송 채널(봇 토큰) 미설정 — 관리자에게 문의하세요." }, 503);
  }

  // ── 담당 실장 → Slack mention 해소 (staff.slack_user_id → 6명 매핑 fallback) ──
  //   ⚠ QA-FIX A안: staff.display_name 컬럼은 foot prod 부재(STAFF-NAME-UNIFY 미마이그) → select 금지(42703).
  //   → name 만 select. suffix('… 실장')는 name 에 저장되며 nameKey 가 strip 후 6명 매핑 조회 → 정합.
  const { data: st } = await supabase
    .from("staff")
    .select("name, slack_user_id")
    .eq("id", row.consultant_id)
    .maybeSingle();
  const staffRow = (st ?? {}) as { name?: string | null; slack_user_id?: string | null };
  const displayName = (staffRow.name ?? "").trim() || "담당실장";
  const slackId =
    (staffRow.slack_user_id ?? "").trim() ||
    SILJANG_SLACK_MAP[nameKey(staffRow.name)] ||
    "";
  const mention = slackId ? `<@${slackId}>` : displayName;

  const customerName = (row.customer_name ?? "").trim() || "고객";
  const inflow = inflowRaw ? `${inflowRaw} ` : "";
  const text = `${mention} ${customerName}님 ${inflow}상담 대기중`;

  // ── 멱등 claim (3-state: NULL → 'sending', 조건부 UPDATE rows-affected 가드) ─────
  //   DA R3: claim 은 'sending' 로 예약만(sent_at/slack_ts 미기록). Slack post 성공 후에만 'sent' 승격.
  //   → claim↔post 사이 프로세스 크래시 시 false-'sent'(무발송) 대신 'sending' 잔류(sweep/재확정 복구 가능).
  //   가드(DA Q3): SET 절에 consult_notify_* 컬럼만 — consultant_id/therapist_id/assigned_consultant_id 절대 미포함.
  const { data: claimed, error: claimErr } = await supabase
    .from("check_ins")
    .update({
      consult_notify_status: "sending",
      consult_notify_by: userId,
    })
    .eq("id", checkInId)
    .eq("clinic_id", clinicId)
    .is("consult_notify_status", null)
    .select("id");
  if (claimErr) return json({ error: `상태 갱신 실패: ${claimErr.message}` }, 500);
  if (!claimed || claimed.length === 0) {
    // 동시 클릭/이미 claim('sending')/발송('sent') — 이중발송 차단
    return json({ ok: true, alreadySent: true, message: "이미 발송(확정)된 건입니다." });
  }

  // ── Slack 발송 ────────────────────────────────────────────────────
  const sent = await sendSlackMessage(CONSULT_WAIT_CHANNEL, text, SLACK_BOT_TOKEN);
  if (!sent.ok) {
    // 발송 실패 → claim 롤백('sending'→NULL) → 재시도 가능. (내 claim 만: status='sending' AND by=userId)
    await supabase.from("check_ins")
      .update({ consult_notify_status: null, consult_notify_by: null })
      .eq("id", checkInId).eq("clinic_id", clinicId)
      .eq("consult_notify_status", "sending").eq("consult_notify_by", userId);
    return json({ error: `Slack 발송 실패: ${sent.error ?? "unknown"}` }, 502);
  }

  // ── 발송 성공 → 'sending' → 'sent' 승격 (+sent_at, slack_ts). 내 claim 만. ──
  const { error: promoteErr } = await supabase
    .from("check_ins")
    .update({
      consult_notify_status: "sent",
      consult_notify_sent_at: new Date().toISOString(),
      consult_notify_slack_ts: sent.ts ?? null,
    })
    .eq("id", checkInId).eq("clinic_id", clinicId)
    .eq("consult_notify_status", "sending").eq("consult_notify_by", userId);
  if (promoteErr) {
    // Slack 은 이미 발송됨. 상태 승격만 실패 → 'sending' 잔류(무한 재발송 금지 위해 성공 반환).
    console.error(`[send-consult-notify] sent OK but promote to 'sent' failed: ${promoteErr.message} (check_in=${checkInId} ts=${sent.ts})`);
  }

  console.log(`[send-consult-notify] sent check_in=${checkInId} by=${userId} slack_id=${slackId || "(name-fallback)"} ts=${sent.ts}`);
  return json({ ok: true, sent: true, ts: sent.ts, text });
});
