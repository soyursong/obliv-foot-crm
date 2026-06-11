/**
 * T-20260611-foot-CHART2-SAVE-DIRTY-RESET — 본문 저장 성공 시 미저장 가드 dirty 리셋
 *
 * 버그: 2번차트(CustomerChartSheet) 본문 [저장](chart-info-save-btn) 직접 클릭으로 저장에
 *   성공해도, 닫기(백드롭/ESC/X) 시 "작성 중인 내용이 있습니다" 미저장 가드(chart-close-confirm)가
 *   여전히 노출됨. = 저장 성공이 Sheet의 dirty 상태(onInput proxy dirtyRef)를 clean으로 안 풀어줌.
 *
 * 수정: 신규 dirty 메커니즘 신설 X. handleInfoPanelSave 전체 성공 시 Sheet의 기존 dirtyRef를
 *   ChartSheetMarkCleanCtx 채널로 false 리셋(= baseline을 방금 저장된 값으로 갱신).
 *
 * AC-1: 본문 저장 성공 시 dirty=clean 초기화 + baseline = 방금 저장값.
 * AC-2: 저장 후 추가입력 없으면 닫기 시 confirm 미노출 / 저장 후 재수정하면 confirm 재노출.
 * AC-3: SAVE-CLOSE-BTN "저장 후 닫기"·UNSAVED-GUARD 3선택지 동작 무변경. CustomerChartSheet 한정.
 *
 * 시나리오(티켓 본문):
 *   S1 저장 후(추가입력 X) 닫기 → confirm 미노출(AC-1/AC-2)
 *   S2 저장 후 재수정 → 닫기 시 confirm 재노출(AC-2, 가드 회귀 없음)
 *   S3 미저장(저장 안 함) 가드 3선택지 회귀 없음(AC-3)
 *
 * 주의: 실서버 시드 데이터 의존 → 데이터/요소/저장 권한 없으면 graceful skip(기존 foot e2e 관례).
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

/** Customers 목록에서 2번차트(CustomerChartSheet) 열기. 실패 시 null. */
async function openSecondChart(page: Page) {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForLoadState('networkidle');
  const chartBtn = page.locator('[data-testid="open-chart-btn"]').first();
  if ((await chartBtn.count()) === 0) return null;
  await chartBtn.click();
  const panel = page.locator('[data-testid="customer-chart-sheet"]');
  if ((await panel.count()) === 0) return null;
  await expect(panel).toBeVisible({ timeout: 6000 });
  return panel;
}

/**
 * 본문 고객정보 이메일 필드를 수정해 dirty 처리(페이지 isDirty + Sheet dirtyRef 동시 활성).
 * 고유 값으로 채워 저장이 실제로 customers.customer_email 을 변경하도록 한다. 실패 시 false.
 */
async function editEmail(page: Page, value: string) {
  const email = page.locator('[data-testid="chart-email-input"]');
  try {
    await email.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false;
  }
  await email.fill(value);
  return true;
}

/**
 * 본문 [저장] 버튼 클릭 → 저장 "완료"까지 대기. 버튼 미활성/실패 시 false.
 *
 * 주의(타이밍): 저장 버튼은 `disabled={savingInfoPanel || !isDirty}`.
 *   저장 시작 즉시 savingInfoPanel=true 로 버튼이 disabled("저장 중…")가 되므로,
 *   단순히 toBeDisabled 만 기다리면 비동기 저장(handleInfoPanelSave 의 RPC + markChartClean)
 *   완료 "이전"에 통과해버린다 → 가드 dirtyRef 가 아직 clean 되기 전에 닫기 단계로 진입.
 *   따라서 (1) 텍스트가 "저장 중…" → "저장" 으로 복귀(savingInfoPanel=false)하고
 *           (2) 버튼이 disabled(=isDirty 리셋됨) 인 상태,
 *   즉 "저장 완료" 상태까지 기다린다. 이 시점이면 markChartClean 이 동기적으로 이미 실행됨.
 */
