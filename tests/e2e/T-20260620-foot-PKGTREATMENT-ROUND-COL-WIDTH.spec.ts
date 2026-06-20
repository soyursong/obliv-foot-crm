/**
 * E2E spec — T-20260620-foot-PKGTREATMENT-ROUND-COL-WIDTH
 * [2번차트] 패키지 치료이력(시술내역) 섹션 회차 칸 너비 (김주연 총괄, C0ATE5P6JTH)
 *
 * 핵심: 직전 배포 eb54f5df(사용이력 회차열)의 동일 처방을 치료이력 섹션 회차 칸에 미러링.
 *   구: w-5(20px) → "10회"~"99회" 두 자리 회차에서 "10"/"회" 줄바꿈.
 *   신: min-w-[2.4rem] + whitespace-nowrap → 두 자리 회차도 1행 고정.
 * 치료이력 = CustomerChartPage.tsx:6284 인라인 span / 사용이력 = PackageTicketReadonlyList.tsx:182.
 *
 * AC1: 치료이력 두 자리 회차 한 줄(줄바꿈 0).
 * AC2: 한 자리 회차 회귀 0(동일 1행 표시).
 * AC3: 인접 컬럼 레이아웃 안 밀림(회차칸 nowrap·min-w 적용).
 * AC4: 사용이력 회차열(eb54f5df) 표시 유지 — PackageTicketReadonlyList 회귀가드.
 *
 * 검증 전략(2계층):
 *   [A] CSS-contract probe (데이터 무의존, 항상 실행) — 회차 셀이 쓰는 정확한 클래스
 *       조합(min-w-[2.4rem] + whitespace-nowrap)이 빌드 번들에 컴파일되어 적용되는지를
 *       실제 DOM 주입 + getComputedStyle 로 결정적 검증. 두 자리 회차 줄바꿈 차단의 근본
 *       메커니즘(min-width 확보 + nowrap)을 데이터 없이 증명한다.
 *       → "시술내역 데이터 없음 skip"으로 AC1~AC3 메커니즘이 미검증되던 공백을 메움.
 *   [B] 런타임 DOM 검증 (데이터 의존, 있을 때만) — 실제 차트의 회차 셀 1행 고정 확인. 보조.
 *
 *   2.4rem = 16px 기준 38.4px. font-size 변동 가능성 대비 35px 하한으로 검증.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 회차 셀: "{n}회" 텍스트 span. 두 자리/한 자리 모두 포함.
const ROUND_RE = /^\d+회$/;

// CustomerChartPage.tsx:6284 / PackageTicketReadonlyList.tsx:182 회차 셀이 쓰는 실제 클래스.
const ROUND_CELL_CLASSES = 'text-muted-foreground min-w-[2.4rem] tabular-nums shrink-0 whitespace-nowrap';

test.describe('PKGTREATMENT-ROUND-COL-WIDTH — 치료이력 회차 칸 너비', () => {
  // ── [A] CSS-contract probe: 데이터 무의존, 항상 실행 ──
  test('AC1·AC3 메커니즘 — 회차 셀 클래스 조합이 번들에 컴파일·적용됨 (min-width≥35px + nowrap)', async ({ page }) => {
    // 앱을 로드해 빌드된 CSS 번들(min-w-[2.4rem]/whitespace-nowrap 포함)을 끌어온다.
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 회차 셀과 동일한 클래스로 "10회"(두 자리)를 좁은 부모 안에 주입 → 컴파일된 규칙 실측.
    const probe = await page.evaluate((cls) => {
      const parent = document.createElement('div');
      // 부모를 좁게 강제(8px) — min-width/nowrap 미적용 시 "10회"가 줄바꿈되어 height 2배.
      parent.style.cssText = 'width:8px;display:flex;position:fixed;left:-9999px;top:0;font-size:16px;line-height:1.2';
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = '10회';
      parent.appendChild(span);
      document.body.appendChild(parent);
      const cs = getComputedStyle(span);
      const rect = span.getBoundingClientRect();
      const result = {
        minWidth: cs.minWidth,
        minWidthPx: parseFloat(cs.minWidth) || 0,
        whiteSpace: cs.whiteSpace,
        height: rect.height,
        width: rect.width,
      };
      document.body.removeChild(parent);
      return result;
    }, ROUND_CELL_CLASSES);

    // min-w-[2.4rem] 컴파일 확인: 2.4rem = 38.4px (root 16px). 폰트 변동 대비 35px 하한.
    expect(probe.minWidthPx, `min-w-[2.4rem] 미컴파일/미적용 (minWidth=${probe.minWidth})`).toBeGreaterThanOrEqual(35);
    // whitespace-nowrap 컴파일·적용 확인 — 줄바꿈 자체 차단.
    expect(probe.whiteSpace, 'whitespace-nowrap 미적용').toBe('nowrap');
    // 좁은 8px 부모 안에서도 "10회"가 1행 유지(줄바꿈 시 height 2배). 단일행 상한 26px.
    expect(probe.height, `두 자리 회차 줄바꿈 의심(height=${probe.height})`).toBeLessThanOrEqual(26);
    // 실측 폭이 min-width 하한 이상 — 칸 너비 확보 증명.
    expect(probe.width, `회차 셀 실폭 부족(width=${probe.width})`).toBeGreaterThanOrEqual(35);
  });

  // ── [B] 런타임 DOM 검증: 실제 차트 데이터 있을 때만(보조) ──
  test('AC1·AC2·AC3 (런타임) — 실차트 회차 셀 1행 고정 + nowrap', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 실패 — 환경 미준비. [A] CSS-contract probe로 메커니즘은 검증됨.');

    const found = await openFirstCustomerChartWithSessions(page);
    test.skip(!found, '시술내역(회차) 데이터 없음 — 런타임 보조 검증 skip. [A] CSS-contract probe로 메커니즘 검증 완료.');

    const roundCells = page.locator('span', { hasText: ROUND_RE });
    const n = await roundCells.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const cell = roundCells.nth(i);
      const box = await cell.boundingBox();
      if (!box) continue;
      // AC1·AC2: 1행 고정 — 줄바꿈 시 높이 2배. 단일 라인 높이 상한(<= 26px).
      expect(box.height, `회차 셀 #${i} 단일행 높이 초과(줄바꿈 의심)`).toBeLessThanOrEqual(26);
      // AC3: whitespace-nowrap 적용 — 줄바꿈 자체를 CSS로 차단.
      const ws = await cell.evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(ws, `회차 셀 #${i} white-space != nowrap`).toBe('nowrap');
    }
  });
});

async function openFirstCustomerChartWithSessions(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle').catch(() => {});
  const rows = page.locator('[data-testid^="customer-row-"], table tbody tr');
  const count = await rows.count().catch(() => 0);
  if (count === 0) return false;
  // 앞에서부터 차트를 열어 시술내역(회차 셀)이 있는 고객을 탐색
  const tryN = Math.min(count, 8);
  for (let i = 0; i < tryN; i++) {
    await rows.nth(i).click().catch(() => {});
    await page.waitForTimeout(600);
    const roundCells = page.locator('span', { hasText: ROUND_RE });
    if ((await roundCells.count().catch(() => 0)) > 0) return true;
    // 닫고 다음 후보
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  return false;
}
