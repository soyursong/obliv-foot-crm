/**
 * E2E (렌더 스모크) — T-20260701-foot-LIVESLOT-GLASS-APPLY
 * v2 컨펌 시안(parent T-20260630-foot-LIVESLOT-GLASS-SILVER-MOCKUP, 졸업) 정식 prod 적용.
 * 순수 FE/CSS — db_change=false. exempt=ef_only(동작 분기 없음) → 어서션은 렌더 스모크/스타일 invariant 수준.
 *
 * 적용 2 surface:
 *  A) 예약관리 day-view '실시간 반영' 현재시각 컬럼(isNow) — 반투명 유리 볼록(.live-glass)
 *     + 연한 실버 테두리(border-[#C7CDD4], v1 #BBBBBB 대비 lighten) + 깜빡(animate-live-border-pulse).
 *     SILVER-PULSE-CLIPFIX 위에 누적 — pulse/실버border 회귀 0, amber 잔재 0.
 *  B) 대시보드 상단 전광판(AssignmentNotifyBell marquee strip) — 동일 유리 볼록(.live-glass-board)
 *     + 연한 실버 + 깜빡(점등/소등 2위상). 볼록 box-shadow 비애니메이션 → 소등에서도 볼록감 유지.
 *
 * 가드: 힐러 #FFFDE7 미접촉(무채색 실버) · 콘솔에러 0 · 그리드/대시보드 정상 렌더.
 * 비파괴: 시드 없음(라이브 데이터). 대상(현재시각 컬럼/미읽음 알림) 없으면 graceful skip.
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

// 현재 시각 컬럼(isNow) = 실버 border 보유 day 컬럼. 영업외/타일자면 0개일 수 있음.
async function findLiveColumn(page: Page) {
  const cols = page.locator('[data-testid^="resv-day-col-"]');
  const n = await cols.count();
  for (let i = 0; i < n; i++) {
    const cls = (await cols.nth(i).getAttribute('class')) ?? '';
    if (cls.includes('border-[#C7CDD4]')) return { el: cols.nth(i), cls };
  }
  return null;
}

test.describe('T-20260701-foot-LIVESLOT-GLASS-APPLY — 유리 볼록 + 연한 실버 정식 적용', () => {
  // S1 — surface A(AC1): 현재시각 컬럼 = 유리(.live-glass) + 연한 실버(border-[#C7CDD4]) + 펄스. amber 잔재 0.
  test('S1: 예약관리 실시간 슬롯카드 = live-glass + 연한 실버 + pulse (SILVER-PULSE 회귀 0)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    const live = await findLiveColumn(page);
    if (!live) { test.info().annotations.push({ type: 'note', text: '현재 시각 컬럼(영업시간 내 today) 없음 → 스타일 검증 skip' }); return; }

    expect(live.cls, '반투명 유리 볼록(.live-glass) 보유').toContain('live-glass');
    expect(live.cls, '연한 실버 테두리(border-[#C7CDD4]) 보유').toContain('border-[#C7CDD4]');
    expect(live.cls, '테두리 깜빡임(pulse) 유지 — SILVER-PULSE 회귀 0').toContain('animate-live-border-pulse');
    // 구(舊) 진한 실버 잔재 0 (lighten 반영)
    expect(live.cls, '구 실버 #BBBBBB 잔재 0(lighten)').not.toContain('border-[#BBBBBB]');
    // 노랑/amber 완전 미접촉
    expect(live.cls, 'amber/yellow 잔재 0(힐러 미접촉)').not.toContain('amber');
    // 유리 반투명을 위해 isNow 컬럼은 불투명 bg-background 미적용
    expect(live.cls, 'isNow 컬럼은 유리 반투명 → bg-background 미적용').not.toContain('bg-background');
  });

  // S2 — surface B(AC2): 대시보드 상단 전광판(marquee strip) = live-glass-board + 연한 실버 + 펄스.
  test('S2: 대시보드 전광판 = live-glass-board + 연한 실버 + pulse(점등/소등 2위상)', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const marquee = page.getByTestId('assign-notify-marquee');
    if (!(await marquee.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.info().annotations.push({ type: 'note', text: '미읽음 배정 알림 0건 → 전광판 미노출, 스타일 검증 skip' });
      return;
    }
    const cls = (await marquee.getAttribute('class')) ?? '';
    expect(cls, '반투명 유리 볼록(.live-glass-board) 보유').toContain('live-glass-board');
    expect(cls, '연한 실버 테두리(border-[#C7CDD4]) 보유').toContain('border-[#C7CDD4]');
    expect(cls, '테두리 깜빡임(pulse, 점등/소등 2위상) 보유').toContain('animate-live-border-pulse');
    // 구 단색 gray 배경 잔재 0 (유리로 대체)
    expect(cls, '구 bg-gray-100 잔재 0(유리 대체)').not.toContain('bg-gray-100');
  });

  // S3 — 가드(AC3/AC4): 힐러 #FFFDE7 불변 + 콘솔에러 0 + 그리드 정상.
  test('S3: 힐러 #FFFDE7 불변 + 콘솔에러 0 + 그리드 정상 렌더', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    const healer = page.locator('.bg-healer-50');
    if ((await healer.count()) > 0) {
      const bg = await healer.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg.replace(/\s/g, ''), `힐러 카드 배경 #FFFDE7 불변 (got=${bg})`).toMatch(/^rgba?\(255,253,231/);
    } else {
      test.info().annotations.push({ type: 'note', text: '힐러(.bg-healer-50) 카드 없음 → 색 검증 skip' });
    }

    expect(consoleErrors, `콘솔 에러 0건 (got=${JSON.stringify(consoleErrors)})`).toHaveLength(0);
    await expect(page).toHaveURL(/reservations/);
  });
});
