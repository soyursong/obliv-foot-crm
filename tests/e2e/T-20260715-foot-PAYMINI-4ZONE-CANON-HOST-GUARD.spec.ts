/**
 * T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC — 배포타깃 divergence RC 가드 spec.
 *
 * reporter = 김주연 총괄 재신고 "아래 내용 하나도 반영 안되어 있는데?" (IMG_8988) →
 *   planner P0 EXPEDITE(MSG-20260717-142137-abn4, CEO 배포타깃/stale-bundle divergence 가설).
 *
 * 포렌식 실증(2026-07-17 dev-foot):
 *   · pages.dev/version.json commit == origin/main HEAD(c1df330d) → 정본 배포타깃 divergence 無.
 *   · ① 좌측 탭 정사각형(aspect-square w-14) = pages.dev 라이브 PaymentMiniWindow 청크에 실재.
 *   · 그러나 구 obliv-foot-crm.vercel.app 이 deprecate 이후에도 라이브(HTTP 200)로 main 자동배포,
 *     정본보다 뒤처진 커밋(2da30ee2) 서빙 → 병렬 드리프트 배포타깃 = 진짜 divergence.
 *   → fix: 부트 하드가드(main.tsx + lib/canonicalHost)로 deprecated 호스트 → 정본 pages.dev 강제 이관.
 *
 * 본 spec = 이관 판정 SSOT(canonicalRedirectTarget) 순수 검증. 시크릿/seed 불요 → QA 워크트리 무크래시.
 */
import { test, expect } from '@playwright/test';
import { canonicalRedirectTarget, CANONICAL_ORIGIN, DEPRECATED_HOSTS } from '../../src/lib/canonicalHost';

test.describe('T-20260715 PAYMINI-4ZONE 배포타깃 단일화(canonical host) 가드', () => {
  test('AC-G1: deprecated 구 vercel.app 진입 = 정본 pages.dev 로 이관(경로/쿼리/해시 보존)', () => {
    expect(canonicalRedirectTarget('obliv-foot-crm.vercel.app', '/admin/dashboard', '?q=1', '#h')).toBe(
      'https://obliv-foot-crm.pages.dev/admin/dashboard?q=1#h',
    );
    // 루트 경로도 정본 origin 으로.
    expect(canonicalRedirectTarget('obliv-foot-crm.vercel.app', '/')).toBe(
      'https://obliv-foot-crm.pages.dev/',
    );
  });

  test('AC-G2: 정본 pages.dev 는 이관하지 않음(무한 리다이렉트/오작동 방지)', () => {
    expect(canonicalRedirectTarget('obliv-foot-crm.pages.dev', '/admin/dashboard')).toBeNull();
  });

  test('AC-G3: 미리보기(CF preview)·로컬은 무영향', () => {
    expect(canonicalRedirectTarget('feat-branch.obliv-foot-crm.pages.dev', '/')).toBeNull();
    expect(canonicalRedirectTarget('localhost', '/')).toBeNull();
    expect(canonicalRedirectTarget('127.0.0.1', '/')).toBeNull();
  });

  test('AC-G4: SSOT 상수 계약 고정(정본 origin · deprecated 집합)', () => {
    expect(CANONICAL_ORIGIN).toBe('https://obliv-foot-crm.pages.dev');
    expect(DEPRECATED_HOSTS.has('obliv-foot-crm.vercel.app')).toBe(true);
  });
});
