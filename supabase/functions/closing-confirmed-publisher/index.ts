// T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN — closing-confirmed-publisher EF (발톱)
//
// 정본 이식: happy-flow-queue closing-confirmed-publisher (경로 A / 옵션 a).
// 역할: 순수 outbox 상태머신(pending→sent) + DLQ. ★Slack 발송 코드 없음.
//   배달경로 = 경로 A(직접 outbox 소비, DA CONSULT-REPLY GO MSG-94bd 확정). 경로 B(Slack-carrier) REJECT
//   → 07-07 제거한 EF chat.postMessage hijack 경로 부활 금지(BINDING §9-1). 발송 주체 = marketing_v2 직접 소비.
//
// 호출자: pg_cron worker process_closing_confirmed_outbox() (net.http_post)
//   POST body: { outbox_id: uuid } / 헤더: X-Internal-Cron: <internal_cron_secret>
//   worker가 status='processing'/attempts++ 로 claim 후 EF 호출. EF는 종결(sent) 전이 또는 실패 처리(재시도/DLQ).
//
// 유지(회귀 0): status 전이(pending→sent) / DLQ(재시도 소진) / 멱등(종결상태 재발사 차단;
//   outbox UNIQUE(clinic_id,close_date,revision)) / 내부 인증(X-Internal-Cron=CRON_SECRET).
//
// env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(+ FOOT_SERVICE_ROLE_KEY fallback), CRON_SECRET(=internal_cron_secret).
// 계약: cross_crm_data_contract §10-11-a(outbox 직소비) / §10-14(schema_version 2 정본).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// 신규 secret 명시 주입 우선 → 표준 service_role fallback (가산적·무중단)
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("FOOT_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// worker 인증용 (pg_net 헤더 X-Internal-Cron 과 일치) = vault internal_cron_secret.
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// 재시도 소진 임계 — worker backoff(1·2·4·8·16·32·60min)와 동일. 소진 시 DLQ 종결.
const MAX_ATTEMPTS = 7;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  // ── 내부 호출 인증 (cron_secret) ────────────────────────────────
  if (CRON_SECRET) {
    const got = req.headers.get("X-Internal-Cron") ?? "";
    if (got !== CRON_SECRET) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }
  }

  // ── 입력 파싱 ────────────────────────────────────────────────
  let outbox_id: string;
  try {
    const body = await req.json();
    outbox_id = body.outbox_id;
    if (!outbox_id) return json({ error: "outbox_id required" }, 400);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // ── 1. outbox 행 로드 ────────────────────────────────────────
  const { data: row, error: loadErr } = await (supabase
    .from("closing_confirmed_outbox")
    .select(
      "id, clinic_id, clinic_slug, close_date, revision, event_id, attempts, status, dlq",
    ) as any)
    .eq("id", outbox_id)
    .maybeSingle();

  if (loadErr) {
    console.error("[foot-closing-pub] load error:", loadErr);
    return json({ ok: false, reason: "db_error", detail: loadErr.message }, 500);
  }
  if (!row) {
    console.warn("[foot-closing-pub] outbox row not found:", outbox_id);
    return json({ ok: false, reason: "not_found" }, 404);
  }
  // 멱등 — 종결(sent/duplicate/failed) 또는 dlq 면 재발사 금지
  if (["sent", "duplicate", "failed"].includes(row.status) || row.dlq) {
    return json({ ok: true, skipped: true, reason: "already_terminal" });
  }

  // ── 2. status 전이(pending→sent) — Slack 발송 없음(경로 A) ─────
  //   발송 주체 = marketing_v2 outbox 직접 소비. EF는 상태만 종결 전이시켜 worker 큐를 드레인.
  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("closing_confirmed_outbox")
    .update({
      status: "sent",
      last_error: null,
      sent_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", outbox_id);

  // ── 3. DLQ — DB 전이 실패 시 재시도/소진 처리 ─────────────────
  if (updErr) {
    console.error("[foot-closing-pub] status transition update error:", updErr);
    const exhausted = (row.attempts as number) >= MAX_ATTEMPTS;
    if (exhausted) {
      await supabase
        .from("closing_confirmed_outbox")
        .update({
          status: "failed",
          dlq: true,
          last_error: `update_retry_exhausted (${row.attempts}) ${updErr.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", outbox_id);
      console.error(
        `[foot-closing-pub] retry_exhausted → DLQ id=${outbox_id} attempts=${row.attempts}`,
      );
      return json(
        { ok: false, reason: "update_failed_dlq", dlq: true, detail: updErr.message },
        500,
      );
    }
    return json({ ok: false, reason: "update_failed", detail: updErr.message }, 500);
  }

  console.log(
    `[foot-closing-pub] id=${outbox_id} clinic=${row.clinic_slug ?? row.clinic_id} date=${row.close_date} rev=${row.revision} → status=sent (경로A / 발송 위임: marketing_v2 직접 소비)`,
  );

  return json({
    ok: true,
    outbox_id,
    new_status: "sent",
    slack_removed: true,
    delivery: "marketing_v2_direct_outbox",
  });
});
