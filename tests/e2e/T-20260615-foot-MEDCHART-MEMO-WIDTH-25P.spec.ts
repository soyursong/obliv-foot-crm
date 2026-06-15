/**
 * T-20260615-foot-MEDCHART-MEMO-WIDTH-25P — 진료차트 의료진메모 + 치료메모 입력영역 25% 확대
 *
 * 요청(문지은 대표원장, C0ATE5P6JTH): 진료차트 의료진메모(원장메모) + 치료메모 입력 영역 너비를
 *   둘 다 현재 대비 25% 확대. FE CSS 전용(DB/계약/권한 무변경).
 *
 * SEQUENCING(충돌 대조 §13.1.A): 같은 메모 패널이 converged grid로 이미 prod 재배치 완료
 *   (T-20260612-MEDREC-DATE-DIAG-UI-REFINE, c9f0143). 25% 확대는 **현 prod의 grid 비율 위에서** 적용.
 *   현 비율: 행마다 좌(치료사차트/임상경과) sm:flex-[4] : 우(치료메모/의료진전용메모) sm:flex-[1]
 *            → 우측 메모 컬럼 = 1/(4+1) = 20% of row.
 *   변경: 좌측을 sm:flex-[3]로 낮춤 → 우측 메모 컬럼 = 1/(3+1) = 25% of row.
 *         즉 우측 메모 컬럼 20% → 25% = **정확히 +25%** 확대. 우 flex-[1] 토큰 무변경.
 *
 * AC:
 *  - AC1: 데스크톱(≥sm)에서 두 메모 행 모두 우측 컬럼이 행 너비의 ≈25%(옛 20% 대비 +25%).
 *  - AC2: 두 메모 행 모두 좌측 컬럼이 ≈75% — 인접 컬럼 overflow/squeeze/잘림 없음
 *         (좌+우 width ≤ row width, 우측 right-edge가 row 경계 안).
 *  - AC3: 모바일(<sm)은 1단 세로 collapse 유지(반응형 회귀 가드).
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 *   진료차트 폼은 시드(고객/차트) 의존이라 환경에 따라 skip 될 수 있다. 그래서 구동 중인 앱의
 *   실 Tailwind CSS 를 로드한 뒤, 수정본 className(좌 flex-[3]:우 flex-[1])을 1:1 복제한 두 메모 행을
 *   document.body 에 주입하고, 실제 레이아웃된 boundingBox 로 비율을 결정적으로 검증한다.
 *   대조군(옛 flex-[4]:flex-[1])도 함께 주입해 '정확히 +25%' 상대 확대를 증명한다.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

const ROW_CLASS = 'flex flex-col sm:flex-row gap-3';
const LEFT_NEW = 'sm:flex-[3] min-w-0';   // 수정본 좌측 컬럼(실 컴포넌트 클래스 — JIT 생성됨)
const RIGHT_COL = 'sm:flex-[1] min-w-0';  // 우측 메모 컬럼(토큰 무변경 — 실 컴포넌트 클래스)
// 대조군(옛 4:1)은 인라인 flex 스타일로 결정적 재현 — 소스에서 flex-[4]를 제거해
//   Tailwind JIT가 더 이상 .flex-[4] 를 생성하지 않으므로 클래스 대신 inline style 사용.
const OLD_LEFT_STYLE = 'flex: 4 4 0%; min-width: 0;';
const OLD_RIGHT_STYLE = 'flex: 1 1 0%; min-width: 0;';

/** 구동 중인 앱 CSS 로드 후, 메모 행(수정본+대조군) DOM 을 body 에 주입(시드 무관). */
async function injectMemoRows(page: Page): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ rowClass, leftNew, rightCol, oldLeftStyle, oldRightStyle }) => {
      document.querySelectorAll('[data-testid="memo-width-harness"]').forEach((n) => n.remove());
      const root = document.createElement('div');
      root.setAttribute('data-testid', 'memo-width-harness');
      // 행 너비를 결정적으로 고정 — 비율 검증의 분모.
      root.style.width = '1000px';
      root.className = 'space-y-3 p-4';
      const body = `여기에 메모 입력`;
      root.innerHTML = `
        <!-- 수정본 row1: 치료사차트(좌 flex-3) | 치료메모(우 flex-1) -->
        <div class="${rowClass}" data-testid="row-new-treat">
          <div class="${leftNew}" data-testid="new-tx"><textarea rows="7" class="w-full min-h-[8rem]"></textarea></div>
          <div class="${rightCol}" data-testid="new-treatmemo"><div class="min-h-[8rem]">${body}</div></div>
        </div>
        <!-- 수정본 row2: 임상경과(좌 flex-3) | 의료진전용메모(우 flex-1) -->
        <div class="${rowClass}" data-testid="row-new-notes">
          <div class="${leftNew}" data-testid="new-clinical"><textarea rows="13" class="w-full min-h-[16rem]"></textarea></div>
          <div class="${rightCol}" data-testid="new-doctormemo"><textarea class="w-full min-h-[16rem]"></textarea></div>
        </div>
        <!-- 대조군(옛 비율 4:1) row — 인라인 flex 스타일(JIT 비의존). sm 이상에서만 가로 2단이 되도록
             flex-direction 은 ROW_CLASS(flex-col sm:flex-row)에 위임. -->
        <div class="${rowClass}" data-testid="row-old">
          <div style="${oldLeftStyle}" data-testid="old-left"><textarea rows="7" class="w-full min-h-[8rem]"></textarea></div>
          <div style="${oldRightStyle}" data-testid="old-right"><div class="min-h-[8rem]">${body}</div></div>
        </div>`;
      document.body.appendChild(root);
    },
    { rowClass: ROW_CLASS, leftNew: LEFT_NEW, rightCol: RIGHT_COL, oldLeftStyle: OLD_LEFT_STYLE, oldRightStyle: OLD_RIGHT_STYLE },
  );
  await expect(page.locator('[data-testid="memo-width-harness"]')).toBeVisible({ timeout: 4000 });
  return true;
}

