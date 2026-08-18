/**
 * refresh401.ts — refresh-401 실패모드 판정식 (순수 코어, React/supabase 비의존)
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §2.1
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step1 (a)(b))
 *
 * ── 이것이 무엇인가 (오귀속 금지, spec §0/§1.1) ──
 *   refresh-401 = 클라가 "유효 세션(갱신 성공 JWT)"을 가졌음에도 데이터플레인 요청이
 *   상류 API Gateway 에서 HTTP 401 로 거부되는 상태. 클라 재갱신으로 해소되지 않으며
 *   게이트웨이 인시던트 (부분)해소 시 자연복구된다. **간헐적**.
 *
 *   이 모듈은 그 상태를 "정상 401(만료·RLS·anon)"과 감별하는 순수 판정기다.
 *   auth-plane(토큰 갱신, auth.tsx)은 건드리지 않는다 — data-plane 전용.
 *
 * 판정식(spec §2.1):
 *   is_refresh_401 = (status === 401)
 *                 && hasLiveUserSession()          // authenticated JWT 이고 exp > now+skew
 *                 && !isAnonPublicEndpoint(request) // anon 컨텍스트 제외
 *
 *   요청의 Authorization bearer 토큰을 디코드해 role/exp 로 판정한다.
 *   (supabase.auth.getSession() 을 부르지 않는 이유: 재진입/순환의존 회피 + 실제 요청이
 *    싣고 나간 토큰 그 자체가 판정 기준이라 가장 정확.)
 */

export type Refresh401Reason =
  | 'refresh_401' // 본 표준 대상
  | 'not_401' // 401 아님
  | 'anon_or_no_session' // anon 컨텍스트/세션 없음 → 정상 RLS/공개 (대상 아님)
  | 'expired_token'; // access_token 만료 → SDK refresh 소관 (auth-plane, 대상 아님)

export interface Refresh401Classification {
  isRefresh401: boolean;
  reason: Refresh401Reason;
}

/** 만료 판정 skew(초). exp 가 now+skew 이하로 다가오면 "만료 임박"으로 보고 SDK refresh 에 양보. */
export const EXP_SKEW_SECONDS = 30;

/**
 * JWT payload 디코드 — **검증 아님**, 클레임 읽기 전용(role/exp). 파싱 실패 시 null.
 * atob 기반 base64url 디코드(브라우저 표준). Node(Playwright collection)에도 atob 존재.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : // Node 폴백(테스트 collection). Buffer 는 런타임 존재.
          (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
            .Buffer?.from(b64, 'base64')
            .toString('utf-8') ?? '';
    if (!json) return null;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 요청 헤더에서 bearer access_token 추출. supabase-js 는 apikey(anon) + Authorization(bearer)
 * 를 함께 싣는다 — 판정은 Authorization bearer(세션 토큰) 기준.
 * headers 는 Headers | Record<string,string> | [k,v][] 형태 모두 허용.
 */
export function extractBearerToken(
  headers: Headers | Record<string, string> | [string, string][] | undefined,
): string | null {
  if (!headers) return null;
  let raw: string | null = null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    raw = headers.get('authorization') ?? headers.get('Authorization');
  } else if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === 'authorization');
    raw = hit ? hit[1] : null;
  } else {
    const rec = headers as Record<string, string>;
    raw = rec.authorization ?? rec.Authorization ?? null;
  }
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1] : raw.trim();
}

/**
 * 헤더의 bearer 토큰이 "살아있는 사용자 세션"인지 — role==='authenticated' 이고 미만료.
 * anon 키(role==='anon') 또는 만료 임박은 false → refresh-401 대상에서 제외.
 */
export function classifyToken(
  token: string | null,
  nowSec: number,
): { live: boolean; anon: boolean; expired: boolean } {
  if (!token) return { live: false, anon: true, expired: false };
  const payload = decodeJwtPayload(token);
  if (!payload) return { live: false, anon: true, expired: false };
  const role = typeof payload.role === 'string' ? (payload.role as string) : '';
  const exp = typeof payload.exp === 'number' ? (payload.exp as number) : 0;
  const anon = role !== 'authenticated';
  // exp 미존재(0)면 만료판정 불가 → 만료 아님으로 취급(role 만으로 판정).
  const expired = exp > 0 ? exp <= nowSec + EXP_SKEW_SECONDS : false;
  const live = !anon && !expired;
  return { live, anon, expired };
}

/**
 * refresh-401 판정(순수). 응답 status + 요청 bearer 토큰 + 현재시각(초)로 결정.
 * @param status  응답 HTTP status
 * @param token   요청 Authorization bearer(없으면 null → anon)
 * @param nowSec  Math.floor(Date.now()/1000)
 */
export function classifyRefresh401(
  status: number,
  token: string | null,
  nowSec: number,
): Refresh401Classification {
  if (status !== 401) return { isRefresh401: false, reason: 'not_401' };
  const { live, anon, expired } = classifyToken(token, nowSec);
  if (anon) return { isRefresh401: false, reason: 'anon_or_no_session' };
  if (expired) return { isRefresh401: false, reason: 'expired_token' };
  if (live) return { isRefresh401: true, reason: 'refresh_401' };
  return { isRefresh401: false, reason: 'anon_or_no_session' };
}

/** 요청 메서드가 안전(재시도 자유: GET/HEAD)한가. write(POST/PATCH/PUT/DELETE)는 (c) 큐 경유. */
export function isSafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD';
}
