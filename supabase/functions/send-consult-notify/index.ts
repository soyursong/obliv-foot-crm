// T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY — Edge Function: send-consult-notify
//
// ★ T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN (decouple resilience, canon-conformance):
//   [확정] 성공 = claim write 영속(rows=1)만으로 성립. Slack 상담대기방 발송 = side-effect(best-effort).
//   기존 단일출구(L258)가 notify 실패(502 channel_not_found)를 [확정] 성공경로에 우발 결합 → 당일 운영정지(P0) = 버그.
//   → 이제: enqueue_consult_notify RPC(claim + outbox enqueue 동일 txn, VG1) → 2xx 반환 →
//      인라인 best-effort 발송(정상채널 즉시 delivered) → 실패 시 outbox 잔류(pg_cron worker 재시도/backoff/DLQ, VG2).
//   발송 실패는 [확정] 실패로 전파하지 않음(2xx 유지). 발송실패는 consult_notify_status='failed' 배지 + DLQ 슬랙알람으로 가시화(VG4).
//   DA SSOT: da_replies/da_decision_foot_consultconfirm_slack_decouple_harden_20260806.md (GO·ADDITIVE·§3.1 면제).
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
// VG5 종단분류 discriminator(channel-gone=terminal / transient=retry) — dispatcher EF 와 SSOT 공유.
import { classifySlackError } from "../_shared/consultNotifyDeliver.ts";

