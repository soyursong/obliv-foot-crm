/**
 * T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN
 * 고객관리 화면 — 생년월일 자동 표기 (RRN 파생). 김주연 총괄 요청.
 *
 * 핵심: customers.birth_date 있으면 우선, 없으면 서버 RPC(fn_customer_birthdates)가
 *       암호화된 rrn 을 서버측에서만 복호화 → YYMMDD + 세기코드로 생년월일(YYYY-MM-DD) 파생.
 *
 * ⚠️ PHI 가드(필수):
 *   - 클라이언트는 평문 rrn 을 절대 수신하지 않는다 (RPC 는 birth_date 만 반환).
 *   - 화면 생년월일 컬럼에 rrn 뒷자리·성별코드·13자리 평문 노출 0.
 *
 * AC-1: 고객관리 목록에 생년월일 컬럼 존재 + 값이 YYYY-MM-DD 또는 '-' 형식.
 * AC-2: 목록 로드 시 fn_customer_birthdates RPC 호출 발생.
 * AC-3: 생년월일 셀/화면에 13자리 주민번호 평문 미노출 (PHI guard).
 * AC-4: 고객 상세(행 클릭) 패널에 생년월일 표기 존재.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'test-admin@obliv-foot.com';
const ADMIN_PW = process.env.TEST_ADMIN_PW ?? 'testpassword';

async function login(page: import('@playwright/test').Page, email = ADMIN_EMAIL, pw = ADMIN_PW) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin**', { timeout: 10000 });
}

// 생년월일 표기 형식: YYYY-MM-DD 또는 '-' (미등록)
const YMD_OR_DASH = /^(\d{4}-\d{2}-\d{2}|-)$/;
// 주민번호 13자리 평문 패턴 (하이픈 유무 무관) — 화면에 절대 없어야 함
const RRN_PLAINTEXT = /\b\d{6}-?\d{7}\b/;

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 생년월일 컬럼 존재 + 값 형식(YYYY-MM-DD | '-')
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 고객관리 목록 생년월일 컬럼이 YYYY-MM-DD 또는 - 형식으로 표기', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1200); // debounce + RPC

  // 헤더에 생년월일 컬럼 존재
  await expect(page.locator('th', { hasText: '생년월일' }).first()).toBeVisible({ timeout: 5000 });

  const cells = page.locator('[data-testid="cust-birthdate"]');
  const n = await cells.count();
  if (n === 0) {
    test.skip(true, '고객 행 없음 — 데이터 의존 스킵');
    return;
  }
  for (let i = 0; i < Math.min(n, 10); i++) {
    const txt = (await cells.nth(i).innerText()).trim();
    expect(txt, `행 ${i} 생년월일 셀 형식`).toMatch(YMD_OR_DASH);
  }
  console.log(`✅ AC-1: 생년월일 셀 ${Math.min(n, 10)}개 형식 검증 통과`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: fn_customer_birthdates RPC 호출 발생
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 목록 로드 시 fn_customer_birthdates RPC 호출', async ({ page }) => {
  await login(page);

  const rpcCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/fn_customer_birthdates')) rpcCalls.push(req.url());
  });

  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1500);

  // 고객이 1명 이상일 때만 RPC 호출됨 (ids 비면 미호출)
  const rows = await page.locator('[data-testid="cust-birthdate"]').count();
  if (rows === 0) {
    test.skip(true, '고객 행 없음 — RPC 미호출 정상, 스킵');
    return;
  }
  expect(rpcCalls.length, 'fn_customer_birthdates RPC 호출 횟수').toBeGreaterThan(0);
  console.log(`✅ AC-2: RPC 호출 ${rpcCalls.length}건`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: PHI 가드 — 화면/생년월일 컬럼에 주민번호 13자리 평문 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 생년월일 컬럼·페이지에 주민번호 평문(13자리) 미노출', async ({ page }) => {
  await login(page);

  // RPC 응답 본문에 birth_date_display 외 rrn 흔적이 없는지 확인
  const rpcBodies: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/rest/v1/rpc/fn_customer_birthdates')) {
      try { rpcBodies.push(await res.text()); } catch { /* noop */ }
    }
  });

  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1500);

  const cells = page.locator('[data-testid="cust-birthdate"]');
  const n = await cells.count();
  for (let i = 0; i < Math.min(n, 20); i++) {
    const txt = (await cells.nth(i).innerText()).trim();
    expect(RRN_PLAINTEXT.test(txt), `행 ${i} 셀에 주민번호 평문`).toBe(false);
  }

  // RPC 응답 키는 customer_id / birth_date_display 만 — rrn/gender 흔적 0
  for (const body of rpcBodies) {
    expect(body.toLowerCase()).not.toContain('rrn');
    expect(body.toLowerCase()).not.toContain('gender');
    expect(RRN_PLAINTEXT.test(body), 'RPC 응답에 주민번호 평문').toBe(false);
  }
  console.log(`✅ AC-3: PHI 가드 — 셀 ${Math.min(n, 20)}개 + RPC 응답 ${rpcBodies.length}건 평문 0`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 고객 상세(행 클릭) 패널에 생년월일 표기
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 행 클릭 고객 상세 패널에 생년월일 표기 존재', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1200);

  const firstRow = page.locator('tbody tr').first();
  if ((await page.locator('[data-testid="cust-birthdate"]').count()) === 0) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }
  await firstRow.click();

  const birthLine = page.locator('[data-testid="cust-detail-birthdate"]');
  await expect(birthLine).toBeVisible({ timeout: 5000 });
  const txt = (await birthLine.innerText()).trim();
  // YYYY-MM-DD 또는 '생년월일 미등록' — 어느 쪽이든 주민번호 평문은 없어야 함
  expect(RRN_PLAINTEXT.test(txt), '상세 생년월일에 주민번호 평문').toBe(false);
  console.log(`✅ AC-4: 고객 상세 생년월일 표기 = "${txt}"`);
});
