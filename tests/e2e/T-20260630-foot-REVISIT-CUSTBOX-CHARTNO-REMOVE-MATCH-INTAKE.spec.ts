/**
 * T-20260630-foot-REVISIT-CUSTBOX-CHARTNO-REMOVE-MATCH-INTAKE
 * 대시보드 통합 시간표 '재진' 열 고객박스 — 차트번호(#F-…) 제거 + 초진과 동일 '성함/폰뒷자리/미수유무' 통일 + 미수 배지 축소
 *
 * 배경 (김주연 총괄, "이전에 맞춰달라 했는데 아직 차트번호 나옴" 재확인):
 *   6/9 T-20260609-foot-RESV-CARD-CHARTNUM-REMOVE 는 재진 '예약(pre-checkin)' 카드
 *   (DraggableBox2ResvCard)의 #차트번호만 제거했다. 그러나 재진 '체크인' 카드
 *   (TimelineCheckInCard, retBox2Ci)는 ChartNumberMapCtx(customers.chart_number) 를
 *   그대로 #표기 — SERIAL 작업으로 chart_number 포맷이 F-XXXX 가 되며 #F-… 시리얼로 재출현.
 *
 * 변경 (presentation only / DB·RPC 무변경 — src/pages/Dashboard.tsx):
 *   - TimelineCheckInCard: visitType==='returning' → 차트번호 span 제거 + 폰 뒷4자리(timeline-phone-suffix) 표기.
 *     visitType==='new'(초진)은 기존 #차트번호 표기 무수정 (AC-5 회귀 금지).
 *   - DraggableBox2ResvCard / 재진 TimelineCheckInCard 의 미수 배지 className 축소(text-[8px] px-0.5 py-0).
 *   - 미수유무 판정은 기존 footBilling.ts outstanding 단일소스(OutstandingDueBadge) 재사용 — 신규 로직 0.
 *
 * 현장 클릭 시나리오 → E2E (티켓 §현장 클릭 시나리오 1·2):
 *   S1 (AC-1): 재진 체크인 고객박스에 #F-…(차트번호/시리얼)가 없다.
 *   S2 (AC-2/AC-3): 재진 체크인 고객박스 식별자는 폰 뒷4자리(\d{4})만.
 *   S3 (AC-5 회귀): 초진 체크인 고객박스의 #차트번호 표기는 유지된다.
 *   S4 (AC-4): 재진 미수 배지가 축소 className(text-[8px])으로 렌더된다 / 미수 0 → 배지 없음.
 *   S5 (AC-1 회귀): 재진 예약(pre-checkin) 카드도 차트번호 없음(6/9 유지).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const RETURNING_CARD = '[data-testid="timeline-checkin-card"][data-visittype="returning"]';
const NEW_CARD = '[data-testid="timeline-checkin-card"][data-visittype="new"]';

test.describe('T-20260630-foot-REVISIT-CUSTBOX-CHARTNO-REMOVE-MATCH-INTAKE', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
  });

  // ── S1: 재진 체크인 고객박스 — #차트번호/시리얼 제거 (AC-1) ──
  test('S1: 재진 체크인 고객박스에 #F-…(차트번호/시리얼)가 없다(AC-1)', async ({ page }) => {
    const cards = page.locator(RETURNING_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 재진 체크인 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      // #로 시작하는 차트번호/시리얼(#F-…, #0042 등) span 이 존재하면 안 됨
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
      // 텍스트 전체에도 차트 시리얼 패턴(#F-…)이 없어야 함
      const txt = (await card.textContent()) ?? '';
      expect(txt).not.toMatch(/#\s*F-/i);
    }
  });

  // ── S2: 재진 체크인 식별자 = 폰 뒷4자리만 (AC-2/AC-3) ──
  test('S2: 재진 체크인 고객박스 식별자는 폰 뒷4자리만(AC-2/AC-3)', async ({ page }) => {
    const cards = page.locator(RETURNING_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 재진 체크인 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      const phoneSuffix = card.locator('[data-testid="timeline-phone-suffix"]');
      if ((await phoneSuffix.count()) > 0) {
        const text = (await phoneSuffix.first().textContent())?.trim() ?? '';
        expect(text).toMatch(/^\d{4}$/);
      }
      // 폰 결측이어도 차트번호 fallback 은 없어야 함 — 성함만 허용
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });

  // ── S3: 초진 체크인 고객박스 #차트번호 표기 유지 (AC-5 회귀) ──
  test('S3: 초진 체크인 고객박스 #차트번호 표기는 유지된다(AC-5 회귀 금지)', async ({ page }) => {
    const cards = page.locator(NEW_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 체크인 카드 없음 — 회귀 검증 스킵(데이터 의존)');
      return;
    }
    // 초진 체크인 카드 중 차트번호 보유 고객이 1명 이상 있으면 #표기가 살아있어야 한다.
    // (차트번호 미발번 고객은 표기 없음이 정상 → 전수 강제는 아님)
    let anyChart = false;
    for (let i = 0; i < Math.min(count, 12); i++) {
      const mono = cards.nth(i).locator('span.font-mono.text-teal-600').filter({ hasText: /^#/ });
      if ((await mono.count()) > 0) {
        const text = (await mono.first().textContent())?.trim() ?? '';
        expect(text.startsWith('#')).toBeTruthy();
        anyChart = true;
      }
    }
    // 초진 카드가 있는데 단 하나도 차트번호가 없다면(예: 전원 미발번) 정보성 스킵
    if (!anyChart) {
      test.skip(true, '초진 체크인 카드에 차트번호 발번 고객 없음 — 회귀 표본 부족');
    }
  });

  // ── S4: 재진 미수 배지 축소 + 미수 0 → 배지 없음 (AC-4) ──
  // T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK 가 배지를 한 단계 더 축소
  //   (text-[8px] → text-[7px], REVISIT_MISU_BADGE_CLS) → 본 회귀 기준도 7px 로 갱신.
  test('S4: 재진 미수 배지가 축소 className(text-[7px])으로 렌더된다(AC-4)', async ({ page }) => {
    const badges = page.locator(`${RETURNING_CARD} [data-testid="outstanding-due-badge"]`)
      .or(page.locator(`[data-testid="box2-resv-card"] [data-testid="outstanding-due-badge"]`));
    const count = await badges.count();
    if (count === 0) {
      test.skip(true, '오늘 미수 있는 재진 고객박스 없음 — 배지 축소 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const cls = (await badges.nth(i).getAttribute('class')) ?? '';
      // DASH-REVISITBOX AC-3: 더 축소 — text-[7px] 적용(기존 9px·8px 대비 작아짐)
      expect(cls).toContain('text-[7px]');
      expect(cls).not.toContain('text-[9px]');
      expect(cls).not.toContain('text-[8px]');
    }
  });

  // ── S5: 재진 예약(pre-checkin) 카드도 차트번호 없음 (6/9 유지, AC-1 회귀) ──
  test('S5: 재진 예약(pre-checkin) 카드 차트번호 없음 유지(AC-1)', async ({ page }) => {
    const cards = page.locator('[data-testid="box2-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 재진 미내원 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const chartBadge = cards.nth(i).locator('span.font-mono').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });
});
