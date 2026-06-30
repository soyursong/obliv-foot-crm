/**
 * T-20260630-foot-SIDEBAR-LAYOUT-RRN-DOB
 * 사이드바 고객관리 섹션 — 레이아웃 축소·중앙정렬 + 생년월일 RRN 파생 표기 (사이드바 한정). 김주연 총괄 요청.
 *
 * 대상 surface: 고객관리(/admin/customers) 행 클릭 시 우측으로 열리는 사이드바
 *   = CheckInDetailSheet customerMode 의 식별정보 섹션([data-testid="cust-info-section"]).
 *
 * 요청1(순수 UI): 식별정보 섹션 폰트 ~절반 축소(text-[11px])·행간 촘촘(space-y-1)·
 *                항목명/값 수평 중앙정렬(text-center, justify-center). 모바일/태블릿 미파손.
 * 요청2(RRN 파생): 주민번호 보유 고객 생년월일 자동 표기 — 기존 서버 RPC(fn_customer_birthdates) 재사용.
 *
 * ⚠️ PHI 가드(필수):
 *   - 클라이언트는 평문 rrn 을 절대 수신하지 않는다 (RPC 는 birth_date_display 만 반환).
 *   - 사이드바 어디에도 rrn 뒷자리·성별코드·13자리 평문 노출 0.
 *
 * AC-1: 사이드바 식별정보 섹션 존재 + 중앙정렬(text-center) 적용.
 * AC-2: 생년월일 라인 존재 + 값이 YYYY-MM-DD 또는 '생년월일 미등록'. RRN 보유 고객은 RPC 파생 자동표기.
 * AC-3: 행 클릭 사이드바 오픈 시 fn_customer_birthdates RPC 호출 발생.
 * AC-4: PHI — 사이드바 섹션/페이지에 주민번호 13자리 평문 미노출.
 * AC-5(회귀): 데스크탑/태블릿 폭에서 사이드바 식별정보 섹션 레이아웃 미파손(가로 overflow 없음).
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

// 생년월일 표기: YYYY-MM-DD 또는 '생년월일 미등록'
const BIRTH_OK = /(\d{4}-\d{2}-\d{2}|생년월일 미등록)/;
// 주민번호 13자리 평문 패턴 (하이픈 유무 무관) — 화면에 절대 없어야 함
const RRN_PLAINTEXT = /\b\d{6}-?\d{7}\b/;

/** 고객관리 첫 행 클릭으로 사이드바(customerMode) 오픈. 행 없으면 null 반환(데이터 의존 스킵용). */
async function openSidebar(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1200); // debounce + RPC
  if ((await page.locator('[data-testid="cust-birthdate"]').count()) === 0) return false;
  await page.locator('tbody tr').first().click();
  await expect(page.locator('[data-testid="cust-info-section"]')).toBeVisible({ timeout: 5000 });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 사이드바 식별정보 섹션 존재 + 중앙정렬
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 사이드바 식별정보 섹션 중앙정렬(text-center) 적용', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const section = page.locator('[data-testid="cust-info-section"]');
  await expect(section).toHaveClass(/text-center/);

  // 라벨/값 수평 중앙정렬: 섹션 컨테이너의 computed text-align = center
  const align = await section.evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe('center');
  console.log('✅ AC-1: 식별정보 섹션 text-align=center');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 생년월일 라인 존재 + 형식(RRN 파생 자동표기 포함)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 사이드바 생년월일 라인 YYYY-MM-DD 또는 미등록 표기', async ({ page }) => {
  await login(page);
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const birthLine = page.locator('[data-testid="cust-detail-birthdate"]');
  await expect(birthLine).toBeVisible({ timeout: 5000 });
  const txt = (await birthLine.innerText()).trim();
  expect(txt, '생년월일 라인 형식').toMatch(BIRTH_OK);
  console.log(`✅ AC-2: 사이드바 생년월일 = "${txt}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 사이드바 오픈 시 fn_customer_birthdates RPC 호출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 사이드바 오픈 시 fn_customer_birthdates RPC 호출(RRN 서버 파생)', async ({ page }) => {
  await login(page);

  const rpcCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/fn_customer_birthdates')) rpcCalls.push(req.url());
  });

  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await page.waitForTimeout(1000);

  expect(rpcCalls.length, 'fn_customer_birthdates RPC 호출 횟수').toBeGreaterThan(0);
  console.log(`✅ AC-3: RPC 호출 ${rpcCalls.length}건 (FE 평문 디코딩 없음)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: PHI 가드 — 사이드바/페이지에 주민번호 13자리 평문 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 사이드바 식별정보 섹션에 주민번호 평문(13자리) 미노출', async ({ page }) => {
  await login(page);

  const rpcBodies: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/rest/v1/rpc/fn_customer_birthdates')) {
      try { rpcBodies.push(await res.text()); } catch { /* noop */ }
    }
  });

  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }
  await page.waitForTimeout(800);

  const sectionTxt = (await page.locator('[data-testid="cust-info-section"]').innerText()).trim();
  expect(RRN_PLAINTEXT.test(sectionTxt), '식별정보 섹션에 주민번호 평문').toBe(false);

  // RPC 응답에 rrn/gender 흔적 0
  for (const body of rpcBodies) {
    expect(body.toLowerCase()).not.toContain('rrn');
    expect(body.toLowerCase()).not.toContain('gender');
    expect(RRN_PLAINTEXT.test(body), 'RPC 응답에 주민번호 평문').toBe(false);
  }
  console.log(`✅ AC-4: PHI 가드 — 섹션 평문 0 + RPC 응답 ${rpcBodies.length}건 평문 0`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5(회귀): 태블릿/데스크탑 폭에서 사이드바 식별정보 섹션 미파손(가로 overflow 0)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 태블릿 폭에서 사이드바 식별정보 섹션 가로 overflow 없음', async ({ page }) => {
  await login(page);
  // 갤탭 가로 근사(태블릿)
  await page.setViewportSize({ width: 1024, height: 768 });
  if (!(await openSidebar(page))) { test.skip(true, '고객 행 없음 — 스킵'); return; }

  const overflow = await page.locator('[data-testid="cust-info-section"]').evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(overflow, '식별정보 섹션 가로 overflow(px)').toBeLessThanOrEqual(1);
  console.log(`✅ AC-5: 태블릿 폭 가로 overflow=${overflow}px (미파손)`);
});
