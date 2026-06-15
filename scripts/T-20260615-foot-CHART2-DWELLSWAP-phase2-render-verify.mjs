/**
 * T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP — phase2 실렌더 검증 (PROD, 갤탭 뷰포트)
 * supervisor FIX-REQUEST (insufficient_verification) 대응.
 *
 * 시나리오0:
 *   (A) 데이터 有 환자 → [체류시간] 탭 → 슬롯별 머문시간 표 표시, "조회 실패" 토스트 미발생.
 *   (B) 데이터 無 환자 → [체류시간] 탭 → "슬롯 체류시간 기록 없음" 빈상태, "조회 실패" 미발생.
 *
 * 타깃: PROD https://obliv-foot-crm.vercel.app (실 Supabase 백엔드 — 누락 마이그 c6fed76 적용 검증)
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const PROD = 'https://obliv-foot-crm.vercel.app';
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TestPass2026!';

const WITH_DATA = 'ac1b22a6-3529-4d31-a4ae-444367c2f72f'; // 장예지, RPC 109행
const NO_DATA   = '30962e3e-2d67-498b-8de7-36d18226de1a'; // 체크인 0건
const OUT = '_handoff/qa_screenshots';

const fail = (m) => { console.error('❌ ' + m); process.exitCode = 1; };

(async () => {
  // 1) SDK 로그인 → 세션 토큰
  const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: login, error: le } = await sb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (le || !login.session) { fail('SDK login: ' + (le?.message ?? 'no session')); return; }
  const s = login.session;
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
    expires_at: s.expires_at, token_type: s.token_type, user: s.user,
  });
  console.log('SDK login OK —', s.user.email);

  // 2) 갤탭 뷰포트 (Galaxy Tab landscape 1280x800, scale 2)
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await ctx.newPage();

  // 토스트/에러 문구 감시
  const toastErrors = [];
  page.on('console', (msg) => { if (/조회 실패/.test(msg.text())) toastErrors.push('console: ' + msg.text()); });

  // 세션 주입 (prod origin)
  await page.goto(PROD + '/login');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: sessionPayload });

  async function verify(label, customerId, expect /* 'table' | 'empty' */) {
    await page.goto(PROD + '/chart/' + customerId, { waitUntil: 'networkidle' });
    // 차트 헤더 렌더 대기
    await page.getByText('SMART DOCTOR — 고객정보').waitFor({ timeout: 20000 });
    // [체류시간] 탭 클릭 (CLINICAL 그룹)
    const tab = page.locator('[data-testid="chart-tab-clinical"]').getByRole('button', { name: '체류시간' });
    await tab.click();
    // 로딩 스피너가 사라질 때까지 (무한로딩 가드)
    await page.waitForTimeout(3500);

    const bodyText = await page.locator('body').innerText();
    const hasErrorToast = /체류시간 조회 실패/.test(bodyText) || toastErrors.length > 0;
    const hasEmpty = /슬롯 체류시간 기록 없음/.test(bodyText);
    const hasLoadingStuck = /체류시간 불러오는 중/.test(bodyText);
    // 표: 실제 dwell 패널(data-testid) 존재 = 슬롯별 머문시간 표 렌더
    const hasTable = await page.locator('[data-testid="slot-dwell-panel"]').count().then((c) => c > 0);

    // 탭 콘텐츠를 뷰포트로 스크롤(하단 폴드 아래 렌더 → 증빙에 실표시)
    const anchor = expect === 'table'
      ? page.locator('[data-testid="slot-dwell-panel"]').first()
      : page.getByText('슬롯 체류시간 기록 없음').first();
    try { await anchor.scrollIntoViewIfNeeded({ timeout: 4000 }); } catch { /* fallback full screenshot */ }
    await page.waitForTimeout(400);

    const shot = `${OUT}/DWELLSWAP_phase2_${label}.png`;
    await page.screenshot({ path: shot, fullPage: false });

    console.log(`\n[${label}] customer=${customerId}`);
    console.log(`  스크린샷: ${shot}`);
    console.log(`  표 렌더: ${hasTable} / 빈상태("기록 없음"): ${hasEmpty} / 무한로딩: ${hasLoadingStuck} / "조회 실패": ${hasErrorToast}`);

    if (hasErrorToast) fail(`[${label}] "조회 실패" 발생`);
    if (hasLoadingStuck) fail(`[${label}] 무한로딩 고착`);
    if (expect === 'table' && !hasTable) fail(`[${label}] 표 미렌더`);
    if (expect === 'empty' && !hasEmpty) fail(`[${label}] 빈상태 미렌더`);
    if (!process.exitCode) console.log(`  ✅ PASS`);
  }

  await verify('A_withdata', WITH_DATA, 'table');
  await verify('B_nodata', NO_DATA, 'empty');

  await browser.close();
  console.log(process.exitCode ? '\n=== 검증 실패 ===' : '\n=== 전 시나리오 PASS ===');
})();
