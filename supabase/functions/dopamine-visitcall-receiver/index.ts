/**
 * dopamine-visitcall-receiver — 도파민 → 풋CRM '내원콜 방문확인' 결과 수신부
 * T-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME (Part A / receive)
 *
 * 롱레 `dopamine-visitcall-receiver` 의 풋 미러. 롱레 receiver 재사용 불가(프로젝트 URL·타깃 DB 상이 — DA Q2).
 * 도파민 TM 이 내원콜 결과(예방콜 방문확인)를 확정하면 풋으로 push → 풋 reservations 에 canonical 착지.
 *
 * ── 계약 (DA-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME) ──────────
 *   canonical governed enum: reachable(부재 아님=내원예정) / absent(부재). 제3의 값 금지.
 *   요청 라벨 매핑: 도파민 '내원예정'→reachable / '부재'→absent (송신부에서 canonical 로 변환해 push).
 *   key           = crm_reservation_id  (풋 예약 바인딩. cue_card_id 금지 — 복수예약 모호, 선례 동일)
 *   충돌해소       = result_at LWW (저장된 visit_call_result_at 보다 오래된 result_at 은 skip)
 *   멱등          = event_id (도파민 결정적 event_id. 동일 event_id 재수신 시 no-op 200 duplicate)
 *   DLQ/retry     = 송신부(도파민 outbox) 책임. 수신부는 HTTP 시맨틱으로 신호:
 *                    2xx=확정(재시도 불요), 404=예약 미존재(재시도 가능/DLQ), 5xx=일시장애(재시도)
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   헤더: X-Callback-Secret: <DOPAMINE_CALLBACK_SECRET>  (풋 기존 dopamine EF 와 동일 게이트)
 *
 * ── Request Body ────────────────────────────────────────────────────────────────
 *   {
 *     "source_system": "dopamine",
 *     "event_id": "<결정적 멱등 키, text>",          ← 필수
 *     "crm_reservation_id": "<풋 reservations.id UUID>", ← 필수 (바인딩 key)
 *     "visit_call_result": "reachable" | "absent",    ← 필수 (canonical only)
 *     "result_at": "2026-07-15T14:30:00+09:00",       ← 필수 (LWW 기준 ISO)
 *     "clinic_slug": "jongno-foot"                    ← optional (스코프 가드; 있으면 검증)
 *   }
 *
 * ── Response ────────────────────────────────────────────────────────────────────
 *   200 적용:      { ok: true, reservation_id, applied: true }
 *   200 멱등중복:  { ok: true, reservation_id, applied: false, reason: "duplicate" }
 *   200 stale LWW: { ok: true, reservation_id, applied: false, reason: "stale" }
 *   400:          { ok: false, error: "INVALID_BODY" | "MISSING_FIELD" | "INVALID_RESULT", detail }
 *   401:          { ok: false, error: "UNAUTHORIZED" }
 *   404:          { ok: false, error: "RESERVATION_NOT_FOUND" }   ← 재시도 가능(예약 미인입)
 *   422:          { ok: false, error: "CLINIC_MISMATCH" }
 *   500:          { ok: false, error: "INTERNAL", detail }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-callback-secret',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

const CANONICAL = new Set(['reachable', 'absent']);

// Cross-CRM slug 통일 (dual-key 전환기 잔여 수용)
const SLUG_ALIAS: Record<string, string> = { 'foot-jongno': 'jongno-foot' };
function normalizeSlug(slug: string): string { return SLUG_ALIAS[slug] ?? slug; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const expectedSecret = Deno.env.get('DOPAMINE_CALLBACK_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-Callback-Secret') ?? '';
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[visitcall-receiver] 401 — secret mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_BODY', detail: 'JSON parse failed' }, 400); }

  const eventId          = body['event_id'] as string | undefined;
  const crmReservationId = body['crm_reservation_id'] as string | undefined;
  const visitCallResult  = body['visit_call_result'] as string | undefined;
  const resultAt         = body['result_at'] as string | undefined;
  const clinicSlug       = body['clinic_slug'] as string | undefined;

  if (!eventId)          return json({ ok: false, error: 'MISSING_FIELD', detail: 'event_id required' }, 400);
  if (!crmReservationId) return json({ ok: false, error: 'MISSING_FIELD', detail: 'crm_reservation_id required' }, 400);
  if (!resultAt)         return json({ ok: false, error: 'MISSING_FIELD', detail: 'result_at required' }, 400);
  if (!visitCallResult || !CANONICAL.has(visitCallResult)) {
    return json({ ok: false, error: 'INVALID_RESULT', detail: `visit_call_result must be one of reachable|absent (got: ${visitCallResult ?? 'null'})` }, 400);
  }
  // result_at ISO 유효성
  const resultAtMs = Date.parse(resultAt);
  if (Number.isNaN(resultAtMs)) {
    return json({ ok: false, error: 'INVALID_BODY', detail: 'result_at not a valid ISO timestamp' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // ── 예약 조회 (key = crm_reservation_id) ───────────────────────────────────
    const { data: resv, error: resvErr } = await admin
      .from('reservations')
      .select('id, clinic_id, visit_call_result, visit_call_result_at, visit_call_result_event_id')
      .eq('id', crmReservationId)
      .maybeSingle();
    if (resvErr) {
      console.error('[visitcall-receiver] reservation lookup error:', resvErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `reservation lookup failed: ${resvErr.message}` }, 500);
    }
    if (!resv) {
      // 예약 미인입(선행 forward push 미착지) → 재시도 가능. 송신부 DLQ 대상.
      console.warn(`[visitcall-receiver] 404 — reservation ${crmReservationId} not found`);
      return json({ ok: false, error: 'RESERVATION_NOT_FOUND' }, 404);
    }

    // ── clinic 스코프 가드(optional) ──────────────────────────────────────────
    if (clinicSlug) {
      const { data: clinicRow } = await admin
        .from('clinics').select('id').eq('slug', normalizeSlug(clinicSlug)).maybeSingle();
      if (clinicRow && clinicRow.id !== resv.clinic_id) {
        console.warn(`[visitcall-receiver] 422 — clinic mismatch rid=${crmReservationId}`);
        return json({ ok: false, error: 'CLINIC_MISMATCH' }, 422);
      }
    }

    // ── 멱등 (event_id) ────────────────────────────────────────────────────────
    if (resv.visit_call_result_event_id && resv.visit_call_result_event_id === eventId) {
      return json({ ok: true, reservation_id: resv.id, applied: false, reason: 'duplicate' }, 200);
    }

    // ── LWW (result_at) — 저장분보다 오래된 결과는 skip ────────────────────────
    if (resv.visit_call_result_at) {
      const storedMs = Date.parse(resv.visit_call_result_at as string);
      if (!Number.isNaN(storedMs) && resultAtMs < storedMs) {
        return json({ ok: true, reservation_id: resv.id, applied: false, reason: 'stale' }, 200);
      }
    }

    // ── 착지 (canonical UPDATE) ────────────────────────────────────────────────
    const { error: updErr } = await admin
      .from('reservations')
      .update({
        visit_call_result: visitCallResult,
        visit_call_result_at: new Date(resultAtMs).toISOString(),
        visit_call_result_event_id: eventId,
      })
      .eq('id', resv.id);
    if (updErr) {
      console.error('[visitcall-receiver] update error:', updErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `update failed: ${updErr.message}` }, 500);
    }

    console.log(`[visitcall-receiver] OK rid=${resv.id} result=${visitCallResult} result_at=${resultAt} event_id=${eventId}`);
    return json({ ok: true, reservation_id: resv.id, applied: true }, 200);
  } catch (e) {
    console.error('[visitcall-receiver] INTERNAL:', String(e));
    return json({ ok: false, error: 'INTERNAL', detail: String(e) }, 500);
  }
});
