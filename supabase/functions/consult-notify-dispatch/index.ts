// T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN — consult_notify_outbox dispatcher
//
// 상담대기방 알림 outbox 1행을 Slack 으로 1회 발사(재시도/백오프는 worker 소유).
// ※ dopamine-callback-dispatch(T-CALLBACK-EF-4) 미러. 대상만 Slack chat.postMessage 로 변형.
//
// 호출자: pg_cron worker process_consult_notify_outbox() (net.http_post)
//   POST body: { outbox_id: uuid }
//   헤더: X-Internal-Cron: <internal_cron_secret>
//
// 동작:
//   1. outbox 행 로드 (status='processing' — worker claim 후 호출). 종결(sent/duplicate/failed/dlq)이면 skip(멱등).
//   2. check_in 재조회 → 고객명/담당실장 mention server-authoritative 렌더(PHI transient, outbox 미영속).
//   3. Slack chat.postMessage 단일 발사.
//   4. 응답 → outbox + check_ins 상태 전이:
//        발송 성공          → outbox 'sent'(+slack_ts,sent_at), check_ins consult_notify_status='sent'(delivered, VG3)
//        channel_gone(VG5)  → outbox dlq+'failed'(dlq_reason='channel_gone'), check_ins 'failed'  (즉시 terminal, 무한재시도 금지)
//        transient/기타      → attempts>=7 이면 dlq+'failed'('retry_exhausted') + check_ins 'failed', 아니면 'pending'(worker 재시도)
//
// PHI 가드: outbox payload 는 운영 메타 only(check_in_id/clinic_id/channel/inflow). 고객명은 본 EF 가 check_ins 에서
//   재조회해 transient 렌더 → DLQ 잔존 저장소에 미마스킹 PHI 축적 없음(§16-3 N/A).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN =
  Deno.env.get("CONSULT_NOTIFY_SLACK_BOT_TOKEN") ??
  Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ??
  "";
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
const MAX_ATTEMPTS = 7; // 마이그레이션 backoff(1·2·4·8·16·32·60)와 동일

// VG5 종단분류 discriminator — 채널 소멸(self-heal 불가) = 즉시 terminal.
const CHANNEL_GONE = /channel_not_found|not_in_channel|is_archived|channel_is_archived/i;

