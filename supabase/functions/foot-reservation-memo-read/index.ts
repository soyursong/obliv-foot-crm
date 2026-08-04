/**
 * foot-reservation-memo-read — T-20260804-dopamine-RESVSIDEBAR-MEMO-CRMSYNC-BIDIR-ALLBRANCH (lane B / dev-foot)
 *
 * 풋CRM 예약메모(reservation-grain)를 reservation_id 앵커로 read-only 반환하는 cross-CRM read surface.
 * 도파민 예약상세 사이드바 '메모' tab(AC-3 READ)이 CRM 실 예약메모를 그대로 표시하기 위한 데이터 소스.
 *
 * ── 왜 신설했나 (RC 배경) ──────────────────────────────────────────────────────
 *   지배적 RC = READ 방향 부재. 사이드바가 CRM 실 예약메모 대신 stale/공란 로컬 mirror를 seed 표시 →
 *   TM이 축약(예: "테스트")으로 replace → foot 수신부가 기존 dopamine-source rmh 행 content를
 *   무조건 UPDATE(clobber) → 예약시 쓴 메모 소실(repro 실증, resv f744fbcc-b9e4-47e7-bad6-c27e74312ae4).
 *   본 endpoint가 full 실메모를 사이드바에 되돌려주면 편집=superset → 재push replace가 자연 preserve.
 *
 * ── FE-visible 예약메모 SoT = reservation_memo_history(rmh) ─────────────────────
 *   reservations.memo = deprecated(T-20260504-MEMO-RESTRUCTURE, FE 미read·NULL 착지).
 *   FE(ReservationMemoTimeline / 예약상세 팝업)가 read 하는 SoT = rmh (reservation_id 앵커,
 *   source_system 파티션: NULL=사람저작 / 'dopamine'=sync). booking_memo = 레거시 fallback(FE resvMemoMap ?? booking_memo).
 *   → 본 EF 는 rmh 를 primary, booking_memo 를 fallback 으로 조립해 사이드바 표시용 full memo 를 반환한다.
 *
 * ── DA VERIFY-GATE (read_gate, MSG-20260804-145025-bm0t / GO_WARN) 준수 ─────────
 *   R1: reservation-grain ONLY · 단일예약 bounded · 고객메모(customer-grain) fetch/표시 절대 금지
 *       → rmh 는 reservation_id 로만 필터(customer_id/check_in_id 앵커 미사용). customers 미조회.
 *   R2: reservation_id 앵커 scoped read · 예약메모 필드만 반환 · crmSupabase 광역 read 금지 ·
 *       masking parity(고객 PII 미반환 — 이름/전화/RRN 컬럼을 응답에 싣지 않음)
 *   R3: 예약메모 cross-CRM 봉투 내 대칭 흐름(foot→dopamine read-back, 동일 grain·동일 tier)
 *
 * ── Auth ────────────────────────────────────────────────────────────────────────
 *   헤더: X-Foot-Read-Secret: <FOOT_CALENDAR_READ_SECRET>
 *   ★ read-only secret 재사용(foot-calendar-read 와 동일 trust-tier) — write secret
 *     (DOPAMINE_CALLBACK_SECRET / DOPAMINE_READ_INBOUND_SECRET)과 물리 분리. write secret 으로 호출 불가.
 *   헤더 없음/불일치/anon → 401. (config.toml verify_jwt=false — 게이트웨이 JWT 검사 off, 인증은 EF 내부)
 *
 * ── Method / Params ──────────────────────────────────────────────────────────────
 *   GET (query params) / POST (JSON body)
 *   reservation_id  string (필수)  reservations.id (UUID) — R2 단일예약 앵커
 *   clinic_slug     string (선택)  방어적 clinic 스코프 확인(불일치 시 404). 미지정 시 검증 skip.
 *   caller          string (선택)  감사 로그 식별자(예: 'dopamine')
 *
 * ── Response ─────────────────────────────────────────────────────────────────────
 *   200: {
 *     ok: true, read_only: true,
 *     reservation_id: string,
 *     memo:         string | null,   // ★ 사이드바 표시용 full 예약메모(rmh timeline 조립, fallback booking_memo)
 *     sync_memo:    string | null,   // ★ dopamine-source rmh 행 content = 사이드바 편집·재push 대상 seed
 *     booking_memo: string | null,   // 레거시 fallback(reservations.booking_memo)
 *     memo_entries: Array<{ content, source_system, created_by_name, created_at, is_pinned }>  // provenance-labeled timeline(표시 투명성)
 *   }
 *   400 INVALID_PARAM / 401 UNAUTHORIZED / 404 NOT_FOUND / 405 METHOD_NOT_ALLOWED / 500 INTERNAL
 *
 * ── 하드펜스 ──────────────────────────────────────────────────────────────────────
 *   ① WRITE=0 (read RPC 없음 · rmh/reservations 무변경) ② customers/PII 미반환 ③ reservation_id 앵커 scoped only
 *   ④ 멱등·무상태 ⑤ 정본=풋 ⑥ db_change=false(신규 컬럼·테이블·함수·enum 0)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assembleMemo } from '../_shared/resv-memo.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-foot-read-secret',
  'Content-Type': 'application/json',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cross-CRM slug 통일(write/read EF 동일 정규화): 도파민 신키 'jongno-foot' ↔ 구키 'foot-jongno'.
const SLUG_ALIAS: Record<string, string> = { 'foot-jongno': 'jongno-foot' };
function normalizeSlug(slug: string): string { return SLUG_ALIAS[slug] ?? slug; }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── Auth: X-Foot-Read-Secret (write secret 과 물리 분리) ──
  const expectedSecret = Deno.env.get('FOOT_CALENDAR_READ_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-Foot-Read-Secret') ?? '';
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[foot-reservation-memo-read] 401 — X-Foot-Read-Secret missing/mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── 파라미터 ──
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

  const reservationId = (params['reservation_id'] ?? '').trim();
  const clinicSlugRaw = (params['clinic_slug'] ?? '').trim();
  const callerRaw     = (params['caller'] ?? '').trim();

  if (!reservationId) return json({ ok: false, error: 'INVALID_PARAM', detail: 'reservation_id is required' }, 400);
  if (!UUID_RE.test(reservationId)) return json({ ok: false, error: 'INVALID_PARAM', detail: `reservation_id '${reservationId}' must be a UUID` }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // ── R2: reservation_id 앵커 scoped read (예약 존재/스코프 확인 + booking_memo fallback) ──
    //   ★ 예약메모·clinic 스코프 필드만 select — 고객 PII(customer_name/phone/RRN) 미조회(masking parity).
    const { data: resv, error: resvErr } = await admin
      .from('reservations')
      .select('id, clinic_id, booking_memo, source_system')
      .eq('id', reservationId)
      .maybeSingle();
    if (resvErr) {
      console.error('[foot-reservation-memo-read] reservations read error:', resvErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `read failed: ${resvErr.message}` }, 500);
    }
    if (!resv) return json({ ok: false, error: 'NOT_FOUND', detail: 'reservation not found' }, 404);

    // 방어적 clinic 스코프(선택): clinic_slug 지정 시 예약의 clinic 과 일치 검증.
    if (clinicSlugRaw) {
      const lookupSlug = normalizeSlug(clinicSlugRaw);
      const { data: clinic } = await admin
        .from('clinics').select('id, slug').eq('slug', lookupSlug).maybeSingle();
      if (!clinic || clinic.id !== resv.clinic_id) {
        return json({ ok: false, error: 'NOT_FOUND', detail: 'reservation not in clinic scope' }, 404);
      }
    }

    // ── R1: reservation-grain ONLY — rmh 를 reservation_id 로만 필터(customer_id/check_in_id 앵커 미사용) ──
    const { data: rmhRows, error: rmhErr } = await admin
      .from('reservation_memo_history')
      .select('content, source_system, created_by_name, created_at, is_pinned')
      .eq('reservation_id', reservationId);
    if (rmhErr) {
      console.error('[foot-reservation-memo-read] rmh read error:', rmhErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `read failed: ${rmhErr.message}` }, 500);
    }

    const entries = (rmhRows ?? []).map((r: Record<string, unknown>) => ({
      content:         (r['content'] as string | null) ?? null,
      source_system:   (r['source_system'] as string | null) ?? null,
      created_by_name: (r['created_by_name'] as string | null) ?? null,
      created_at:      r['created_at'] as string,
      is_pinned:       (r['is_pinned'] as boolean | null) ?? false,
    }));

    const bookingMemo = ((resv.booking_memo as string | null) ?? null);
    // dopamine-source 행 content = 사이드바 편집·재push 대상 seed(가장 최근).
    const dopamineRows = entries
      .filter((e) => e.source_system != null && (e.content ?? '').trim() !== '')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const syncMemo = dopamineRows.length ? (dopamineRows[0].content ?? '').trim() : null;
    // 표시용 full memo = rmh 조립, 없으면 booking_memo fallback.
    const memo = assembleMemo(entries) ?? (bookingMemo && bookingMemo.trim() !== '' ? bookingMemo.trim() : null);

    const caller = callerRaw !== '' ? callerRaw.slice(0, 64) : 'unknown';
    console.log(`[foot-reservation-memo-read] OK rid=${reservationId} caller=${caller} entries=${entries.length} has_memo=${memo != null} has_sync=${syncMemo != null}`);

    return json({
      ok: true,
      read_only: true,
      reservation_id: reservationId,
      memo,
      sync_memo: syncMemo,
      booking_memo: bookingMemo && bookingMemo.trim() !== '' ? bookingMemo.trim() : null,
      memo_entries: entries,
    });
  } catch (err) {
    console.error('[foot-reservation-memo-read] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
