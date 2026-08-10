// crm-payment-sync-emit — 풋(발톱) CRM(obliv-foot-crm) 결제 → 도파민 crm-payment-callback 역sync(emitter)
// T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT (부모 EPIC T-20260730-xcrm-CUECARD-FUNNEL-P0)
//
// ══ 정본 ══ happy-flow-queue crm-payment-sync-emit 이식(결제 leg). foot 착지 = DA CONSULT-REPLY
//   (DA-20260730-XCRM-CUECARD-FUNNEL-PAYSYNC) + addendum(DA-20260730-FOOT-PAYSYNC-REVERSE-EMIT-Q1Q4).
//   정본 DDL: 별도 payment_sync_outbox(결제 leg 전용).
//   ★ 내원(visited) leg 는 dopamine-callback-dispatch 로 이미 정상 → 본 EF 는 결제 leg 전용
//     (내원 발신부 중복 신설 금지 — 단일생산자 유지).
//
// ══ 동작 ══
//   1. payment_sync_outbox 에서 due 행(status='pending', dlq=false, next_attempt_at<=now) N건 drain.
//   2. cue_card_id 해소(§3, Q2 정정): outbox.cue_card_id 는 reservations.external_id(raw, 동행 가능).
//      resolveBaseCueCardId(_shared/external-id.ts, isCompanion-aware) → base cue_card_id 1회 해소
//      → clean UUID 직송(payload cue_card_id first-class, emit-time 조인0).
//      · !ok(형식오류)   → permanent DLQ (재시도 금지).
//      · isCompanion(§4) → companion_no_cue_attribution 가드: 부모 cue 오귀속 금지 → 종결('duplicate',
//        무발신). 동행 결제를 부모 cue_card 에 계상하지 않는다(companion=회수 miss 아님, DoD 분모 제외).
//   3. amount/paid_at 권위 재산출(정본 §4-2d-5 parity): payments(non-refund) SUM/MIN. 실패 시 스냅샷 폴백.
//   4. 도파민 crm-payment-callback POST (header X-Callback-Secret). payload(수신부 계약 정합):
//        { source_system='foot', external_id(=cue_card_id base UUID), cue_card_id(=동), crm_payment_id,
//          crm_reservation_id?, amount, currency='KRW', paid_at(ISO8601), payment_status='paid' }
//      멱등 이중방어 = outbox UNIQUE(crm_payment_id) + 수신부 cue_cards.crm_payment_id 전역 UNIQUE(INV-PAYID-1).
//   5. 상태머신 (foot outbox enum {pending,processing,sent,duplicate,failed}+dlq boolean):
//      [성공] 2xx applied!==false → 'sent'. 2xx applied===false(중복) → 'duplicate'.
//      [4xx]  recv 미라이브 window self-heal → attempts<MAX 면 재시도('pending'), 소진 시 'failed'+dlq.
//             (형식오류 permanent DLQ 는 위 2단계에서 선처리 — 여기 4xx 는 전송 응답 4xx.)
//      [5xx/네트워크] 재시도('pending') → 소진 시 'failed'+dlq.
//      backoff(min) = 1·2·4·8·16·32·60 (attempts 기준), attempts>=7 → dlq (DA 표준).
//
// ══ 롤아웃 게이트 ══ PAYMENT_SYNC_EMIT_ENABLED (기본 'false' = dark hold, pending 보존).
//   foot 결제 leg 는 GREENFIELD + 수신부(crm-payment-callback) foot-source 수용이 supervisor/DA 게이트.
//   조기 발사(수신부 미수용 window → 4xx) 방지 위해 기본 dark. supervisor 가 수신부 확인 후 'true' flip.
//   dark 여도 outbox 는 계속 적재(forward emit, 멱등 안전).
//
// 호출: pg_cron payment_sync_drain() → net.http_post (Authorization: Bearer <anon> + X-Internal-Cron).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      DOPAMINE_CALLBACK_URL(도파민 functions base 또는 full endpoint → base 정규화 후 /crm-payment-callback),
//      FOOT_CALLBACK_SECRET(우선, {SLUG}_CALLBACK_SECRET 패턴) ?? DOPAMINE_CALLBACK_SECRET(폴백, §6-6-2),
//      PAYMENT_SYNC_EMIT_ENABLED(기본 'false').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveBaseCueCardId } from "../_shared/external-id.ts";
// deno-lint-ignore no-explicit-any
declare const Deno: any;

