/**
 * T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (divergence RC fix) — 배포타깃 단일화 SSOT.
 *
 * RC(포렌식 실증 2026-07-17): 구 Vercel 배포(obliv-foot-crm.vercel.app)가 deprecate 선언
 *   (env matrix: Cloudflare Pages 정본, 2026-07-16 canon) 이후에도 여전히 라이브(HTTP 200)로
 *   main 을 자동배포하며, 정본 pages.dev(c1df330d) 보다 뒤처진 커밋(2da30ee2)을 서빙 중이었다.
 *   → 검증/배포는 정본 pages.dev 에서 이뤄지는데 현장 갤탭이 구 vercel.app 을 북마크하면
 *     서로 드리프트하는 병렬 앱을 보게 됨(= CEO 배포타깃 divergence 가설 · COPAY 좀비 지문).
 *
 * 정본(canonical) 호스트 = obliv-foot-crm.pages.dev. deprecated 호스트 진입 시 정본으로 강제 이관.
 */
export const CANONICAL_ORIGIN = 'https://obliv-foot-crm.pages.dev';

/** deprecate 선언된(그러나 라이브로 남아있는) 배포 호스트 집합. */
export const DEPRECATED_HOSTS: ReadonlySet<string> = new Set(['obliv-foot-crm.vercel.app']);

/**
 * 주어진 location 파편이 deprecated 호스트면 정본 이관 URL(경로/쿼리/해시 보존)을,
 * 아니면 null(이관 불필요)을 반환하는 순수 함수. 부트 하드가드·유닛테스트 공용 SSOT.
 */
export function canonicalRedirectTarget(
  hostname: string,
  pathname = '/',
  search = '',
  hash = '',
): string | null {
  if (!DEPRECATED_HOSTS.has(hostname)) return null;
  return CANONICAL_ORIGIN + pathname + search + hash;
}