// 6명 실장 ↔ Slack ID 매핑 (send-consult-notify EF 와 동일 — SSOT src/lib/siljangSlack.ts 복제).
const SILJANG_SLACK_MAP: Record<string, string> = {
  "엄경은": "U0B4JFD5Z6V",
  "송지현": "U0B4BSU84E9",
  "정연주": "U0B49P7JB3P",
  "강경민": "U0BFYC35B0X",
  "김지윤": "U0B902NG8JF",
  "김주연": "U0ATDB587PV",
  "최현희": "U0BKRDWDG9Z",
  "진이서": "U0BM25FTBFZ",
  "송민근": "U0BMKHRLCJV",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nameKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s*실장\s*$/u, "").trim();
}

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
    if (!data.ok) return { ok: false, error: data.error };
    return { ok: true, ts: data.ts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ── 내부 호출 인증 (cron_secret) ─────────────────────────────
  if (CRON_SECRET) {
    if ((req.headers.get("X-Internal-Cron") ?? "") !== CRON_SECRET) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }
  }

  let outboxId: string;
  try {
    const body = await req.json();
    outboxId = String(body.outbox_id ?? "");
    if (!outboxId) return json({ error: "outbox_id required" }, 400);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // ── 1. outbox 행 로드 ────────────────────────────────────────
  const { data: row, error: loadErr } = await supabase
    .from("consult_notify_outbox")
    .select("id, check_in_id, clinic_id, channel, inflow, attempts, status, dlq")
    .eq("id", outboxId)
    .maybeSingle();
  if (loadErr) return json({ ok: false, reason: "db_error", detail: loadErr.message }, 500);
  if (!row) return json({ ok: false, reason: "not_found" }, 404);
  const o = row as {
    id: string; check_in_id: string; clinic_id: string; channel: string;
    inflow: string | null; attempts: number; status: string; dlq: boolean;
  };
  if (["sent", "duplicate", "failed"].includes(o.status) || o.dlq) {
    return json({ ok: true, skipped: true, reason: "already_terminal" });
  }

  if (!SLACK_BOT_TOKEN) {
    // 토큰 미설정 → pending 유지, worker 재시도(env 주입 전 안전망). transient 취급.
    await supabase.from("consult_notify_outbox")
      .update({ status: "pending", last_error: "slack_bot_token_not_configured", updated_at: new Date().toISOString() })
      .eq("id", outboxId);
    return json({ ok: false, reason: "slack_bot_token_not_configured" }, 500);
  }

  // ── 2. check_in 재조회 → 메시지 server-authoritative 렌더 (PHI transient) ──
  const { data: ci } = await supabase
    .from("check_ins")
    .select("id, customer_name, consultant_id")
    .eq("id", o.check_in_id)
    .eq("clinic_id", o.clinic_id)
    .maybeSingle();
  const ciRow = (ci ?? {}) as { customer_name?: string | null; consultant_id?: string | null };

  let mention = "담당실장";
  let slackId = "";
  if (ciRow.consultant_id) {
    const { data: st } = await supabase
      .from("staff")
      .select("name, slack_user_id")
      .eq("id", ciRow.consultant_id)
      .maybeSingle();
    const staffRow = (st ?? {}) as { name?: string | null; slack_user_id?: string | null };
    const displayName = (staffRow.name ?? "").trim() || "담당실장";
    slackId =
      (staffRow.slack_user_id ?? "").trim() ||
      SILJANG_SLACK_MAP[nameKey(staffRow.name)] ||
      "";
    mention = slackId ? `<@${slackId}>` : displayName;
  }
  const customerName = (ciRow.customer_name ?? "").trim() || "고객";
  const inflow = (o.inflow ?? "").trim() ? `${(o.inflow ?? "").trim()} ` : "";
  const text = `${mention} ${customerName}님 ${inflow}상담 대기중`;

  // ── 3. Slack 단일 발사 ───────────────────────────────────────
  const sent = await sendSlackMessage(o.channel, text, SLACK_BOT_TOKEN);
  const nowIso = new Date().toISOString();

  // ── 4. outbox + check_ins 상태 전이 ──────────────────────────
  let outboxUpdate: Record<string, unknown>;
  let checkInStatus: string | null = null; // 반영할 check_ins.consult_notify_status

  if (sent.ok) {
    outboxUpdate = { status: "sent", last_error: null, slack_ts: sent.ts ?? null, sent_at: nowIso };
    checkInStatus = "sent";
  } else if (CHANNEL_GONE.test(sent.error ?? "")) {
    // VG5 — 채널 소멸: 즉시 terminal(무한 재시도 금지) + 즉시 가시화.
    outboxUpdate = { status: "failed", dlq: true, dlq_reason: "channel_gone", last_error: `channel_gone: ${sent.error}` };
    checkInStatus = "failed";
  } else {
    const exhausted = o.attempts >= MAX_ATTEMPTS;
    if (exhausted) {
      outboxUpdate = { status: "failed", dlq: true, dlq_reason: "retry_exhausted", last_error: `retry_exhausted(${o.attempts}) last=${sent.error ?? "?"}` };
      checkInStatus = "failed";
    } else {
      outboxUpdate = { status: "pending", last_error: `transient: ${sent.error ?? "?"}` };
      // pending → check_ins 는 'sending' 유지(확정됨, 재시도 대기). 변경 없음.
    }
  }
  outboxUpdate.updated_at = nowIso;

  const { error: updErr } = await supabase
    .from("consult_notify_outbox").update(outboxUpdate).eq("id", outboxId);
  if (updErr) return json({ ok: false, reason: "update_failed", detail: updErr.message }, 500);

  // VG4 — 발송상태를 check_ins 로 반영(FE 배지: sent/failed). sending 유지 시 미변경.
  if (checkInStatus) {
    const ciUpdate: Record<string, unknown> = { consult_notify_status: checkInStatus };
    if (checkInStatus === "sent") {
      ciUpdate.consult_notify_sent_at = nowIso;
      ciUpdate.consult_notify_slack_ts = sent.ts ?? null;
    }
    await supabase.from("check_ins").update(ciUpdate)
      .eq("id", o.check_in_id).eq("clinic_id", o.clinic_id)
      // sent 는 sending 에서만 승격(멱등), failed 는 sending/pending 어디서든 반영
      .in("consult_notify_status", checkInStatus === "sent" ? ["sending"] : ["sending", "sent"]);
  }

  console.log(`[consult-notify-dispatch] id=${outboxId} slack_ok=${sent.ok} → status=${outboxUpdate.status} dlq=${outboxUpdate.dlq ?? false} reason=${outboxUpdate.dlq_reason ?? "-"}`);
  return json({
    ok: true,
    outbox_id: outboxId,
    slack_ok: sent.ok,
    new_status: outboxUpdate.status,
    dlq: outboxUpdate.dlq ?? false,
  });
});
