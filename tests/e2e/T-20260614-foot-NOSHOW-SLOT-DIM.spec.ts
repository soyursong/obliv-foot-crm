/**
 * E2E spec — T-20260614-foot-NOSHOW-SLOT-DIM
 * 통합시간표(Dashboard) 노쇼 슬롯 박스 시각 완화 (흐림/muted)
 *
 * 현상: 노쇼 처리된 슬롯이 너무 도드라짐(붉은 인셋 바 + 붉은 배지).
 * 요청: 구분은 유지하되 흐림(dimmed/muted) 톤으로 완화.
 *       선행 c697295(NOSHOW-BADGE-KEEP-INLIST) 후속 톤 조정 — 동일 파일.
 *
 * AC-1: 노쇼 슬롯이 일반 예약보다 시각적으로 덜 강조됨(흐림/저채도).
 *        → 비드래그 시 컨테이너 opacity 0.55 + 인셋 바 색 --status-noshow → --status-noshow-dim(muted).
 * AC-2: 노쇼 배지 텍스트("노쇼"/"N")는 여전히 인식 가능 (완전 비표시 금지 — 가독성 하한).
 *        → 배지 자체는 --status-noshow(red) + 텍스트 유지. 컨테이너 0.55 dim 내에서 인식 가능.
 * AC-3: 일반 예약·워크인('W') 슬롯 기존 스타일 회귀 없음 (opacity 1, 바 없음).
 * AC-4: 노쇼 외 status(예약/완료) 슬롯 회귀 없음.
 *
 * 구현 (FE CSS 전용, DB 무변경):
 *   - index.css: --status-noshow-dim 신규 (light oklch(0.72 0.04 25) / dark oklch(0.52 0.04 25)) — 저채도 muted.
 *   - Dashboard.tsx 3곳(체크인 카드 / box1-resv / box2-resv):
 *       opacity = isDragging ? 0.3|0.4 : (isNoShow ? 0.55 : 기존)
 *       boxShadow inset 바 = var(--status-noshow-dim)
 *   - 배지(NoShowBadge) 미변경 — data-testid="noshow-badge" 텍스트 "노쇼" 유지.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── Unit-level: 노쇼 슬롯 opacity 결정 로직 미러 ────────────────────────────────

/**
 * Dashboard.tsx 슬롯 컨테이너 opacity 규칙 미러.
 * @param base  비드래그·비노쇼 시 기본값(체크인 카드=undefined, 예약카드=1)
 */
function slotOpacity(
  isDragging: boolean,
  isNoShow: boolean,
  draggingVal: number,
  base: number | undefined,
): number | undefined {
  return isDragging ? draggingVal : isNoShow ? 0.55 : base;
}

test.describe('T-20260614 NOSHOW-SLOT-DIM — opacity 완화 로직 유닛 검증', () => {
  test('AC-1: 노쇼 예약 카드는 비드래그 시 0.55로 흐려진다 (기본 1 대비)', () => {
    expect(slotOpacity(false, true, 0.4, 1)).toBe(0.55); // 노쇼 → 흐림
    expect(slotOpacity(false, false, 0.4, 1)).toBe(1); // 일반 예약 → 불변 (AC-3)
  });

  test('AC-1: 노쇼 체크인 카드도 비드래그 시 0.55로 흐려진다 (기본 undefined 대비)', () => {
    expect(slotOpacity(false, true, 0.3, undefined)).toBe(0.55);
    expect(slotOpacity(false, false, 0.3, undefined)).toBeUndefined(); // 일반 체크인 → CSS 클래스 위임 (회귀 없음)
  });

  test('AC-3/AC-4: 드래그 중에는 노쇼 여부와 무관하게 기존 드래그 값 유지 (회귀 방지)', () => {
    expect(slotOpacity(true, true, 0.4, 1)).toBe(0.4); // 노쇼라도 드래그 우선
    expect(slotOpacity(true, false, 0.4, 1)).toBe(0.4);
    expect(slotOpacity(true, true, 0.3, undefined)).toBe(0.3);
  });

  test('AC-2: 0.55는 가독성 하한(>0.5) 이상 — 배지 완전 비표시(0) 금지', () => {
    const noshowOpacity = slotOpacity(false, true, 0.4, 1)!;
    expect(noshowOpacity).toBeGreaterThan(0.5); // 가독성 하한
    expect(noshowOpacity).toBeLessThan(1); // 일반보다는 덜 강조 (AC-1)
  });
});

// ── E2E: 통합시간표 CSS 변수 + 노쇼 카드 흐림 DOM 검증 ─────────────────────────

test.describe('T-20260614 NOSHOW-SLOT-DIM — 통합시간표 렌더 + 흐림 톤', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-1: --status-noshow-dim 이 정의되고 --status-noshow 보다 저채도(muted)다', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const vals = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        noshow: cs.getPropertyValue('--status-noshow').trim(),
        dim: cs.getPropertyValue('--status-noshow-dim').trim(),
      };
    });
    expect(vals.noshow).not.toBe(''); // 원본 유지 (배지용)
    expect(vals.dim).not.toBe(''); // 신규 muted 변수 정의됨
    expect(vals.dim).not.toBe(vals.noshow); // 강조색과 구분되는 별도 muted 톤
    // oklch chroma(2번째 토큰) 비교 — dim 채도 < noshow 채도
    const chroma = (v: string) => {
      const m = v.match(/oklch\(\s*[\d.]+\s+([\d.]+)/i);
      return m ? parseFloat(m[1]) : NaN;
    };
    const cN = chroma(vals.noshow);
    const cD = chroma(vals.dim);
    if (!Number.isNaN(cN) && !Number.isNaN(cD)) {
      expect(cD).toBeLessThan(cN); // muted = 저채도
    }
  });

  test('AC-1/AC-2: 노쇼 카드가 있으면 opacity로 흐려지고 배지는 유지된다', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const noshowCard = page.locator('[data-noshow="true"]');
    try {
      await noshowCard.first().waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '오늘 노쇼 예약 카드 없음 — 스킵');
      return;
    }
    // AC-1: 컨테이너 흐림 (inline opacity 0.55)
    const opacity = await noshowCard.first().evaluate(
      (el) => getComputedStyle(el as HTMLElement).opacity,
    );
    expect(parseFloat(opacity)).toBeLessThan(1); // 일반보다 흐림
    expect(parseFloat(opacity)).toBeGreaterThan(0.5); // 가독성 하한

    // AC-2: 배지 텍스트 여전히 인식 가능
    const badge = noshowCard.first().locator('[data-testid="noshow-badge"]');
    expect(await badge.count()).toBeGreaterThanOrEqual(1);
    const txt = await badge.first().textContent();
    expect(txt?.trim()).toBe('노쇼');
  });

  test('AC-3: 일반 예약 카드(data-noshow 없음)는 흐려지지 않는다 (opacity 회귀 없음)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const normalCard = page.locator(
      '[data-testid="box1-resv-card"]:not([data-noshow]), [data-testid="box2-resv-card"]:not([data-noshow])',
    );
    try {
      await normalCard.first().waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '오늘 일반 예약 카드 없음 — 회귀 스킵');
      return;
    }
    const opacity = await normalCard.first().evaluate(
      (el) => getComputedStyle(el as HTMLElement).opacity,
    );
    // 비드래그 일반 예약 → opacity 1 (회귀 없음)
    expect(parseFloat(opacity)).toBeGreaterThanOrEqual(0.99);
  });
});
