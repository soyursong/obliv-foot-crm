/**
 * T-20260701-foot-PROGRESS-DOCISSUE-BTN — 경과분석 리스트 발행/일괄처리 버튼 (Phase 1: UI 배치)
 *
 * 검증 대상 (Phase 1 = 버튼 UI + 선택상태 관리만. 실 발행 로직은 Phase 2):
 *   시나리오 1: 개별 '발행하기' 버튼 노출 + 클릭 시 크래시 없음 (AC1, AC4)
 *   시나리오 2: 상단 '일괄처리' 버튼 + row 체크박스 다건 선택 + 선택개수 반영 + 전체선택 토글 (AC2, AC3, AC4)
 *   시나리오 3: 기존 경과분석 리스트 렌더/구조 회귀 없음 (AC5)
 *
 * 방어: 경과분석 대상자(rows)가 0명일 수 있음 → 버튼은 rows>0 일 때만 렌더.
 *   대상자 없을 때는 empty 상태 무파손만 검증(조건부 skip).
 *   [갱신] T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: 리스트 모집단 = 활성 패키지 6배수 도래 대상자
 *   (구 '당일 progress_check_required 예약'에서 변경). skip 게이트(rowCount===0)는 신 필터에서도 그대로 유효.
 *
 * READ-ONLY — DB 변경 없음(DDL0). 발행 클릭은 placeholder(준비 중 안내) — 실제 서류 발행 안 함.
 */

import { test, expect } from '@playwright/test';

// 상대경로 goto → playwright.config baseURL(8089 테스트 서버) 적용.
// storageState 는 desktop-chrome 프로젝트 기본값(config AUTH_FILE = .auth/user.json, auth.setup 인증본) 상속.
const TREATMENT_PATH = '/admin/treatment-table';

