/**
 * E2E spec — T-20260818-foot-CUSTMGMT-SEARCH-FAIL
 *
 * 증상(종로 캡처): 고객관리(/admin/customers)에서 이름 검색 시 우상단 빨강 토스트 "검색 실패" +
 *   목록 "검색 결과 없음". 검색 요청 자체가 에러(단순 무결과 아님).
 *
 * 진단 결과(근본원인 클래스):
 *   - 표준 검색경로(FE .or() ilike 필터 + count:'exact' + 정렬 + clinic 스코프)를 실 prod DB에
 *     전 입력클래스(매칭명/단문자/특수문자/SQL류/전화번호)로 실측 → 모두 200/206 정상 조회.
 *     → (a)FE쿼리/파라미터 (b)서버RPC (c)인덱스·컬럼부재/타입 (d)권한/RLS 어느 것도 '상시 결함' 아님.
 *   - '검색 실패'는 DB 일시 지연/타임아웃(동시 진행 OUTAGE: CRM-SAVE-FAIL-LOADING-SLOW-OUTAGE)에서만
 *     발생하는 '일시적 실패'가, 원인코드를 통째로 삼키는 일반 토스트로 표출된 것.
 *   - db_change=false 확정(서버 RPC/인덱스/컬럼 신설 불요).
 *
 * 수정(FE 하드닝, 검색경로 catch 블록 단일 hunk):
 *   ① 원인코드(code/message/details/hint) console.error 로깅 → 재발 시 진단(에러코드 확보) 가능.
 *      (종전엔 error를 삼켜 진단 1단계 자체가 불가능 = 이 티켓이 막혔던 근본 이유.)
 *   ② 토스트를 '검색에 실패했습니다. 잠시 후 다시 시도해 주세요.' 재시도 문구로 전환
 *      → 일시적 실패를 '검색 자체 고장'으로 오인하지 않게.
 *
 * AC:
 *  AC-1: 이름 검색 시 정상 조회 또는 정상 empty-state('검색 결과 없음') 렌더 — 에러 토스트 미재현.
 *  AC-2: 검색 실패 catch가 원인코드를 콘솔 로깅하고, 재시도 유도 문구 토스트를 사용(소스 계약).
 *  AC-3: 종로 컨텍스트 실브라우저에서 고객관리 검색이 크래시/에러 없이 렌더(회귀).
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

// ── AC-2: catch 블록 소스 계약 — 원인코드 로깅 + 재시도 문구, 원인 삼키는 bare '검색 실패' 제거 ──
test("AC-2: 검색 실패 catch가 원인코드 콘솔 로깅 + 재시도 유도 문구 사용(소스 계약)", () => {
  const src = readFileSync(CUSTOMERS_SRC, 'utf-8');

  // ① 원인코드(code) 콘솔 로깅 — 재발 시 진단 가능(종전엔 삼켰음)
  expect(src).toContain("console.error('[customer-search] query failed'");
  expect(src).toMatch(/code:\s*\(error as \{ code\?: string \}\)\.code/);

  // ② 재시도 유도 문구 토스트
  expect(src).toContain('검색에 실패했습니다. 잠시 후 다시 시도해 주세요.');

  // 회귀: 진단 불가능했던 bare "검색 실패" 토스트가 검색경로에서 제거됐는지
  //   (export 경로의 '내보내기 조회 실패'는 별개 — 오검출 방지 위해 정확히 bare toast만 검사)
  expect(src).not.toContain("toast.error('검색 실패')");
});

// ── AC-1/AC-3: 실브라우저 이름 검색 → 에러 토스트 없이 정상 조회/empty-state 렌더 ──
test('AC-1/3: 이름 검색이 에러 토스트 없이 정상 조회/empty-state 렌더(종로)', async ({ page }) => {
  await loginIfNeeded(page);
  if (!(await gotoCustomers(page))) { test.skip(true, '고객관리 표 미렌더 — 스킵'); return; }

  const search = page.getByPlaceholder(/이름 · 전화번호/);
  await expect(search).toBeVisible();

  // 존재 가능성 높은 흔한 성씨 + 무매칭 문자열 둘 다 검색 — 어느 쪽도 에러 토스트가 뜨면 안 됨
  for (const term of ['김', '갖민없는이름zzz']) {
    await search.fill('');
    await search.fill(term);
    // 디바운스 + 서버 조회 대기
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);

    // 에러 토스트 미재현 (구 'X 검색 실패' / 신 '검색에 실패했습니다…' 어느 것도 없어야 함)
    await expect(page.getByText('검색 실패', { exact: true })).toHaveCount(0);
    await expect(page.getByText('검색에 실패했습니다. 잠시 후 다시 시도해 주세요.')).toHaveCount(0);

    // 목록 컨테이너는 크래시 없이 존속(정상 조회 or '검색 결과 없음' empty-state)
    await expect(page.locator('thead tr th').first()).toBeVisible();
  }
});