async function box(page: Page, id: string) {
  const b = await page.locator(`[data-testid="${id}"]`).boundingBox();
  expect(b, `${id} box`).not.toBeNull();
  return b!;
}

/** 한 메모 행: 우측 컬럼이 행 너비의 ≈ratio(±tol), 인접 overflow 없음(좌+우 ≤ row). */
async function assertMemoRatio(page: Page, rowId: string, leftId: string, rightId: string, ratio: number) {
  const row = await box(page, rowId);
  const l = await box(page, leftId);
  const r = await box(page, rightId);
  const rightFrac = r.width / row.width;
  expect(rightFrac, `${rightId} 우측 컬럼 비율 ≈${ratio}`).toBeGreaterThan(ratio - 0.025);
  expect(rightFrac, `${rightId} 우측 컬럼 비율 ≈${ratio}`).toBeLessThan(ratio + 0.025);
  // AC-2: 인접 컬럼 overflow/squeeze 없음 — 좌+우(+gap) 가 행을 넘지 않음, 우측 right-edge 가 행 안.
  expect(l.width + r.width, `${rowId} 좌+우 width ≤ row width`).toBeLessThanOrEqual(row.width + 1);
  expect(r.x + r.width, `${rightId} right-edge 가 row 경계 안(잘림 없음)`).toBeLessThanOrEqual(row.x + row.width + 1);
  // 좌측이 우측보다 앞(2단 가로 배치)
  expect(l.x + l.width, `${leftId} is left of ${rightId}`).toBeLessThanOrEqual(r.x + 2);
}

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 시드 무관 결정적 검증
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: 메모 입력영역 25% 확대 (seed-free, 실 CSS 주입)', () => {
  test('AC1: 데스크톱 — 치료메모 행 우측 컬럼 ≈25%', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectMemoRows(page);
    expect(ok, '앱 CSS 로드 + 주입 실패 — 환경 확인 필요').toBe(true);
    await page.screenshot({ path: 'evidence/T-20260615-foot-MEDCHART-MEMO-WIDTH-25P_AC1_treat.png' });
    await assertMemoRatio(page, 'row-new-treat', 'new-tx', 'new-treatmemo', 0.25);
  });

  test('AC1: 데스크톱 — 의료진전용메모 행 우측 컬럼 ≈25%', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectMemoRows(page);
    expect(ok).toBe(true);
    await assertMemoRatio(page, 'row-new-notes', 'new-clinical', 'new-doctormemo', 0.25);
  });

  test('AC1-rel: 대조군(옛 flex-4:1) 대비 정확히 +25% 상대 확대', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectMemoRows(page);
    expect(ok).toBe(true);
    const oldR = await box(page, 'old-right');
    const newTreat = await box(page, 'new-treatmemo');
    const newDoc = await box(page, 'new-doctormemo');
    // 옛 우측 20% → 신 우측 25% = ×1.25 (±3% 허용)
    expect(newTreat.width / oldR.width, '치료메모 +25%').toBeGreaterThan(1.22);
    expect(newTreat.width / oldR.width, '치료메모 +25%').toBeLessThan(1.28);
    expect(newDoc.width / oldR.width, '의료진메모 +25%').toBeGreaterThan(1.22);
    expect(newDoc.width / oldR.width, '의료진메모 +25%').toBeLessThan(1.28);
  });

  test('AC2: 옛 비율(대조군) 우측 컬럼은 ≈20% — baseline 확인', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ok = await injectMemoRows(page);
    expect(ok).toBe(true);
    await assertMemoRatio(page, 'row-old', 'old-left', 'old-right', 0.20);
  });

  test('AC3: 모바일(390) — 두 메모 행 1단 세로 collapse(반응형 회귀 가드)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ok = await injectMemoRows(page);
    expect(ok).toBe(true);
    await page.screenshot({ path: 'evidence/T-20260615-foot-MEDCHART-MEMO-WIDTH-25P_AC3_mobile.png' });
    for (const [topId, botId] of [['new-tx', 'new-treatmemo'], ['new-clinical', 'new-doctormemo']] as const) {
      const t = await box(page, topId);
      const b = await box(page, botId);
      expect(t.y + t.height, `${topId} stacks above ${botId}`).toBeLessThanOrEqual(b.y + 2);
    }
  });
});
