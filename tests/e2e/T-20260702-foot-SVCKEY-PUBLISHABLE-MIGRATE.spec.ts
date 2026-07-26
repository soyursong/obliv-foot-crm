/**
 * T-20260702-foot-SVCKEY-GIT-EXPOSURE-ROTATE — AC5 FE anon → sb_publishable_ 마이그 검증 spec
 *
 * 배경(Path Y, CEO 결정 MSG-20260726-170130-uc88): FE 공개 키를 legacy anon JWT(eyJ…)에서
 *   신형 publishable 키(sb_publishable_…)로 배선 교체. src/lib/supabase.ts 는 빌드 환경변수
 *   VITE_SUPABASE_ANON_KEY 를 그대로 읽으므로 코드 변경 없이 CF Pages 빌드 env 값만 교체
 *   (prod/preview 모두). 두 키는 legacy disable(AC6) 전까지 동일 project 에서 병행 유효.
 *
 * AC-1: 배포된 프로덕션 index-*.js 번들에 legacy anon JWT prefix(eyJhbGciOiJIUzI1…) 미포함,
 *       publishable prefix(sb_publishable_) 만 inlining.  (legacy 참조 0건 FE 실증)
 * AC-2: publishable 키로 웹앱 로그인 → access_token 발급 (auth 정상).
 * AC-3: publishable 키 + 로그인 토큰으로 주요 조회(staff/reservations/customers/packages)
 *       HTTP 200 — FE 소비처 회귀 0.
 * AC-4: anon-context(로그인 전) RLS 동작이 legacy 와 동일 (권한 거부/0행) — 보안 불변.
 *
 * 주의: AC-1 은 신형 키가 inlining 된 재배포 완료 후에만 PASS. 미배포 시 skip 가드로
 *   "미적용" 을 명시(false-green 방지).
 */

import { test, expect } from '@playwright/test';

const SITE = process.env.TEST_BASE_URL ?? 'https://obliv-foot-crm.pages.dev';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.TEST_ANON_KEY;
const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

const LEGACY_JWT_PREFIX = 'eyJhbGciOiJIUzI1';
const PUBLISHABLE_PREFIX = 'sb_publishable_';

// ─── AC-1: 배포 번들에 legacy JWT 미포함 / publishable 만 inlining ──────────────
test('AC-1: 프로덕션 번들에 legacy anon JWT 미포함, publishable prefix 만 inlining', async ({ request }) => {
  const indexHtml = await (await request.get(`${SITE}/`)).text();
  const asset = indexHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  expect(asset, 'index-*.js 번들을 index.html 에서 찾지 못함').toBeTruthy();
  const bundle = await (await request.get(`${SITE}/${asset}`)).text();

  expect(bundle.includes(LEGACY_JWT_PREFIX), 'legacy anon JWT prefix 가 번들에 남아있음').toBe(false);
  expect(bundle.includes(PUBLISHABLE_PREFIX), 'publishable prefix 가 번들에 inlining 되지 않음').toBe(true);
});

// ─── AC-2: publishable 키로 로그인 정상 ────────────────────────────────────────
test('AC-2: publishable 키로 password grant 로그인 → access_token 발급', async ({ request }) => {
  test.skip(!ANON_KEY || !EMAIL || !PASSWORD, 'ANON_KEY/TEST_USER 자격증명 미설정 — skip');
  expect(ANON_KEY!.startsWith(PUBLISHABLE_PREFIX), 'ANON_KEY 가 publishable 형식이 아님').toBe(true);

  const resp = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.access_token, 'access_token 미발급').toBeTruthy();
});

// ─── AC-3: 로그인 토큰 + publishable 키로 주요 조회 회귀 0 ───────────────────────
test('AC-3: publishable 키 + 로그인 토큰으로 주요 테이블 조회 HTTP 200', async ({ request }) => {
  test.skip(!ANON_KEY || !EMAIL || !PASSWORD, 'ANON_KEY/TEST_USER 자격증명 미설정 — skip');
  const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    data: { email: EMAIL, password: PASSWORD },
  });
  const token = (await auth.json()).access_token as string;
  expect(token).toBeTruthy();

  for (const t of ['staff', 'reservations', 'customers', 'packages']) {
    const r = await request.get(`${SUPABASE_URL}/rest/v1/${t}?select=id&limit=1`, {
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${token}` },
    });
    expect([200, 206], `${t} 조회 실패 HTTP ${r.status()}`).toContain(r.status());
  }
});

// ─── AC-4: anon-context RLS 보안 불변 (로그인 전 = 거부/0행) ─────────────────────
test('AC-4: publishable anon-context 에서 보호 테이블 직접 조회 = 거부 (보안 불변)', async ({ request }) => {
  test.skip(!ANON_KEY, 'ANON_KEY 미설정 — skip');
  const r = await request.get(`${SUPABASE_URL}/rest/v1/customers?select=id&limit=1`, {
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY!}` },
  });
  // anon 은 authenticated 전에는 보호 테이블 접근 불가 → 401/403 또는 0행
  if (r.status() === 200) {
    expect((await r.json()).length, 'anon 이 customers 행을 노출함').toBe(0);
  } else {
    expect([401, 403]).toContain(r.status());
  }
});
