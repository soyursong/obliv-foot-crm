/**
 * reservations-read-api — TD2
 * 풋CRM 예약 Read API EF
 *
 * 도파민 ↔ 풋CRM 연동 예약 조회 엔드포인트.
 * 도파민 측 또는 내부 관리 도구에서 예약 상태·외부_id 매핑을 조회할 때 사용.
 * 스펙: memory/_handoff/spec_foot_dopamine_integration_20260520.md §3, §6
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   헤더: X-Callback-Secret: <DOPAMINE_CALLBACK_SECRET>
 *   불일치 시 401, 처리 없음
 *
 * ── Method ──────────────────────────────────────────────────────
 *   GET (Query params 기반 조회)
 *   POST (JSON body 기반 조회, 동일 파라미터)
 *
 * ── Query Parameters ─────────────────────────────────────────────
 *   external_id    UUID      도파민 cue_card.id (단일 조회)
 *   phone_e164     string    고객 전화번호 (E.164)
 *   source_system  string    'dopamine' | 'foot-walkin' | '' (전체)
 *   clinic_slug    string    클리닉 슬러그 (clinics.slug)
 *   date_from      string    YYYY-MM-DD (reservation_date >=)
 *   date_to        string    YYYY-MM-DD (reservation_date <=)
 *   status         string    'confirmed' | 'cancelled' | 'completed' | ...
 *   limit          number    최대 결과 수 (default: 20, max: 100)
 *
 * ── Response ────────────────────────────────────────────────────
 *   200: { ok: true, reservations: [...], total: number }
 *   400: { ok: false, error: "INVALID_PARAM", detail: string }
 *   401: { ok: false, error: "UNAUTHORIZED" }
 *   500: { ok: false, error: "INTERNAL", detail: string }
 *
 * ── Reservation item 구조 ─────────────────────────────────────────
 *   {
 *     id: string,
 *     reservation_date: string,       // YYYY-MM-DD
 *     reservation_time: string,       // HH:MM:SS
 *     status: string,
 *     source_system: string | null,
 *     external_id: string | null,     // 도파민 cue_card.id
 *     visit_type: string | null,      // 'new' | 'returning'
 *     memo: string | null,
 *     clinic_id: string,
 *     clinic_slug: string | null,     // clinics.slug join
 *     customer: {
 *       id: string,
 *       name: string,
 *       phone: string,
 *     },
 *     created_at: string,
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-callback-secret',
  'Content-Type': 'application/json',
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// E.164 validation
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── 인증: X-Callback-Secret ──────────────────────────────────────────────
  const expectedSecret = Deno.env.get('DOPAMINE_CALLBACK_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-Callback-Secret') ?? '';
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[reservations-read-api] 401 — secret mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── 파라미터 추출 (GET: URL query / POST: JSON body) ────────────────────
  let params: Record<string, string | undefined> = {};

  if (req.method === 'GET') {
    const url = new URL(req.url);
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
  } else if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (typeof body === 'object' && body !== null) {
        params = body as Record<string, string | undefined>;
      }
    } catch {
      return json({ ok: false, error: 'INVALID_PARAM', detail: 'JSON parse failed' }, 400);
    }
  }

  const externalId   = params['external_id']   as string | undefined;
  const phoneE164    = params['phone_e164']     as string | undefined;
  const sourceSystem = params['source_system']  as string | undefined;
  const clinicSlug   = params['clinic_slug']    as string | undefined;
  const dateFrom     = params['date_from']      as string | undefined;
  const dateTo       = params['date_to']        as string | undefined;
  const statusFilter = params['status']         as string | undefined;
  const rawLimit     = params['limit'];

  // limit 검증
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || parsed < 1) {
      return json({ ok: false, error: 'INVALID_PARAM', detail: 'limit must be a positive integer' }, 400);
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  // phone_e164 포맷 검증 (지정된 경우)
  if (phoneE164 !== undefined && !isE164(phoneE164)) {
    return json({ ok: false, error: 'INVALID_PARAM', detail: `phone_e164 '${phoneE164}' is not valid E.164` }, 400);
  }

  // 날짜 포맷 검증 (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !dateRegex.test(dateFrom)) {
    return json({ ok: false, error: 'INVALID_PARAM', detail: `date_from '${dateFrom}' must be YYYY-MM-DD` }, 400);
  }
  if (dateTo && !dateRegex.test(dateTo)) {
    return json({ ok: false, error: 'INVALID_PARAM', detail: `date_to '${dateTo}' must be YYYY-MM-DD` }, 400);
  }

  // ── Supabase service role client ──────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    // ── 클리닉 slug → id 조회 (clinic_slug 지정 시) ────────────────────────
    let clinicIdFilter: string | undefined;
    if (clinicSlug) {
      const { data: clinicRow, error: clinicErr } = await admin
        .from('clinics')
        .select('id')
        .eq('slug', clinicSlug)
        .maybeSingle();

      if (clinicErr) {
        console.error('[reservations-read-api] clinic lookup error:', clinicErr.message);
        return json({ ok: false, error: 'INTERNAL', detail: `clinic lookup failed: ${clinicErr.message}` }, 500);
      }
      if (!clinicRow) {
        // slug 미매칭 → 빈 결과 반환 (에러 아님)
        console.log(`[reservations-read-api] clinic_slug '${clinicSlug}' not found → returning empty`);
        return json({ ok: true, reservations: [], total: 0 });
      }
      clinicIdFilter = clinicRow.id as string;
    }

    // ── phone_e164 → customer_id 조회 ─────────────────────────────────────
    let customerIdFilter: string | undefined;
    if (phoneE164) {
      const { data: customerRow, error: custErr } = await admin
        .from('customers')
        .select('id')
        .eq('phone', phoneE164)
        .maybeSingle();

      if (custErr) {
        console.error('[reservations-read-api] customer lookup error:', custErr.message);
        return json({ ok: false, error: 'INTERNAL', detail: `customer lookup failed: ${custErr.message}` }, 500);
      }
      if (!customerRow) {
        // 고객 없음 → 빈 결과
        return json({ ok: true, reservations: [], total: 0 });
      }
      customerIdFilter = customerRow.id as string;
    }

    // ── 예약 조회 ─────────────────────────────────────────────────────────
    let query = admin
      .from('reservations')
      .select(`
        id,
        reservation_date,
        reservation_time,
        status,
        source_system,
        external_id,
        visit_type,
        memo,
        clinic_id,
        created_at,
        customers ( id, name, phone ),
        clinics ( slug )
      `)
      .order('reservation_date', { ascending: false })
      .order('reservation_time', { ascending: false })
      .limit(limit);

    // 필터 적용
    if (externalId) {
      query = query.eq('external_id', externalId);
    }
    if (customerIdFilter) {
      query = query.eq('customer_id', customerIdFilter);
    }
    if (sourceSystem !== undefined && sourceSystem !== '') {
      query = query.eq('source_system', sourceSystem);
    }
    if (clinicIdFilter) {
      query = query.eq('clinic_id', clinicIdFilter);
    }
    if (dateFrom) {
      query = query.gte('reservation_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('reservation_date', dateTo);
    }
    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data: rows, error: queryErr } = await query;

    if (queryErr) {
      console.error('[reservations-read-api] query error:', queryErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `query failed: ${queryErr.message}` }, 500);
    }

    // ── 응답 포맷 정리 ─────────────────────────────────────────────────────
    const reservations = (rows ?? []).map((row: Record<string, unknown>) => {
      const customer  = row['customers']  as Record<string, unknown> | null;
      const clinicJoin = row['clinics']   as Record<string, unknown> | null;
      return {
        id:               row['id'],
        reservation_date: row['reservation_date'],
        reservation_time: row['reservation_time'],
        status:           row['status'],
        source_system:    row['source_system'] ?? null,
        external_id:      row['external_id']   ?? null,
        visit_type:       row['visit_type']    ?? null,
        memo:             row['memo']          ?? null,
        clinic_id:        row['clinic_id'],
        clinic_slug:      clinicJoin?.['slug'] ?? null,
        customer: customer
          ? { id: customer['id'], name: customer['name'], phone: customer['phone'] }
          : null,
        created_at: row['created_at'],
      };
    });

    console.log(`[reservations-read-api] OK — returned ${reservations.length} rows`);
    return json({ ok: true, reservations, total: reservations.length });

  } catch (err) {
    console.error('[reservations-read-api] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
