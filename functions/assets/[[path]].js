/**
 * T-20260807-foot-CFPAGES-ASSET-404-HTML-IMMUTABLE
 *
 * 문제(재발): 없는 `/assets/*.js` 요청이 `public/_redirects` 의 SPA fallback
 *   (`/*  /index.html  200`) 에 삼켜져 HTML(200) 로 회신 → 브라우저가 JS 로
 *   파싱하다 실패 → 전 라우트 동적 import(코드 스플리팅) 붕괴 → 전 메뉴 접속 불가.
 *   게다가 `public/_headers` 의 `/assets/* immutable` 이 그 오답을 1년 캐싱.
 *   735e33fd(07-10) 는 클라이언트 자가치유만 넣었고 서버 오답 자체는 미조치 → 재발.
 *
 * 처방(서버측 근본): CF Pages 의 `_redirects` 는 404 rewrite 를 지원하지 않으므로
 *   `/assets/**` 스코프 Pages Function 으로 처리한다.
 *   - 실존 자산 → next() 가 정적 파일(200 · 올바른 JS MIME · _headers immutable)을
 *     반환 → 그대로 통과(DoD#2).
 *   - 없는 자산 → next() 가 404 또는 SPA fallback(text/html) 을 반환 → 강제 404
 *     (no-store) 로 치환(DoD#1). 오답이 immutable 캐시에 눌러붙지 않음.
 *   - 이 Function 은 `/assets/**` 에만 라우팅되므로 `/dashboard` 등 SPA 라우트는
 *     무영향 — 기존 SPA fallback 200 HTML 유지(DoD#3).
 */
export async function onRequest(context) {
  const res = await context.next();
  const contentType = res.headers.get("content-type") || "";

  // /assets/* 로 요청됐는데 실제 정적 자산이 아니면(404 이거나 SPA fallback HTML)
  // = 없는 자산 → SPA fallback 에 삼켜지지 않도록 하드 404 로 치환.
  const assetMissing = res.status === 404 || contentType.includes("text/html");

  if (assetMissing) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  return res;
}
