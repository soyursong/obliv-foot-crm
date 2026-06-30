/**
 * E2E — T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX
 * 풋 예약관리(일간 TIMEGRID, day-view) '실시간 반영'(현재 시각 컬럼 isNow) 표현 2종. 순수 FE/CSS, DB 무변경.
 *
 *  [건1·버그] 현재시각 컬럼 노란 ring(ring-amber-400=box-shadow)이 부모 overflow-x-auto(→overflow-y auto 계산)에
 *             좌·하단 짤림(10:00=첫 컬럼). → ring(box-shadow) 제거, border(박스모델 내부)로 전환 = 클립 근본 해소.
 *  [건2·UX]   노랑 제거 → 실버 border + 테두리 깜빡임(animate-live-border-pulse, motion-safe).
 *             헤더 노랑(bg-amber-50) → 실버(bg-slate-100). 힐러 #FFFDE7(healer 토큰) 미접촉.
 *  [후속]     T-20260701-foot-LIVESLOT-GLASS-APPLY: 실버 톤 lighten(#BBBBBB→#C7CDD4) + 유리(.live-glass) 누적.
 *             본 회귀 spec의 실버 border 색 기준도 #C7CDD4로 갱신(깜빡/클립해소 동작 불변).
 *
 * 검증(현장 클릭 시나리오 → DOM 구조/스타일 invariant):
 *  S1 클립해소 : day-view 시간 컬럼에 ring-amber-400(짤림 유발 box-shadow) 클래스 0건. (상시 검증)
 *  S2 실버·펄스: 현재시각 컬럼이 존재하면 border-[#C7CDD4] + animate-live-border-pulse 보유 + amber 미보유,
 *               헤더는 bg-slate-100(bg-amber-50 잔재 0). (현재시각 컬럼 없으면 graceful skip)
 *  S3 힐러보존 : .bg-healer-50 요소의 실제 배경색 = #FFFDE7(rgb(255,253,231)) 불변 + 그리드 정상 렌더 + 콘솔에러 0.
 *
 * 비파괴: 시드 없음(라이브 데이터/스타일 검증, 대상 0이면 graceful skip). 데이터·로직·라우팅 무변경.
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
    await page.waitForURL(/\/(dashboard|reservations|$)/, { timeout: 10000 });
  }
}

// 현재 시각 컬럼(isNow) = border-[#C7CDD4] 보유 day 컬럼. 영업외/타일자면 0개일 수 있음.
async function findLiveColumn(page: Page) {
  const cols = page.locator('[data-testid^="resv-day-col-"]');
  const n = await cols.count();
  for (let i = 0; i < n; i++) {
    const cls = (await cols.nth(i).getAttribute('class')) ?? '';
    if (cls.includes('border-[#C7CDD4]')) return { el: cols.nth(i), cls };
  }
  return null;
}

test.describe('T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX — 실시간 반영 실버·펄스 + 클립 해소', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // S1 — 건1(AC1): 짤림 유발 노란 ring(box-shadow) 제거. day 컬럼에 ring-amber-400 클래스 0건.
  test('S1: day-view 시간 컬럼에 ring-amber-400(클립 유발 box-shadow) 클래스 0건', async ({ page }) => {
    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    const cols = page.locator('[data-testid^="resv-day-col-"]');
    const n = await cols.count();
    expect(n, '일간 시간 컬럼이 렌더되어야 함').toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const cls = (await cols.nth(i).getAttribute('class')) ?? '';
      expect(cls, `컬럼 ${i}: 노란 ring(ring-amber-400) 잔재 0 (cls=${cls})`).not.toContain('ring-amber-400');
    }
  });

  // S2 — 건2(AC2/AC3): 현재시각 컬럼 = 실버 border + 펄스, 노랑 제거, 헤더 bg-slate-100.
  test('S2: 현재시각 컬럼은 실버(#C7CDD4) border + animate-live-border-pulse, amber 잔재 0, 헤더 bg-slate-100', async ({ page }) => {
    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    const live = await findLiveColumn(page);
    if (!live) { test.info().annotations.push({ type: 'note', text: '현재 시각 컬럼(영업시간 내 today) 없음 → 스타일 검증 skip' }); return; }

    // 실버 border + 테두리 깜빡임(pulse)
    expect(live.cls, '실버 #C7CDD4 border 보유').toContain('border-[#C7CDD4]');
    expect(live.cls, '테두리 깜빡임(pulse) 애니메이션 보유').toContain('animate-live-border-pulse');
    // 노랑 완전 제거
    expect(live.cls, 'amber/yellow ring 잔재 0').not.toContain('ring-amber-400');
    expect(live.cls).not.toContain('amber');

    // 현재시각 컬럼 헤더 = 실버(bg-slate-100), 노랑(bg-amber-50) 잔재 0
    const header = live.el.locator('[data-testid^="resv-day-hslot-"]');
    const hcls = (await header.getAttribute('class')) ?? '';
    expect(hcls, '현재시각 헤더 실버 배경(bg-slate-100)').toContain('bg-slate-100');
    expect(hcls, '현재시각 헤더 노랑(bg-amber-50) 잔재 0').not.toContain('bg-amber-50');
  });

  // S3 — 건2(AC4): 힐러 #FFFDE7 미접촉 + (AC5) 그리드 정상 + 콘솔에러 0.
  test('S3: 힐러 .bg-healer-50 배경 = #FFFDE7(rgb(255,253,231)) 불변 + 그리드 정상 + 콘솔에러 0', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('resv-day-xaxis')).toBeVisible();

    // 힐러 토큰 보존: 화면에 healer-50 요소가 있으면 실제 배경색이 #FFFDE7 그대로여야 함.
    const healer = page.locator('.bg-healer-50');
    const hc = await healer.count();
    if (hc > 0) {
      const bg = await healer.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      // #FFFDE7 = rgb(255, 253, 231) (alpha 표기 차 허용)
      expect(bg.replace(/\s/g, ''), `힐러 카드 배경 #FFFDE7 불변 (got=${bg})`).toMatch(/^rgba?\(255,253,231/);
    } else {
      test.info().annotations.push({ type: 'note', text: '힐러(.bg-healer-50) 카드 없음 → 색 검증 skip (토큰 정의는 회귀가드 외)' });
    }

    // 콘솔 에러 0 (라우팅·렌더 회귀 가드)
    expect(consoleErrors, `콘솔 에러 0건 (got=${JSON.stringify(consoleErrors)})`).toHaveLength(0);
    await expect(page).toHaveURL(/reservations/);
  });
});
