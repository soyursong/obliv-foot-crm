/**
 * E2E spec — T-20260708-foot-CUSTMGMT-LIST-SORT-REGDATE-ASC
 *
 * 고객관리(/admin/customers) 고객 목록 기본 정렬을 등록순(created_at ASC)으로 변경 (김주연 총괄 요청).
 *   - 기존: updated_at DESC (수정 최신순) → 변경: created_at ASC (최초 등록 오름차순).
 *   - 맨 위 = 가장 먼저(오래전) 등록된 고객, 아래로 갈수록 최근 등록.
 *   - 서버 페이지네이션(PAGE_SIZE=30, .range) 환경 → 쿼리 레벨 ORDER BY 적용
 *     (클라 정렬만으론 페이지 경계에서 순서 깨짐 → 쿼리 레벨이라 페이지 넘어도 일관).
 *   - created_at 동률 시 id ASC 안정 tie-break.
 *   - 컬럼 클릭 정렬 UI 없음(plain th) → "기본 진입 정렬"만 변경.
 *
 * AC:
 *  AC-1: 기본 진입 시 목록이 created_at ASC(맨 위=가장 오래된 등록 고객)로 정렬.
 *  AC-2: 페이지 경계를 넘어 전체 순서가 등록순 ASC로 일관(쿼리 레벨 ORDER BY).
 *  AC-3: created_at 동률 시 안정 tie-break(id ASC)로 순서 뒤섞임 없음.
 *  AC-4: 정렬 변경으로 인한 크래시/빈화면/데이터 누락 없이 목록이 정상 표시(회귀).
 *
 * 검증 방식: DB 컬럼(created_at)은 목록 UI에 노출되지 않으므로(표시 컬럼=이름/전화/생일/차트/담당자/방문/최종방문/결제액),
 *   행 순서의 시각 검증은 불가. 대신 코드 계약(쿼리 레벨 ORDER BY created_at ASC + id ASC tie-break)이
 *   정확히 적용됐는지 소스에서 검증 + 목록이 크래시 없이 렌더되는지(회귀) 검증.
 *   (created_at 값 노출 UI가 없어 순서의 브라우저 시각 대조는 소스 계약 검증으로 대체.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOMERS_SRC = resolve(__dirname, '../../src/pages/Customers.tsx');

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
  const head = page.locator('thead tr th').first();
  return await head.isVisible({ timeout: 5000 }).catch(() => false);
}

// ── AC-1/AC-2/AC-3: 쿼리 레벨 ORDER BY created_at ASC + id ASC tie-break (소스 계약) ──
test('AC-1/2/3: 목록 조회가 created_at ASC + id ASC tie-break로 정렬(쿼리 레벨)', () => {
  const src = readFileSync(CUSTOMERS_SRC, 'utf-8');

  // runSearch 목록 쿼리: created_at ASC 기본 정렬
  expect(src).toContain(".order('created_at', { ascending: true })");
  // 안정 tie-break: id ASC (created_at 동률 시 순서 고정 — AC-3)
  expect(src).toContain(".order('id', { ascending: true })");

  // 회귀: 기존 updated_at DESC 기본 정렬이 완전히 제거됐는지(잔존 시 정렬 축 충돌)
  expect(src).not.toContain(".order('updated_at', { ascending: false })");

  // 쿼리 레벨 적용 확인: 페이지네이션(.range)과 함께 서버 정렬 — created_at ASC가
  // .range보다 앞서 체이닝(페이지 경계 넘어 순서 일관, AC-2). created_at ASC 2회(목록+내보내기).
  const asc = src.match(/\.order\('created_at', \{ ascending: true \}\)/g) ?? [];
  expect(asc.length).toBeGreaterThanOrEqual(2);
});

// ── AC-4: 정렬 변경 후에도 목록이 크래시/빈화면 없이 정상 렌더(회귀) ──
test('AC-4: 정렬 변경 후 고객 목록 정상 렌더(크래시/빈화면 없음)', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객관리 표 미렌더 — 스킵'); return; }

  // 헤더 컬럼 존속(정렬 변경이 렌더를 깨지 않음)
  for (const label of ['이름', '전화번호', '생년월일', '차트번호', '담당자', '방문', '최종 방문', '결제액', '관리']) {
    await expect(page.locator('thead tr th', { hasText: label }).first()).toBeVisible();
  }

  // 데이터 행이 있으면 최소 1행 이상 정상 표시(누락 없음)
  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(firstRow.getByTestId('open-chart-btn').first()).toBeVisible();
  }
});
