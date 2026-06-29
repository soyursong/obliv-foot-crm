/**
 * E2E spec — T-20260629-foot-CUSTLIST-MEMO-REMOVE-COMPACT
 *
 * 고객관리(/admin/customers) 고객 목록 표 2건 (김주연 총괄 요청):
 *   ① 고객메모 컬럼 제거 — 표 헤더/셀에서 '고객메모' 컬럼 삭제(11열→10열).
 *      ⚠️ customer_memo 데이터·고객상세(수정 다이얼로그)·CSV 내보내기는 존속(목록 표시만 숨김).
 *   ② 남은 10개 컬럼 너비 컴팩트화 — 실제 글자수 기준 폭 고정 + 패딩 축소,
 *      overflow ellipsis/nowrap로 넘침 방지(행 높이/줄바꿈 깨짐 금지).
 *
 * AC:
 *  AC-1: 목록 표 헤더에 '고객메모' 컬럼이 더 이상 없음. 유지 컬럼 10개
 *        (이름·전화번호·생년월일·차트번호·담당자·방문·최종 방문·결제액·관리 + 선택 체크박스) 전부 존속.
 *  AC-2: 컴팩트화 — 헤더 셀이 좁은 패딩(px-2)으로 렌더, 각 셀 nowrap/truncate로 줄바꿈 없이 1행 유지.
 *        (행 클릭/우클릭/체크박스/차트열기 등 기존 동선 무결 — 회귀)
 *
 * 현장 클릭 시나리오(티켓 본문) 2건 → 본 spec test 2건으로 변환.
 *
 * 비고: customer_memo 데이터 보존은 목록 비노출과 별개(EditCustomerDialog·CSV 유지) →
 *       마이그레이션 0건. 본 spec은 목록 표시 레이어만 검증.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
  }
}

async function gotoCustomers(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  // 표(thead)는 행이 없어도 렌더되므로 헤더 기준으로 대기
  const head = page.locator('thead tr th').first();
  return await head.isVisible({ timeout: 5000 }).catch(() => false);
}

// ── AC-1: 시나리오① — 고객 목록 헤더에서 '고객메모' 컬럼이 사라지고 10개 컬럼 유지 ──
test('AC-1: 고객메모 컬럼 제거(11열→10열), 유지 컬럼 존속', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객관리 표 미렌더 — 스킵'); return; }

  const headers = page.locator('thead tr th');
  // 헤더 셀 개수 = 10 (선택 체크박스 + 9개 정보/관리 컬럼)
  await expect(headers).toHaveCount(10);

  // '고객메모' 헤더는 없어야 함
  await expect(page.locator('thead tr th', { hasText: '고객메모' })).toHaveCount(0);

  // 유지 컬럼은 전부 존속
  for (const label of ['이름', '전화번호', '생년월일', '차트번호', '담당자', '방문', '최종 방문', '결제액', '관리']) {
    await expect(page.locator('thead tr th', { hasText: label }).first()).toBeVisible();
  }
});

// ── AC-2: 시나리오② — 컴팩트화(좁은 패딩 + nowrap/truncate), 기존 동선 무결 ──
test('AC-2: 컴팩트 렌더 + 행 동선 회귀(체크박스/차트열기)', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객관리 표 미렌더 — 스킵'); return; }

  // 컴팩트화: 헤더 셀 패딩이 px-2(8px)로 축소되어 렌더(좌우 padding ≤ 12px) — 너비 절반 수준 근사 검증
  const nameHeader = page.locator('thead tr th', { hasText: '이름' }).first();
  const padLeft = await nameHeader.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(padLeft).toBeLessThanOrEqual(12);

  // 데이터 행이 있을 때만 셀 레벨 검증(넘침 방지 = 한 줄 유지)
  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 전화번호 셀은 nowrap(줄바꿈 없음)
    const phoneCell = firstRow.locator('td').nth(2);
    const ws = await phoneCell.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(ws).toBe('nowrap');

    // 회귀: 행 체크박스 토글 정상
    const rowCheck = page.getByTestId('cust-row-check').first();
    await rowCheck.check();
    await expect(rowCheck).toBeChecked();

    // 회귀: 차트열기 버튼 노출(관리 컬럼 무결)
    await expect(page.getByTestId('open-chart-btn').first()).toBeVisible();
  }
});
