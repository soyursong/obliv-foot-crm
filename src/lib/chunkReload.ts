/**
 * T-20260710-foot-DASHBOARD-PAGELOAD-ERROR
 *
 * 배포 후 stale-app(현장 브라우저가 구 index 번들을 캐시한 채 도는 상태) 자가치유의 단일 SSOT.
 *
 * 배경 RC:
 *   오늘처럼 하루에 prod 를 여러 번 재배포하면, 구 index 번들이 참조하던 해시 route-chunk(/assets/*.js)가
 *   CDN 에서 purge 된다. 구번들로 도는 브라우저가 그 chunk 를 dynamic import 하면:
 *     - fetch 자체 실패(404) 또는
 *     - Vercel SPA rewrite(/(.*) → /index.html)로 인해 없는 .js 요청에 index.html(HTML,200)이 회신 →
 *       "not a valid JavaScript MIME type: text/html" 로 import 가 reject/throw.
 *   → 모든 route(=모든 메뉴)에서 재발 → 현장 "CRM 전체/모든 메뉴 오류" 신고.
 *
 * 기존(개선 전) 취약점:
 *   App.tsx lazyWithRetry 의 재시도 가드가 '영구 단발 플래그(spa_reload_tried)'였다. 이 플래그가
 *   한 번 '1' 로 남고 정상 clear 경로에 도달하지 못하면, 이후 '정당하게 복구 가능한' chunk 실패마다
 *   자동 reload 를 건너뛰고 곧장 ErrorBoundary fallback 으로 떨어져 자가치유가 영구 무력화됐다.
 *
 * 처방(본 util):
 *   시간 윈도우 가드(CHUNK_RELOAD_LOOP_WINDOW_MS)로 바꿔 무한 reload 루프는 막되, 윈도우가 지나면
 *   가드가 자동 만료 → 자가치유가 항상 재무장된다. lazyWithRetry(fetch 실패 경로)와
 *   AdminLayout.ChunkErrorBoundary(eval-time 렌더 throw 경로)가 이 가드 하나를 공유해 경합 없이 협력한다.
 */

/** lazyWithRetry / ChunkErrorBoundary 공용 자동-리로드 가드 키(sessionStorage). */
export const CHUNK_RELOAD_GUARD_KEY = 'foot-chunk-autoreload-at';

/** 직전 자동 reload 후 이 시간 안에 재발하면 = 리로드해도 여전히 깨짐 → 루프 중단. 지나면 재무장. */
export const CHUNK_RELOAD_LOOP_WINDOW_MS = 20_000;

/** 에러가 chunk-load(구번들 stale) 성격인지 판별. */
export function isChunkLoadError(error: unknown): boolean {
  const err = error as { name?: unknown; message?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  const msg = typeof err?.message === 'string' ? err.message : String(error ?? '');
  return (
    name === 'ChunkLoadError' ||
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /loading (css )?chunk [\w-]+ failed/i.test(msg) ||
    // SPA rewrite 가 없는 청크 요청에 index.html(HTML)을 돌려줄 때의 시그니처(브라우저별 문구 변형 포함)
    /failed to load module script/i.test(msg) ||
    /not a valid javascript mime type/i.test(msg) ||
    /non-javascript mime type/i.test(msg) ||
    /expected a javascript(-or-wasm)? module script/i.test(msg) ||
    /'?text\/html'? is not a valid/i.test(msg)
  );
}

/**
 * 자동 reload 를 시도해도 되는지 판정하고, 시도 가능하면 가드 타임스탬프를 찍는다.
 * @returns true = 리로드 실행 OK(호출자가 window.location.reload()), false = 루프윈도우 이내 재발 → 리로드 금지.
 */
export function markAndCheckAutoReload(nowMs: number): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) ?? 0) || 0;
  } catch {
    /* private mode / storage 접근 불가 → 가드 없이 1회 시도 허용 */
  }
  if (nowMs - last < CHUNK_RELOAD_LOOP_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(nowMs));
  } catch {
    /* noop */
  }
  return true;
}

/** 정상 로드 성공/사용자 수동 새로고침 시 가드를 비워 자가치유를 재무장한다. */
export function clearAutoReloadGuard(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
  } catch {
    /* noop */
  }
}
