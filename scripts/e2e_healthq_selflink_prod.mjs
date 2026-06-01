/**
 * T-20260601-foot-HEALTHQ-SELFLINK-FAIL (REOPEN-1) — prod 실브라우저 E2E 증거 수집
 *
 * AC-R1: prod 실브라우저 로그인 → 고객 펜차트 → "자가작성 링크 생성" 직접 클릭.
 *        성공/실패 네트워크 응답 본문 + 화면 스샷 확보.
 * AC-R3: 생성된 실링크를 브라우저로 직접 열어 자가작성 화면 렌더 실증.
 *
 * 대상: https://obliv-foot-crm.vercel.app (rxlomoozakkjesdqjtvd — 배포 번들 확인됨)
 * 계정: test@medibuilder.com (staff "데스크" coordinator, clinic jongno-foot = 김주연과 동일)
 * 고객: 송유진 (8817fc08, jongno-foot)
 *
 * 실행: node scripts/e2e_healthq_selflink_prod.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://obliv-foot-crm.vercel.app';
const EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'TestPass2026!';
const CUSTOMER_ID = '8817fc08-0deb-4dc4-9c5e-b1793c89f8cf'; // 송유진
const OUT = '/tmp/healthq_prod_evidence';
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[E2E]', ...a);
const evidence = { steps: [], createTokenResponse: null, generatedUrl: null, linkRender: null };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// 콘솔 에러/네트워크 실패 수집
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const netFailures = [];
page.on('requestfailed', (r) => netFailures.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));

// fn_health_q_create_token 응답 가로채기
page.on('response', async (resp) => {
  const u = resp.url();
  if (u.includes('fn_health_q_create_token')) {
    let body = null;
    try { body = await resp.text(); } catch { /* ignore */ }
    evidence.createTokenResponse = { status: resp.status(), body };
    log('🎯 create_token 응답:', resp.status(), body);
  }
});

try {
  // 1) 로그인
  log('1) 로그인 페이지 진입');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  log('   로그인 후 URL:', page.url());
  await page.screenshot({ path: `${OUT}/01_after_login.png` });
  evidence.steps.push({ step: 'login', url: page.url() });

  // 2) 고객 펜차트 진입 (기본 탭 = pen_chart)
  log('2) 고객 차트 진입');
  await page.goto(`${BASE}/chart/${CUSTOMER_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // 차트 + 패널 lazy 로드
  await page.screenshot({ path: `${OUT}/02_chart_page.png`, fullPage: true });

  // 발건강질문지 자가작성 섹션 확인
  const sectionVisible = await page.getByText('발건강질문지 자가작성').first().isVisible().catch(() => false);
  log('   발건강질문지 섹션 보임:', sectionVisible);
  evidence.steps.push({ step: 'chart', sectionVisible });

  if (!sectionVisible) {
    // 펜차트 탭이 기본이 아닐 수 있으니 명시적으로 클릭 시도
    const tab = page.getByRole('button', { name: '펜차트' }).first();
    if (await tab.isVisible().catch(() => false)) { await tab.click(); await page.waitForTimeout(1500); }
  }

  // 3) 링크 생성 클릭
  log('3) "링크 생성" 버튼 클릭');
  const createBtn = page.getByRole('button', { name: '링크 생성' }).first();
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ timeout: 10000 });
  // 응답/토스트/URL 표시 대기
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/03_after_create_click.png`, fullPage: true });

  // 생성된 URL 또는 에러 토스트 탐지
  const genUrlEl = page.locator('text=/\\/health-q\\//').first();
  const errToast = page.locator('text=/링크 생성 실패/').first();
  const hasErr = await errToast.isVisible().catch(() => false);
  const hasUrl = await genUrlEl.isVisible().catch(() => false);
  if (hasErr) {
    const errText = await errToast.textContent().catch(() => '');
    log('   ❌ 에러 토스트:', errText);
    evidence.steps.push({ step: 'create_token', result: 'ERROR_TOAST', text: errText });
  }
  // 생성된 링크 input/text 추출
  let generatedUrl = null;
  // input value 우선
  const inputs = await page.locator('input').all();
  for (const inp of inputs) {
    const v = await inp.inputValue().catch(() => '');
    if (v && v.includes('/health-q/')) { generatedUrl = v; break; }
  }
  if (!generatedUrl) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const m = bodyText.match(/https?:\/\/[^\s'"]+\/health-q\/[A-Za-z0-9_-]+/);
    if (m) generatedUrl = m[0];
  }
  evidence.generatedUrl = generatedUrl;
  log('   생성된 URL:', generatedUrl, '| hasUrlEl:', hasUrl, '| hasErr:', hasErr);

  // 4) 생성된 링크 열기 → 렌더 실증 (AC-R3)
  if (generatedUrl) {
    log('4) 생성 링크 열어 렌더 실증');
    const linkPage = await ctx.newPage();
    await linkPage.goto(generatedUrl, { waitUntil: 'networkidle' });
    await linkPage.waitForTimeout(3000);
    await linkPage.screenshot({ path: `${OUT}/04_link_render.png`, fullPage: true });
    const formVisible = await linkPage.getByText('발건강 질문지').first().isVisible().catch(() => false);
    const errVisible = await linkPage.getByText('링크 오류').first().isVisible().catch(() => false);
    const loadingStuck = await linkPage.getByText('불러오는 중').first().isVisible().catch(() => false);
    evidence.linkRender = { formVisible, errVisible, loadingStuck, url: generatedUrl };
    log('   링크 렌더 — 폼:', formVisible, '| 오류:', errVisible, '| 로딩멈춤:', loadingStuck);
    await linkPage.close();
  } else {
    log('4) 생성 URL 없음 → 렌더 실증 스킵');
  }

  evidence.consoleErrors = consoleErrors.slice(0, 20);
  evidence.netFailures = netFailures.slice(0, 20);
} catch (e) {
  log('❌ E2E 예외:', e.message);
  evidence.exception = e.message;
  await page.screenshot({ path: `${OUT}/99_exception.png`, fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  log('증거 저장:', `${OUT}/evidence.json`);
  log('스샷 디렉토리:', OUT);
  log('\n=== 요약 ===');
  log('create_token 응답:', JSON.stringify(evidence.createTokenResponse));
  log('생성 URL:', evidence.generatedUrl);
  log('링크 렌더:', JSON.stringify(evidence.linkRender));
  log('콘솔에러:', evidence.consoleErrors?.length || 0, '네트워크실패:', evidence.netFailures?.length || 0);
  await browser.close();
}
