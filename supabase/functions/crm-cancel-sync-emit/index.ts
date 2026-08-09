// crm-cancel-sync-emit — 풋(발톱) CRM(obliv-foot-crm) 예약취소 → 도파민 crm-cancel-callback(live 취소 SSOT rail) emit
// T-20260807-dopamine-CRM-CANCEL-CALLBACK-FOOT-COVERAGE (재라우팅 dopamine→foot)
//   DA CONSULT-REPLY: MSG-20260807-061709-hpoa
//     (SSOT=agents/docs/da_replies/da_decision_dopamine_crm_cancel_callback_foot_coverage_20260807.md)
//   부모: T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14 (as-scoped 백필 DEAD·convergence 목표는 본 forward-fix로 달성)
//
// ══ 정본 미러 ══
//   crm-payment-sync-emit(20260730, 결제 leg) 구조 미러(outbox drain + backoff/DLQ + dark 게이트 + companion 가드).
//   본 EF 는 **취소 leg 전용** → 도파민 crm-cancel-callback(live 취소 SSOT rail).
//
// ══ ★HARD 불변식 (절대 — 위반 시 자동 NO-GO) ══
//   lifecycle rail(crm-lifecycle-callback) 재활성 금지 = gjv7 INVARIANT-1(2nd-writer eventscope) 위반.
//   본 EF 는 crm-cancel-callback(별 live rail)만 호출 — lifecycle 무접촉. dopamine-callback-dispatch
//   (→crm-lifecycle-callback, dopamine_callback_outbox 소비)와 완전 직교(별 outbox·별 드레이너·별 EF).
//
// ══ 동작 ══
//   1. cancel_sync_outbox 에서 due 행(status='pending', dlq=false, next_attempt_at<=now) N건 drain.
//   2. cue_card_id 해소(resolveBaseCueCardId, isCompanion-aware):
//      · !ok(형식오류) → permanent DLQ (재시도 무의미).
//      · isCompanion(동행) → 부모 cue 오귀속 금지 → **복합키 전용**(source_crm=foot + crm_reservation_id) 송신
//        (cue_card_id 미포함 → 수신부 경로 B: 해당 미러만 is_cancelled. 부모 cue 미접촉).
//      · 기저(비동행) → cue_card_id(base UUID) 송신 → 수신부 경로 A(cue-bearing):
//        cue_cards.stage='cancelled' + reservations.is_cancelled=true **양축 수렴**(DA 완전수렴 정의).
//   3. 도파민 crm-cancel-callback POST (header X-Cancel-Secret). payload(수신부 계약 정합):
//        { source_system='foot', event_id(멱등키=reservation_id:epoch), cancelled_at(권위·outbox 저장값,
//          ★now() 합성 금지), event_type='cancel', reservation_id,
//          [기저] cue_card_id  |  [동행] source_crm='foot' + crm_reservation_id }
//      ★단일 crm_reservation_id 단독 = 수신부 400 REJECT → 동행경로는 source_crm 항상 동반(복합키).
//      멱등 = outbox UNIQUE(event_id) + 수신부 cancel_sync_log UNIQUE(source_system,event_id).
//   4. 상태머신 (foot outbox enum {pending,processing,sent,duplicate,failed}+dlq boolean):
//      [성공] 2xx applied!==false → 'sent'. 2xx applied===false(중복/미매칭) → 'duplicate'.
//      [4xx/5xx/네트워크] self-heal 재시도('pending') → 소진 시 'failed'+dlq(형식오류는 위 2단계 permanent DLQ).
//      backoff(min) = 1·2·4·8·16·32·60, attempts>=7 → dlq (DA 표준·payment twin 동형).
//
// ══ 롤아웃 게이트 ══ CANCEL_SYNC_EMIT_ENABLED (기본 'false' = dark hold, pending 보존).
//   수신부(crm-cancel-callback) foot-source 는 이미 완비 → 조기발사 리스크 낮으나 twin 규율 유지
//   (supervisor 가 EF 배포 + DOPAMINE_CALLBACK_URL/secret 주입 확인 후 'true' flip). dark 여도 outbox 계속 적재.
//
// 호출: pg_cron cancel_sync_drain() → net.http_post (Authorization: Bearer <anon> + X-Internal-Cron).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      DOPAMINE_CALLBACK_URL(도파민 functions base 또는 full endpoint → base 정규화 후 /crm-cancel-callback),
//      CANCEL_WEBHOOK_SECRET(공유 crm/foot — 수신부 source='foot' 검증축) 또는 FOOT_CANCEL_SECRET(optional 하드닝),
//      CANCEL_SYNC_EMIT_ENABLED(기본 'false').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveBaseCueCardId } from "../_shared/external-id.ts";
// deno-lint-ignore no-explicit-any
declare const Deno: any;

