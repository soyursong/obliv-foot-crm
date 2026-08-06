// T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN — Edge Function: consult-notify-dispatch
//
// 상담대기방 발송 outbox 의 단일행 dispatcher. pg_cron worker(process_consult_notify_outbox)가
//   net.http_post 로 호출. 재시도/backoff/DLQ 소유권은 worker(claim 시 attempts++/next_attempt_at 선반영).
//   본 EF 는 1행 발송 시도 + 상태전이만 담당(재시도 루프 없음) — dopamine-callback-dispatch 동형.
//
// 인증: 헤더 X-Internal-Cron: <internal_cron_secret> (worker net.http_post 헤더와 일치).
// 요청: { outbox_id: uuid }
//
// 발송/분류/상태전이 로직 = _shared/consultNotifyDeliver.ts (send-consult-notify 인라인 경로와 SSOT 공유).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { deliverConsultNotify } from "../_shared/consultNotifyDeliver.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN =
  Deno.env.get("CONSULT_NOTIFY_SLACK_BOT_TOKEN") ??
  Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ??
  "";
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 내부 cron 전용 — X-Internal-Cron 일치 검증.
  const got = req.headers.get("X-Internal-Cron") ?? "";
  if (!CRON_SECRET || got !== CRON_SECRET) {
    return json({ error: "Unauthorized (internal cron only)" }, 401);
  }

  let outboxId: string;
  try {
    const body = await req.json() as { outbox_id?: string };
    outboxId = String(body.outbox_id ?? "").trim();
    if (!outboxId) return json({ error: "outbox_id required" }, 400);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { data: row, error: loadErr } = await supabase
    .from("consult_notify_outbox")
    .select("id, event_id, check_in_id, clinic_id, channel, inflow, consultant_id, status, attempts, dlq")
    .eq("id", outboxId)
    .maybeSingle();

  if (loadErr) {
    console.error("[consult-notify-dispatch] load error:", loadErr.message);
    return json({ ok: false, reason: "db_error", detail: loadErr.message }, 500);
  }
  if (!row) {
    console.warn("[consult-notify-dispatch] outbox row not found:", outboxId);
    return json({ ok: false, reason: "not_found" }, 404);
  }

  const result = await deliverConsultNotify(supabase, row, SLACK_BOT_TOKEN);

  console.log(
    `[consult-notify-dispatch] done id=${outboxId} delivered=${result.delivered} terminal=${result.terminal ?? false} ` +
      `skipped=${result.skipped ?? false} err=${result.error ?? "-"}`,
  );
  return json({ ok: true, ...result });
});
