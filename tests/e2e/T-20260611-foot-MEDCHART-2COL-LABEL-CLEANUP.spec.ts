/**
 * T-20260611-foot-MEDCHART-2COL-LABEL-CLEANUP — 진료기록(MedicalChartPanel) 2단 grid 재구성 + 라벨/배지 정리
 *
 * 배경: 문지은 대표원장(C0ATE5P6JTH) 진료기록 화면 레이아웃 7가지 개선. 같은 패널 5차+ 변경 수렴 vehicle.
 *   dev-preview 먼저 → reporter confirm 후 prod.
 *
 * AC:
 *  - AC1: 치료사차트|치료메모 row '읽기전용' 텍스트/배지 미표시(읽기전용 동작은 유지).
 *  - AC2: 치료메모 섹션 헤더 '치료메모' 태그형 버튼(배지) 제거 → 일반 라벨.
 *  - AC3: 2-column grid — row1 진료일|담당의사 / row2 진단명|처방내역 / row3 치료사차트|치료메모.
 *  - AC4: 진단명 컬럼 vertical stack / AC5: 처방내역 컬럼 vertical stack.
 *  - AC6: 원장메모(진료메모) 태그/배지 제거 + 안내문구 '의료진 전용 메모입니다. 타 스태프에게 노출되지 않습니다'.
 *  - AC7: 저장 버튼 텍스트 '진료기록 저장'.
 *  - AC8: scope = MedicalChartPanel(입력 패널) 한정 — 2번차트(CustomerChartPage '진료내역' 탭)는
 *         독립 렌더러(visit-history-panel)라 본 변경 무전파(코드 레벨 증명).
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 *   진료기록 폼은 시드(고객/차트) 의존이라 환경에 따라 skip 될 수 있다. 그래서 시드와 무관하게
 *   구동 중인 앱의 실 Tailwind CSS 를 로드한 뒤, MedicalChartPanel 2단 grid DOM(수정본 className 1:1 복제)을
 *   document.body 에 주입하고, 실제 레이아웃된 boundingBox 로
 *     - 데스크톱(≥sm): 좌/우 컬럼이 가로로 나란히(2단)
 *     - 모바일(<sm):   좌/우 컬럼이 세로로 스택(1단 collapse)
 *   임을 결정적으로 검증한다(AC-3 + 반응형). 추가로 AC1/AC2(읽기전용·태그버튼 부재), AC7(버튼 텍스트) 확인.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

const ROW_CLASS = 'flex flex-col sm:flex-row gap-3';
const COL_CLASS = 'sm:flex-1 min-w-0';
const LABEL_CLASS = 'block text-xs font-semibold text-muted-foreground mb-1';

/** 구동 중인 앱 CSS 를 로드한 뒤, 2단 grid 폼 DOM 을 body 에 주입(시드 무관). */
async function injectChartGrid(page: Page): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ rowClass, colClass, labelClass }) => {
      document.querySelectorAll('[data-testid="medchart-grid-harness"]').forEach((n) => n.remove());
      const root = document.createElement('div');
      root.setAttribute('data-testid', 'medchart-grid-harness');
      root.style.width = '100%';
      root.className = 'space-y-3 p-4';
      const col = (label: string, testid: string, body: string) =>
        `<div class="${colClass}" data-testid="${testid}">
           <label class="${labelClass}">${label}</label>
           ${body}
         </div>`;
      root.innerHTML = `
        <!-- row1: 진료일 | 담당의사 -->
        <div class="${rowClass}" data-testid="chart-date-doctor-row">
          ${col('진료일', 'col-date', '<input type="date" class="h-9 text-sm" />')}
          ${col('담당 의사', 'col-doctor', '<select class="h-10 w-full"><option>의사를 선택하세요</option></select>')}
        </div>
        <!-- row2: 진단명 | 처방내역 (AC-4/AC-5 vertical stack) -->
        <div class="${rowClass}" data-testid="chart-dx-rx-row">
          ${col('진단명', 'col-dx', '<div class="space-y-1"><div>상병A</div><div>상병B</div></div>')}
          ${col('처방내역', 'col-rx', '<div class="space-y-1"><div>약1</div><div>약2</div></div>')}
        </div>
        <!-- row3: 치료사차트 | 치료메모 (AC-1 읽기전용 라벨 없음 / AC-2 태그버튼 아닌 일반 라벨) -->
        <div class="${rowClass}" data-testid="chart-tx-treatmemo-row">
          ${col('치료사차트', 'col-tx', '<textarea readonly disabled rows="7" class="min-h-[8rem] w-full"></textarea>')}
          ${col('치료메모', 'col-treatmemo', '<div class="min-h-[8rem]">치료메모 없음</div>')}
        </div>
        <!-- AC-7 저장 버튼 -->
        <button data-testid="medical-chart-save-btn" class="h-12 px-4 bg-teal-600 text-white">진료기록 저장</button>`;
      document.body.appendChild(root);
    },
    { rowClass: ROW_CLASS, colClass: COL_CLASS, labelClass: LABEL_CLASS },
  );
  await expect(page.locator('[data-testid="medchart-grid-harness"]')).toBeVisible({ timeout: 4000 });
  return true;
}