async function saveInfoPanel(page: Page) {
  const saveBtn = page.locator('[data-testid="chart-info-save-btn"]');
  if ((await saveBtn.count()) === 0) return false;
  if (await saveBtn.isDisabled()) return false; // isDirty 미반영 시드 환경 → skip
  await saveBtn.click();
  try {
    // 저장 in-flight("저장 중…") 종료 = 텍스트 "저장" 복귀(savingInfoPanel=false)
    await expect(saveBtn).toHaveText('저장', { timeout: 8000 });
    // isDirty=false 반영(저장 성공 신호) — 완료 후엔 disabled 유지
    await expect(saveBtn).toBeDisabled({ timeout: 8000 });
  } catch {
    return false; // 저장 실패(권한/시드) → 가드 리셋 검증 불가 → graceful
  }
  return true;
}

test.describe('T-20260611-foot-CHART2-SAVE-DIRTY-RESET — 저장 성공 시 dirty 리셋', () => {
  // ── S1: 본문 저장 성공 → 추가입력 없이 닫기 → confirm 미노출(AC-1/AC-2) ──────
  test('S1: 본문 [저장] 성공 후 ESC 닫기 → 미저장 가드 미노출', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await editEmail(page, `reset.s1.${Date.now()}@obliv.test`))) { test.skip(); return; }
    if (!(await saveInfoPanel(page))) { test.skip(); return; }

    // 저장 성공 후 추가입력 없음 → ESC 시 confirm 안 떠야 하고 패널이 즉시 닫혀야 함
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="chart-close-confirm"]')).toBeHidden();
    await expect(panel).toBeHidden({ timeout: 3000 });
  });

  // ── S1b: 저장 성공 후 백드롭 클릭 닫기도 confirm 미노출 ──────────────────────
  test('S1b: 본문 [저장] 성공 후 백드롭 클릭 → 미저장 가드 미노출', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await editEmail(page, `reset.s1b.${Date.now()}@obliv.test`))) { test.skip(); return; }
    if (!(await saveInfoPanel(page))) { test.skip(); return; }

    // 백드롭은 full-screen(fixed inset-0)이지만 슬라이드 패널(우측 88~95vw)이 중앙을 덮어
    //   기본 .click()(요소 중앙 타깃)은 패널 subtree 에 pointer intercept 된다.
    //   → 패널에 가려지지 않는 좌측 노출 영역 좌표를 직접 지정해 백드롭을 클릭한다.
    await page.locator('[data-testid="chart-backdrop"]').click({ position: { x: 12, y: 300 } });
    await expect(page.locator('[data-testid="chart-close-confirm"]')).toBeHidden();
    await expect(panel).toBeHidden({ timeout: 3000 });
  });

  // ── S2: 저장 성공 후 재수정 → 닫기 시 confirm 재노출(AC-2, 가드 회귀 없음) ────
  test('S2: 본문 [저장] 성공 후 재수정 → ESC 닫기 시 미저장 가드 재노출', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await editEmail(page, `reset.s2a.${Date.now()}@obliv.test`))) { test.skip(); return; }
    if (!(await saveInfoPanel(page))) { test.skip(); return; }

    // 저장 후 다시 수정(추가 입력) → dirtyRef 가 onInput 으로 재활성화되어야 함
    await editEmail(page, `reset.s2b.${Date.now()}@obliv.test`);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="chart-close-confirm"]')).toBeVisible({ timeout: 3000 });
    await expect(panel).toBeVisible();
    // 가드 3선택지 회귀 확인
    await expect(page.locator('[data-testid="chart-save-close-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-close-confirm-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-close-cancel"]')).toBeVisible();
  });

  // ── S3: 저장 안 한 미저장 상태 → 가드 3선택지 그대로 노출(AC-3 회귀) ──────────
  test('S3: 저장 없이 수정만 → ESC 시 미저장 가드 3선택지 정상 노출', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await editEmail(page, `reset.s3.${Date.now()}@obliv.test`))) { test.skip(); return; }

    await page.keyboard.press('Escape');
    const confirm = page.locator('[data-testid="chart-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="chart-save-close-btn"]')).toContainText('저장 후 닫기');
    await expect(page.locator('[data-testid="chart-close-confirm-btn"]')).toContainText('저장하지 않고 닫기');
    await expect(page.locator('[data-testid="chart-close-cancel"]')).toBeVisible();
    // 취소(계속 작성) → 패널·내용 보존 (UNSAVED-GUARD 무변경)
    await page.locator('[data-testid="chart-close-cancel"]').click();
    await expect(confirm).toBeHidden();
    await expect(panel).toBeVisible();
  });
});