// 경과분석 탭으로 진입해 대상자 리스트 유무를 반환하는 헬퍼.
//   [갱신] T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME(C): '경과분석'이 최상위 탭(tab-progress) 하위의
//   서브탭(tab-progress-targets)으로 중첩됨 → 서브탭은 부모 탭이 활성일 때만 마운트된다.
//   따라서 최상위 tab-progress 를 먼저 클릭한 뒤 서브탭 tab-progress-targets 로 진입한다.
async function gotoProgressTab(page: import('@playwright/test').Page) {
  await page.goto(TREATMENT_PATH);
  await page.waitForLoadState('networkidle');
  // 최상위 '경과분석' 탭 먼저 활성화(getByTestId 는 정확일치 → 'tab-progress' ≠ 'tab-progress-targets').
  await page.getByTestId('tab-progress').click();
  await page.getByTestId('tab-progress-targets').click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('progress-targets-section')).toBeVisible();
  // [갱신] 비동기 쿼리(활성 패키지 6배수) 가 settle 될 때까지 결정론적으로 대기.
  //   구 fixed waitForTimeout(500) 은 데이터 로드 전 rowCount 를 읽어 race(0명 오판)를 유발했다.
  //   row 또는 empty 중 하나가 나타날 때까지(로딩 스피너 소멸) 기다린 뒤 count 를 읽는다.
  await expect(async () => {
    const rows = await page.getByTestId('progress-targets-row').count();
    const empty = await page.getByTestId('progress-targets-empty').count();
    expect(rows + empty).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
  return page.getByTestId('progress-targets-row');
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 개별 '발행하기' 버튼 (AC1, AC4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('개별 발행하기 버튼', () => {
  test('각 행에 발행하기 버튼 노출 + 클릭 시 크래시 없음', async ({ page }) => {
    const rows = await gotoProgressTab(page);
    const rowCount = await rows.count();
    test.skip(rowCount === 0, '6배수 도래 경과분석 대상자가 없어 버튼 검증 스킵');

    // AC1: 각 행에 발행하기 버튼 노출 (행 수 == 버튼 수)
    const issueBtns = page.getByTestId('progress-issue-btn');
    await expect(issueBtns).toHaveCount(rowCount);
    await expect(issueBtns.first()).toBeVisible();

    // AC4: 첫 행 클릭 → 오류/크래시 없이 placeholder 동작 (섹션 유지)
    await issueBtns.first().click();
    await expect(page.getByTestId('progress-targets-section')).toBeVisible();
    await expect(page.getByTestId('progress-targets-row').first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 일괄처리 버튼 + 다건 선택 (AC2, AC3, AC4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('일괄처리 다건 선택', () => {
  test('일괄처리 버튼 + 체크박스 다건 선택 + 선택개수 + 전체선택 토글', async ({ page }) => {
    const rows = await gotoProgressTab(page);
    const rowCount = await rows.count();
    test.skip(rowCount === 0, '6배수 도래 경과분석 대상자가 없어 일괄처리 검증 스킵');

    // AC2: 상단 일괄처리 버튼 노출 (선택 0건이므로 disabled)
    const bulkBtn = page.getByTestId('progress-bulk-action-btn');
    await expect(bulkBtn).toBeVisible();
    await expect(bulkBtn).toBeDisabled();

    // AC3: 각 행 체크박스 노출
    const checkboxes = page.getByTestId('progress-row-checkbox');
    await expect(checkboxes).toHaveCount(rowCount);

    // 1개 선택 → 선택개수 1 반영 + 일괄처리 활성화
    await checkboxes.first().check();
    await expect(page.getByTestId('progress-bulk-selected-count')).toHaveText(/선택 1명/);
    await expect(bulkBtn).toBeEnabled();

    // 2개 이상일 때 두 번째도 선택 → 선택개수 2 반영
    if (rowCount >= 2) {
      await checkboxes.nth(1).check();
      await expect(page.getByTestId('progress-bulk-selected-count')).toHaveText(/선택 2명/);
    }

    // AC3: 전체선택 클릭 → 전체 행 선택 (선택개수 == 행 수)
    const selectAll = page.getByTestId('progress-selectall-checkbox');
    await selectAll.check();
    await expect(page.getByTestId('progress-bulk-selected-count')).toHaveText(
      new RegExp(`선택 ${rowCount}명`),
    );
    for (let i = 0; i < rowCount; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    // 전체선택 해제 토글 → 전부 해제 (선택개수 배지 사라짐, 일괄처리 disabled)
    await selectAll.uncheck();
    await expect(page.getByTestId('progress-bulk-selected-count')).toHaveCount(0);
    await expect(bulkBtn).toBeDisabled();

    // AC4: 다시 1건 선택 후 일괄처리 클릭 → 크래시 없음
    await checkboxes.first().check();
    await bulkBtn.click();
    await expect(page.getByTestId('progress-targets-section')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 기존 기능 회귀 없음 (AC5)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('기존 경과분석 리스트 회귀 없음', () => {
  test('탭 진입 → 섹션 + (대상자 있으면) 테이블 헤더/셀 정상 렌더', async ({ page }) => {
    const rows = await gotoProgressTab(page);
    const rowCount = await rows.count();

    // 섹션은 항상 렌더 (대상자 유무 무관)
    await expect(page.getByTestId('progress-targets-section')).toBeVisible();

    if (rowCount === 0) {
      // 대상자 없음 → empty 상태 무파손
      await expect(page.getByTestId('progress-targets-empty')).toBeVisible();
      return;
    }

    // 기존 컬럼 셀(환자 이름 클릭영역 / 회차 / 다음 예약 / 담당자) 유지 확인
    //   [갱신] T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: '예약시간'(progress-time-cell) → '다음 예약'(progress-nextresv-cell) rename.
    await expect(page.getByTestId('progress-name-clickable').first()).toBeVisible();
    await expect(page.getByTestId('progress-label-cell').first()).toBeVisible();
    await expect(page.getByTestId('progress-nextresv-cell').first()).toBeVisible();
    await expect(page.getByTestId('progress-registrar-cell').first()).toBeVisible();
    // 대상 인원 배지 유지
    await expect(page.getByTestId('progress-targets-count')).toBeVisible();
  });
});
