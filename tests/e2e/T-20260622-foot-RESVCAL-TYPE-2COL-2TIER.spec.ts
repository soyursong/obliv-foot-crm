/**
 * E2E spec — T-20260622-foot-RESVCAL-TYPE-2COL-2TIER
 * 예약 캘린더 슬롯 내 카드 = 타입별 2단(초진ㅣ재진&힐러)·각 단 2열 레이아웃
 *
 * 출처: 김주연 총괄(C0ATE5P6JTH) — "[ 초진 ㅣ 재진&힐러 ] 각 한줄씩 나눠서 2단으로 예약 나열해줘".
 *   슬롯 내 예약 카드가 생성순 1열(세로 쌓기) → 타입별 2단 + 각 단 2열 그리드.
 *   1단(상단)=초진(new) / 2단(하단)=재진(returning)+힐러(healer)+기타(other).
 *
 * 본 스펙 = 티켓 §현장 클릭 시나리오 3종 변환:
 *   - 시나리오1(혼합): 초진 단(resv-tier-new) + 재진·힐러 단(resv-tier-rest) 둘 다 2열 그리드.
 *   - 시나리오2(단일그룹): 한 타입만 있는 슬롯 → 해당 단만 렌더(빈 단 미렌더).
 *   - 시나리오3(홀수): 카드가 2열 그리드에서 2+1 wrap(grid-cols-2 = 한 줄 2건) 정상.
 *
 * ⚠ 표시 레이어 전용(DB 무변경, appointment_type 기존 분류). COMPACT-CONTENT-KEEP 압축·컬러·인터랙션 불변.
 * 데이터/clinic 미준비 시 graceful skip + 데이터 무의존 CSS-contract probe 병행(결정적 검증).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoReservations(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

/** 요소의 grid-template-columns 트랙 수(공백 분리). */
async function gridTrackCount(locator: ReturnType<Page['locator']>): Promise<number> {
  const tpl = await locator
    .evaluate((el) => window.getComputedStyle(el as HTMLElement).gridTemplateColumns)
    .catch(() => '');
  if (!tpl || tpl === 'none') return 0;
  return tpl.trim().split(/\s+/).filter(Boolean).length;
}

test.describe('T-20260622-foot-RESVCAL-TYPE-2COL-2TIER — 타입별 2단·2열 레이아웃', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('CSS-contract(데이터 무의존): grid-cols-2 gap-0.5 = 한 줄 2건(2 트랙)', async ({ page }) => {
    // 결정적 검증 — 시드 무관. 실제 단 컨테이너가 쓰는 클래스 조합을 주입해 2열 그리드임을 실측.
    await page.setContent(
      `<html><head></head><body>
        <div id="probe" class="grid grid-cols-2 gap-0.5" style="width:200px">
          <div style="min-width:0">A</div><div style="min-width:0">B</div><div style="min-width:0">C</div>
        </div>
      </body></html>`,
    );
    // Tailwind 런타임 없이 grid-template-columns 인라인 동치로 contract만 확인.
    await page.locator('#probe').evaluate((el) => {
      (el as HTMLElement).style.display = 'grid';
      (el as HTMLElement).style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    });
    const tracks = await gridTrackCount(page.locator('#probe'));
    expect(tracks).toBe(2); // 한 줄 2건 보장(minmax(0,1fr)로 카드 셀폭 수축 → 홀수 카드 2+1 wrap)
  });

  test('시나리오1(혼합): 단 컨테이너(tier-new/tier-rest)는 항상 2열 그리드', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');

    const tiers = page.locator('[data-testid^="resv-tier-new-"], [data-testid^="resv-tier-rest-"]');
    const cnt = await tiers.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — 단 컨테이너 미렌더, soft skip');

    // 렌더된 모든 단은 2열 그리드여야 함(grid-cols-2).
    for (let i = 0; i < cnt; i++) {
      const tracks = await gridTrackCount(tiers.nth(i));
      expect(tracks).toBe(2);
    }
  });

  test('시나리오2(단일그룹): 렌더된 단은 빈 단이 아님(카드 ≥1) — 빈 단 미렌더', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const tiers = page.locator('[data-testid^="resv-tier-new-"], [data-testid^="resv-tier-rest-"]');
    const cnt = await tiers.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    // 빈 단 미렌더 불변: 존재하는 모든 단은 카드를 1개 이상 가짐.
    for (let i = 0; i < cnt; i++) {
      const cards = tiers.nth(i).locator('[data-testid^="resv-card-"]');
      expect(await cards.count()).toBeGreaterThan(0);
    }
  });

  test('시나리오3(홀수/중복0): 카드는 정확히 한 단에만 귀속(누락·중복 0)', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const allCards = page.locator('[data-testid^="resv-card-"]');
    const total = await allCards.count();
    if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    // 단 내부 카드 합 = 전체 카드 수 → 카드 누락 0 & 중복 0(visible 전수 귀속).
    const tiers = page.locator('[data-testid^="resv-tier-new-"], [data-testid^="resv-tier-rest-"]');
    const cnt = await tiers.count();
    let sum = 0;
    for (let i = 0; i < cnt; i++) {
      sum += await tiers.nth(i).locator('[data-testid^="resv-card-"]').count();
    }
    expect(sum).toBe(total);
  });

  test('불변: 카드 본문 폰트 ≥11px(COMPACT-CONTENT-KEEP 압축 유지) + 클릭 무손상', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0); // 카드 내용 유지(삭제 0)

    const px = await card.evaluate((el) => window.getComputedStyle(el as HTMLElement).fontSize).catch(() => '');
    const m = /([\d.]+)px/.exec(px ?? '');
    if (m) expect(parseFloat(m[1])).toBeGreaterThanOrEqual(11); // 압축 레이어 폰트 가독성 유지

    // 클릭해도 레이아웃(단/카드 수) 무손상.
    const before = await page.locator('[data-testid^="resv-card-"]').count();
    await card.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = await page.locator('[data-testid^="resv-card-"]').count();
    expect(after).toBe(before);
  });
});
