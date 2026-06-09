/**
 * E2E spec — T-20260609-foot-MEDCHART-SOAK-REFINE (문지은 대표원장 field-soak)
 * 진료차트 특이사항 패널 + 경과타임라인 정정.
 *
 * 1차 batch (4892f9b, planner MSG-20260609-181542-jn4m):
 *   AC3-3 처방내역 = 검은색 미니멀 알약(Pill) 아이콘으로 표기("처방" 텍스트 헤더 대체).
 *   AC3-4 처방내역 항목마다 줄바꿈(말줄임 제거). 묶음처방(4건+)은 버튼 토글로 펼침/접기.
 *
 * 2차 batch (본 변경, planner MSG-20260609-180615-bp4j item1·item2 — 1차 미포함분 수렴):
 *   item1 특이사항 패널: 이모지/"메모판" 제거, 박스 강조 제거(배경 녹임), 빈상태 텍스트 제거,
 *          버튼형 입력 → 줄(inline) 입력.
 *   item2 타임라인 필터: '처방/치료/진료' 필터 시 방문 날짜행 보존(소거 금지), 내용만 미표기.
 *
 * ※ AC3-1(펼침/접기 라벨, 이미 정상)·AC3-2(헤더→컬러바, planner out-of-scope)는 미검증.
 *
 * 처방 있는 저장 차트 의존 → 데이터 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

async function openMedicalChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator('[data-testid="open-chart-btn"]');
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  return page
    .locator('[data-testid="medical-chart-drawer"]')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

// 처방이 있는 타임라인 엔트리를 펼쳐 처방 섹션 노출 → 해당 엔트리 반환(없으면 null)
async function expandEntryWithRx(page: Page) {
  const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
  const n = await entries.count();
  for (let i = 0; i < n; i++) {
    const e = entries.nth(i);
    const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
    if ((await toggle.count()) === 0) continue;
    await toggle.first().click();
    await page.waitForTimeout(150);
    if ((await e.locator('[data-testid="timeline-rx-section"]').count()) > 0) return e;
  }
  return null;
}

test.describe('T-20260609-MEDCHART-SOAK-REFINE — 타임라인 처방 표기 AC3-3/AC3-4', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC3-3: 처방내역에 검은색 미니멀 알약 아이콘 표기(텍스트 "처방" 헤더 대체) ──
  test('AC3-3: 처방 섹션에 알약 아이콘이 표기된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await expandEntryWithRx(page);
    if (!entry) {
      test.skip(true, '처방 있는 타임라인 엔트리 없음 — 스킵');
      return;
    }
    const pill = entry.locator('[data-testid="timeline-rx-pill-icon"]');
    await expect(pill.first()).toBeVisible();
  });

  // ── AC3-4: 처방 항목이 줄바꿈(말줄임 제거)으로 표기된다 ───────────────────────
  test('AC3-4: 처방 항목 li 에 truncate 말줄임이 없고 break-words 로 전체표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await expandEntryWithRx(page);
    if (!entry) {
      test.skip(true, '처방 있는 타임라인 엔트리 없음 — 스킵');
      return;
    }
    const rxItems = entry.locator('[data-testid="timeline-rx-item"]');
    await expect(rxItems.first()).toBeVisible();
    const cls = (await rxItems.first().getAttribute('class')) ?? '';
    expect(cls).not.toContain('truncate');
    expect(cls).toContain('break-words');
  });

  // ── AC3-4: 묶음처방(4건+)은 펼침/접기 토글 버튼으로 동작 ──────────────────────
  test('AC3-4: 묶음처방이면 펼침 토글이 노출되고 클릭 시 항목이 늘어난다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const n = await entries.count();
    for (let i = 0; i < n; i++) {
      const e = entries.nth(i);
      const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
      if ((await toggle.count()) === 0) continue;
      await toggle.first().click();
      await page.waitForTimeout(150);
      const bundleToggle = e.locator('[data-testid="timeline-rx-bundle-toggle"]');
      if ((await bundleToggle.count()) === 0) continue;
      // 묶음처방 발견 — 펼침 전후 항목 수 증가 확인
      const before = await e.locator('[data-testid="timeline-rx-item"]').count();
      await bundleToggle.first().click();
      await page.waitForTimeout(150);
      const after = await e.locator('[data-testid="timeline-rx-item"]').count();
      expect(after).toBeGreaterThan(before);
      return;
    }
    test.skip(true, '묶음처방(4건+) 엔트리 없음 — 스킵');
  });
});

test.describe('T-20260609-MEDCHART-SOAK-REFINE — item1 특이사항 패널 chrome 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC1-1/1-2: 헤더에 이모지 없고 라벨이 "특이사항"(="메모판" 단어 제거) ──
  test('AC1-1/1-2: 특이사항 헤더 라벨이 "특이사항"이고 "메모판" 단어가 없다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const toggle = page.locator('[data-testid="special-note-toggle"]');
    await expect(toggle.first()).toBeVisible();
    const label = (await toggle.first().innerText()).trim();
    expect(label).toContain('특이사항');
    expect(label).not.toContain('메모판');
  });

  // ── AC1-5: 빈상태 텍스트("메모가 없습니다") 제거 — 패널 어디에도 노출되지 않음 ──
  test('AC1-5: "메모가 없습니다" 빈상태 텍스트가 노출되지 않는다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // 섹션 펼치기 (접혀 있으면)
    const toggle = page.locator('[data-testid="special-note-toggle"]');
    if ((await toggle.count()) > 0) {
      const expanded = await toggle.first().getAttribute('aria-expanded');
      if (expanded !== 'true') await toggle.first().click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByText('메모가 없습니다')).toHaveCount(0);
  });

  // ── AC1-6: 줄(inline) 입력 — 입력 필드는 있고 별도 저장 버튼(+버튼)은 제거됨 ──
  test('AC1-6: 줄 입력 필드는 있고 버튼형 저장(+) 버튼은 없다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const toggle = page.locator('[data-testid="special-note-toggle"]');
    if ((await toggle.count()) > 0) {
      const expanded = await toggle.first().getAttribute('aria-expanded');
      if (expanded !== 'true') await toggle.first().click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('[data-testid="special-note-input"]').first()).toBeVisible();
    // 버튼형 입력 제거 — 별도 저장 버튼 없음
    await expect(page.locator('[data-testid="special-note-add-btn"]')).toHaveCount(0);
  });
});

test.describe('T-20260609-MEDCHART-SOAK-REFINE — item2 타임라인 필터 날짜행 보존', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC2-1/2-2: '처방' 필터 토글 후에도 방문 날짜행(엔트리)이 사라지지 않는다 ──
  test('AC2-1: 처방 필터 토글 후에도 타임라인 엔트리 수가 줄지 않는다(날짜행 보존)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const before = await entries.count();
    if (before === 0) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const rxFilter = page.locator('[data-testid="memo-filter-rx"]');
    if ((await rxFilter.count()) === 0) {
      test.skip(true, '처방 필터 칩 없음 — 스킵');
      return;
    }
    await rxFilter.first().click();
    await page.waitForTimeout(200);
    const after = await entries.count();
    // 날짜행(방문) 보존 — 필터로 행이 사라지면 FAIL
    expect(after).toBe(before);
    // "필터 결과 없음" 식 빈상태(행 소거)도 노출되지 않아야 함
    await expect(page.getByText('방문 기록 없음')).toHaveCount(0);
  });

  // ── AC2-2: 치료 필터에서도 동일 — 날짜행 보존 ──
  test('AC2-2: 치료 필터 토글 후에도 엔트리 수가 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const before = await entries.count();
    if (before === 0) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const treatFilter = page.locator('[data-testid="memo-filter-treat"]');
    if ((await treatFilter.count()) === 0) {
      test.skip(true, '치료 필터 칩 없음 — 스킵');
      return;
    }
    await treatFilter.first().click();
    await page.waitForTimeout(200);
    expect(await entries.count()).toBe(before);
  });
});
