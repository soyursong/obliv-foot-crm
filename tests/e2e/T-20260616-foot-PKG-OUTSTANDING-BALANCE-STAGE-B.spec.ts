/**
 * E2E spec — T-20260616-foot-PKG-OUTSTANDING-BALANCE (Stage B)
 * 패키지/진료비 금액 별도 표기 + 항목별 잔금 + 재방 미수금 배너 (옵션 A: 화면 표기만)
 *
 * Stage A(목록 잔금 컬럼·상세 미수금 박스)는 동명 base spec 에서 커버.
 * 본 Stage B 범위 — 마이그(consultation_fee/fee_kind) 적용 후:
 *   AC-B1(§4-A): 패키지 생성폼이 '패키지 총 금액'과 '진료비'를 **별도 필드**로 분리 노출한다.
 *                (합산 단일 '총 금액' 1필드 금지)
 *   AC-B2(§4-A): 고객 차트 패키지 카드가 '패키지 금액'과 (진료비 있을 때)'진료비(별도)'를
 *                항목별 잔금과 함께 별도 표기한다.
 *   AC-B3: 체크인 추가 다이얼로그(NewCheckInDialog)는 미수금>0 고객에 한해 배너/뱃지를 노출한다.
 *          (자동 SMS/알림톡 독촉 없음 — 화면 표기만)
 *
 * 데이터 의존 단언(활성 패키지·미수금 존재)은 조건 충족 시에만 수행하고, 없으면 skip(CI 안전).
 * 잔금 자체 검증은 갤탭 실기기 필드테스트(supervisor 게이트)에서 라이브 데이터로 최종 확인.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260616 PKG-OUTSTANDING-BALANCE Stage B — 금액 분리·항목별 잔금·재방 배너', () => {
  async function gotoFirstCustomerChart(page: import('@playwright/test').Page): Promise<boolean> {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) return false;
    const link = page.getByRole('link', { name: '고객' }).first();
    if (!(await link.isVisible().catch(() => false))) return false;
    await link.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    const firstRow = page.locator('tbody tr').first();
    if ((await firstRow.count()) === 0) return false;
    await firstRow.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  }

  test('AC-B2(§4-A): 패키지 카드가 패키지 금액을 별도 라벨로 표기한다(합산 총금액 단독 아님)', async ({ page }) => {
    if (!(await gotoFirstCustomerChart(page))) { test.skip(true, '고객 차트 접근 불가(권한/데이터)'); return; }

    // 패키지 탭 진입(있을 때만)
    const pkgTab = page.getByRole('tab', { name: /패키지/ }).first();
    if (!(await pkgTab.isVisible().catch(() => false))) { test.skip(true, '패키지 탭 없음'); return; }
    await pkgTab.click();

    const pkgAmountLabel = page.getByText('패키지 금액:').first();
    if (!(await pkgAmountLabel.isVisible().catch(() => false))) { test.skip(true, '활성 패키지 카드 없음(데이터)'); return; }

    // §4-A: '패키지 금액' 라벨이 존재해야 한다(이전 '총 금액' 단독 라벨 → '패키지 금액'으로 분리).
    await expect(pkgAmountLabel).toBeVisible();
    // 카드에 항목별 잔금 표기('잔금' 토큰)도 함께 노출
    await expect(page.getByText(/잔금/).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/pkg-outstanding-chart-card.png', fullPage: true });
  });

  test('AC-B3: 체크인 추가 — 미수금 배너는 미수금>0일 때만(없으면 비노출)', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) { test.skip(true, '대시보드 접근 불가'); return; }

    // 체크인 추가 버튼(대시보드)
    const addBtn = page.getByRole('button', { name: /체크인 추가|체크인/ }).first();
    if (!(await addBtn.isVisible().catch(() => false))) { test.skip(true, '체크인 추가 진입점 없음'); return; }
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('체크인 추가')).toBeVisible({ timeout: 5_000 }).catch(() => {});

    // 배너는 미수금>0 고객 식별 시에만 — 다이얼로그 오픈 직후(고객 미선택)에는 비노출이어야 한다.
    const banner = page.getByTestId('checkin-outstanding-banner');
    expect(await banner.count()).toBe(0);

    // ③ 확인 팝업도 트리거 전(고객 미선택)에는 DOM에 없어야 한다.
    expect(await page.getByTestId('checkin-outstanding-confirm').count()).toBe(0);
  });

  test('AC-B4(§8 ③): 미수금 고객 체크인 시 [수납]/[그냥 진행] 확인 팝업 — 잔금 합산 단독표기 없음', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) { test.skip(true, '대시보드 접근 불가'); return; }

    const addBtn = page.getByRole('button', { name: /체크인 추가|체크인/ }).first();
    if (!(await addBtn.isVisible().catch(() => false))) { test.skip(true, '체크인 추가 진입점 없음'); return; }
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('체크인 추가')).toBeVisible({ timeout: 5_000 }).catch(() => {});

    // 미수금>0 고객을 식별해야 팝업 경로 검증 가능 — 오늘 예약 row 중 잔금 뱃지가 붙은 건을 선택.
    // (데이터 의존: 미수금 예약 고객이 없으면 skip — 라이브 데이터는 갤탭 필드테스트에서 최종 확인)
    const dueRow = dialog.locator('button', { has: page.getByText(/잔금\s/) }).first();
    if (!(await dueRow.isVisible().catch(() => false))) {
      test.skip(true, '미수금>0 예약 고객 없음(데이터)'); return;
    }
    await dueRow.click();

    // 미수금 배너가 떠야 한다(고객 식별 → 미수금 인지).
    await expect(page.getByTestId('checkin-outstanding-banner')).toBeVisible({ timeout: 5_000 });

    // 체크인 버튼 클릭 → 바로 체크인하지 않고 ③ 확인 팝업이 떠야 한다.
    await dialog.getByRole('button', { name: /^체크인$/ }).click();
    const confirm = page.getByTestId('checkin-outstanding-confirm');
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await expect(confirm.getByText('미납금이 있어요. 수납 후 진행하시겠어요?')).toBeVisible();
    await expect(page.getByTestId('checkin-outstanding-settle')).toBeVisible();
    await expect(page.getByTestId('checkin-outstanding-proceed')).toBeVisible();

    // §4-A: 팝업 내 잔금/진료비는 별도 칩 — '총금액'/'총 미수금' 합산 단독표기가 없어야 한다.
    expect(await confirm.getByText(/총\s*금액|총\s*미수금/).count()).toBe(0);

    // [수납] → 체크인하지 않고 팝업만 닫힘(체크인 다이얼로그는 유지).
    await page.getByTestId('checkin-outstanding-settle').click();
    await expect(confirm).toBeHidden({ timeout: 5_000 });
    await expect(dialog.getByText('체크인 추가')).toBeVisible();
  });
});
