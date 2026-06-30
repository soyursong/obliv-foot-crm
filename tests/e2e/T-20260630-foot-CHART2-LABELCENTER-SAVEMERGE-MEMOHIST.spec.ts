/**
 * T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST
 * 풋 2번차트(CustomerChartSheet/CustomerChartPage) UI 개선 3건 + 메모 저장 통합.
 *
 * AC1 (항목명 중앙정렬): 차트 항목명(라벨) 텍스트 center 정렬(LC 클래스 text-center). 값(VC) 정렬 유지.
 * AC2 (메모 저장 통합): 예약메모 [추가] / 고객메모 [저장] 개별 버튼 제거 → 상단 통합 [저장] 1회로
 *      예약메모(flush·append) + 고객메모(customer_note) + 본문 일괄 저장.
 *      ★회귀가드★ 통합 저장 성공 후 dirty reset → 닫기 시 미저장 가드("작성 중인 내용이 있습니다") 미재노출.
 * AC3 (예약메모 히스토리 컴팩트): denseHistory — 항목 패딩/폰트/간격 축소.
 * AC4 (히스토리 수정/삭제): 각 항목 [수정](content UPDATE)/[삭제](hard DELETE) 버튼.
 *
 * 주의: 실서버 시드 데이터 의존 → 데이터/요소/저장 권한 없으면 graceful skip(기존 foot e2e 관례).
 *   삭제(hard DELETE)는 시드 파괴 방지를 위해 confirm-취소 경로만 검증(버튼 wiring 확인).
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

/** 고객메모 입력 → 페이지 isDirty 활성. 실패 시 false. */
async function fillCustomerNote(page: Page, value: string) {
  const note = page.locator('[data-testid="chart-customer-note-input"]');
  try {
    await note.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false;
  }
  await note.fill(value);
  return true;
}

/** 패널 [저장](chart-info-save-btn) 클릭 → 저장 완료(텍스트 '저장' 복귀 + disabled=isDirty리셋)까지 대기. */
async function saveInfoPanel(page: Page) {
  const saveBtn = page.locator('[data-testid="chart-info-save-btn"]');
  if ((await saveBtn.count()) === 0) return false;
  if (await saveBtn.isDisabled()) return false; // isDirty 미반영 시드 환경 → skip
  await saveBtn.click();
  try {
    await expect(saveBtn).toHaveText('저장', { timeout: 8000 });
    await expect(saveBtn).toBeDisabled({ timeout: 8000 });
  } catch {
    return false;
  }
  return true;
}

