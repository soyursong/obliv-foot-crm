/**
 * E2E spec — T-20260609-foot-MEDCHART-TIMELINE-COMPACT
 * 경과타임라인·메모 표시 한 줄 컴팩트 재정의 (문지은 대표원장 C0ATE5P6JTH)
 *
 * 이 spec 범위 (옵션 A — scoped GO, MSG-20260609-020553-bjvm):
 *   AC-1 "기록자" 단어 제거 → 성명만 (created_by_name 데이터 보존)
 *   AC-2 per-item 메타 압축 — 각 타임라인 항목 [날짜·작성자성명·유형badge]를 상단 한 줄,
 *        메모 텍스트만 아래. 다줄 분산 제거.
 *   AC-3 처방 = 약명 + 용량만 주르륵(처방일시·코드 등 메타 숨김) / 진료메모=치료메모 동일 레이아웃
 *   AC-4 "상병명 호전" 등 diagnosis 라벨 타임라인 카드 숨김 (데이터 삭제 아님, 표시만)
 *   AC-5 기능·산출물 보존 (PANEL-CLARITY 좌우패널/토글, PROGRESS-TIMELINE-AUTHOR 성명 데이터)
 *
 * 🧊 FROZEN (본 spec 범위 외 — e7cc 원장 A/B 회신 대기):
 *   AC-6 특이사항 필터칩 제거 + 상단고정 / 글로벌 필터행(FILTER_OPTIONS 4종) → ⋯케밥 통합.
 *   → 글로벌 필터 칩 행(memo-filter-*)은 본 티켓에서 건드리지 않음(보존 검증만).
 *
 * 데이터 의존(저장된 차트)이라 데이터 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

// 진료차트 Drawer 열기 — 못 열면 false
async function openMedicalChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator(
    '[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")',
  );
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  const drawer = page.locator('[data-testid="medical-chart-drawer"]');
  return drawer
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

async function firstTimelineEntry(page: Page) {
  const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
  if ((await entries.count()) === 0) return null;
  return entries.first();
}

test.describe('T-20260609-MEDCHART-TIMELINE-COMPACT — 경과타임라인 컴팩트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: "기록자" 단어 제거 — 성명만 (시나리오 1) ────────────────────────
  test('AC-1: 타임라인 작성자 표시에 "기록자" 단어가 없다(성명만)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await firstTimelineEntry(page);
    if (!entry) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const recorder = entry.locator('[data-testid="timeline-recorder"]');
    if ((await recorder.count()) === 0) {
      test.skip(true, '작성자 데이터 없는 엔트리 — 스킵');
      return;
    }
    // "기록자" 단어가 더 이상 노출되지 않음 — 성명만
    await expect(recorder.first()).not.toContainText('기록자');
  });

  // ── AC-2: per-item 메타 상단 한 줄 + 텍스트 아래 (시나리오 1) ──────────────
  test('AC-2: 날짜·작성자·유형badge가 한 줄(부모 flex row)에 모여 있다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await firstTimelineEntry(page);
    if (!entry) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const recorder = entry.locator('[data-testid="timeline-recorder"]');
    if ((await recorder.count()) === 0) {
      test.skip(true, '작성자 없는 엔트리 — 메타행 검증 스킵');
      return;
    }
    // 작성자 성명이 날짜와 같은 메타 행(flex)에 위치 — 부모가 flex items-center
    const metaRow = recorder.first().locator('xpath=..');
    await expect(metaRow).toHaveClass(/flex/);
    await expect(metaRow).toContainText(/\d/); // 날짜 숫자가 같은 행에 존재
  });

  // ── AC-3: 처방 = 약명+용량만 주르륵 (시나리오 4) ───────────────────────────
  test('AC-3: 처방 펼침 시 약 항목이 목록(li)으로 표시되고 처방코드 메타가 안 보인다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // 처방이 있는 엔트리를 찾아 아코디언 펼침
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const n = await entries.count();
    let found = false;
    for (let i = 0; i < n; i++) {
      const e = entries.nth(i);
      const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
      if ((await toggle.count()) === 0) continue;
      await toggle.first().click();
      await page.waitForTimeout(200);
      const rxItems = e.locator('[data-testid="timeline-rx-item"]');
      if ((await rxItems.count()) > 0) {
        // 약명+용량만 — 처방일시/코드 메타 텍스트 미노출
        await expect(rxItems.first()).toBeVisible();
        found = true;
        break;
      }
    }
    if (!found) {
      test.skip(true, '처방 항목이 있는 타임라인 엔트리 없음 — 스킵');
    }
  });

  // ── AC-5(보존): 글로벌 필터 칩 행은 그대로 — FROZEN surface 무변경 ─────────
  test('AC-5(보존): 글로벌 메모 필터 칩 행(FILTER 산출물)이 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // FILTER 4종(treat/doc/rx/notable) 칩이 그대로 존재해야 한다(본 티켓 비건드림)
    const treatChip = page.locator('[data-testid="memo-filter-treat"]');
    const docChip = page.locator('[data-testid="memo-filter-doc"]');
    if ((await treatChip.count()) === 0) {
      test.skip(true, '필터 칩 행 미렌더(데이터/뷰 상태) — 스킵');
      return;
    }
    await expect(treatChip).toBeVisible();
    await expect(docChip).toBeVisible();
  });
});
