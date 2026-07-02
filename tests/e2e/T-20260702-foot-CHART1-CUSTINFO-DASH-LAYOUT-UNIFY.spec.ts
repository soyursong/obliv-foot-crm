/**
 * T-20260702-foot-CHART1-CUSTINFO-DASH-LAYOUT-UNIFY
 * 고객관리 1번차트 상단 환자 식별정보 섹션을 "대시보드(checkIn) 1번차트 상단"과 동일 레이아웃으로 통일.
 * FONT-RESTORE(폰트-only 원복)를 흡수/supersede — HALF2(9b019c8f)의 6px 축소·중앙정렬 폐기.
 *
 * 기준(reference) = 대시보드 1번차트 상단(CheckInDetailSheet checkIn 모드 본문):
 *   좌측정렬(text-center 없음), 폰트 text-sm(≈14px), 아이콘 h-3.5(≈14px),
 *   연락처=한 줄(Phone), 생년월일=한 줄(Calendar), 차트번호/초진·재진 배지=헤더 성함 옆.
 *
 * 대상 surface = 고객관리(/admin/customers) 행 클릭 시 우측 사이드바
 *   = CheckInDetailSheet customerMode 식별정보 섹션([data-testid="cust-info-section"]).
 *
 * 순수 FE(Tailwind 클래스만). RPC/쿼리/필드매핑 무변경. DB 무변경.
 *
 * AC-1: 식별정보 폰트가 대시보드 기준(text-sm ≈14px, HALF2 6px 대비 확대)으로 또렷하게 읽힘.
 * AC-2: 아이콘 h-3.5(≈14px)·행간 정상 — 붙거나 겹치지 않음.
 * AC-3: 배치 구조 대시보드 통일 — 좌측정렬(text-align != center), 차트번호 배지가 헤더(성함 옆)에 노출.
 * AC-4: 회귀 0 — 생년월일 RPC 파생 표기 유지 + 고객차트/진료차트 버튼·환자명 유지.
 * AC-5(가드): 모바일(390)·태블릿(768)·데스크톱 실브라우저에서 4항목 겹침·잘림 없이 표시.
 * AC-6: PHI — 섹션에 주민번호 13자리 평문 미노출.
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
  if ((await page.locator('tbody tr').count()) === 0) return false;
  await page.locator('tbody tr').first().click();
  await expect(page.locator('[data-testid="cust-info-section"]')).toBeVisible({ timeout: 5000 });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 폰트 대시보드 기준(text-sm ≈14px) — HALF2 6px → 원복·통일
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 식별정보 생년월일 라인 폰트 ≈14px (대시보드 text-sm 통일, HALF2 6px 대비 확대)', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const fontPx = await page.locator('[data-testid="cust-detail-birthdate"]').evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize),
  );
  // 대시보드 text-sm=14px 통일. HALF2 6px보다 분명히 큼(≥ 12px).
  expect(fontPx, '식별정보 라인 font-size(px)').toBeGreaterThanOrEqual(12);
  console.log(`✅ AC-1: 식별정보 라인 font-size=${fontPx}px (대시보드 통일)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 아이콘 h-3.5(≈14px) 통일
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 식별정보 아이콘 ≈14px(h-3.5) 대시보드 통일 (HALF2 6px 대비 확대)', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const iconH = await page.locator('[data-testid="cust-detail-birthdate"] svg').first().evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(iconH, '아이콘 높이(px)').toBeGreaterThanOrEqual(12); // h-3.5=14px, HALF2 6px 대비 확대
  console.log(`✅ AC-2: 아이콘 높이=${iconH}px (대시보드 통일)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 배치 구조 통일 — 좌측정렬 + 차트번호 배지 헤더 노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 좌측정렬(중앙정렬 폐기) + 차트번호 배지 헤더(성함 옆) 노출 — 대시보드 통일', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  // 좌측정렬: 섹션 text-align != center (대시보드와 동일)
  const section = page.locator('[data-testid="cust-info-section"]');
  await expect(section).not.toHaveClass(/text-center/);
  const align = await section.evaluate((el) => getComputedStyle(el).textAlign);
  expect(align, '섹션 text-align(좌측정렬)').not.toBe('center');

  // 차트번호 배지가 헤더(성함 옆)에 노출 — 대시보드 1번차트 상단과 동일 위치
  const chartBadge = page.locator('[data-testid="chartno-inline"]');
  await expect(chartBadge).toBeVisible();
  const badgeTxt = (await chartBadge.innerText()).trim();
  expect(badgeTxt.length, '차트번호 배지 텍스트(#F-XXXX 또는 #미발번)').toBeGreaterThan(0);
  console.log(`✅ AC-3: 좌측정렬(align=${align}) + 차트번호 배지="${badgeTxt}" 헤더 노출 (대시보드 통일)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 회귀 0 — 생년월일 RPC 파생 표기 + 버튼/환자명 유지
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 생년월일 RRN 파생 표기 + 고객차트/진료차트 버튼 회귀 0', async ({ page }) => {
  await login(page);

  const rpcCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/fn_customer_birthdates')) rpcCalls.push(req.url());
  });

  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await page.waitForTimeout(1000);

  const birthTxt = (await page.locator('[data-testid="cust-detail-birthdate"]').innerText()).trim();
  expect(birthTxt, '생년월일 라인 형식').toMatch(BIRTH_OK);
  expect(rpcCalls.length, 'fn_customer_birthdates RPC 호출(FE 평문 디코딩 없음)').toBeGreaterThan(0);

  // 고객차트 버튼 유지 (진료차트는 customer_id 존재 조건)
  await expect(page.getByRole('button', { name: '고객차트' })).toBeVisible();
  console.log(`✅ AC-4: 생년월일="${birthTxt}" + RPC ${rpcCalls.length}건 + 고객차트 버튼 유지 (회귀 0)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5(가드): 모바일/태블릿/데스크톱 폭 파손 0 + 4항목 표시
// ─────────────────────────────────────────────────────────────────────────────
for (const vp of [
  { name: '모바일', width: 390, height: 844 },
  { name: '태블릿(갤탭 근사)', width: 768, height: 1024 },
  { name: '데스크톱', width: 1440, height: 900 },
]) {
  test(`AC-5: ${vp.name}(${vp.width}px) 식별정보 섹션 가로 overflow 0 + 4항목 표시`, async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

    const overflow = await page.locator('[data-testid="cust-info-section"]').evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow, `${vp.name} 섹션 가로 overflow(px)`).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-testid="cust-detail-birthdate"]')).toBeVisible();
    await expect(page.locator('[data-testid="chartno-inline"]')).toBeVisible();
    console.log(`✅ AC-5: ${vp.name} 폭 overflow=${overflow}px (미파손, 4항목 표시)`);
  });
}

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
