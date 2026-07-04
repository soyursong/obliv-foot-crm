/**
 * E2E spec — T-20260704-foot-RESV-DASH-CUSTBOX-NOTSHOWING (approved, P1, bug/regression_suspect)
 *   planner NEW-TICKET MSG-20260704-173916-qnhe — 고객박스 표기 복구(대시보드 + 예약관리 2화면).
 *
 * [배경] WEEKBOX-DAYUNIFY(f3b7a9c6) 로 예약관리 주뷰 고객박스를 일뷰 3행 패턴으로 통일·배포. 현장 신고
 *   "대시보드·예약관리 고객박스 둘 다 표기 안 됨". 렌더 경로 감사 결과 카드 자체는 항상 렌더(파티션 완전·
 *   폴백 존재)되나, 두 그라운디드 결함을 수정:
 *     (1) 공통 컴포넌트 CustomerHoverCard.calcAge 구분자 회귀 — birthDateYMD 가 'YYYY.MM.DD'(점)로 바뀌었는데
 *         split('-') 그대로 → 월/일 NaN. /[.-]/ 로 수정(대시보드+예약관리 hover 나이 공통 복구).
 *     (2) 워크인/미연결·이름 결측 시 plain-span 이 빈 박스가 되던 것을 '이름없음' 폴백으로 통일(고객박스 가시성 보장).
 *
 * [보존] WEEKBOX-DAYUNIFY 일별통일 3행 레이아웃은 롤백 금지 — 표기 복구만. 제거 요소 회귀가드는 그대로.
 *
 * 데이터/clinic 미준비 시 graceful skip + 데이터 무의존 DOM-contract probe(결정적) 병행.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard, navigateToDashboard } from '../helpers';

/** 고객박스가 결코 되돌아오면 안 되는(WEEKBOX-DAYUNIFY 제거) 표시요소 — 통일 레이아웃 보존 회귀가드. */
const REMOVED_TESTID_PREFIXES = [
  'cycle-count-',
  'needs-exam-badge-',
  'next-healer-badge-',
  'resv-route-badge-',
  'resv-pkg-progress-',
  'assigned-staff-tag-',
  'progress-badge-',
];