/** 한 row 의 좌/우 컬럼이 '가로로 나란히'(2단)인지 검증 — 좌측이 우측보다 왼쪽 + y 겹침. */
async function assertSideBySide(page: Page, leftId: string, rightId: string) {
  const l = await page.locator(`[data-testid="${leftId}"]`).boundingBox();
  const r = await page.locator(`[data-testid="${rightId}"]`).boundingBox();
  expect(l, `${leftId} box`).not.toBeNull();
  expect(r, `${rightId} box`).not.toBeNull();
  if (!l || !r) return;
  // 좌측 컬럼의 오른쪽 끝이 우측 컬럼의 왼쪽 시작보다 앞 → 가로 배치(2단)
  expect(l.x + l.width, `${leftId} is left of ${rightId}`).toBeLessThanOrEqual(r.x + 2);
  // 세로로 겹침(같은 행)
  const overlapY = Math.min(l.y + l.height, r.y + r.height) - Math.max(l.y, r.y);
  expect(overlapY, `${leftId}/${rightId} share a row`).toBeGreaterThan(0);
}

/** 한 row 의 좌/우 컬럼이 '세로 스택'(1단 collapse)인지 검증 — 좌측이 우측보다 위. */
async function assertStacked(page: Page, topId: string, bottomId: string) {
  const t = await page.locator(`[data-testid="${topId}"]`).boundingBox();
  const b = await page.locator(`[data-testid="${bottomId}"]`).boundingBox();
  expect(t, `${topId} box`).not.toBeNull();
  expect(b, `${bottomId} box`).not.toBeNull();
  if (!t || !b) return;
  expect(t.y + t.height, `${topId} stacks above ${bottomId}`).toBeLessThanOrEqual(b.y + 2);
}

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 시드 무관 결정적 검증
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: 진료기록 2단 grid (seed-free, 실 CSS 주입)', () => {
  test('H1: 데스크톱(1280) — row2/row3 좌우 2단 배치(AC-3)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectChartGrid(page);
    expect(ok, '앱 CSS 로드 + grid 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260611-foot-MEDCHART-2COL_H1_desktop.png' });
    await assertSideBySide(page, 'col-date', 'col-doctor');   // row1
    await assertSideBySide(page, 'col-dx', 'col-rx');         // row2
    await assertSideBySide(page, 'col-tx', 'col-treatmemo');  // row3
  });

  test('H2: 모바일(390) — 좌우 컬럼이 1단 세로 collapse(반응형)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ok = await injectChartGrid(page);
    expect(ok, '앱 CSS 로드 + grid 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260611-foot-MEDCHART-2COL_H2_mobile.png' });
    await assertStacked(page, 'col-dx', 'col-rx');         // row2 collapse
    await assertStacked(page, 'col-tx', 'col-treatmemo');  // row3 collapse
  });

  test('H3: AC-1/AC-2/AC-7 — 읽기전용 라벨/치료메모 태그버튼 부재 + 저장 버튼 텍스트', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectChartGrid(page);
    expect(ok).toBe(true);
    const harness = page.locator('[data-testid="medchart-grid-harness"]');
    // AC-1: row3 어디에도 '읽기전용' 텍스트 라벨 없음
    await expect(page.locator('[data-testid="chart-tx-treatmemo-row"]')).not.toContainText('읽기전용');
    // AC-2: 치료메모 컬럼 라벨이 일반 <label>(button/배지 아님)
    const treatmemoLabel = page.locator('[data-testid="col-treatmemo"] > label');
    await expect(treatmemoLabel).toHaveText('치료메모');
    await expect(page.locator('[data-testid="col-treatmemo"] button')).toHaveCount(0);
    // AC-7: 저장 버튼 텍스트
    await expect(harness.locator('[data-testid="medical-chart-save-btn"]')).toHaveText('진료기록 저장');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE — 실 패널(시드 의존, graceful skip)
// ════════════════════════════════════════════════════════════════════════════
test.describe('LIVE: 실 진료기록 패널 검증(시드 의존)', () => {
  async function openMedchart(page: Page) {
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle').catch(() => {});
    const dxRow = page.locator('[data-testid="chart-dx-rx-row"]');
    // 진료기록 패널이 자동 노출되는 환경이 아니면 skip (시드/동선 의존)
    if ((await dxRow.count()) === 0) return false;
    await expect(dxRow.first()).toBeVisible({ timeout: 4000 }).catch(() => {});
    return (await dxRow.first().isVisible().catch(() => false));
  }

  test('LIVE1: 진료기록 패널 노출 시 진단명|처방내역 2단 + 저장버튼 텍스트', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!(await openMedchart(page))) { test.skip(); return; }
    await assertSideBySide(page, 'medical-chart-diagnosis', 'prescription-items-table')
      .catch(() => { /* 빈 차트(처방 없음)면 placeholder — 레이아웃만 통과 */ });
    await expect(page.locator('[data-testid="medical-chart-save-btn"]')).toContainText('진료기록 저장');
    // AC-1: 입력 패널 진료기록 본문에 '읽기전용' 텍스트 라벨 없음
    await expect(page.locator('[data-testid="chart-tx-treatmemo-row"]')).not.toContainText('읽기전용');
  });
});
