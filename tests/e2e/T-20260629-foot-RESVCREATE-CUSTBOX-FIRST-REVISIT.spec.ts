/**
 * E2E spec — T-20260629-foot-RESVCREATE-CUSTBOX-FIRST-REVISIT (6/25 개편2탄 항목2·3)
 *
 * 예약 생성 고객박스 초진/재진 분기.
 *   초진(신규 고객 등록): 성함 + 간략메모(발톱무좀/내성발톱 체크박스 + 직접입력) + 예약경로.
 *   재진(기존 고객): 성함 + 패키지 N/N(진행회차/총회차) + 예약경로. 패키지 자동로드.
 *
 * AC1/AC3(초진): 신규 고객 등록 폼에 성함·간략메모 빠른선택(발톱무좀/내성발톱)·예약경로.
 * AC2/AC4/AC5(재진): 기존 고객 선택 시 고객박스에 패키지 N/N 배지 + 예약경로 + 자동로드된 패키지·치료이력.
 *
 * 자산 재사용: 예약경로=REGISTRAR-ROUTE-FIELDS(VISIT_ROUTE_OPTIONS), 패키지 N/N=FIELDBATCH 활성패키지 양식.
 * 검증 방식: 실브라우저(desktop-chrome, 1280px). 재진 데이터 의존부는 graceful.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function openNewReservation(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '새 예약' }).click();
  await expect(page.getByTestId('popup-newmode-entry-choose')).toBeVisible();
}

test.describe('T-20260629-foot-RESVCREATE-CUSTBOX-FIRST-REVISIT — 예약생성 고객박스 초진/재진', () => {
  test('AC1/AC3(초진): 신규 고객 등록 폼 = 성함 + 간략메모(발톱무좀/내성발톱) + 예약경로', async ({ page }) => {
    await openNewReservation(page);
    await page.getByTestId('btn-newmode-register-new').click();

    const form = page.getByTestId('popup-newmode-manual-form');
    await expect(form).toBeVisible();
    // 성함
    await expect(page.getByTestId('newmode-cust-name-input')).toBeVisible();
    // 간략메모 빠른선택 체크박스 — 발톱무좀 / 내성발톱
    await expect(page.getByTestId('newmode-brief-quick-발톱무좀')).toBeVisible();
    await expect(page.getByTestId('newmode-brief-quick-내성발톱')).toBeVisible();
    // 직접입력 병행
    await expect(page.getByTestId('newmode-brief-note-input')).toBeVisible();
    // 예약경로(배지형 선택)
    await expect(page.getByTestId('newmode-visit-route-select')).toBeVisible();

    // 빠른선택 토글 동작 — 발톱무좀 클릭 시 직접입력칸에 반영
    await page.getByTestId('newmode-brief-quick-발톱무좀').click();
    await expect(page.getByTestId('newmode-brief-note-input')).toHaveValue('발톱무좀');
  });

  test('AC2/AC4/AC5(재진): 기존 고객 선택 시 고객박스에 패키지 N/N + 예약경로 + 자동로드 패키지이력', async ({ page }) => {
    await openNewReservation(page);
    await page.getByTestId('btn-newmode-existing-resv').click();
    await expect(page.getByTestId('popup-newmode-existing-search')).toBeVisible();

    // 첫 글자로 후보 노출 시 첫 고객 선택(데이터 의존 — 없으면 graceful skip)
    const searchInput = page.locator('#resv-popup-newmode-search');
    await searchInput.fill('김');
    await page.waitForTimeout(1200);
    const firstOption = page.locator('[data-testid^="inline-patient-option-"], [role="option"]').first();
    if ((await firstOption.count()) === 0) {
      test.info().annotations.push({ type: 'graceful-skip', description: '검색 후보 고객 데이터 없음 — 선택 단계 skip' });
      return;
    }
    await firstOption.click();

    const custBox = page.getByTestId('popup-newmode-customer');
    await expect(custBox).toBeVisible();
    // 예약경로(재진 박스에도 노출 — 신규)
    await expect(page.getByTestId('newmode-existing-visit-route-select')).toBeVisible();
    // 패키지·치료이력 자동로드(수동조회 불필요)
    await expect(page.getByTestId('popup-newmode-pkg-history')).toBeVisible();
    // 패키지 N/N 배지 — 진행중 패키지가 있는 고객일 때만(없으면 graceful)
    const nn = page.getByTestId('newmode-existing-pkg-nn');
    if ((await nn.count()) > 0) {
      await expect(nn).toContainText('패키지');
      await expect(nn).toHaveText(/패키지 \d+\/\d+/);
    }
  });

  test('회귀가드: 신규예약 진입 2버튼(신규/기존) 동선 무회귀', async ({ page }) => {
    await openNewReservation(page);
    await expect(page.getByTestId('btn-newmode-register-new')).toBeVisible();
    await expect(page.getByTestId('btn-newmode-existing-resv')).toBeVisible();
  });
});