// ── 환경 변수 ─────────────────────────────────────────────────────
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    // 빠른 경로 — 이미 발송완료(멱등). (RPC 도 'already' 로 커버하나 불필요 write 회피.)
    return json({ ok: true, confirmed: true, alreadySent: true, message: "이미 발송된 건입니다." });
  }

  // ── VG1: 원자적 claim + outbox enqueue (RPC, 동일 txn) ────────────────────────────
  //   [확정] 성공 = claim write(consult_notify_status NULL→'sending') 영속(rows=1). = 권위 상태전이.
  //   enqueue 실패 시 RPC 가 RAISE → 전체 롤백 → 아래 rpcErr 로 5xx([확정]과 함께 실패 = silent gap 재생성 방지).
  //   Slack 발송은 이 아래 side-effect — 실패해도 [확정] 성공(2xx)을 전파하지 않음(decouple 핵심).
  const { data: rpcData, error: rpcErr } = await supabase.rpc("enqueue_consult_notify", {
    p_check_in_id: checkInId,
    p_clinic_id: clinicId,
    p_channel: CONSULT_WAIT_CHANNEL,
    p_inflow: inflowRaw || null,
    p_actor: userId,
  });
  if (rpcErr) {
    console.error(`[send-consult-notify] enqueue RPC 실패(→ claim/outbox 롤백): ${rpcErr.message} (check_in=${checkInId})`);
    return json({ error: `확정 처리 실패: ${rpcErr.message}` }, 500);
  }
  const rpc = (rpcData ?? {}) as {
    ok?: boolean; claimed?: boolean; enqueued?: boolean; outbox_id?: string; reason?: string;
  };
  if (rpc.ok === false) {
    if (rpc.reason === "not_found") return json({ error: "배정 건을 찾을 수 없습니다." }, 404);
    if (rpc.reason === "no_consultant") return json({ error: "상담 담당(실장)이 배정되지 않았습니다." }, 409);
    return json({ error: `확정 처리 실패: ${rpc.reason ?? "unknown"}` }, 500);
  }
  // 멱등: 이미 확정(claim 안 됨, race/already) — 이중확정 차단. [확정]은 이미 성립 → 2xx.
  if (rpc.claimed !== true) {
    return json({ ok: true, confirmed: true, alreadySent: true, message: "이미 확정된 건입니다." });
  }

  // ══ [확정] 성공(claim 영속·outbox enqueue 완료). 이하 Slack 발송 = best-effort side-effect. ══
  //   정상 채널이면 인라인 즉시 delivered(낮은 지연). 실패해도 2xx 유지 → outbox 잔류 → pg_cron worker 재시도/DLQ.
  //   (worker 는 enqueue next_attempt_at=+90s 유예로 인라인과 race 안 함 — VG3 double-send 가드.)
  const outboxId = rpc.outbox_id ?? "";
  let delivery: { delivered: boolean; terminal?: boolean; error?: string } = { delivered: false };

  if (!SLACK_BOT_TOKEN) {
    console.warn("[send-consult-notify] SLACK_BOT_TOKEN 미설정 — 인라인 발송 skip. outbox 잔류 → worker 처리.");
    delivery = { delivered: false, error: "slack_token_not_configured" };
  } else {
    try {
      // 담당 실장 → Slack mention 해소 (staff.slack_user_id → 6명 매핑 fallback).
      //   ⚠ staff.display_name 컬럼 foot prod 부재 → name 만 select. nameKey 가 ' 실장' strip 후 매핑 조회.
      const { data: st } = await supabase
        .from("staff").select("name, slack_user_id").eq("id", row.consultant_id).maybeSingle();
      const staffRow = (st ?? {}) as { name?: string | null; slack_user_id?: string | null };
      const displayName = (staffRow.name ?? "").trim() || "담당실장";
      const slackId =
        (staffRow.slack_user_id ?? "").trim() || SILJANG_SLACK_MAP[nameKey(staffRow.name)] || "";
      const mention = slackId ? `<@${slackId}>` : displayName;
      const customerName = (row.customer_name ?? "").trim() || "고객";
      const inflow = inflowRaw ? `${inflowRaw} ` : "";
      const text = `${mention} ${customerName}님 ${inflow}상담 대기중`;

      const sent = await sendSlackMessage(CONSULT_WAIT_CHANNEL, text, SLACK_BOT_TOKEN);
      const nowIso = new Date().toISOString();

      if (sent.ok) {
        // VG3 delivered 마킹 + check_ins 'sent' 승격 (내 'sending' claim 만).
        await supabase.from("consult_notify_outbox")
          .update({ status: "delivered", delivered_at: nowIso, slack_ts: sent.ts ?? null, last_error: null, error_class: null, updated_at: nowIso })
          .eq("id", outboxId);
        await supabase.from("check_ins")
          .update({ consult_notify_status: "sent", consult_notify_sent_at: nowIso, consult_notify_slack_ts: sent.ts ?? null })
          .eq("id", checkInId).eq("clinic_id", clinicId).eq("consult_notify_status", "sending");
        delivery = { delivered: true };
      } else {
        // VG5 종단분류: channel-gone=terminal(즉시 DLQ + 'failed' 가시화) / transient=worker 재시도.
        const cls = classifySlackError(sent.error);
        if (cls === "terminal") {
          await supabase.from("consult_notify_outbox")
            .update({ status: "failed", dlq: true, error_class: "terminal", last_error: `terminal:${sent.error ?? "unknown"}`.slice(0, 500), updated_at: nowIso })
            .eq("id", outboxId);
          // VG4 가시화: [확정]은 성립·발송만 실패 → FE '발송실패' 배지.
          await supabase.from("check_ins")
            .update({ consult_notify_status: "failed" })
            .eq("id", checkInId).eq("clinic_id", clinicId).eq("consult_notify_status", "sending");
          delivery = { delivered: false, terminal: true, error: sent.error };
        } else {
          // transient — worker next_attempt_at 재시도. check_ins 'sending' 유지.
          await supabase.from("consult_notify_outbox")
            .update({ status: "pending", error_class: "transient", last_error: `transient:${sent.error ?? "unknown"}`.slice(0, 500), updated_at: nowIso })
            .eq("id", outboxId);
          delivery = { delivered: false, error: sent.error };
        }
      }
    } catch (e) {
      // 인라인 발송 예외도 [확정] 성공을 훼손하지 않음 — outbox 잔류 → worker 재시도(silent drop 0).
      console.error(`[send-consult-notify] 인라인 발송 예외(비치명, worker 재시도): ${e instanceof Error ? e.message : String(e)}`);
      delivery = { delivered: false, error: "inline_dispatch_exception" };
    }
  }

  console.log(`[send-consult-notify] confirmed check_in=${checkInId} by=${userId} outbox=${outboxId} delivered=${delivery.delivered} terminal=${delivery.terminal ?? false}`);
  // [확정] 성공 = 2xx 불변(발송 결과와 독립). delivery 는 FE 안내용 부가정보.
  return json({ ok: true, confirmed: true, enqueued: rpc.enqueued ?? true, delivery });
});
