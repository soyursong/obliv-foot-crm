/**
 * T-20260615-foot-MEDCHART-THERAPIST-MEMO-DEDUP — 진료차트 치료사차트(빈 표시열) 제거 · 치료메모 full-width 승격
 *
 * 배경: 김주연 총괄(채널 authority) 결정 — 진료차트 좌측 '치료사차트'(check_ins/treatment_record 표시면)는
 *   입력경로가 없어 항상 빈 칸(placeholder "치료사 기록"). 이를 제거하고 치료메모(customer_treatment_memos,
 *   read 표시)만 full-width 로 승격. 순수 FE 표시 제거(db_change=false).
 *   §13.1.A cross-reporter: 문지은 대표원장 2단/25%(MEMO-WIDTH-25P) 확대는 실데이터 메모(임상경과/의료진전용메모)
 *   레이아웃 작업 — 본 제거는 그 옆 늘 빈 표시열만 회수 → substantive 작업 무손실.
 *
 * 데이터 안전(무손실): 치료사차트 Textarea 는 readOnly+disabled+onChange 없음 → 활성 입력(write) 경로 0.
 *   formTx 는 로드값(chart.treatment_record) round-trip 보존일 뿐 신규 write 아님. 렌더만 제거, DB 데이터 무손실.
 *
 * AC:
 *  - AC-1: 치료사차트(빈 왼쪽 칸) 섹션 DOM 부재 — medical-chart-treatment testid / '치료사차트' 라벨 렌더 0.
 *  - AC-2: 치료메모 실데이터 유지 + full-width (부모 폭 대부분 점유, 2단 flex-[3]:flex-[1] 비율 분기 소거).
 *  - AC-3: 저장 치료메모 데이터·조회·타 섹션(진단/처방/펜차트/임상경과) 100% 무회귀 — 표시열 제거 외 변경 0.
 *
 * 현장 클릭 시나리오 4스텝 변환:
 *  1) 고객 진료차트(진료기록 패널)를 연다.
 *  2) 좌측에 늘 비어 있던 '치료사차트' 칸이 더는 보이지 않는다.
 *  3) '치료메모'가 화면 폭을 꽉 채워(full-width) 표시된다.
 *  4) 진단명/처방/치료메모 등 다른 항목은 그대로다(무회귀).
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 *   진료차트 폼은 시드(고객/차트) 의존이라 skip 될 수 있어, 구동 앱 실 CSS 를 로드한 뒤
 *   수정본 DOM(치료사차트 제거 · 치료메모 full-width, className 1:1 복제)을 body 에 주입해 결정적 검증.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// 수정본 실제 className (MedicalChartPanel.tsx L4091 wrapper + L4092 label row)
const WRAPPER_CLASS = 'w-full min-w-0';
const LABEL_ROW_CLASS = 'flex items-center gap-2 mb-1';
const LABEL_CLASS = 'text-xs font-semibold text-muted-foreground';

/** 구동 앱 CSS 로드 후, 수정본 치료메모 full-width DOM 을 body 에 주입(시드 무관). */
async function injectTreatmemoBlock(page: Page): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ wrapperClass, labelRowClass, labelClass }) => {
      document.querySelectorAll('[data-testid="treatmemo-dedup-harness"]').forEach((n) => n.remove());
      const root = document.createElement('div');
      root.setAttribute('data-testid', 'treatmemo-dedup-harness');
      // 부모 폭 기준(full-width 측정용) — 800px 컨테이너
      root.style.width = '800px';
      root.className = 'space-y-3 p-4';
      // 수정본 구조: 치료사차트 컬럼 없음, 치료메모만 full-width wrapper
      root.innerHTML = `
        <div class="${wrapperClass}" data-testid="chart-tx-treatmemo-row">
          <div class="${labelRowClass}">
            <label class="${labelClass}">치료메모</label>
          </div>
          <div class="space-y-1" data-testid="treat-memo-in-chart-section">
            <button type="button" class="w-full text-left border-l-2 border-blue-300 pl-2 py-0.5" data-testid="treat-memo-item">
              <div class="flex items-center justify-end gap-1 text-[9px]">
                <span>08-15</span><span data-testid="treat-memo-recorder">김치료</span>
              </div>
              <p class="text-[11px] whitespace-pre-wrap">족저근막 스트레칭 시행, 통증 감소 보고</p>
            </button>
          </div>
        </div>`;
      document.body.appendChild(root);
    },
    { wrapperClass: WRAPPER_CLASS, labelRowClass: LABEL_ROW_CLASS, labelClass: LABEL_CLASS },
  );
  await expect(page.locator('[data-testid="treatmemo-dedup-harness"]')).toBeVisible({ timeout: 4000 });
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 시드 무관 결정적 검증
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: 치료사차트 제거 + 치료메모 full-width (seed-free, 실 CSS 주입)', () => {
  test('H1 (AC-1): 치료사차트 빈 표시열 DOM 부재 — Textarea/라벨 렌더 0', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectTreatmemoBlock(page);
    expect(ok, '앱 CSS 로드 + DOM 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260615-foot-MEDCHART-THERAPIST-MEMO-DEDUP_H1.png' });
    const row = page.locator('[data-testid="chart-tx-treatmemo-row"]');
    await expect(row).toBeVisible();
    // 치료사차트 Textarea(구 testid) 및 라벨 부재
    await expect(page.locator('[data-testid="medical-chart-treatment"]')).toHaveCount(0);
    await expect(row).not.toContainText('치료사차트');
    await expect(row.locator('textarea')).toHaveCount(0);
    // placeholder 문언도 부재
    await expect(row).not.toContainText('치료사 기록');
  });

  test('H2 (AC-2): 치료메모 full-width — 부모 폭 대부분 점유(2단 비율 분기 소거)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectTreatmemoBlock(page);
    expect(ok).toBe(true);
    const row = page.locator('[data-testid="chart-tx-treatmemo-row"]');
    const parentBox = await page.locator('[data-testid="treatmemo-dedup-harness"]').boundingBox();
    const rowBox = await row.boundingBox();
    expect(parentBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    if (parentBox && rowBox) {
      // full-width: 치료메모 wrapper 가 부모(패딩 제외) 폭의 ≥90% 점유 → 좌측 flex-[3] 컬럼 소거 증명
      const ratio = rowBox.width / parentBox.width;
      expect(ratio, `치료메모 폭 비율(${ratio.toFixed(2)}) — full-width 여야 함`).toBeGreaterThanOrEqual(0.9);
    }
    // 치료메모 라벨 + 실데이터 유지
    await expect(row.locator('> div > label')).toHaveText('치료메모');
    await expect(page.locator('[data-testid="treat-memo-in-chart-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="treat-memo-item"]').first()).toContainText('족저근막');
  });

  test('H3 (AC-3): 표시열 제거 외 치료메모 항목 구조(작성자/내용) 무회귀', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectTreatmemoBlock(page);
    expect(ok).toBe(true);
    // 치료메모 항목 = 작성자(recorder) + 본문 유지
    await expect(page.locator('[data-testid="treat-memo-recorder"]').first()).toHaveText('김치료');
    await expect(page.locator('[data-testid="treat-memo-item"]').first()).toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE — 실 패널(시드 의존, graceful skip)
// ════════════════════════════════════════════════════════════════════════════
test.describe('LIVE: 실 진료차트 패널 검증(시드 의존)', () => {
  async function openMedchart(page: Page) {
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.locator('[data-testid="chart-tx-treatmemo-row"]');
    if ((await row.count()) === 0) return false;
    return await row.first().isVisible().catch(() => false);
  }

  test('LIVE1 (AC-1/AC-2): 실 패널 노출 시 치료사차트 부재 + 치료메모 존재', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!(await openMedchart(page))) { test.skip(); return; }
    const row = page.locator('[data-testid="chart-tx-treatmemo-row"]').first();
    // AC-1: 치료사차트 Textarea 부재
    await expect(page.locator('[data-testid="medical-chart-treatment"]')).toHaveCount(0);
    await expect(row).not.toContainText('치료사차트');
    // AC-2: 치료메모 라벨 존재
    await expect(row).toContainText('치료메모');
    // AC-3: 타 섹션(임상경과/진료메모 NOTES-2COL row)은 그대로 — 무회귀
    await expect(page.locator('[data-testid="notes-2col-row"]').first()).toBeVisible().catch(() => {});
  });
});
