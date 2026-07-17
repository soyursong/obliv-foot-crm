/**
 * 인증된 /admin 브라우저 진단 — supervisor phase2 browser_diag 전용
 *
 * 배경(반복 사고):
 *   /admin 은 ProtectedRoute(인증 게이트) 뒤에 있다. 세션 없이 진입하면
 *   ProtectedRoute → <Navigate to="/login"> 로 즉시 리다이렉트되어 로그인 화면이
 *   렌더된다. 이 상태에서 "대시보드" 텍스트를 기다리면 영구 timeout →
 *   browser_diag_fail 로 잘못 판정된다(기능 결함 아님).
 *   동일 사고 이력: T-20260529-foot-CHECKIN-BTN-REMOVE, T-20260522-foot-PKG-BOX-INDICATOR,
 *                 T-20260523-foot-LASER-TIMER.
 *
 * 이 스크립트는 auth.setup.ts 와 동일하게 Supabase SDK 로그인 → localStorage 세션 주입 →
 *   /admin 진입 → "대시보드" 가시성 확인 → 스크린샷 저장까지 결정적으로 수행한다.
 *   supervisor 가 /admin 게이트 기능을 수동/자동 진단할 때 이 스크립트로 인증 전제를
 *   충족시키면 false browser_diag_fail 을 막을 수 있다.
 *   (raw `~/scripts/diag-browser.mjs <url>` 은 무인증 진입 → /login 리다이렉트로 항상 실패.
 *    /admin 뒤 화면[결제 미니창 등] 실렌더 QA 는 반드시 이 authed 헬퍼를 쓸 것.)
 *
 * 테스트 계정: test@medibuilder.com / $TEST_PASSWORD (종로 풋센터)
 *   ⚠ TEST_PASSWORD + Supabase 비밀은 gitignored `.env.local` 에 있다(.env 에는 없음).
 *      → 실행 전 `.env.local` 을 반드시 source 할 것(아래 예시).
 *
 * 실행(운영 번들=CF Pages canon 대상, 기본):
 *   set -a && . ./.env.local && set +a && node scripts/browser_diag_admin.mjs
 * 실행(결제 미니창 4구역 실렌더 QA — 현재 결제대기 큐번호 지정):
 *   set -a && . ./.env.local && set +a && OPEN_PAY_QUEUE=<큐번호> node scripts/browser_diag_admin.mjs
 * 실행(로컬 테스트 서버 대상):
 *   set -a && . ./.env.local && set +a && TARGET_URL=http://localhost:8089 node scripts/browser_diag_admin.mjs
 * 옵션:
 *   TARGET_URL     진단 대상 origin (default https://obliv-foot-crm.pages.dev = CF Pages canon 2026-07-16)
 *   DIAG_PATH      진입 경로 (default /admin)
 *   EXPECT_TEXT    가시성 확인 텍스트 (default 대시보드)
 *   OPEN_PAY_QUEUE 지정 시 대시보드 로드 후 해당 큐번호(#N) 의 결제 버튼 클릭 →
 *                  PaymentMiniWindow(4구역) 오픈 후 다이얼로그 스크린샷. 미지정=대시보드 확인만.
 *
 * 종료코드: 0 = PASS, 1 = FAIL
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

// canon = CF Pages(2026-07-16 flip, T-20260716-meta-DEPLOY-PIPE-SSOT-CLOUDFLARE-CANON).
// 구 vercel.app 은 frozen/deprecated → 무-override 실행이 canon 을 진단하도록 default 를 pages.dev 로 고정.
const TARGET_URL = (process.env.TARGET_URL ?? 'https://obliv-foot-crm.pages.dev').replace(/\/$/, '');
const DIAG_PATH = process.env.DIAG_PATH ?? '/admin';
const EXPECT_TEXT = process.env.EXPECT_TEXT ?? '대시보드';
const OPEN_PAY_QUEUE = process.env.OPEN_PAY_QUEUE ?? '';
const SHOT = path.join(__dirname, '..', 'test-results', `browser_diag_admin_${Date.now()}.png`);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 env 에 없습니다.');
  console.error('   실행 예: node --env-file=.env scripts/browser_diag_admin.mjs');
  process.exit(1);
}

async function main() {
  // 1) Supabase SDK 직접 로그인 → 토큰 획득
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`SDK login 실패: ${error?.message ?? 'no session'}`);
  }
  const session = data.session;
  console.log('✓ SDK login OK —', session.user.email);

  // 2) Supabase JS 가 사용하는 키로 localStorage 세션 주입
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // origin 컨텍스트 확보 후 localStorage 주입 — 빈 페이지 진입(로그인 리다이렉트 무관)
  await page.goto(`${TARGET_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: sessionPayload },
  );

  // 3) /admin 진입 → 대시보드 텍스트 확인
  await page.goto(`${TARGET_URL}${DIAG_PATH}`, { waitUntil: 'domcontentloaded' });
  let pass = false;
  try {
    await page.getByText(EXPECT_TEXT, { exact: true }).first().waitFor({ timeout: 20_000 });
    pass = true;
  } catch {
    pass = false;
  }

  // 4) (opt-in) PaymentMiniWindow(결제 미니창 4구역) 오픈 → 다이얼로그 스크린샷
  //    OPEN_PAY_QUEUE 지정 시에만. 비파괴(읽기/클릭만, DB write 없음).
  let payShot = null;
  let payOpened = false;
  if (pass && OPEN_PAY_QUEUE) {
    try {
      const wrapper = page
        .locator('div:has(> [data-testid="btn-pay"])')
        .filter({ hasText: `#${OPEN_PAY_QUEUE}` });
      const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
      await payBtn.waitFor({ state: 'visible', timeout: 20_000 });
      await payBtn.scrollIntoViewIfNeeded();
      await payBtn.click();
      // settle 버튼 = PaymentMiniWindow 오픈 확증(E2E openMiniWindow 동일 기준)
      await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      payOpened = true;
      payShot = path.join(__dirname, '..', 'test-results', `paymini_4zone_q${OPEN_PAY_QUEUE}_${Date.now()}.png`);
      const dialog = page.locator('[role="dialog"]').first();
      await dialog.screenshot({ path: payShot }).catch(async () => {
        await page.screenshot({ path: payShot, fullPage: true });
      });
      console.log(`  결제 미니창 오픈 OK (큐 #${OPEN_PAY_QUEUE}) — 4구역 스크린샷: ${payShot}`);
    } catch (e) {
      console.error(`  ⚠ 결제 미니창 오픈 실패 (큐 #${OPEN_PAY_QUEUE}): ${e.message}`);
      console.error(`     → 해당 큐번호가 현재 대시보드에 결제대기(btn-pay)로 존재하는지 확인.`);
    }
  }

  await page.screenshot({ path: SHOT, fullPage: true });
  const finalUrl = page.url();
  await browser.close();

  console.log(`  대상: ${TARGET_URL}${DIAG_PATH}`);
  console.log(`  최종 URL: ${finalUrl}`);
  console.log(`  스크린샷: ${SHOT}`);
  if (pass && OPEN_PAY_QUEUE && !payOpened) {
    console.error(`❌ FAIL — 대시보드는 인증 렌더 OK 이나 결제 미니창(큐 #${OPEN_PAY_QUEUE}) 오픈 실패.`);
    process.exit(1);
  }
  if (pass) {
    console.log(`✅ PASS — "${EXPECT_TEXT}" 렌더 확인 (인증 세션 정상)${payOpened ? ` + 결제 미니창 4구역 렌더 OK` : ''}`);
    process.exit(0);
  } else {
    console.error(`❌ FAIL — "${EXPECT_TEXT}" 미노출. 최종 URL(${finalUrl}) 이 /login 이면 인증 미주입.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌ 진단 실패:', e.message);
  process.exit(1);
});
