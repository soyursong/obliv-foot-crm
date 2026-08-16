/**
 * T-20260805-foot-CF-PHISHING-BLOCK-LOGIN — 로그인 경로 rename (/login → /entry)
 *
 * 배경: Cloudflare "Suspected Phishing" 인터스티셜이 pages.dev 공유 서브도메인 연좌로
 *   경로 `/login`(server GET)만 path-exact 하드차단(403). CEO 실측 2026-08-16
 *   (`/login`=403 phishing_hits=5 cf-ray a2be6bf70d29 · `/entry`=200 phishing_hits=0).
 *   대소문자/슬래시만 달라도 통과 → path-exact 확정. CF 403은 엣지에서 origin 도달 前
 *   차단이라 구 `/login`을 앱단 redirect로 되살릴 수 없음(사망경로).
 *
 * 결정(§3): canonical 로그인 경로를 로그인-유의어가 아닌 내부용 명칭 `/entry`로 rename.
 *   직전 임시경로 `/signin`(로그인 유의어 → CF 재학습 재발 위험)은 한 릴리스 동안
 *   client-side redirect로만 브릿지(다음 사이클 제거). 구 `/login` 라우트는 완전 제거.
 *
 * 본 spec = 로컬 dev 서버 대상(CF edge 차단 없음) → 라우트 rename 정합만 검증.
 *   실제 CF 차단 해소는 라이브 브라우저 접속(infra evidence: 신규경로 200 + phishing_hits=0 + cf-ray)로 확인.
 *
 * 검증:
 *   1) /entry = canonical 로그인 화면(폼 렌더).
 *   2) /signin = client-side redirect → /entry 착지(직전경로 브릿지).
 *   3) 미인증 /admin = /entry 리다이렉트(ProtectedRoute — 세션만료·401 인터셉터 전원 튕김 타깃).
 *   4) STATIC 회귀: 소스에 로그인 라우트 타깃으로서의 `/login`·`/signin` 코드 참조 0(주석 제외).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('T-20260805 CF phishing — login route rename /login→/entry', () => {
  test('/entry 가 로그인 화면(canonical)을 렌더한다', async ({ page }) => {
    await page.goto('/entry');
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByText('오블리브 풋센터')).toBeVisible();
    await expect(page.getByLabel('이메일')).toBeVisible();
    await expect(page.getByLabel('비밀번호')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('/signin 은 /entry 로 client-side redirect 된다(직전경로 브릿지)', async ({ page }) => {
    await page.goto('/signin');
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('미인증 /admin 진입은 /entry 로 튕긴다(ProtectedRoute)', async ({ page }) => {
    // 스토리지 상태 없이 진입 → ProtectedRoute 가 /entry 로 Navigate.
    await page.context().clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/entry$/);
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  // ── STATIC 회귀: 로그인 라우트 타깃으로서의 /login·/signin 코드 참조 0(주석·설명 프로즈 제외) ──
  test('소스에 로그인 라우트 타깃 /login·/signin 코드 참조가 0 이다(주석 제외)', () => {
    const files = [
      'src/App.tsx',
      'src/components/ProtectedRoute.tsx',
      'src/components/AdminLayout.tsx',
      'src/pages/Register.tsx',
      'src/pages/ResetPassword.tsx',
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf-8');
      expect(src, `${rel}: navigate('/login') 잔존`).not.toMatch(/navigate\(\s*['"]\/login['"]/);
      expect(src, `${rel}: to="/login" 잔존`).not.toMatch(/to=["']\/login["']/);
      expect(src, `${rel}: navigate('/signin') 잔존`).not.toMatch(/navigate\(\s*['"]\/signin['"]/);
    }
    // App.tsx: /login 라우트 정의(path="/login") 완전 제거 확인
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf-8');
    expect(app, 'App.tsx: <Route path="/login"> 잔존').not.toMatch(/path=["']\/login["']/);
    // canonical /entry 라우트는 존재
    expect(app, 'App.tsx: /entry canonical 라우트 부재').toMatch(/path=["']\/entry["']/);
  });
});
