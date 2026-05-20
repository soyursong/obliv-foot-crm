/**
 * dopamine-callback — 풋CRM → 도파민 Reverse 콜백 공통 Emitter
 *
 * TA3: visited (셀프QR 체크인 내원)
 * TA4: paid    (첫 패키지 결제, 1회만 발사)
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
 * ── Edge Secrets ────────────────────────────────────────────────
 *   DOPAMINE_CALLBACK_URL    — 도파민 수신 EF URL
 *                              예: https://<dopamine-project>.supabase.co/functions/v1/foot-callback-recv
 *   DOPAMINE_CALLBACK_SECRET — X-Callback-Secret 헤더 값
 *
 * ── 멱등성 ──────────────────────────────────────────────────────
 *   - dopamine_outbound_log UNIQUE(callback_type, event_id) 제약으로 중복 방지
 *   - paid: outbound_log에 external_id + callback_type='paid' + status='sent' 있으면 skip
 *   - visited: outbound_log에 event_id=check_in_id 있으면 skip
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

// ── Payload builder (§6-2) ────────────────────────────────────────────────
function buildVisitedPayload(
  externalId: string,
  checkInId: string,
  reservationId: string | null,
): object {
  return {
    source_system: 'foot',
    clinic_slug: 'foot-jongno',
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
    clinic_slug: 'foot-jongno',
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

// ── HTTP POST to dopamine ────────────────────────────────────────────────
async function httpPostToDopamine(
  url: string,
  secret: string,
  payload: object,
): Promise<{ httpStatus: number; responseBody: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Callback-Secret': secret,
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
  if (callbackType !== 'visited' && callbackType !== 'paid') {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'type must be "visited" or "paid"' }, 400);
  }

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
