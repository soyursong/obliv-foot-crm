/**
 * authReadError.ts — data-plane read 의 "인증오류(401)" 판정식 (순수 코어)
 *
 * 티켓: T-20260820-foot-CONSULT-READ-SILENT401-BANNER-RELOGIN-FIX
 * 부모 RC: 31fb4f5b (角3 세션/토큰 만료 → data-plane read silent 401 → 배너없이 empty)
 *
 * ── 무엇을 푸는가 ──
 *   supabase-js `.select()` 는 HTTP 401/JWT만료/RLS-deny 에 throw 하지 않고
 *   `{ data: null, error }` 를 반환한다. load() 가 error 를 무시하고 `set(data ?? [])` 하면
 *   **인증오류를 "진짜 0건"과 구분 못 해 조용히 명단을 비운다**(silent empty). 새로고침은
 *   저장된 동일 만료 토큰을 재사용 → 같은 401 → 자가복구 안 됨(현장 "새로고침해도 안 됨").
 *
 *   이 모듈은 그 error 를 "인증오류(재로그인 필요)"와 "그 외(일시 네트워크·PGRST 로직오류)"로
 *   가르는 순수 판정기다. refresh401.ts(요청측 bearer 디코드)와 상보 — 이쪽은 **응답측 error
 *   객체**를 본다(load() 는 응답만 손에 쥐므로).
 *
 * ── refresh401 인프라와의 관계 (T-20260818 non-target 갭 봉합, ticket (b)) ──
 *   resilientFetch 는 refresh_401(유효 JWT인데 게이트웨이 401)만 재시도·배너.
 *   expired_token / anon_or_no_session 은 **non-target → 그대로 통과**(silent). 그 통과분이
 *   load() 에 error 로 도달하며, 이 판정기가 잡아 재로그인 유도(authRecoveryBus)로 넘긴다.
 */

/** PostgREST/supabase-js 가 인증실패에 싣는 코드. PGRST301=JWT invalid/expired, PGRST302=anon-not-permitted(JWT 필요). */
const AUTH_PGRST_CODES = new Set(['PGRST301', 'PGRST302', '401', 'PGRST303']);

/** 최소 형태의 error(형태만 필요 — PostgrestError / StorageError / gateway body 파싱 결과 공통 커버). */
export interface ReadErrorLike {
  code?: string | number | null;
  message?: string | null;
  status?: number | null;
  // supabase-js PostgrestError 는 status 를 직접 노출하지 않을 수 있어 __isAuthError(GoTrue) 등도 방어적으로 수용.
  __isAuthError?: boolean;
  name?: string | null;
}

/**
 * 이 read error 가 "인증오류(재로그인/토큰갱신 필요)"인가.
 *   true  → 명단 blank 금지 + 재로그인 유도(authRecoveryBus).
 *   false → 인증과 무관(일시 네트워크·PGRST 로직오류 등) → 기존 처리 불변(회귀0).
 *
 * ⚠ **real 0-row 는 error 가 null 이다** → 여기서 false → 기존대로 정상 blank(빈 명단 표시).
 *   즉 이 판정기는 "성공(빈 결과 포함) 경로"를 절대 인증오류로 오분류하지 않는다(부모 fail-open 보존).
 */
export function isAuthReadError(error: ReadErrorLike | null | undefined): boolean {
  if (!error) return false;

  // 1) GoTrue AuthError 표식(있으면 확정).
  if (error.__isAuthError === true) return true;
  if (typeof error.name === 'string' && /AuthError|AuthApiError/i.test(error.name)) return true;

  // 2) HTTP status 직접 노출 시.
  if (typeof error.status === 'number' && error.status === 401) return true;

  // 3) PostgREST 인증 코드.
  const code = error.code == null ? '' : String(error.code);
  if (AUTH_PGRST_CODES.has(code)) return true;

  // 4) 메시지 휴리스틱(게이트웨이 body·프록시가 코드 없이 문구만 줄 때 방어).
  const msg = (error.message ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('jwt') ||
    msg.includes('unauthorized') ||
    msg.includes('not authenticated') ||
    msg.includes('invalid claim') ||
    msg.includes('token is expired') ||
    msg.includes('token expired') ||
    /\b401\b/.test(msg)
  );
}
