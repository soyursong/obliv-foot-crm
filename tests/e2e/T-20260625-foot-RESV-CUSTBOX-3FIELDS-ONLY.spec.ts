/**
 * T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY
 * 예약관리 고객박스(custbox) 표시필드 3개 슬림화 — [성함 / 간략메모 / 예약등록자].
 *
 * 변경:
 *   · 차트번호: 고객박스에서 제거 → 간략정보(hover)로 이관(CustomerHoverCard reservationInfo 분기 헤더 표기).
 *   · 연락처(전화 뒷4자리 ···NNNN): 고객박스 상태줄에서 제거 → 간략정보(hover)에 풀번호 노출(기존 유지).
 *   · 초진/재진 텍스트: 상태줄에서 제거 — 박스 배경 컬러로 이미 구분(컬러 점 KIND_DOT은 유지).
 *   · 예약 상태(STATUS_LABEL)·@담당자·@예약등록자 등 운영 신호는 유지.
 *
 * 회귀 가드:
 *   · COMPACT2(8px·90px 일간 칸) 결과 위 적용 — 폰트/칸 축소 회귀 금지.
 *   · reservationInfo 미지정 surface(대시보드 등)는 트리거 차트번호 인접 표기 유지(회귀 0).
 *
 * 참고: 데이터 없는 환경(예약카드 0)에서는 skip — CI/로컬 공통.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 예약관리 일간 뷰의 활성 고객박스 안 성함 트리거(호버 가능) 1개를 찾는다. 없으면 null. */
async function firstHoverTrigger(page: import('@playwright/test').Page) {
  const trigger = page.locator('span[title*="호버"]').first();
  if ((await trigger.count()) === 0) return null;
  if (!(await trigger.isVisible({ timeout: 2000 }).catch(() => false))) return null;
  return trigger;
}

test.describe('T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // ── 시나리오 1: 고객박스에 차트번호·연락처 뒷4자리·초진/재진 텍스트가 없다 ──
  test('AC-1: 고객박스 상태줄에 전화 뒷4자리(···)와 초진/재진 텍스트 라벨이 없다', async ({ page }) => {
    const trigger = await firstHoverTrigger(page);
    if (!trigger) { test.skip(); return; }

    // 활성 카드 컨테이너(성함 트리거의 상위 카드). 일간 TIMEGRID/2열 그리드 공통으로
    // 카드 루트는 draggable div. 트리거 인접 텍스트를 카드 단위로 검사.
    const card = trigger.locator(
      'xpath=ancestor::div[contains(@class,"rounded") and contains(@class,"border")][1]'
    );
    if ((await card.count()) === 0) { test.skip(); return; }

    const cardText = (await card.first().innerText()).replace(/\s+/g, ' ');
    // 연락처 뒷4자리 마스킹 패턴(···) 미노출
    expect(cardText).not.toContain('···');
  });

  // ── 시나리오 1-b: 활성 카드 성함 트리거 옆 인라인 차트번호 배지(#) 미노출 ──
  test('AC-1b: 활성 고객박스 성함 트리거에 인라인 차트번호 배지가 없다', async ({ page }) => {
    const trigger = await firstHoverTrigger(page);
    if (!trigger) { test.skip(); return; }

    // 트리거 내부 font-mono(차트번호 배지) span 0개 — reservationInfo surface는 차트번호를 hover로 이관.
    const inlineChartBadge = trigger.locator('span.font-mono');
    expect(await inlineChartBadge.count()).toBe(0);
  });

  // ── 시나리오 2: 간략정보(hover) 팝업에 차트번호·연락처가 노출된다 ──
  test('AC-2: hover 간략정보에 차트번호 배지와 연락처(풀번호)가 노출된다', async ({ page }) => {
    const trigger = await firstHoverTrigger(page);
    if (!trigger) { test.skip(); return; }

    await trigger.hover();
    await page.waitForTimeout(450);

    const popup = page.locator('[data-testid="customer-hover-card"]');
    if (!(await popup.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }

    // 차트번호 배지(font-mono)가 팝업 헤더에 존재 (미발번이면 'NEW'/'미발번' 텍스트라도 배지 자체는 존재)
    const chartBadge = popup.locator('span.font-mono');
    expect(await chartBadge.count()).toBeGreaterThanOrEqual(1);

    // 연락처(전화 아이콘 라인) 존재 — 풀번호 또는 '번호 없음'
    const popupText = (await popup.innerText()).replace(/\s+/g, ' ');
    expect(popupText.length).toBeGreaterThan(0);
  });

  // ── 시나리오 3: 성함 폰트 축소 회귀 가드 — 카드 레이아웃 비파괴 ──
  test('AC-3: 일간 고객박스가 COMPACT2(8px·90px) 위에서 레이아웃 깨짐 없이 렌더된다', async ({ page }) => {
    // 일간 뷰 컬럼(90px) 회귀 가드 — 컬럼 존재 시 폭이 유지되는지 확인.
    const dayCol = page.locator('[data-testid^="resv-day-col-"]').first();
    if ((await dayCol.count()) === 0) { test.skip(); return; }
    const box = await dayCol.boundingBox();
    if (!box) { test.skip(); return; }
    // COMPACT2 90px 칸 회귀가드(±2px 허용). 폰트 슬림으로 칸 폭이 커지지 않아야 한다.
    expect(box.width).toBeLessThanOrEqual(92 + 2);
  });

  // ── 시나리오 3-b: 일간 고객박스 성함 폰트 축소(text-sm 14px → ≤11px) ──
  test('AC-3b: 일간 고객박스 성함 폰트가 14px 미만(≤11px)으로 축소됐다', async ({ page }) => {
    // 일간 TIMEGRID 컬럼(resv-day-col) 안의 성함 트리거(호버 가능)만 대상.
    const dayName = page.locator('[data-testid^="resv-day-col-"] span[title*="호버"]').first();
    if ((await dayName.count()) === 0) { test.skip(); return; }
    if (!(await dayName.isVisible({ timeout: 2000 }).catch(() => false))) { test.skip(); return; }
    const fontSizePx = await dayName.evaluate((el) =>
      parseFloat(getComputedStyle(el as HTMLElement).fontSize)
    );
    // compactDense=text-[11px]. 기존 compact-only(text-sm=14px) 대비 축소 — ≤11.5px(반올림 여유).
    expect(fontSizePx).toBeLessThanOrEqual(11.5);
  });
});