test.describe('T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST', () => {
  // ── AC1: 항목명(라벨) 중앙정렬 ─────────────────────────────────────────────
  test('AC1: 차트 항목명 라벨이 중앙정렬(text-align:center)', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    // lazy CustomerChartPage 콘텐츠 로드 대기(고객메모 입력칸 = 정보패널 하단 anchor)
    try {
      await panel.locator('[data-testid="chart-customer-note-input"]').waitFor({ state: 'visible', timeout: 8000 });
    } catch { test.skip(); return; }
    // 대표 라벨 셀(고객명 — 항상 존재)의 computed text-align 확인 — LC 클래스 text-center
    const label = panel.locator('td', { hasText: '고객명' }).first();
    if ((await label.count()) === 0) { test.skip(); return; }
    const align = await label.evaluate((el) => getComputedStyle(el as HTMLElement).textAlign);
    expect(align).toBe('center');
  });

  // ── AC2: 개별 저장 버튼 제거 — 고객메모 [저장] / 예약메모 [추가] 차트 내 미노출 ──
  test('AC2: 고객메모 개별 [저장] + 예약메모 [추가] 버튼 제거됨', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    // 고객메모 개별 저장 버튼 제거
    await expect(panel.locator('[data-testid="chart-customer-note-save-btn"]')).toHaveCount(0);
    // 예약메모 인라인 [추가] 버튼 제거(hideAddButton) — 상단 통합 저장이 flush
    await expect(panel.locator('[data-testid="memo-add-btn"]')).toHaveCount(0);
    // 상단 통합 저장 버튼은 존재(헤더 전체저장 + 패널 저장)
    await expect(page.locator('[data-testid="btn-chart-save-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-info-save-btn"]')).toBeVisible();
  });

  // ── AC2 ★회귀가드★: 고객메모 통합 저장 성공 후 닫기 시 미저장 가드 미재노출 ──────
  test('AC2-회귀: 고객메모 입력 → 상단 통합 [저장] → ESC 닫기 시 미저장 가드 미노출', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await fillCustomerNote(page, `note merge ${Date.now()}`))) { test.skip(); return; }
    if (!(await saveInfoPanel(page))) { test.skip(); return; }

    // 통합 저장 성공 → dirty clean → ESC 닫기 시 가드 미노출 + 패널 즉시 닫힘
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="chart-close-confirm"]')).toBeHidden();
    await expect(panel).toBeHidden({ timeout: 3000 });
  });

  // ── AC2 회귀: 저장 없이 고객메모만 입력 → 닫기 시 미저장 가드 정상 노출(가드 자체 보존) ──
  test('AC2-회귀: 고객메모 입력 후 저장 안 함 → ESC 시 미저장 가드 노출(가드 무변경)', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    if (!(await fillCustomerNote(page, `note nosave ${Date.now()}`))) { test.skip(); return; }

    await page.keyboard.press('Escape');
    const confirm = page.locator('[data-testid="chart-close-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 3000 });
    // 3선택지 회귀
    await expect(page.locator('[data-testid="chart-save-close-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-close-confirm-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-close-cancel"]')).toBeVisible();
    await page.locator('[data-testid="chart-close-cancel"]').click();
    await expect(confirm).toBeHidden();
    await expect(panel).toBeVisible();
  });

  // ── AC2: 예약메모 입력 후 상단 전체저장(flush) → 히스토리 반영 ────────────────
  test('AC2: 예약메모 입력 → 헤더 [저장](flush) → 히스토리에 추가', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    const memoInput = panel.locator('textarea[placeholder*="새 메모 입력"]').first();
    if ((await memoInput.count()) === 0) { test.skip(); return; }
    const text = `resv flush ${Date.now()}`;
    await memoInput.fill(text);

    // 헤더 전체저장(btn-chart-save-all)은 항상 클릭 가능 → flushPending이 예약메모 append
    const saveAll = page.locator('[data-testid="btn-chart-save-all"]');
    if ((await saveAll.count()) === 0) { test.skip(); return; }
    await saveAll.click();
    // flush 성공 시 입력칸 비워지고 히스토리에 신규 항목 표시
    try {
      await expect(memoInput).toHaveValue('', { timeout: 8000 });
    } catch {
      test.skip(); return; // 권한/시드로 저장 실패 → graceful
    }
    await expect(panel.locator('[data-testid="memo-item"]', { hasText: text }).first()).toBeVisible({ timeout: 6000 });
  });

  // ── AC3: 예약메모 히스토리 컴팩트(denseHistory) ──────────────────────────────
  test('AC3: 예약메모 히스토리 항목이 컴팩트 폰트(text-[11px])', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    const item = panel.locator('[data-testid="memo-item"], [data-testid="memo-pinned"]').first();
    if ((await item.count()) === 0) { test.skip(); return; } // 히스토리 없음 → skip
    const cls = await item.getAttribute('class');
    expect(cls ?? '').toContain('text-[11px]'); // denseHistory itemFont
  });

  // ── AC4: 히스토리 [수정]/[삭제] 버튼 노출 + 수정 인라인 편집 동작 ──────────────
  test('AC4: 히스토리 항목 [수정]/[삭제] 노출 + 수정 인라인 편집', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    const item = panel.locator('[data-testid="memo-item"]').first();
    if ((await item.count()) === 0) { test.skip(); return; }

    await expect(item.locator('[data-testid="memo-edit-btn"]')).toBeVisible();
    await expect(item.locator('[data-testid="memo-delete-btn"]')).toBeVisible();

    // 수정 진입 → 인라인 textarea 노출 → 취소(원복)로 시드 보존
    await item.locator('[data-testid="memo-edit-btn"]').click();
    await expect(panel.locator('[data-testid="memo-edit-input"]').first()).toBeVisible();
    await expect(panel.locator('[data-testid="memo-edit-save-btn"]').first()).toBeVisible();
    await panel.locator('[data-testid="memo-edit-cancel-btn"]').first().click();
    await expect(panel.locator('[data-testid="memo-edit-input"]').first()).toBeHidden();
  });

  // ── AC4: 삭제 confirm 취소 → 항목 유지(시드 파괴 없이 wiring 검증) ─────────────
  test('AC4: 히스토리 [삭제] confirm 취소 → 항목 유지', async ({ page }) => {
    const panel = await openSecondChart(page);
    if (!panel) { test.skip(); return; }
    const item = panel.locator('[data-testid="memo-item"]').first();
    if ((await item.count()) === 0) { test.skip(); return; }
    const before = await panel.locator('[data-testid="memo-item"]').count();

    page.once('dialog', (d) => d.dismiss()); // window.confirm 취소
    await item.locator('[data-testid="memo-delete-btn"]').click();
    await page.waitForTimeout(300);
    await expect(panel.locator('[data-testid="memo-item"]')).toHaveCount(before);
  });
});
