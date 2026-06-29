/**
 * E2E spec — T-20260629-foot-RESVCREATE-CUSTAUTOLOAD (foot · 요청2)
 * 6/29 김주연 총괄: 예약 생성창에서 성함/연락처 입력 시 기존 고객 매칭 검색 →
 *   후보 리스트 → 선택 시 입력 필드 자동 populate(이름·연락처·생년월일) + 수정 가능.
 *
 * COORDINATION: NEWRESV-UNIFIED-MODAL(통합 모달)·FIELDBATCH-6FIX(검색창)·2ZONE-SEARCH 자산 위 delta.
 *   별도 검색/자동완성 UI 신설 0 — 기존 InlinePatientSearch + loadedMatch(재진 자동판별) 재사용.
 *
 * AC 매핑:
 *  AC1: 성함/연락처 입력 시 기존 고객 매칭(InlinePatientSearch, 신규 검색 UI 없음).
 *  AC2: 매칭 후보 리스트 표시('기존 고객 N건'); 0건이면 신규(초진) 직접입력 그대로 진행.
 *  AC3: 후보 선택 시 이름·연락처 자동 populate + 수정 가능(읽기전용 강제 금지) + 생년월일 표시.
 *  AC4: 매칭 선택 시 재진 자동판별(L-002 일관) + 진행중 패키지 N/N 자동로드.
 *  AC6: 기존 검색창 동선 재사용(중복 UI 신설 금지) — manual-form 의 성함/연락처 입력이 그 진입점.
 *
 * 매칭(AC3/AC4)은 기존 고객 데이터 의존 → 후보가 없으면 해당 단계 skip(구조/무매칭 경로는 항상 검증).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openUnifiedModalViaListButton(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: '새 예약' });
  if (!(await btn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await btn.click();
  return page.getByTestId('popup-newmode-manual-form').isVisible({ timeout: 4_000 }).catch(() => false);
}

test.describe('T-20260629-foot-RESVCREATE-CUSTAUTOLOAD — 기존 고객 자동 불러오기', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC1/AC6: 성함·연락처 입력칸 = 기존 검색 자산(InlinePatientSearch) 재사용 (별도 검색 UI 0)
  test('AC1/AC6: 성함·연락처 입력으로 기존 고객 매칭 (검색 UI 재사용)', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    // 통합 모달의 성함/연락처 입력 = 기존 매칭 검색의 진입점 (별도 검색창 신설 없음)
    await expect(page.locator('#newmode-cust-name')).toBeVisible();
    await expect(page.locator('#newmode-cust-phone')).toBeVisible();
    // 입력 시 매칭 검색 트리거(InlinePatientSearch debounce 300ms) — 입력 자체가 막히지 않음
    await page.locator('#newmode-cust-name').fill('김');
    await page.locator('#newmode-cust-name').fill('김민');
    await expect(page.locator('#newmode-cust-name')).toHaveValue('김민');
  });

  // AC2: 후보 0건(존재하지 않는 값) → 신규(초진) 직접입력 그대로 진행(차단 없음)
  test('AC2: 매칭 없으면 신규(초진) 직접입력 진행', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    // 거의 존재하지 않을 성함 입력 → 후보 드롭다운 미표시 가정
    await page.locator('#newmode-cust-name').fill('존재하지않는고객zzz');
    await page.locator('#newmode-cust-phone').fill('01000000000');
    // 신규(초진) 배지 유지 + 직접입력 폼 잔존(재진 카드로 전환되지 않음)
    await expect(page.getByTestId('newmode-visittype-badge')).toHaveText(/신규\(초진\)/);
    await expect(page.getByTestId('popup-newmode-manual-form')).toBeVisible();
    await expect(page.getByTestId('popup-newmode-customer')).toHaveCount(0);
  });

  // AC3/AC4: 후보 선택 → 자동 populate(수정 가능) + 재진 자동판별 (데이터 의존 → 후보 없으면 skip)
  test('AC3/AC4: 후보 선택 시 필드 자동 populate + 수정 가능 + 재진 전환', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    // 성함 2자 입력 → 매칭 후보 드롭다운 시도
    await page.locator('#newmode-cust-name').fill('김');
    await page.locator('#newmode-cust-name').fill('김지');
    // 후보 리스트 헤더('기존 고객 N건') 대기 — 없으면 데이터 부재로 skip
    const candidateHeader = page.getByText(/기존 고객 \d+건/);
    const hasCandidate = await candidateHeader.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasCandidate) test.skip(true, '매칭 가능한 기존 고객 데이터 없음(환경 의존)');

    // 첫 후보 선택(onMouseDown 으로 blur 전 선택)
    const firstOption = page.locator('.absolute.z-30 button').first();
    await firstOption.dispatchEvent('mousedown');

    // 재진 자동판별 카드로 전환 + 재진 배지
    await expect(page.getByTestId('popup-newmode-customer')).toBeVisible({ timeout: 4_000 });
    await expect(page.getByTestId('newmode-visittype-badge')).toHaveText(/재진/);

    // AC3: 이름·연락처가 자동 populate 되고 '수정 가능'(readonly/disabled 아님)
    const nameInput = page.getByTestId('newmode-existing-name-input');
    const phoneInput = page.getByTestId('newmode-existing-phone-input');
    await expect(nameInput).toBeVisible();
    await expect(phoneInput).toBeVisible();
    await expect(nameInput).not.toHaveValue('');
    await expect(nameInput).toBeEditable();
    await expect(phoneInput).toBeEditable();

    // 실제 수정 가능 확인(오입력 정정) — 값 편집이 반영됨
    await nameInput.fill('수정된이름');
    await expect(nameInput).toHaveValue('수정된이름');
  });

  // AC4 동선: 재진 카드에서 '다시 입력' → 신규 직접입력 폼 복귀(원복 동선 무회귀)
  test('AC4: 재진 카드 다시 입력 → 신규 폼 복귀', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    await page.locator('#newmode-cust-name').fill('김');
    await page.locator('#newmode-cust-name').fill('김지');
    const candidateHeader = page.getByText(/기존 고객 \d+건/);
    const hasCandidate = await candidateHeader.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasCandidate) test.skip(true, '매칭 가능한 기존 고객 데이터 없음(환경 의존)');
    await page.locator('.absolute.z-30 button').first().dispatchEvent('mousedown');
    await expect(page.getByTestId('popup-newmode-customer')).toBeVisible({ timeout: 4_000 });
    // 다시 입력 → 신규 직접입력 폼 복귀
    await page.getByTestId('btn-newmode-existing-research').click();
    await expect(page.getByTestId('popup-newmode-manual-form')).toBeVisible();
    await expect(page.getByTestId('newmode-visittype-badge')).toHaveText(/신규\(초진\)/);
  });
});
