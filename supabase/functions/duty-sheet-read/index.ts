/**
 * duty-sheet-read — T-20260606-foot-HANDOVER-TODAY-ATTENDEES (REV-1)
 *
 * 구글시트 근무 캘린더(오리진점 상담&코디 등)를 서버에서 read 해 raw CSV 그대로
 * 돌려주는 얇은 프록시. 브라우저에서 docs.google.com gviz CSV를 직접 fetch 하면
 * Access-Control-Allow-Origin 헤더가 없어 CORS 차단되므로(2026-06-06 실측 확인),
 * Edge Function 경유로 우회한다. 파싱은 클라이언트 lib/dutySheet.ts 가 담당(테스트 용이).
 *
 * ── Method ──────────────────────────────────────────────────────
 *   GET  ?gid=341864863
 *   POST { gid: "341864863" }
 *
 * ── Auth ────────────────────────────────────────────────────────
 *   Supabase 플랫폼 verify_jwt (anon/user JWT) — 로그인 직원 세션에서만 호출.
 *   추가로 gid 는 ALLOWED_GIDS 화이트리스트로 제한(오픈 프록시 방지).
 *
 * ── Response ────────────────────────────────────────────────────
 *   200: { ok: true, gid: string, csv: string }
 *   400: { ok: false, error: "INVALID_GID" }
 *   405: { ok: false, error: "METHOD_NOT_ALLOWED" }
 *   502: { ok: false, error: "UPSTREAM", detail: string }
 *
 * read-only. DB 접근 없음. 외부 의존: Google Sheets gviz CSV.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// 시트 문서 ID (read-only 공개 시트 — 비밀 아님). 필요 시 env 로 override.
const SHEET_ID =
  Deno.env.get('DUTY_SHEET_ID') ?? '1Ch4BhCZ1RPWKELedyWo6x60twjva3E0vXfHsiz_tRfo';

// 허용 gid 화이트리스트. 341864863 = 오리진점 상담&코디.
// 치료팀 별도 탭 gid 가 확인되면 env DUTY_SHEET_GIDS 에 콤마로 추가(재배포 불필요).
const ALLOWED_GIDS = new Set(
  (Deno.env.get('DUTY_SHEET_GIDS') ?? '341864863')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean),
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // gid 추출 (GET query 우선, 없으면 POST body)
  let gid = '';
  try {
    const url = new URL(req.url);
    gid = url.searchParams.get('gid') ?? '';
    if (!gid && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      gid = String((body as Record<string, unknown>).gid ?? '');
    }
  } catch {
    gid = '';
  }
  gid = gid.trim();

  if (!gid || !ALLOWED_GIDS.has(gid)) {
    return json({ ok: false, error: 'INVALID_GID' }, 400);
  }

  const upstream = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  try {
    const res = await fetch(upstream, { redirect: 'follow' });
    if (!res.ok) {
      return json({ ok: false, error: 'UPSTREAM', detail: `status ${res.status}` }, 502);
    }
    const csv = await res.text();
    return json({ ok: true, gid, csv });
  } catch (e) {
    return json({ ok: false, error: 'UPSTREAM', detail: String(e) }, 502);
  }
});
