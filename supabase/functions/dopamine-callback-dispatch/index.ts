// T-20260602-multi-CALLBACK-EF-4-NEW (풋 outbox dispatcher)
// 풋 CRM outbox dispatcher — outbox 1행을 도파민 라이프사이클 콜백으로 1회 발사.
//
// ※ 롱레(dev-crm) dopamine-callback-dispatch 미러. 차이점만 풋 변형:
//    - payload.source_system='foot'는 outbox payload 에 이미 저장돼 있음 (트리거가 생성).
//    - 동일 도파민 단일 EF crm-lifecycle-callback 호출 (계약 확정).
//
// 호출자: pg_cron worker process_dopamine_callback_outbox() (net.http_post)
//   POST body: { outbox_id: uuid, mode: 'shadow' | 'live' }
//   헤더: X-Internal-Cron: <internal_cron_secret>
//
// 동작:
//   1. outbox 행 로드 (status='processing' 이어야 정상 — worker가 claim 후 호출)
//   2. 도파민 crm-lifecycle-callback 으로 단일 POST (재시도/백오프는 worker 소유)
//   3. 응답으로 outbox 상태 전이:
//        2xx applied:true   → status='sent'
//        2xx applied:false  → status='duplicate' (멱등 — 성공 취급)
//        4xx                → status='failed' + dlq=true (영구 실패, 사람 확인 필요)
//        5xx / network err  → status='pending' (worker가 next_attempt_at 에 재시도)
//                              단 attempts>=7 이면 dlq=true + status='failed' (재시도 소진)
//
// 게이트: mode='shadow' 면 payload.mode='shadow' 전달 → 도파민은 audit만(status 전환 X).
//         mode='live' 전환은 dopamine_callback_config.mode UPDATE 로만 (supervisor 게이트).
//
// 계약: agents/docs/_draft/dopamine_callback_receive_pattern.md v0.1
//        인증 헤더 X-Callback-Secret (env DOPAMINE_CALLBACK_SECRET) — foot-callback-recv 동일.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// 도파민 EF base URL (예: https://<dopamine-project>.supabase.co/functions/v1)
const DOPAMINE_FUNCTIONS_URL = Deno.env.get("DOPAMINE_FUNCTIONS_URL") ?? "";
// 공유 시크릿 — supervisor가 양쪽 env 동시 주입 (계약). 풋 기존 콜백과 동일 env.
const DOPAMINE_CALLBACK_SECRET = Deno.env.get("DOPAMINE_CALLBACK_SECRET") ?? "";
// worker 인증용 (net.http_post 헤더 X-Internal-Cron 과 일치)
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// 재시도 소진 임계 — 마이그레이션 backoff(1·2·4·8·16·32·60)와 동일
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

  // ── 내부 호출 인증 (cron_secret) ─────────────────────────────
  if (CRON_SECRET) {
    const got = req.headers.get("X-Internal-Cron") ?? "";
    if (got !== CRON_SECRET) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }
  }

  // ── 입력 파싱 ────────────────────────────────────────────────
  let outbox_id: string;
  let mode: string;
  try {
    const body = await req.json();
    outbox_id = body.outbox_id;
    mode = body.mode === "live" ? "live" : "shadow"; // 안전 기본 shadow
    if (!outbox_id) {
      return json({ error: "outbox_id required" }, 400);
    }
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // ── 1. outbox 행 로드 ────────────────────────────────────────
  const { data: row, error: loadErr } = await (supabase
    .from("dopamine_callback_outbox")
    .select("id, event_type, event_id, payload, attempts, status, dlq") as any)
    .eq("id", outbox_id)
    .maybeSingle();

  if (loadErr) {
    console.error("[cb-dispatch] load error:", loadErr);
    return json({ ok: false, reason: "db_error", detail: loadErr.message }, 500);
  }
  if (!row) {
    console.warn("[cb-dispatch] outbox row not found:", outbox_id);
    return json({ ok: false, reason: "not_found" }, 404);
  }
  // 이미 종결된 건은 재발사 금지 (멱등)
  if (["sent", "duplicate", "failed"].includes(row.status) || row.dlq) {
    return json({ ok: true, skipped: true, reason: "already_terminal" });
  }

  if (!DOPAMINE_FUNCTIONS_URL) {
    console.error("[cb-dispatch] DOPAMINE_FUNCTIONS_URL not set");
    // pending 유지 → worker가 재시도. env 주입 전 안전망.
    await supabase
      .from("dopamine_callback_outbox")
      .update({
        status: "pending",
        last_error: "dopamine_url_not_configured",
        updated_at: new Date().toISOString(),
      })
      .eq("id", outbox_id);
    return json({ ok: false, reason: "dopamine_url_not_configured" }, 500);
  }

  // ── 2. payload 구성 (저장된 payload + mode) ──────────────────
  // payload.source_system='foot' 는 트리거가 이미 적재.
  const payload = { ...(row.payload as Record<string, unknown>), mode };
  const targetUrl = `${DOPAMINE_FUNCTIONS_URL}/crm-lifecycle-callback`;

  console.log(
    `[cb-dispatch] firing → ${targetUrl} | id=${outbox_id} type=${row.event_type} attempts=${row.attempts} mode=${mode}`,
  );

  // ── 3. 단일 POST (재시도는 worker 소유) ──────────────────────
  let httpStatus = 0;
  let respBody = "";
  let applied: boolean | undefined;
  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Callback-Secret": DOPAMINE_CALLBACK_SECRET,
      },
      body: JSON.stringify(payload),
    });
    httpStatus = res.status;
    respBody = await res.text();
    try {
      applied = JSON.parse(respBody)?.applied;
    } catch {
      applied = undefined;
    }
  } catch (fetchErr) {
    console.error("[cb-dispatch] fetch error:", fetchErr);
    respBody = String(fetchErr);
    httpStatus = 0; // network error → 5xx 취급 (재시도)
  }

  // ── 4. 응답 → outbox 상태 전이 ───────────────────────────────
  const nowIso = new Date().toISOString();
  let update: Record<string, unknown>;

  if (httpStatus >= 200 && httpStatus < 300) {
    // 2xx — applied:false 면 도파민 측 중복 (성공 취급)
    update = applied === false
      ? { status: "duplicate", last_error: null, sent_at: nowIso }
      : { status: "sent", last_error: null, sent_at: nowIso };
  } else if (httpStatus >= 400 && httpStatus < 500) {
    // 4xx — 영구 실패. 재시도 안 함 + DLQ (external_id 미매칭/스키마 오류 등)
    update = {
      status: "failed",
      dlq: true,
      last_error: `4xx ${httpStatus}: ${respBody.slice(0, 500)}`,
    };
  } else {
    // 5xx / network — 재시도. attempts 소진 시 DLQ.
    const exhausted = (row.attempts as number) >= MAX_ATTEMPTS;
    update = exhausted
      ? {
          status: "failed",
          dlq: true,
          last_error: `retry_exhausted (${row.attempts}) last=${httpStatus}: ${respBody.slice(0, 300)}`,
        }
      : {
          status: "pending", // worker next_attempt_at(claim 시 선반영) 에 재시도
          last_error: `5xx ${httpStatus}: ${respBody.slice(0, 300)}`,
        };
  }
  update.updated_at = nowIso;

  const { error: updErr } = await supabase
    .from("dopamine_callback_outbox")
    .update(update)
    .eq("id", outbox_id);

  if (updErr) {
    console.error("[cb-dispatch] update error:", updErr);
    return json({ ok: false, reason: "update_failed", detail: updErr.message }, 500);
  }

  console.log(
    `[cb-dispatch] done id=${outbox_id} httpStatus=${httpStatus} → status=${update.status} dlq=${update.dlq ?? false}`,
  );

  return json({
    ok: true,
    outbox_id,
    http_status: httpStatus,
    new_status: update.status,
    dlq: update.dlq ?? false,
  });
});