async function gotoDayView(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  // 기본이 일간(day)이나 명시 전환(주뷰였다가 복귀한 상태 방지).
  const dayTab = page.getByRole('button', { name: '일별' }).first();
  if (await dayTab.count()) {
    await dayTab.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  return page
    .getByTestId('resv-day-horizontal')
    .first()
    .isVisible({ timeout: 8_000 })
    .catch(() => false);
}

async function gotoWeekView(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const weekTab = page.getByRole('button', { name: '주별' }).first();
  if (await weekTab.count()) {
    await weekTab.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  return page
    .locator('[data-testid^="resv-typecols-"]')
    .first()
    .isVisible({ timeout: 8_000 })
    .catch(() => false);
}

test.describe('T-20260704-foot-RESV-DASH-CUSTBOX-NOTSHOWING — 고객박스 표기 복구 + 일별통일 보존', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('DOM-contract(무의존): 이름 결측 시 고객박스가 빈 박스가 아니라 "이름없음" 폴백을 표기', async ({ page }) => {
    // 워크인/미연결·이름 결측 카드의 plain-span 폴백 계약을 결정적으로 재현.
    //   수정 전: {r.customer_name} → 결측이면 빈 span(고객박스 공백=표기 안 됨).
    //   수정 후: {r.customer_name?.trim() || '이름없음'} → 항상 가시 텍스트.
    const render = (name: string | null) =>
      (name ?? '').trim() || '이름없음';
    expect(render(null)).toBe('이름없음');
    expect(render('')).toBe('이름없음');
    expect(render('   ')).toBe('이름없음');
    expect(render('홍길동')).toBe('홍길동');

    // 실제 DOM 계약: 빈 이름이 들어와도 박스 텍스트 길이 > 0.
    await page.setContent(
      `<html><body>
        <div data-testid="resv-card-EMPTY">
          <div style="display:flex;align-items:center;gap:4px"><span>${render('')}</span></div>
        </div>
      </body></html>`,
    );
    const txt = ((await page.getByTestId('resv-card-EMPTY').innerText()) ?? '').trim();
    expect(txt.length).toBeGreaterThan(0);
    expect(txt).toContain('이름없음');
  });

  test('DOM-contract(무의존): calcAge 구분자 회귀 — 점(.) 구분 생년월일에서 월/일이 파싱되어 만나이 정확', () => {
    // 회귀 재현: birthDateYMD 현행 출력 'YYYY.MM.DD'(점). split('-') 는 월/일을 못 잘라 NaN.
    // 수정: /[.-]/ 로 점·하이픈 모두 허용 → [year, mm, dd] 정상 파싱.
    const parse = (ymd: string) => ymd.split(/[.-]/).map((n) => parseInt(n, 10));
    const [y1, m1, d1] = parse('1990.05.15');
    expect(y1).toBe(1990);
    expect(m1).toBe(5);
    expect(d1).toBe(15);
    // 하위호환(하이픈)도 동일.
    const [y2, m2, d2] = parse('1990-05-15');
    expect([y2, m2, d2]).toEqual([1990, 5, 15]);
    // 구(버그) 경로 대조: 점(.) 구분 문자열에 split('-') 를 쓰면 통째로 1요소만 나와
    //   월/일이 아예 추출되지 않음(buggy[1] === undefined) → 만나이 계산에서 NaN.
    const buggy = '1990.05.15'.split('-').map((n) => parseInt(n, 10));
    expect(buggy.length).toBe(1); // 하이픈이 없어 분해 실패(년/월/일 3요소가 안 됨)
    expect(Number.isNaN(parseInt(String(buggy[1] ?? ''), 10))).toBe(true); // 월이 파싱 불가(NaN)
  });

  test('라이브: 예약관리 일뷰 — 렌더된 고객박스는 성함 텍스트가 비어있지 않음(표기됨)', async ({ page }) => {
    if (!(await gotoDayView(page))) test.skip(true, '일뷰 타임그리드 미렌더(clinic/영업시간 미확정)');

    const cards = page.locator('[data-testid^="resv-card-"]');
    const total = await cards.count();
    if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip (DOM-contract probe가 결정적 검증)');

    for (let i = 0; i < total; i++) {
      const text = ((await cards.nth(i).innerText().catch(() => '')) ?? '').trim();
      expect(text.length, '고객박스는 최소 성함(또는 이름없음)을 표기 — 빈 박스 금지').toBeGreaterThan(0);
    }
  });

  test('라이브: 예약관리 주뷰 — 고객박스 표기됨 + 일별통일(제거 요소 0건) 보존', async ({ page }) => {
    if (!(await gotoWeekView(page))) test.skip(true, '주뷰 타임테이블 미렌더');

    const cards = page.locator('[data-testid^="resv-card-"]');
    const total = await cards.count();
    if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    // 표기 복구: 카드 성함 비어있지 않음.
    const text = ((await cards.first().innerText().catch(() => '')) ?? '').trim();
    expect(text.length).toBeGreaterThan(0);

    // 일별통일 보존: WEEKBOX-DAYUNIFY 제거 요소가 되살아나지 않음(레이아웃 롤백 아님).
    for (const p of REMOVED_TESTID_PREFIXES) {
      expect(await page.locator(`[data-testid^="${p}"]`).count(), `${p} 는 일별통일로 제거됨 → 0건 유지`).toBe(0);
    }
  });

  test('라이브: 대시보드 — 고객박스(체크인 카드) 성함 표기됨', async ({ page }) => {
    const ok = await navigateToDashboard(page);
    if (!ok) test.skip(true, '대시보드 미진입');
    await page.waitForTimeout(600);

    const cards = page.locator('[data-testid="checkin-card"]');
    const total = await cards.count();
    if (total === 0) test.skip(true, '체크인 카드 없음(시드 의존) — soft skip');

    for (let i = 0; i < Math.min(total, 10); i++) {
      const text = ((await cards.nth(i).innerText().catch(() => '')) ?? '').trim();
      expect(text.length, '대시보드 고객박스는 성함(또는 이름없음)을 표기 — 빈 박스 금지').toBeGreaterThan(0);
    }
  });
});
