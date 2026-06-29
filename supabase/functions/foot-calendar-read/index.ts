/**
 * foot-calendar-read — T-20260629-foot-FOOTDIRECT-CAL-READ-SURFACE
 * 풋 direct/walk-in 예약(source_system IS NULL) cross-CRM read surface (도파민 read-through 데이터 소스)
 *
 * 부모: T-20260629-dopamine-FOOTDIRECT-REVERSE-VISIBILITY (intent (가) display-only)
 *   화면 렌더·read-only 배지·캘린더 투영 = 부모(dev-dopamine) 소관. 본 EF = 풋 측 데이터 소스.
 * DA B SHAPE: CONSULT-REPLY MSG-20260629-154106-p5yt / 계약 §6-6-9 (v1.22)
 *
 * ── Auth (§1-3, AC-2) ───────────────────────────────────────────────────────
 *   헤더: X-Foot-Read-Secret: <FOOT_CALENDAR_READ_SECRET>
 *   ★ write 계열 secret(DOPAMINE_CALLBACK_SECRET / DOPAMINE_READ_INBOUND_SECRET)과 물리 분리.★
 *   FOOT_CALENDAR_READ_SECRET 은 그 값들과 반드시 다른 값으로 설정 → write secret 으로는 호출 불가.
 *   헤더 없음/불일치/anon → 401. 처리 0.
 *
 * ── Method ──────────────────────────────────────────────────────────────────
 *   GET (query params) / POST (JSON body)
 *
 * ── Params ──────────────────────────────────────────────────────────────────
 *   clinic_slug  string  (필수) clinics.slug — 풋 지점 (AC-5 clinic 스코프)
 *   date_from    string  (필수) YYYY-MM-DD (reservation_date >=)
 *   date_to      string  (필수) YYYY-MM-DD (reservation_date <=)
 *   status       string  (선택) 'all' | 'confirmed' | 'checked_in' | 'cancelled' | 'noshow'
 *   page_size    number  (선택) 최대 결과 수 (default 200, max 500)
 *   caller       string  (선택) 감사 로그용 호출자 식별 (예: 'dopamine')
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 *   200: { ok: true, read_only: true, reservations: [...], total: number }
 *   400: { ok: false, error: "INVALID_PARAM", detail }
 *   401: { ok: false, error: "UNAUTHORIZED" }
 *   422: { ok: false, error: "INVALID_VALUE", detail }
 *   405: { ok: false, error: "METHOD_NOT_ALLOWED" }
 *   500: { ok: false, error: "INTERNAL", detail }
 *
 * ── Reservation item (§1-4 allowlist — 서버 RPC 시그니처에서 구조적 강제) ─────
 *   {
 *     reservation_id: string,           // opaque uuid
 *     reservation_date: string,         // YYYY-MM-DD
 *     reservation_time: string,         // HH:MM:SS
 *     service_label: string | null,     // 시술유형 라벨 (services.name)
 *     visit_type: string | null,        // new | returning | experience
 *     status: string,
 *     room: string | null,              // 예약은 방 미배정 → null
 *     customer_name_masked: string,     // "김**"
 *   }
 *   ★ DENY: 풀 전화번호 · RRN · 진료기록 PHI → RPC RETURNS TABLE 에 컬럼 자체 부재(우회 불가).
 *
 * ── 하드펜스 8 (§1-6) ───────────────────────────────────────────────────────
 *   ① WRITE=0 (reservations/customers 무변경 — read RPC + audit log insert만)
 *   ② MINT=0 (cue_card 미접촉) ③ FUNNEL 미진입 ④ process_status 무부여
 *   ⑥ FORWARD write(reservation-ingest-from-dopamine)와 직교 ⑦ 멱등·무상태 ⑧ 정본=풋
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-foot-read-secret',
  'Content-Type': 'application/json',
};

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// ── Cross-CRM slug 통일 (dual-key, write/read EF 와 동일 정규화) ──────────────
//   도파민 신키 'jongno-foot' ↔ 구키 'foot-jongno'. 입력 slug 정규화 후 RPC 전달.
const SLUG_ALIAS: Record<string, string> = {
  'foot-jongno': 'jongno-foot',
};
function normalizeSlug(slug: string): string {
  return SLUG_ALIAS[slug] ?? slug;
}

const VALID_STATUSES = new Set(['all', 'confirmed', 'checked_in', 'cancelled', 'noshow']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── AC-2: X-Foot-Read-Secret 인증 (write secret 과 물리 분리) ───────────────
  const expectedSecret = Deno.env.get('FOOT_CALENDAR_READ_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-Foot-Read-Secret') ?? '';
  // expectedSecret 미설정(빈값) 또는 불일치 → 401. anon(헤더 없음)도 빈 문자열 → 불일치 → 401.
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[foot-calendar-read] 401 — X-Foot-Read-Secret missing/mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── 파라미터 추출 ───────────────────────────────────────────────────────────
  let params: Record<string, string | undefined> = {};
  if (req.method === 'GET') {
    const url = new URL(req.url);
    url.searchParams.forEach((v, k) => { params[k] = v; });
  } else {
    try {
      const body = await req.json();
      if (body && typeof body === 'object') params = body as Record<string, string | undefined>;
    } catch {
      return json({ ok: false, error: 'INVALID_PARAM', detail: 'JSON parse failed' }, 400);
    }
  }

  const clinicSlug = params['clinic_slug'] as string | undefined;
  const dateFrom   = params['date_from']   as string | undefined;
  const dateTo     = params['date_to']     as string | undefined;
  const statusRaw  = params['status']      as string | undefined;
  const callerRaw  = params['caller']      as string | undefined;
  const rawPageSize = (params['page_size'] ?? params['limit']) as string | undefined;

  // 필수 파라미터 (AC-5 clinic_slug)
  if (!clinicSlug) return json({ ok: false, error: 'INVALID_PARAM', detail: 'clinic_slug is required' }, 400);
  if (!dateFrom)   return json({ ok: false, error: 'INVALID_PARAM', detail: 'date_from is required' }, 400);
  if (!dateTo)     return json({ ok: false, error: 'INVALID_PARAM', detail: 'date_to is required' }, 400);

  // 날짜 포맷
  if (!DATE_RE.test(dateFrom)) return json({ ok: false, error: 'INVALID_PARAM', detail: `date_from '${dateFrom}' must be YYYY-MM-DD` }, 400);
  if (!DATE_RE.test(dateTo))   return json({ ok: false, error: 'INVALID_PARAM', detail: `date_to '${dateTo}' must be YYYY-MM-DD` }, 400);
  if (dateFrom > dateTo)       return json({ ok: false, error: 'INVALID_PARAM', detail: 'date_from must be <= date_to' }, 400);

  // status 허용값 (422)
  let statusFilter: string | null = null;
  if (statusRaw !== undefined && statusRaw !== '' && statusRaw !== 'all') {
    if (!VALID_STATUSES.has(statusRaw)) {
      return json({ ok: false, error: 'INVALID_VALUE', detail: `status '${statusRaw}' must be one of: all, confirmed, checked_in, cancelled, noshow` }, 422);
    }
    statusFilter = statusRaw;
  }

  // page_size
  let pageSize = DEFAULT_PAGE_SIZE;
  if (rawPageSize !== undefined) {
    const parsed = parseInt(rawPageSize, 10);
    if (isNaN(parsed) || parsed < 1) {
      return json({ ok: false, error: 'INVALID_PARAM', detail: 'page_size must be a positive integer' }, 400);
    }
    pageSize = Math.min(parsed, MAX_PAGE_SIZE);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const lookupSlug = normalizeSlug(clinicSlug);

  try {
    // ── AC-1/3/4/5: read 전용 SECURITY DEFINER RPC (allowlist 투영 SQL 강제) ──
    const { data: rows, error: rpcErr } = await admin.rpc('foot_calendar_read_direct', {
      p_clinic_slug: lookupSlug,
      p_date_from:   dateFrom,
      p_date_to:     dateTo,
      p_status:      statusFilter,   // null = 전체
      p_limit:       pageSize,
    });

    if (rpcErr) {
      console.error('[foot-calendar-read] rpc error:', rpcErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `read failed: ${rpcErr.message}` }, 500);
    }

    const reservations = (rows ?? []).map((row: Record<string, unknown>) => ({
      reservation_id:       row['reservation_id'],
      reservation_date:     row['reservation_date'],
      reservation_time:     row['reservation_time'],
      service_label:        row['service_label']        ?? null,
      visit_type:           row['visit_type']           ?? null,
      status:               row['status'],
      room:                 row['room']                 ?? null,
      customer_name_masked: row['customer_name_masked'] ?? '**',
    }));

    // ── AC-6: 경량 read-access log (audit-only, 도메인 write 아님) ──────────────
    //   실패해도 read 응답을 막지 않음(best-effort) — 감사 누락은 read 차단보다 경미.
    const caller = (typeof callerRaw === 'string' && callerRaw.trim() !== '') ? callerRaw.trim().slice(0, 64) : 'unknown';
    const { error: logErr } = await admin.from('foot_calendar_read_access_log').insert({
      caller,
      clinic_slug:   lookupSlug,
      date_from:     dateFrom,
      date_to:       dateTo,
      status_filter: statusFilter ?? 'all',
      row_count:     reservations.length,
    });
    if (logErr) console.warn('[foot-calendar-read] access log insert failed (non-fatal):', logErr.message);

    console.log(`[foot-calendar-read] OK clinic=${lookupSlug} ${dateFrom}~${dateTo} status=${statusFilter ?? 'all'} caller=${caller} rows=${reservations.length}`);
    return json({ ok: true, read_only: true, reservations, total: reservations.length });

  } catch (err) {
    console.error('[foot-calendar-read] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
