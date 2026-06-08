/**
 * dopamine-callback — 풋CRM → 도파민 Reverse 콜백 공통 Emitter
 *
 * TA3: visited   (셀프QR 체크인 내원)
 * TA4: paid      (첫 패키지 결제, 1회만 발사)
 * NEW: cancelled (예약 취소 — cross_crm_data_contract.md §6, T-20260527-dopamine-RESV-CANCEL-SYNC)
 *
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-2, §6-2, §7
 *
 * POST /functions/v1/dopamine-callback
 * Auth: Supabase Bearer JWT (authenticated user)
 *
 * ── Body (type=visited) ──────────────────────────────────────────
 *   {
 *     "type": "visited",
 *     "check_in_id": "<check_ins.id>"
 *   }
 *
 * ── Body (type=paid) ────────────────────────────────────────────
 *   {
 *     "type": "paid",
 *     "check_in_id": "<check_ins.id>",
 *     "package_id": "<packages.id>",
 *     "amount": 1200000,
 *     "package_name": "비가열 24회"
 *   }
 *
 * ── Body (type=cancelled) ───────────────────────────────────────
 *   {
 *     "type": "cancelled",
 *     "reservation_id": "<reservations.id>"
 *   }
 *
 * ── Edge Secrets ────────────────────────────────────────────────
 *   DOPAMINE_CALLBACK_URL    — 도파민 수신 EF URL (visited/paid)
 *                              예: https://<dopamine-project>.supabase.co/functions/v1/foot-callback-recv
 *   DOPAMINE_CALLBACK_SECRET — X-Callback-Secret 헤더 값 (visited/paid)
 *   DOPAMINE_CANCEL_URL      — 도파민 crm-cancel-callback EF URL (cancelled)
 *                              예: https://<dopamine-project>.supabase.co/functions/v1/crm-cancel-callback
 *   DOPAMINE_CANCEL_SECRET   — X-Cancel-Secret 헤더 값 (cancelled)
 *
 * ── 멱등성 ──────────────────────────────────────────────────────
 *   - dopamine_outbound_log UNIQUE(callback_type, event_id) 제약으로 중복 방지
 *   - paid: outbound_log에 external_id + callback_type='paid' + status='sent' 있으면 skip
 *   - visited: outbound_log에 event_id=check_in_id 있으면 skip
 *   - cancelled: outbound_log에 event_id=reservation_id + callback_type='cancelled' 있으면 skip
 *
 * ── 재시도 정책 ─────────────────────────────────────────────────
 *   - 5xx: 지수 백오프 3회 (1s → 2s → 4s)
 *   - 4xx: 재시도 없음
 *
 * ── 응답 ────────────────────────────────────────────────────────
 *   200: { ok: true, applied: true }
 *   200: { ok: true, applied: false, reason: 'skipped' | 'not_first_package' | 'duplicate' | 'not_dopamine_source' }
 *   400: { ok: false, error: 'INVALID_BODY' | 'MISSING_FIELD' }
 *   401: { ok: false, error: 'UNAUTHORIZED' }
 *   500: { ok: false, error: 'INTERNAL', detail: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// ── Cross-CRM slug 통일 (dual-key transition window, ~2026-06-15 구키 제거) ──────
//   도파민 신키 'jongno-foot' ↔ 구키 'foot-jongno' 1주 전환기 양쪽 수용.
//   출력 콜백 payload는 canonical 신키(FOOT_CLINIC_SLUG)로 emit.
//   paired: T-20260602-dopamine-CLINIC-SLUG-UNIFY
const SLUG_ALIAS: Record<string, string> = {
  'foot-jongno': 'jongno-foot',
};
function normalizeSlug(slug: string): string {
  return SLUG_ALIAS[slug] ?? slug;
}
const FOOT_CLINIC_SLUG = normalizeSlug('foot-jongno'); // → 'jongno-foot' (canonical)

// ── Payload builder (§6-2) ────────────────────────────────────────────────
function buildVisitedPayload(
  externalId: string,
  checkInId: string,
  reservationId: string | null,
): object {
  return {
    source_system: 'foot',
    clinic_slug: FOOT_CLINIC_SLUG,
    external_id: externalId,
    type: 'visited',
    event_id: checkInId,
    occurred_at: new Date().toISOString(),
    payload: {
      checkin_method: 'self_qr',
      reservation_id: reservationId,
    },
  };
}

function buildPaidPayload(
  externalId: string,
  packageId: string,
  amount: number,
  packageName: string,
): object {
  return {
    source_system: 'foot',
    clinic_slug: FOOT_CLINIC_SLUG,
    external_id: externalId,
    type: 'paid',
    event_id: packageId,
    occurred_at: new Date().toISOString(),
    payload: {
      crm_payment_id: packageId,
      amount,
      currency: 'KRW',
      package_name: packageName,
      is_first_package: true,
    },
  };
}

// ── Payload builder (cancelled) ──────────────────────────────────────────
// cross_crm_data_contract.md §6 — 예약 취소 콜백
function buildCancelledPayload(
  reservationId: string,
  cueCardId: string,
  cancelledAt: string,
): object {
  return {
    source_system: 'foot',
    event_id: reservationId,
    cue_card_id: cueCardId,
    cancelled_at: cancelledAt,
  };
}

// ── HTTP POST to dopamine ────────────────────────────────────────────────
async function httpPostToDopamine(
  url: string,
  secret: string,
  payload: object,
  secretHeader = 'X-Callback-Secret',
): Promise<{ httpStatus: number; responseBody: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [secretHeader]: secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => '');
    return { httpStatus: res.status, responseBody: text.slice(0, 2000) };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    return {
      httpStatus: 0,
      responseBody: isTimeout ? 'TIMEOUT_10S' : String(err).slice(0, 500),
    };
  }
}

// ── HTTP POST with exponential backoff retry (5xx only) ─────────────────
// MQ T-20260527-dopamine-RESV-CANCEL-SYNC: 5xx → 3회 지수 백오프, 4xx → 재시도 없음
async function httpPostWithRetry(
  url: string,
  secret: string,
  payload: object,
  secretHeader: string,
  maxAttempts = 3,
): Promise<{ httpStatus: number; responseBody: string; attempts: number }> {
  let lastResult = { httpStatus: 0, responseBody: '' };
  let delayMs = 1000; // 1s, 2s, 4s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await httpPostToDopamine(url, secret, payload, secretHeader);
    // 2xx or 4xx → no retry
    if (lastResult.httpStatus >= 200 && lastResult.httpStatus < 500) {
      return { ...lastResult, attempts: attempt };
    }
    // 5xx / network error (0) → retry if attempts remain
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  return { ...lastResult, attempts: maxAttempts };
}

// ── Determine outbound log status from HTTP response ────────────────────
function resolveLogStatus(
  httpStatus: number,
  responseBody: string,
): 'sent' | 'duplicate' | 'failed' {
  if (httpStatus === 200) {
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed?.applied === false) return 'duplicate';
    } catch {
      // non-JSON 200 → treat as sent
    }
    return 'sent';
  }
  return 'failed';
}

// ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── JWT auth ───────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userToken   = authHeader.slice(7);

  // Validate JWT via anon client
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(userToken);
  if (authErr || !user) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400);
  }

  const callbackType = body['type'] as string | undefined;
  if (callbackType !== 'visited' && callbackType !== 'paid' && callbackType !== 'cancelled') {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'type must be "visited", "paid", or "cancelled"' }, 400);
  }

  // ── cancelled path: takes reservation_id directly ─────────────────────
  // cross_crm_data_contract.md §6 — T-20260527-dopamine-RESV-CANCEL-SYNC
  if (callbackType === 'cancelled') {
    const reservationId = body['reservation_id'] as string | undefined;
    if (!reservationId) {
      return json({ ok: false, error: 'MISSING_FIELD', detail: 'cancelled requires reservation_id' }, 400);
    }

    const adminCancelled = createClient(supabaseUrl, serviceKey);

    try {
      const { data: reservation, error: rsvErr } = await adminCancelled
        .from('reservations')
        .select('id, external_id, cancelled_at')
        .eq('id', reservationId)
        .single();

      if (rsvErr || !reservation) {
        return json({ ok: false, error: 'INTERNAL', detail: `reservation not found: ${rsvErr?.message}` }, 500);
      }

      // Only fire for reservations with external_id (= dopamine cue_card_id)
      if (!reservation.external_id) {
        return json({ ok: true, applied: false, reason: 'not_dopamine_source' });
      }

      const cueCardId   = reservation.external_id as string;
      const cancelledAt = (reservation.cancelled_at as string | null) ?? new Date().toISOString();

      // Idempotency: skip if already sent/pending
      const { data: priorLog } = await adminCancelled
        .from('dopamine_outbound_log')
        .select('id, status')
        .eq('callback_type', 'cancelled')
        .eq('event_id', reservationId)
        .in('status', ['sent', 'pending'])
        .maybeSingle();

      if (priorLog) {
        return json({ ok: true, applied: false, reason: 'duplicate' });
      }

      const cancelPayload = buildCancelledPayload(reservationId, cueCardId, cancelledAt);

      const { data: logRow, error: logInsertErr } = await adminCancelled
        .from('dopamine_outbound_log')
        .insert({
          external_id: cueCardId,
          callback_type: 'cancelled',
          event_id: reservationId,
          payload: cancelPayload,
          status: 'pending',
          attempts: 0,
        })
        .select('id')
        .single();

      if (logInsertErr) {
        if (logInsertErr.code === '23505') {
          return json({ ok: true, applied: false, reason: 'duplicate' });
        }
        return json({ ok: false, error: 'INTERNAL', detail: `outbound_log insert failed: ${logInsertErr.message}` }, 500);
      }

      const logId = logRow.id as string;

      const cancelUrl    = Deno.env.get('DOPAMINE_CANCEL_URL') ?? '';
      const cancelSecret = Deno.env.get('DOPAMINE_CANCEL_SECRET') ?? '';

      if (!cancelUrl) {
        await adminCancelled
          .from('dopamine_outbound_log')
          .update({ status: 'failed', http_status: 0, response_body: 'DOPAMINE_CANCEL_URL_NOT_SET', attempts: 1, last_attempt_at: new Date().toISOString() })
          .eq('id', logId);
        return json({ ok: true, applied: false, reason: 'skipped', detail: 'DOPAMINE_CANCEL_URL not configured' });
      }

      // 5xx → 지수 백오프 3회, 4xx → 재시도 없음
      const { httpStatus, responseBody, attempts } = await httpPostWithRetry(
        cancelUrl, cancelSecret, cancelPayload, 'X-Cancel-Secret',
      );
      const finalStatus = resolveLogStatus(httpStatus, responseBody);

      await adminCancelled
        .from('dopamine_outbound_log')
        .update({ status: finalStatus, http_status: httpStatus, response_body: responseBody, attempts, last_attempt_at: new Date().toISOString() })
        .eq('id', logId);

      if (finalStatus === 'failed') {
        return json({ ok: false, error: 'DOPAMINE_HTTP_FAILED', http_status: httpStatus, detail: responseBody.slice(0, 200) }, 502);
      }

      return json({ ok: true, applied: true, dopamine_status: finalStatus });

    } catch (err) {
      console.error('[dopamine-callback/cancelled] unexpected error:', err);
      return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
    }
  }

  // ── visited / paid path ────────────────────────────────────────────────
  const checkInId = body['check_in_id'] as string | undefined;
  if (!checkInId) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'check_in_id required' }, 400);
  }

  // paid-specific fields
  const packageId   = body['package_id']   as string | undefined;
  const amount      = body['amount']        as number | undefined;
  const packageName = body['package_name']  as string | undefined;

  if (callbackType === 'paid') {
    if (!packageId || amount == null || !packageName) {
      return json({
        ok: false,
        error: 'MISSING_FIELD',
        detail: 'paid requires package_id, amount, package_name',
      }, 400);
    }
  }

  // ── Service role client (DB ops) ──────────────────────────────────────
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // ── Look up check_in → reservation (source_system + external_id) ─────
    const { data: checkIn, error: ciErr } = await admin
      .from('check_ins')
      .select('id, reservation_id')
      .eq('id', checkInId)
      .single();

    if (ciErr || !checkIn) {
      return json({ ok: false, error: 'INTERNAL', detail: `check_in not found: ${ciErr?.message}` }, 500);
    }

    if (!checkIn.reservation_id) {
      // No reservation linked — not a dopamine source
      return json({ ok: true, applied: false, reason: 'not_dopamine_source' });
    }

    const { data: reservation, error: rsvErr } = await admin
      .from('reservations')
      .select('id, source_system, external_id')
      .eq('id', checkIn.reservation_id)
      .single();

    if (rsvErr || !reservation) {
      return json({ ok: false, error: 'INTERNAL', detail: `reservation not found: ${rsvErr?.message}` }, 500);
    }

    // ── AC-5 / AC-1 guard: only fire for dopamine-sourced reservations ────
    if (reservation.source_system !== 'dopamine' || !reservation.external_id) {
      return json({ ok: true, applied: false, reason: 'not_dopamine_source' });
    }

    const externalId = reservation.external_id as string;

    // ── Paid-specific: is_first_package判정 (AC-1, AC-4) ─────────────────
    if (callbackType === 'paid') {
      const { data: priorLog } = await admin
        .from('dopamine_outbound_log')
        .select('id, status')
        .eq('external_id', externalId)
        .eq('callback_type', 'paid')
        .in('status', ['sent', 'pending'])
        .maybeSingle();

      if (priorLog) {
        // Already sent (or pending — another in-flight request)
        return json({ ok: true, applied: false, reason: 'not_first_package' });
      }
    }

    // ── For visited: check duplicate by event_id (check_in_id) ───────────
    if (callbackType === 'visited') {
      const { data: priorVisited } = await admin
        .from('dopamine_outbound_log')
        .select('id, status')
        .eq('callback_type', 'visited')
        .eq('event_id', checkInId)
        .maybeSingle();

      if (priorVisited) {
        return json({ ok: true, applied: false, reason: 'duplicate' });
      }
    }

    // ── AC-2: Insert outbound_log (status='pending') ──────────────────────
    const eventId = callbackType === 'paid' ? packageId! : checkInId;
    const payload = callbackType === 'paid'
      ? buildPaidPayload(externalId, packageId!, amount!, packageName!)
      : buildVisitedPayload(externalId, checkInId, checkIn.reservation_id);

    const { data: logRow, error: logInsertErr } = await admin
      .from('dopamine_outbound_log')
      .insert({
        external_id: externalId,
        callback_type: callbackType,
        event_id: eventId,
        payload,
        status: 'pending',
        attempts: 0,
      })
      .select('id')
      .single();

    if (logInsertErr) {
      // UNIQUE violation means already inserted (race condition) — treat as duplicate
      if (logInsertErr.code === '23505') {
        return json({ ok: true, applied: false, reason: 'duplicate' });
      }
      return json({ ok: false, error: 'INTERNAL', detail: `outbound_log insert failed: ${logInsertErr.message}` }, 500);
    }

    const logId = logRow.id as string;

    // ── AC-3: HTTP POST to dopamine ────────────────────────────────────────
    const dopamineUrl    = Deno.env.get('DOPAMINE_CALLBACK_URL') ?? '';
    const dopamineSecret = Deno.env.get('DOPAMINE_CALLBACK_SECRET') ?? '';

    if (!dopamineUrl) {
      // env not configured — mark as failed, return skipped (dev/staging safe)
      await admin
        .from('dopamine_outbound_log')
        .update({ status: 'failed', http_status: 0, response_body: 'DOPAMINE_CALLBACK_URL_NOT_SET', attempts: 1, last_attempt_at: new Date().toISOString() })
        .eq('id', logId);
      return json({ ok: true, applied: false, reason: 'skipped', detail: 'DOPAMINE_CALLBACK_URL not configured' });
    }

    const { httpStatus, responseBody } = await httpPostToDopamine(dopamineUrl, dopamineSecret, payload);
    const finalStatus = resolveLogStatus(httpStatus, responseBody);

    // ── AC-2: Update outbound_log with result ──────────────────────────────
    await admin
      .from('dopamine_outbound_log')
      .update({
        status: finalStatus,
        http_status: httpStatus,
        response_body: responseBody,
        attempts: 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', logId);

    if (finalStatus === 'failed') {
      // HTTP failed but we recorded it — caller can retry
      return json({ ok: false, error: 'DOPAMINE_HTTP_FAILED', http_status: httpStatus, detail: responseBody.slice(0, 200) }, 502);
    }

    return json({ ok: true, applied: true, dopamine_status: finalStatus });

  } catch (err) {
    console.error('[dopamine-callback] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