const MAX_ATTEMPTS = 7; // DA 표준: attempts>=7 → dlq
const BATCH = 50;
// backoff(min): attempts 1→1,2→2,3→4,4→8,5→16,6→32,7+→60 (foot 20260603 워커 동형)
function backoffNextAt(attempts: number): string {
  const min = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + min * 60 * 1000).toISOString();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function markSent(admin: any, id: string, duplicate: boolean): Promise<void> {
  await admin.from("payment_sync_outbox").update({
    status: duplicate ? "duplicate" : "sent",
    last_error: null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

// 재시도/소진 공통 — attempts++ 후 소진이면 dlq, 아니면 pending + backoff.
// last_error 는 PHI 금지(응답 본문 미적재 — status code + 사유 코드만).
// deno-lint-ignore no-explicit-any
async function markRetryOrDlq(admin: any, r: any, code: string): Promise<"failed" | "pending"> {
  const attemptsNew = (r.attempts ?? 0) + 1;
  if (attemptsNew >= MAX_ATTEMPTS) {
    await admin.from("payment_sync_outbox").update({
      status: "failed", dlq: true, attempts: attemptsNew,
      last_error: `dlq_after_${attemptsNew}:${code}`.slice(0, 200),
      updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    return "failed";
  }
  await admin.from("payment_sync_outbox").update({
    status: "pending", attempts: attemptsNew,
    next_attempt_at: backoffNextAt(attemptsNew),
    last_error: code.slice(0, 200), updated_at: new Date().toISOString(),
  }).eq("id", r.id);
  return "pending";
}

// 형식오류(비-UUID external_id) → 즉시 permanent DLQ (재시도 무의미).
// deno-lint-ignore no-explicit-any
async function markPermanentDlq(admin: any, r: any, code: string): Promise<void> {
  await admin.from("payment_sync_outbox").update({
    status: "failed", dlq: true, attempts: (r.attempts ?? 0) + 1,
    last_error: `dlq_permanent:${code}`.slice(0, 200),
    updated_at: new Date().toISOString(),
  }).eq("id", r.id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("CRM_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // 도파민 crm-payment-callback full URL. DOPAMINE_CALLBACK_URL 이 base/full 어느 형태든 정규화.
  //   (foot sibling EF dopamine-callback-dispatch 동일 관용 — full endpoint → functions/v1 base 도출.)
  const CB_RAW = (Deno.env.get("DOPAMINE_CALLBACK_URL") ?? "").replace(/\/+$/, "");
  const CB_BASE = CB_RAW.replace(/(\/functions\/v1)(\/[^/?#]+)?$/, "$1");
  const CB_URL = CB_BASE ? `${CB_BASE}/crm-payment-callback` : "";
  // 발신 secret — 풋 전용 FOOT_CALLBACK_SECRET 우선(rotation 격리), 폴백 DOPAMINE (§6-6-2, addendum).
  const SECRET = Deno.env.get("FOOT_CALLBACK_SECRET") ??
    Deno.env.get("DOPAMINE_CALLBACK_SECRET") ?? "";
  // 롤아웃 게이트 — 기본 dark(false). supervisor 수신부 확인 후 'true' flip.
  const EMIT_ENABLED =
    (Deno.env.get("PAYMENT_SYNC_EMIT_ENABLED") ?? "false").toLowerCase() === "true";

  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, reason: "server_env_missing" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // dark hold — pending 보존(발사 안 함).
  if (!EMIT_ENABLED) {
    return json(200, { ok: true, dark: true, reason: "PAYMENT_SYNC_EMIT_ENABLED=false" });
  }
  if (!CB_URL) return json(500, { ok: false, reason: "DOPAMINE_CALLBACK_URL_missing" });

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("payment_sync_outbox")
    .select("*")
    .eq("status", "pending")
    .eq("dlq", false)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH);
  if (error) return json(500, { ok: false, reason: `outbox_read_failed:${error.message}` });

  let sent = 0, dup = 0, dlq = 0, failed = 0, skipped = 0;
  for (const r of rows ?? []) {
    // ── §3 cue_card_id 해소 (isCompanion-aware) ──────────────────────────
    const resolved = resolveBaseCueCardId(r.cue_card_id);
    if (!resolved.ok) {
      // 형식오류 → permanent DLQ (재시도 무의미).
      await markPermanentDlq(admin, r, "invalid_external_id_format");
      dlq++;
      continue;
    }
    if (resolved.isCompanion) {
      // §4 COMPANION 가드: 부모 cue 오귀속 금지 → 무발신 종결(no attribution).
      await admin.from("payment_sync_outbox").update({
        status: "duplicate", last_error: "companion_no_cue_attribution",
        sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", r.id);
      skipped++;
      continue;
    }
    const cueCardId = resolved.baseId as string;

    // ── amount/paid_at 권위 재산출 (정본 §4-2d-5, non-refund SUM/MIN) ──────
    let amount = r.amount as number;
    let paidAtIso = new Date(r.paid_at).toISOString();
    try {
      const { data: pays } = await admin
        .from("payments")
        .select("amount, created_at, payment_type")
        .eq("check_in_id", r.check_in_id)
        .or("payment_type.is.null,payment_type.neq.refund")
        .order("created_at", { ascending: true });
      if (pays && pays.length > 0) {
        amount = (pays as { amount: number }[]).reduce((s, p) => s + (p.amount ?? 0), 0);
        paidAtIso = new Date((pays[0] as { created_at: string }).created_at).toISOString();
      }
      if (!(amount > 0)) amount = r.amount as number; // 재산출 비정상 → 스냅샷 유지
    } catch (_) {
      // 재산출 실패 → outbox 스냅샷 폴백(무손실).
    }

    // ── payload (수신부 crm-payment-callback 계약 정합) ───────────────────
    //   external_id = 수신부 required(매칭축). cue_card_id = §3 first-class 직접 포함(둘 다 clean base UUID).
    //   source_system='foot' 리터럴(addendum §6-6-2 — 수신부 foot-source 검증축).
    // deno-lint-ignore no-explicit-any
    const payload: Record<string, any> = {
      source_system: "foot",
      external_id: cueCardId, // 수신부 required(매칭). clean base UUID(동행 해소 완료).
      cue_card_id: cueCardId, // §3 first-class 직접 포함(external_id 조인 의존 금지).
      crm_payment_id: r.crm_payment_id, // 멱등키 = check_in_id::text
      crm_reservation_id: r.reservation_id ?? null,
      amount,
      currency: "KRW",
      paid_at: paidAtIso,
      payment_status: "paid",
    };

    try {
      const resp = await fetch(CB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Callback-Secret": SECRET },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        let applied: boolean | undefined;
        try { applied = JSON.parse(await resp.text())?.applied; } catch { applied = undefined; }
        const isDup = applied === false;
        await markSent(admin, r.id, isDup);
        if (isDup) dup++; else sent++;
      } else {
        // 전송 응답 4xx/5xx 모두 self-heal 재시도(수신부 foot-source 미수용 window 대비).
        //   attempts 소진 시에만 DLQ. (형식오류 permanent DLQ 는 위 resolve 단계에서 선처리.)
        const res = await markRetryOrDlq(admin, r, `http_${resp.status}`);
        if (res === "failed") dlq++; else failed++;
      }
    } catch (_e) {
      const res = await markRetryOrDlq(admin, r, "network_error");
      if (res === "failed") dlq++; else failed++;
    }
  }

  return json(200, {
    ok: true,
    processed: (rows ?? []).length,
    sent, duplicate: dup, dlq, retry: failed, companion_skipped: skipped,
  });
});