const MAX_ATTEMPTS = 7; // DA 표준: attempts>=7 → dlq
const BATCH = 50;
// backoff(min): attempts 1→1,2→2,3→4,4→8,5→16,6→32,7+→60 (payment twin 동형)
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
  await admin.from("cancel_sync_outbox").update({
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
    await admin.from("cancel_sync_outbox").update({
      status: "failed", dlq: true, attempts: attemptsNew,
      last_error: `dlq_after_${attemptsNew}:${code}`.slice(0, 200),
      updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    return "failed";
  }
  await admin.from("cancel_sync_outbox").update({
    status: "pending", attempts: attemptsNew,
    next_attempt_at: backoffNextAt(attemptsNew),
    last_error: code.slice(0, 200), updated_at: new Date().toISOString(),
  }).eq("id", r.id);
  return "pending";
}

// 형식오류(비-UUID external_id) → 즉시 permanent DLQ (재시도 무의미).
// deno-lint-ignore no-explicit-any
async function markPermanentDlq(admin: any, r: any, code: string): Promise<void> {
  await admin.from("cancel_sync_outbox").update({
    status: "failed", dlq: true, attempts: (r.attempts ?? 0) + 1,
    last_error: `dlq_permanent:${code}`.slice(0, 200),
    updated_at: new Date().toISOString(),
  }).eq("id", r.id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // 도파민 crm-cancel-callback full URL. DOPAMINE_CALLBACK_URL 이 base/full 어느 형태든 정규화
  //   (foot sibling EF crm-payment-sync-emit·dopamine-callback-dispatch 동일 관용).
  const CB_RAW = (Deno.env.get("DOPAMINE_CALLBACK_URL") ?? "").replace(/\/+$/, "");
  const CB_BASE = CB_RAW.replace(/(\/functions\/v1)(\/[^/?#]+)?$/, "$1");
  const CB_URL = CB_BASE ? `${CB_BASE}/crm-cancel-callback` : "";
  // 발신 secret — 수신부는 source='foot' 를 SHARED CANCEL_WEBHOOK_SECRET 로 검증(scalp 만 별도).
  //   FOOT_CANCEL_SECRET = optional 하드닝(supervisor env 게이트에서 수신부와 동시 격리 전환 시 사용).
  //   기본 정합 = CANCEL_WEBHOOK_SECRET(공유). 하드닝 미적용 시 FOOT_CANCEL_SECRET 미주입 → 공유값 사용.
  const SECRET = Deno.env.get("FOOT_CANCEL_SECRET") ??
    Deno.env.get("CANCEL_WEBHOOK_SECRET") ?? "";
  // 롤아웃 게이트 — 기본 dark(false). supervisor 준비 확인 후 'true' flip.
  const EMIT_ENABLED =
    (Deno.env.get("CANCEL_SYNC_EMIT_ENABLED") ?? "false").toLowerCase() === "true";

  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, reason: "server_env_missing" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // dark hold — pending 보존(발사 안 함).
  if (!EMIT_ENABLED) {
    return json(200, { ok: true, dark: true, reason: "CANCEL_SYNC_EMIT_ENABLED=false" });
  }
  if (!CB_URL) return json(500, { ok: false, reason: "DOPAMINE_CALLBACK_URL_missing" });

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("cancel_sync_outbox")
    .select("*")
    .eq("status", "pending")
    .eq("dlq", false)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH);
  if (error) return json(500, { ok: false, reason: `outbox_read_failed:${error.message}` });

  let sent = 0, dup = 0, dlq = 0, failed = 0;
  for (const r of rows ?? []) {
    // ── cue_card_id 해소 (isCompanion-aware) ─────────────────────────────
    const resolved = resolveBaseCueCardId(r.cue_card_id);
    if (!resolved.ok) {
      // 형식오류 → permanent DLQ (재시도 무의미).
      await markPermanentDlq(admin, r, "invalid_external_id_format");
      dlq++;
      continue;
    }

    // ── cancelled_at 권위 = outbox 저장값(취소 tx 시점 원자 캡처). ★now() 합성 금지. ──
    //   불변식(수신부): is_cancelled=true ⟹ cancelled_at NOT NULL. r.cancelled_at 은 NOT NULL(스키마 강제).
    const cancelledAtIso = new Date(r.cancelled_at).toISOString();

    // ── payload (수신부 crm-cancel-callback 계약 정합) ────────────────────
    //   공통: source_system='foot'(secret 선택자·검증축), event_id(멱등키), cancelled_at(권위), event_type='cancel'.
    //   매칭키 분기:
    //     · 기저(비동행): cue_card_id → 경로 A(cue-bearing) = stage='cancelled' + is_cancelled 양축 수렴.
    //     · 동행(companion): 복합키(source_crm='foot' + crm_reservation_id) → 경로 B(해당 미러만).
    //       부모 cue 오귀속 방지(cue_card_id 미포함). ★단일 crm_reservation_id 단독 아님(source_crm 동반).
    // deno-lint-ignore no-explicit-any
    const payload: Record<string, any> = {
      source_system: "foot",
      event_id: r.event_id,          // 멱등키 = reservation_id:epoch(cancelled_at)
      cancelled_at: cancelledAtIso,  // 권위(outbox). now() 합성 금지.
      event_type: "cancel",
      reservation_id: r.reservation_id, // 참조용
    };
    if (resolved.isCompanion) {
      // 동행: 복합키 전용(부모 cue 오귀속 금지).
      payload.source_crm = "foot";
      payload.crm_reservation_id = r.reservation_id;
    } else {
      // 기저: cue-bearing(양축 수렴). 복합키 병행 시 수신부 경로 A 가 is_cancelled UPDATE 를
      //   crm_reservation_id AND 로 과도-제약할 수 있어(도파민 미러 컬럼 미population 리스크) cue 단독 송신.
      payload.cue_card_id = resolved.baseId as string;
    }

    try {
      const resp = await fetch(CB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cancel-Secret": SECRET },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        let applied: boolean | undefined;
        try { applied = JSON.parse(await resp.text())?.applied; } catch { applied = undefined; }
        const isDup = applied === false; // duplicate / already_cancelled / no_mirror_matched
        await markSent(admin, r.id, isDup);
        if (isDup) dup++; else sent++;
      } else {
        // 전송 응답 4xx/5xx 모두 self-heal 재시도. attempts 소진 시에만 DLQ.
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
    sent, duplicate: dup, dlq, retry: failed,
  });
});
