/**
 * T-20260630-foot-SIDEBAR-CUST-HEIGHT-FONT-HALF2
 * 사이드바 고객관리 식별정보 섹션 — baseline(3a7fabd, 직전 T-20260630-foot-SIDEBAR-LAYOUT-RRN-DOB) 대비
 * 세로높이·폰트·여백·아이콘을 동일 비율(~50%)로 추가 축소. 김주연 총괄 요청
 * ("세로 높이 지금보다 절반으로 폰트도 동일하게 축소").
 *
 * 대상 surface: 고객관리(/admin/customers) 행 클릭 시 우측 사이드바
 *   = CheckInDetailSheet customerMode 식별정보 섹션([data-testid="cust-info-section"]).
 *
 * baseline(3a7fabd): 폰트 text-[11px], 아이콘 h-3(12px), 행간 space-y-1(4px), 항목 gap-1(4px).
 * 본 티켓(HALF2): 폰트 text-[6px](원본 14px 대비 ~1/4·동일비율), 아이콘 h-1.5(6px),
 *                행간 space-y-0.5(2px), 항목 gap-0.5(2px). 중앙정렬·생년월일 RRN 파생 표기 동작 유지(회귀 0).
 *
 * 순수 FE(Tailwind 클래스만). RPC/쿼리/필드매핑 무변경. DB 무변경.
 *
 * AC-1: 행높이/여백 ~50%↓ — 식별정보 inner 블록 space-y-0.5 적용 + 항목 라인 gap 축소.
 * AC-2: 폰트 동일비율 ~50%↓ — 식별정보 라인 computed font-size ≈ 6px(≤ 8px, 직전 11px 대비 축소).
 * AC-3: [가독성 가드] 라벨·값 truncate/overflow/겹침 0 (섹션·각 라인 가로 overflow 0).
 * AC-4: [반응형 가드] 모바일(390)·태블릿(1024) 폭 파손 0 (가로 overflow 0).
 * AC-5(회귀): 중앙정렬(text-center) + 생년월일 RRN 파생 표기(RPC 호출·YYYY-MM-DD/미등록) 유지.
 * AC-6: PHI — 사이드바 섹션에 주민번호 13자리 평문 미노출(직전 가드 유지).
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'test-admin@obliv-foot.com';
const ADMIN_PW = process.env.TEST_ADMIN_PW ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

async function login(page: import('@playwright/test').Page, email = ADMIN_EMAIL, pw = ADMIN_PW) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin**', { timeout: 10000 });
}

const BIRTH_OK = /(\d{4}-\d{2}-\d{2}|생년월일 미등록)/;
const RRN_PLAINTEXT = /\b\d{6}-?\d{7}\b/;

/** 고객관리 첫 행 클릭으로 사이드바(customerMode) 오픈. 행 없으면 false(데이터 의존 스킵용). */
async function openSidebar(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1200); // debounce + RPC
  if ((await page.locator('[data-testid="cust-birthdate"]').count()) === 0) return false;
  await page.locator('tbody tr').first().click();
  await expect(page.locator('[data-testid="cust-info-section"]')).toBeVisible({ timeout: 5000 });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 행높이/여백 ~50%↓ — inner 블록 space-y-0.5 + 항목 라인 gap 축소
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 식별정보 inner 블록 행간 축소(space-y-0.5) 적용', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const section = page.locator('[data-testid="cust-info-section"]');
  await expect(section).toHaveClass(/space-y-0\.5/);

  // 생년월일 라인(항목) gap 축소: gap-0.5(2px) → computed column-gap ≤ 3px
  const gap = await page.locator('[data-testid="cust-detail-birthdate"]').evaluate(
    (el) => parseFloat(getComputedStyle(el).columnGap || '0'),
  );
  expect(gap, '항목 라인 column-gap(px)').toBeLessThanOrEqual(3);
  console.log(`✅ AC-1: space-y-0.5 적용 + 항목 gap=${gap}px (~50%↓)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 폰트 동일비율 ~50%↓ — 식별정보 라인 font-size ≈ 6px
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 식별정보 생년월일 라인 폰트 ~6px (직전 11px 대비 ~50%↓)', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const fontPx = await page.locator('[data-testid="cust-detail-birthdate"]').evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize),
  );
  // baseline 11px → ~6px. 안전 상한 8px(직전보다 분명히 작음).
  expect(fontPx, '식별정보 라인 font-size(px)').toBeLessThanOrEqual(8);
  expect(fontPx, '식별정보 라인 font-size(px)').toBeGreaterThan(0);
  console.log(`✅ AC-2: 식별정보 라인 font-size=${fontPx}px`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 가독성 가드 — 섹션·각 라인 가로 overflow/겹침 0
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 가독성 가드 — 식별정보 섹션·라인 가로 overflow 0', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const sectionOverflow = await page.locator('[data-testid="cust-info-section"]').evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(sectionOverflow, '섹션 가로 overflow(px)').toBeLessThanOrEqual(1);

  const lineOverflow = await page.locator('[data-testid="cust-detail-birthdate"]').evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(lineOverflow, '생년월일 라인 가로 overflow(px)').toBeLessThanOrEqual(1);
  console.log(`✅ AC-3: 섹션 overflow=${sectionOverflow}px, 라인 overflow=${lineOverflow}px (truncate/겹침 0)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 반응형 가드 — 모바일/태블릿 폭 파손 0
// ─────────────────────────────────────────────────────────────────────────────
for (const vp of [
  { name: '모바일', width: 390, height: 844 },
  { name: '태블릿(갤탭 근사)', width: 1024, height: 768 },
]) {
  test(`AC-4: ${vp.name}(${vp.width}px) 폭 식별정보 섹션 가로 overflow 0`, async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

    const overflow = await page.locator('[data-testid="cust-info-section"]').evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow, `${vp.name} 섹션 가로 overflow(px)`).toBeLessThanOrEqual(1);
    console.log(`✅ AC-4: ${vp.name} 폭 overflow=${overflow}px (미파손)`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-5(회귀): 중앙정렬 + 생년월일 RRN 파생 표기 유지
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 중앙정렬(text-center) + 생년월일 RRN 파생 표기 회귀 0', async ({ page }) => {
  await login(page);

  const rpcCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/fn_customer_birthdates')) rpcCalls.push(req.url());
  });

  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await page.waitForTimeout(1000);

  const section = page.locator('[data-testid="cust-info-section"]');
  await expect(section).toHaveClass(/text-center/);
  const align = await section.evaluate((el) => getComputedStyle(el).textAlign);
  expect(align, '섹션 text-align').toBe('center');

  const birthTxt = (await page.locator('[data-testid="cust-detail-birthdate"]').innerText()).trim();
  expect(birthTxt, '생년월일 라인 형식').toMatch(BIRTH_OK);

  expect(rpcCalls.length, 'fn_customer_birthdates RPC 호출(FE 평문 디코딩 없음)').toBeGreaterThan(0);
  console.log(`✅ AC-5: 중앙정렬 유지 + 생년월일="${birthTxt}" + RPC ${rpcCalls.length}건 (회귀 0)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: PHI 가드 — 사이드바 섹션에 주민번호 13자리 평문 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-6: PHI — 식별정보 섹션에 주민번호 평문(13자리) 미노출', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await page.waitForTimeout(800);

  const sectionTxt = (await page.locator('[data-testid="cust-info-section"]').innerText()).trim();
  expect(RRN_PLAINTEXT.test(sectionTxt), '식별정보 섹션에 주민번호 평문').toBe(false);
  console.log('✅ AC-6: PHI 가드 — 섹션 평문 0');
});
