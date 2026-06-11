/**
 * user-lookup-by-email — T-20260611-foot-DOPAMINE-FOOT3-UUID-LOOKUP (옵션 B: scoped proxy)
 * 풋CRM 권위 user UUID 조회 API EF (read-only, 최소권한)
 *
 * 도파민TM match-crm-user EF 가 staff 이메일로 풋CRM 권위 user UUID를 해석하기 위한
 * 전용 엔드포인트. 풋의 proxy-only(anon) 포스처를 유지하면서, service_role 직결 키를
 * 타 도메인에 확산시키지 않고 "email → 권위 UUID" 한 가지 조회만 노출한다.
 *
 * 설계 근거: 부모 T-20260611-dopamine-MAPCHECK-SCALP-FOOT-CRM AC-2 B경로.
 *   - 옵션 A(service_role 키 도파민 EF 주입) 대신 B(scoped proxy) 채택 = dev-foot 데이터 노출 정책 결정.
 *   - sister EF `reservations-read-api` 의 검증 패턴 재사용 (X-ReadAPI-Secret 인증 + service_role 내부 클라 + scoped SELECT).
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   헤더: X-ReadAPI-Secret: <DOPAMINE_READ_INBOUND_SECRET>
 *   (reservations-read-api 와 동일 시크릿 재사용 — 신규 secret 프로비저닝 0.
 *    도파민 측 기존 FOOT_INBOUND_SECRET 값과 동일하므로 즉시 사용 가능.)
 *   불일치 시 401, 처리 없음
 *
 * ── Method ──────────────────────────────────────────────────────
 *   GET  (?email=...)
 *   POST ({ "email": "..." })
 *
 * ── Parameters ──────────────────────────────────────────────────
 *   email   string (required)   조회할 staff 이메일. 대소문자 무시 정확 일치.
 *
 * ── Response ────────────────────────────────────────────────────
 *   200: { ok: true, user: { id, email, name, role, active, approved } | null }
 *        user=null → 일치하는 user_profiles 없음 (도파민은 skipped_no_match 처리)
 *   400: { ok: false, error: "INVALID_PARAM", detail }
 *   401: { ok: false, error: "UNAUTHORIZED" }
 *   405: { ok: false, error: "METHOD_NOT_ALLOWED" }
 *   500: { ok: false, error: "INTERNAL", detail }
 *
 * ── 노출 범위 (최소권한 명세) ──────────────────────────────────────
 *   - 테이블: user_profiles 1개만 (customers/reservations/payments 등 노출 안 함)
 *   - 컬럼: id(=auth.users.id=권위 crm_user_uuid), email, name, role, active, approved
 *   - 연산: SELECT only. 코드 내 INSERT/UPDATE/DELETE 경로 없음.
 *   - 조회 키: email 단일 (전체 스캔/목록 덤프 불가 — email 미지정 시 400)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-readapi-secret',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// 이메일 기본 포맷 검증 (스캔/와일드카드 방지 + 입력 위생)
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
}

// ilike 와일드카드 메타문자 이스케이프 (% _ \ → 리터럴)
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // ── 인증: X-ReadAPI-Secret (reservations-read-api 와 동일 read 전용 시크릿) ──
  const expectedSecret = Deno.env.get('DOPAMINE_READ_INBOUND_SECRET') ?? '';
  const receivedSecret = req.headers.get('X-ReadAPI-Secret') ?? '';
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    console.warn('[user-lookup-by-email] 401 — X-ReadAPI-Secret mismatch');
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // ── 파라미터 추출 ───────────────────────────────────────────────────────
  let email: string | undefined;
  if (req.method === 'GET') {
    email = new URL(req.url).searchParams.get('email') ?? undefined;
  } else {
    try {
      const body = await req.json();
      if (typeof body === 'object' && body !== null) {
        email = (body as Record<string, unknown>)['email'] as string | undefined;
      }
    } catch {
      return json({ ok: false, error: 'INVALID_PARAM', detail: 'JSON parse failed' }, 400);
    }
  }

  if (!email || typeof email !== 'string') {
    return json({ ok: false, error: 'INVALID_PARAM', detail: 'email is required' }, 400);
  }
  email = email.trim();
  if (!isEmail(email)) {
    return json({ ok: false, error: 'INVALID_PARAM', detail: 'email format invalid' }, 400);
  }

  // ── Supabase service role client (내부 전용 — 외부로 키 노출 없음) ──────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    // email 대소문자 무시 정확 일치 (와일드카드 이스케이프로 스캔 방지)
    const { data: row, error: qErr } = await admin
      .from('user_profiles')
      .select('id, email, name, role, active, approved')
      .ilike('email', escapeLike(email))
      .maybeSingle();

    if (qErr) {
      console.error('[user-lookup-by-email] query error:', qErr.message);
      return json({ ok: false, error: 'INTERNAL', detail: `query failed: ${qErr.message}` }, 500);
    }

    if (!row) {
      console.log('[user-lookup-by-email] no match for given email');
      return json({ ok: true, user: null });
    }

    console.log(`[user-lookup-by-email] OK — resolved user ${row.id}`);
    return json({
      ok: true,
      user: {
        id:       row.id,        // = auth.users.id = 권위 crm_user_uuid
        email:    row.email,
        name:     row.name,
        role:     row.role,
        active:   row.active,
        approved: row.approved,
      },
    });
  } catch (err) {
    console.error('[user-lookup-by-email] unexpected error:', err);
    return json({ ok: false, error: 'INTERNAL', detail: String(err).slice(0, 500) }, 500);
  }
});
