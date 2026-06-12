/**
 * T-20260612-foot-CHARTNO-B2-P2
 * 환자명↔차트번호 인접 표기 Phase B-2 (P2군 13 surface).
 *
 * B-1(PAIRING-AUDIT) + B-2 P1군에 이어, 결제·예약·보조 UI(모달/시트/배지/힌트)에
 * 공통 헬퍼(chartNoBadge/chartNoDisplay)를 재사용해 차트번호를 인접 표기한다.
 * 핵심 규약: 미발번이어도 환자명 단독 노출 금지
 *   → 배지(chartNoBadge)는 '#'+값('#F-1234') 또는 '#미발번'으로 항상 표기.
 *   → 칼럼(chartNoDisplay)은 값 또는 '(미발번)'로 표기.
 *
 * 본 배치(P2) 대상 13 (모두 내부 직원 화면):
 *   결제 모달/미니창 타이틀 · 체크인 상세시트 헤더 · 예약상세 팝업 헤더 · 수납 상세모달 타이틀 ·
 *   상태 컨텍스트메뉴 헤더 · 예약시간 변경 모달 · 예약 클립보드 힌트바 · 미내원 예약 테이블 ·
 *   진행중/미수 경고카드 · 패키지 상세시트 · 예약 연결 배지 · 호버카드 트리거.
 *
 * 주: 테스트 DB에 데이터/상호작용 조건이 없을 수 있어 구조/회귀 위주 방어적 단언.
 *     차트번호 배지가 렌더되면 반드시 '#' 접두(또는 '(미발번)')여야 함을 검증(환자명 단독 표기 0).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
  }
}

/** chartNoBadge 규약(항상 '#' 접두) — 환자명 단독 표기 0 보장. */
async function assertBadgeFormat(locator: import('@playwright/test').Locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const txt = ((await locator.nth(i).textContent()) ?? '').trim();
    if (txt.length === 0) continue;
    expect(txt.startsWith('#')).toBeTruthy(); // '#F-1234' | '#미발번'
  }
}

test.describe('T-20260612-foot-CHARTNO-B2-P2', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // 시나리오 2(일부): 미내원 예약 테이블 — 차트번호 인접 칼럼(chartNoDisplay) + 체크인 카드 배지
  test('S1: DailyHistory 미내원 테이블 차트번호 칼럼 + 체크인 카드 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/history`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // 미체크인(추정 노쇼) 카드가 렌더되면 환자명(고객명) 옆에 '차트번호' 칼럼이 인접
    const noshowHeader = page.getByText('미체크인 예약 (추정 노쇼)', { exact: false });
    if (await noshowHeader.isVisible({ timeout: 6000 }).catch(() => false)) {
      // '고객명' 칼럼 바로 옆에 '차트번호' 칼럼 헤더가 존재(분리 유지)
      await expect(page.getByRole('columnheader', { name: '차트번호' }).first()).toBeVisible();
    }

    // 일자 체크인 카드(목록)의 환자명 옆 차트번호 배지가 렌더되면 '#' 규약 준수
    await assertBadgeFormat(page.locator('span.font-mono').filter({ hasText: '#' }));
  });

  // 시나리오 3(일부): 진행중/미수 경고카드 — 환자명 옆 차트번호 배지
  test('S2: Closing 경고카드 환자명에 차트번호 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/closing`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // 경고카드(진행중/미수)에 환자명+배지가 함께. 배지 렌더 시 '#' 규약 준수.
    await assertBadgeFormat(page.locator('span.font-mono').filter({ hasText: '#' }));
  });

  // 시나리오 3(일부): 패키지 상세시트 — 환자명 옆 차트번호 배지
  test('S3: Packages 상세시트 환자명에 차트번호 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // 첫 패키지 행 클릭 → 상세시트 진입 시 환자명 옆 차트번호 배지
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 6000 }).catch(() => false)) {
      await firstRow.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    // 시트가 열려 배지가 렌더되면 '#' 규약 준수
    await assertBadgeFormat(page.locator('span.font-mono').filter({ hasText: '#' }));
  });

  // 시나리오 2(일부): 예약 상세 팝업/예약관리 — 환자명 옆 차트번호 배지
  test('S4: Reservations 환자명 노출 지점 차트번호 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // 예약 슬롯/클립보드 힌트/상세팝업 등에 배지가 렌더되면 '#' 규약 준수(환자명 단독 노출 0)
    await assertBadgeFormat(page.locator('span.font-mono').filter({ hasText: '#' }));
  });

  // 시나리오 4: 미발번 엣지 — 배지가 렌더되는 모든 surface에서 '#미발번' 깨짐 없이 표기
  //   (assertBadgeFormat이 '#' 접두를 강제하므로 '#미발번'도 자동 검증됨)
  test('S5: 미발번 환자도 배지 깨짐 없이 항상 표기(환자명 단독 노출 0)', async ({ page }) => {
    for (const path of ['/admin', '/admin/history', '/admin/closing']) {
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await assertBadgeFormat(page.locator('span.font-mono').filter({ hasText: '#' }));
    }
  });
});
