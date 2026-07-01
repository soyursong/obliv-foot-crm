/**
 * E2E (렌더 스모크) — T-20260701-foot-DASH-SCREENSHOT-GLASS-APPLY
 * 대시보드 '스크린샷' 영역(reporter 김주연 총괄 20260630_110631.png 빨간박스 = 평면 박스 카드/칩)을
 * 앞서 컨펌된 v2 유리 볼록 + 연한 실버(.live-glass-board, LIVESLOT-GLASS-APPLY commit 6ff8b291) 그대로 통일 적용.
 * 순수 FE/CSS — db_change=false. exempt=ef_only(동작 분기 없음) → 어서션은 렌더 스모크/스타일 invariant 수준.
 *
 * 적용 대상(별개 surface, 슬롯/전광판과 별개):
 *  ① 사이드바 결제대기 뱃지(대시보드·일마감 옆 amber '2' 칩) — amber → .live-glass-board + 연한 실버(border-[#C7CDD4]).
 *  ② 달력 선택 날짜 칩(teal-600) — .live-glass-board + 연한 실버.
 *  ③ 뷰모드(당일/일/주/월) 활성 버튼(teal-600) — .live-glass-board + 연한 실버.
 * live 아님 → pulse(animate-live-border-pulse) 미적용(정적 유리). 신규 스타일 창작 X — 확정 클래스 재사용.
 *
 * 가드: 힐러 노랑 #FFFDE7 미접촉(무채색 실버) · 콘솔에러 0 · 대시보드 정상 렌더.
 * 비파괴: 시드 없음(라이브 데이터). 대상(결제대기 뱃지 등) 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|admin|$)/, { timeout: 10000 });
  }
}

function todayKey() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test.describe('T-20260701-foot-DASH-SCREENSHOT-GLASS-APPLY — 대시보드 칩 유리 볼록+연한 실버 통일', () => {
  // S1(AC1) — 대시보드 칩(선택 날짜 + 뷰모드 활성)이 유리(.live-glass-board) + 연한 실버(border-[#C7CDD4])로 렌더.
  test('S1: 달력 선택날짜 칩 + 뷰모드 활성 버튼 = live-glass-board + 연한 실버', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 선택 날짜 칩(기본 선택 = 오늘). 사이드바 달력이 접혀 있으면 skip.
    const todayCell = page.getByTestId(`cal-day-${todayKey()}`);
    if (await todayCell.isVisible({ timeout: 6000 }).catch(() => false)) {
      const cls = (await todayCell.getAttribute('class')) ?? '';
      expect(cls, '선택 날짜 칩 = 반투명 유리 볼록(.live-glass-board)').toContain('live-glass-board');
      expect(cls, '선택 날짜 칩 = 연한 실버 테두리(border-[#C7CDD4])').toContain('border-[#C7CDD4]');
      expect(cls, '선택 날짜 칩 = teal-600 잔재 0(실버 통일)').not.toContain('bg-teal-600');
    } else {
      test.info().annotations.push({ type: 'note', text: '사이드바 달력 미노출(접힘) → 칩 스타일 검증 skip' });
    }

    // 뷰모드 활성 버튼 — '당일/일/주/월' 중 활성 1개가 유리.
    const modeBtns = page.getByRole('button', { name: /^(당일|일|주|월)$/ });
    const mn = await modeBtns.count();
    let glassActive = 0;
    for (let i = 0; i < mn; i++) {
      const c = (await modeBtns.nth(i).getAttribute('class')) ?? '';
      if (c.includes('live-glass-board')) {
        glassActive++;
        expect(c, '뷰모드 활성 = 연한 실버 테두리').toContain('border-[#C7CDD4]');
      }
    }
    if (mn > 0) {
      expect(glassActive, '뷰모드 활성 버튼 1개가 유리(.live-glass-board)').toBeGreaterThanOrEqual(1);
    }
  });

  // S1b(AC1) — 결제대기 뱃지(있을 때)가 유리 + 연한 실버, amber 잔재 0.
  test('S1b: 사이드바 결제대기 뱃지 = live-glass-board + 연한 실버(amber 잔재 0)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 결제대기 0건이면 뱃지 미렌더 → graceful skip.
    const badge = page.locator('span[title^="결제대기"]').first();
    if (await badge.isVisible({ timeout: 4000 }).catch(() => false)) {
      const cls = (await badge.getAttribute('class')) ?? '';
      expect(cls, '결제대기 뱃지 = 유리(.live-glass-board)').toContain('live-glass-board');
      expect(cls, '결제대기 뱃지 = 연한 실버 테두리').toContain('border-[#C7CDD4]');
      expect(cls, '결제대기 뱃지 = amber 잔재 0').not.toContain('bg-amber-500');
    } else {
      test.info().annotations.push({ type: 'note', text: '결제대기 0건 → 뱃지 미렌더, skip' });
    }
  });

  // S2(AC2) — 무회귀: 힐러 노랑(#FFFDE7) 미접촉 + 콘솔에러 0 + 대시보드 정상 렌더.
  test('S2: 힐러 노랑 무회귀 + 콘솔에러 0 + 대시보드 렌더', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 대시보드 루트 정상 렌더.
    await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 8000 });

    // 힐러 노랑(#FFFDE7)을 이번 티켓이 침범하지 않음 — 유리 클래스에 healer 노랑 토큰 잔재 0.
    const glassEls = page.locator('.live-glass-board');
    const gn = await glassEls.count();
    for (let i = 0; i < gn; i++) {
      const c = (await glassEls.nth(i).getAttribute('class')) ?? '';
      expect(c, '유리 칩에 healer 노랑(#FFFDE7) 미혼입').not.toContain('FFFDE7');
    }

    const fatal = errors.filter((e) => !/favicon|net::ERR|ResizeObserver|Failed to load resource/i.test(e));
    expect(fatal, `콘솔 치명 에러 0 (실제: ${fatal.join(' | ')})`).toHaveLength(0);
  });
});
