/**
 * checkin-visited-fire — TA3
 * 풋 셀프QR 체크인 → 도파민 visited 콜백 발사 (공개 EF, 내부 서비스 역할 사용)
 *
 * SelfCheckIn 페이지(익명 사용자)에서 체크인 완료 후 호출.
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3-2, §6-2, §7
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   Supabase anon JWT 허용 (SelfCheckIn 페이지는 인증된 사용자 없음)
 *   DB 검증으로 보안 대체 (reservation 존재 + source_system='dopamine' 확인)
 *
 * ── Request Body ────────────────────────────────────────────────
 *   { "reservation_id": "<UUID>" }
 *
 *   - matchedReservationId를 체크인 완료 직후 전달
 *   - EF가 해당 reservation의 최신 check_in을 조회해 event_id로 사용
 *
 * ── Response ────────────────────────────────────────────────────
 *   200 발사성공: { ok: true, applied: true, dopamine_status: "sent" }
 *   200 스킵:     { ok: true, applied: false, reason: "not_dopamine_source"|"duplicate"|"no_checkin" }
 *   400 오류:     { ok: false, error: "MISSING_FIELD", detail: string }
 *   502 HTTP실패: { ok: false, error: "DOPAMINE_HTTP_FAILED", http_status: N }
 *   500 내부:     { ok: false, error: "INTERNAL", detail: string }
 *
 * ── 멱등성 ──────────────────────────────────────────────────────
 *   dopamine_outbound_log UNIQUE(callback_type, event_id) 제약으로 중복 방지
 *   동일 reservation에 대해 중복 호출 시 두 번째부터 applied:false 반환
 *
 * ── 보안 고려 ────────────────────────────────────────────────────
 *   - reservation_id는 UUID (brute-force 어려움)
 *   - reservation.source_system='dopamine' 검증으로 유효 도파민 예약만 처리
 *   - outbound_log UNIQUE 제약으로 중복 발화 원천 차단
 *   - 최악의 경우: 잘못된 "visited" 전달 (도파민 측 stage=visited) — 비즈로직 영향 최소
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
//   visited 콜백 payload는 canonical 신키(FOOT_CLINIC_SLUG)로 emit.
//   paired: T-20260602-dopamine-CLINIC-SLUG-UNIFY
const SLUG_ALIAS: Record<string, string> = {
  'foot-jongno': 'jongno-foot',
};
function normalizeSlug(slug: string): string {
  return SLUG_ALIAS[slug] ?? slug;
}
const FOOT_CLINIC_SLUG = normalizeSlug('foot-jongno'); // → 'jongno-foot' (canonical)

// ── HTTP POST to dopamine ────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'INVALID_BODY', detail: 'JSON parse failed' }, 400);
  }

  const reservationId = body['reservation_id'] as string | undefined;
  if (!reservationId) {
    return json({ ok: false, error: 'MISSING_FIELD', detail: 'reservation_id required' }, 400);
  }

  // ── Service role client ───────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    // ── AC-1: reservation source_system 검증 ─────────────────────────────────
    const { data: reservation, error: rsvErr } = await admin
      .from('reservations')
      .select('id, source_system, external_id')
      .eq('id', reservationId)
      .single();

    if (rsvErr || !reservation) {
      // 예약 없음 → 스킵 (에러 아님, SelfCheckIn에서 예약 없이 체크인한 경우)
      return json({ ok: true, applied: false, reason: 'not_dopamine_source' });
    }

    // AC-5: source_system='dopamine' + external_id 필수
    if (reservation.source_system !== 'dopamine' || !reservation.external_id) {
      return json({ ok: true, applied: false, reason: 'not_dopamine_source' });
    }

    const externalId = reservation.external_id as string;

    // ── AC-1: 해당 예약의 최신 check_in 조회 ─────────────────────────────────
    // SelfCheckIn이 insert 직후 호출 → 가장 최신 check_in이 방금 생성된 것
    const { data: checkIn, error: ciErr } = await admin
      .from('check_ins')
      .select('id, created_at')
      .eq('reservation_id', reservationId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ciErr || !checkIn) {
      // check_in이 없으면 스킵 (방금 INSERT했는데 없는 경우는 비정상 — 로그만)
      console.warn(`[checkin-visited-fire] no check_in found for reservation_id=${reservationId}`);
      return json({ ok: true, applied: false, reason: 'no_checkin' });
    }

    const checkInId = checkIn.id as string;

    // ── AC-2: 중복 체크 ───────────────────────────────────────────────────────
    const { data: priorLog } = await admin
      .from('dopamine_outbound_log')
      .select('id, status')
      .eq('callback_type', 'visited')
      .eq('event_id', checkInId)
      .maybeSingle();

    if (priorLog) {
      return json({ ok: true, applied: false, reason: 'duplicate' });
    }

    // ── AC-2: outbound_log INSERT (pending) ───────────────────────────────────
    const visitedPayload = {
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

    const { data: logRow, error: logInsertErr } = await admin
      .from('dopamine_outbound_log')
      .insert({
        external_id: externalId,
        callback_type: 'visited',
        event_id: checkInId,
        payload: visitedPayload,
        status: 'pending',
        attempts: 0,
      })
      .select('id')
      .single();

    if (logInsertErr) {
      if (logInsertErr.code === '23505') {
        return json({ ok: true, applied: false, reason: 'duplicate' });
      }
      return json({ ok: false, error: 'INTERNAL', detail: `outbound_log insert: ${logInsertErr.message}` }, 500);
    }

    const logId = logRow.id as string;

    // ── AC-3: HTTP POST to dopamine ───────────────────────────────────────────
    const dopamineUrl    = Deno.env.get('DOPAMINE_CALLBACK_URL') ?? '';
    const dopamineSecret = Deno.env.get('DOPAMINE_CALLBACK_SECRET') ?? '';

    if (!dopamineUrl) {
      await admin
        .from('dopamine_outbound_log')
        .update({
          status: 'failed',
          http_status: 0,
          response_body: 'DOPAMINE_CALLBACK_URL_NOT_SET',
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', logId);
      return json({ ok: true, applied: false, reason: 'skipped', detail: 'DOPAMINE_CALLBACK_URL not configured' });
    }

    const { httpStatus, responseBody } = await httpPostToDopamine(dopamineUrl, dopamineSecret, visitedPayload);
    const finalStatus = resolveLogStatus(httpStatus, responseBody);

    // ── AC-4: outbound_log 업데이트 ───────────────────────────────────────────
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
      return json({ ok: false, error: 'DOPAMINE_HTTP_FAILED', http_status: httpStatus, detail: responseBody.slice(0, 200) }, 502);
    }

    console.log(`[checkin-visited-fire] OK external_id=${externalId} check_in_id=${checkInId} status=${finalStatus}`);
    return json({ ok: true, applied: true, dopamine_status: finalStatus });

  } catch (err) {
    console.error('[checkin-visited-fire] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
