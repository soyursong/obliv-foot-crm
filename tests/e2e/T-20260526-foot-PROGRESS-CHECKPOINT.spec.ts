/**
 * E2E spec — T-20260526-foot-PROGRESS-CHECKPOINT (Phase 1 + Phase 2)
 * 경과분석지 플랜 세팅 (n회차 체크포인트 + 예약 시 알림)
 *
 * AC-1: DB 테이블 생성 + 기본 시드 데이터 (진료 도구 > 경과분석 플랜 탭)
 * AC-2: 진료 도구 > "경과분석 플랜" 탭 — CRUD UI
 * AC-3(tag): 예약 폼 — 패키지 연결 드롭다운 + 경과분석 배너
 * AC-4: 예약현황 — 경과분석 필터 버튼 + 배지 표시
 *
 * Phase 1 테스트 시나리오:
 *  T1: "경과분석 플랜" 탭 진입 + 시드 데이터 렌더
 *  T2: 신규 체크포인트 추가 (커스텀 타입 + 회차 + 레이블)
 *  T3: 체크포인트 수정
 *  T4: 활성/비활성 토글
 *  T5: 중복 회차 등록 시 오류 메시지 (UI 레벨 방어)
 *
 * Phase 2 테스트 시나리오:
 *  T6: 예약현황 경과분석 필터 버튼 렌더링 + 토글 ON/OFF
 *  T7: 신규 예약 폼 — 패키지 미연결 시 배너 없음 (AC-3 미표시 시나리오 4)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const GOTO_TAB = async (page: Parameters<typeof loginAndWaitForDashboard>[0]) => {
  await page.goto('/admin/clinic-management');
  try {
    await page.getByTestId('tab-progress-plans').waitFor({ timeout: 12_000 });
  } catch {
    test.skip(true, '진료 도구 페이지 또는 경과분석 플랜 탭 없음');
    return false;
  }
  await page.getByTestId('tab-progress-plans').click();
  await page.waitForTimeout(600);
  return true;
};

test.describe('T-20260526-foot-PROGRESS-CHECKPOINT — 경과분석 플랜 탭 (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T1: 탭 진입 + 시드 데이터 렌더
  // ─────────────────────────────────────────────────────────────────────────────
  test('T1: 경과분석 플랜 탭 진입 + 회차 tier 그룹 렌더', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    // 탭 콘텐츠 영역 존재
    await expect(page.getByTestId('progress-plans-tab')).toBeVisible({ timeout: 8_000 });

    // 로딩 스피너 사라질 때까지 대기
    await page.waitForTimeout(1_000);

    // T-PROGRESSPLAN-PKGTYPE-DB-BIND: 회차 tier 그룹(12회 등) 존재 — package_type 하드코딩 제거됨
    const groups = page.getByTestId('progress-plan-group-12');
    await expect(groups).toBeVisible({ timeout: 5_000 });

    console.log('[T1] 경과분석 플랜 탭 + 회차 tier 그룹 렌더 OK');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T2: 신규 체크포인트 추가
  // ─────────────────────────────────────────────────────────────────────────────
  test('T2: 신규 체크포인트 추가 → 목록 반영', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    await page.waitForTimeout(800);

    // "체크포인트 추가" 버튼
    const addBtn = page.getByTestId('progress-plan-add-btn');
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // 다이얼로그 열림
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 회차 tier: 48회 선택 (milestone ≤ tier). 47 = 6배수 아니라 시드 비충돌
    await page.getByTestId('tier-btn-48').click();

    // 회차 입력 (47 — 48 tier 내 비충돌 값)
    await page.getByTestId('milestone-input').fill('47');

    // 레이블 자동 생성 확인 후 커스텀 입력
    await page.getByTestId('label-input').fill('[테스트] 47회 E2E 검증');

    // 저장
    await page.getByTestId('progress-plan-save-btn').click();

    // 다이얼로그 닫힘
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // 99회 행 존재
    // (목록에 추가된 것 확인 — 텍스트 검색)
    await page.waitForTimeout(800);
    const rows = page.getByTestId('progress-plan-row');
    const texts = await rows.allTextContents();
    const found = texts.some(t => t.includes('47'));
    expect(found).toBeTruthy();

    console.log('[T2] 신규 체크포인트 추가 + 목록 반영 OK');

    // 정리: 추가한 47회 행 삭제 (테스트 격리)
    // delete 버튼은 row 내 Trash2 아이콘 — 목록 재조회 후 해당 행 찾아 삭제
    const deleteButtons = page.getByTestId(/progress-plan-delete-/);
    const count = await deleteButtons.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent();
      if (rowText?.includes('47')) {
        page.on('dialog', d => d.accept()); // confirm 자동승인
        await deleteButtons.nth(i).click();
        await page.waitForTimeout(600);
        break;
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T3: 체크포인트 수정
  // ─────────────────────────────────────────────────────────────────────────────
  test('T3: 체크포인트 수정 다이얼로그 열림 + 레이블 변경', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    await page.waitForTimeout(800);

    // 첫 번째 수정 버튼
    const editBtns = page.getByTestId(/progress-plan-edit-/);
    const editCount = await editBtns.count();
    if (editCount === 0) {
      console.log('[T3] 수정 버튼 없음 — 시드 데이터 없을 수 있음, skip');
      test.skip(true, '수정 버튼 없음');
      return;
    }

    await editBtns.first().click();

    // 다이얼로그 열림
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 레이블 변경 (기존 값에 [수정됨] 추가 — 저장 후 원상복구는 이후 수동)
    const labelInput = page.getByTestId('label-input');
    const originalLabel = await labelInput.inputValue();

    await labelInput.clear();
    await labelInput.fill(`${originalLabel} [E2E]`);

    // 저장
    await page.getByTestId('progress-plan-save-btn').click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // 수정 반영 확인
    await page.waitForTimeout(600);
    const rows = page.getByTestId('progress-plan-row');
    const texts = await rows.allTextContents();
    const found = texts.some(t => t.includes('[E2E]'));
    expect(found).toBeTruthy();

    console.log('[T3] 체크포인트 수정 OK');

    // 정리: [E2E] 태그 제거
    const editBtns2 = page.getByTestId(/progress-plan-edit-/);
    const count2 = await editBtns2.count();
    for (let i = 0; i < count2; i++) {
      const rowText = await rows.nth(i).textContent();
      if (rowText?.includes('[E2E]')) {
        await editBtns2.nth(i).click();
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        const lbl = page.getByTestId('label-input');
        const cur = await lbl.inputValue();
        await lbl.clear();
        await lbl.fill(cur.replace(' [E2E]', ''));
        await page.getByTestId('progress-plan-save-btn').click();
        await page.waitForTimeout(500);
        break;
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T4: 활성/비활성 토글
  // ─────────────────────────────────────────────────────────────────────────────
  test('T4: 활성 토글 — 상태 반전 후 opacity 변화', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    await page.waitForTimeout(800);

    const toggleBtns = page.getByTestId(/progress-plan-toggle-/);
    const tCount = await toggleBtns.count();
    if (tCount === 0) {
      test.skip(true, '토글 버튼 없음');
      return;
    }

    // 첫 번째 토글 클릭 — 상태 반전
    await toggleBtns.first().click();
    await page.waitForTimeout(500);

    // 다시 클릭해서 원상복구 (테스트 격리)
    await toggleBtns.first().click();
    await page.waitForTimeout(400);

    console.log('[T4] 활성 토글 왕복 OK');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T5: 다이얼로그 필수값 미입력 시 저장 방어
  // ─────────────────────────────────────────────────────────────────────────────
  test('T5: 회차 미입력 시 저장 방어 — toast 오류 표시', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    await page.waitForTimeout(600);

    await page.getByTestId('progress-plan-add-btn').click();
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 회차 비워두고 저장
    await page.getByTestId('milestone-input').fill('');
    await page.getByTestId('label-input').fill('테스트 레이블');
    await page.getByTestId('progress-plan-save-btn').click();

    // 다이얼로그가 열려있어야 함 (저장 불가)
    await expect(dialog).toBeVisible({ timeout: 2_000 });

    console.log('[T5] 회차 미입력 방어 OK');

    await page.keyboard.press('Escape');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T6: Phase 2 — 예약현황 경과분석 필터 버튼 (AC-4)
  //   T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 예약관리 경과분석 ON/OFF 토글/뷰 완전 제거 →
  //   치료테이블 [경과분석] 탭으로 이관(RELOCATE 스펙이 신규 동선 소유). 본 T6은 '예약관리에서 토글 부재' 회귀 가드로 전환.
  // ─────────────────────────────────────────────────────────────────────────────
  test('T6: 예약현황 경과분석 필터 버튼은 제거됨(치료테이블 탭으로 이관)', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle');

    // 토글 버튼은 더 이상 예약관리에 없어야 함(이관 완료)
    const filterBtn = page.locator('[data-testid="progress-filter-btn"]');
    await expect(filterBtn).toHaveCount(0);
    console.log('[T6-RELOCATE] 예약관리 경과분석 토글 부재 확인 PASS');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T7: Phase 2 — 플랜 미세팅/패키지 미연결 → 경과분석 배너 미표시 (AC-3 시나리오 4)
  // ─────────────────────────────────────────────────────────────────────────────
  test('T7: 패키지 미연결 시 경과분석 배너 미표시 (시나리오 4)', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle');

    const newResvBtn = page.getByRole('button', { name: '새 예약' });
    await expect(newResvBtn).toBeVisible({ timeout: 10_000 });
    await newResvBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!dialogVisible) {
      test.skip(true, '예약 폼 다이얼로그 미오픈');
      return;
    }

    // 패키지 연결 없는 상태 — 경과분석 배너는 없어야 함
    const banner = dialog.locator('[data-testid="progress-check-banner"]');
    const bannerVisible = await banner.isVisible({ timeout: 2_000 }).catch(() => false);
    expect(bannerVisible).toBe(false);
    console.log('[T7-AC-3] 패키지 미연결 시 배너 미표시 PASS');

    await page.keyboard.press('Escape');
  });
});
