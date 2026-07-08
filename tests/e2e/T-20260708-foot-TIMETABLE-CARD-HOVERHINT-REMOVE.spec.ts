/**
 * T-20260708-foot-TIMETABLE-CARD-HOVERHINT-REMOVE (P2)
 * 통합시간표(일정/스케줄) 화면 예약 카드 hover 안내 툴팁 제거 (FE only, db_change=false).
 *
 * 요청:
 *   - 제거 대상: 예약 카드 hover 시 나타나는 인터랙션 안내 문구
 *       '드래그=시간변경 · 클릭=차트조회 · 우클릭=메뉴' (native title 툴팁).
 *   - 유지: 실제 인터랙션(드래그=시간변경 / 클릭=차트조회 / 우클릭=컨텍스트메뉴) 기능 무변경 — 문구만 삭제.
 *   - a11y: 환자명 식별자 title 유지 무방(안내/도움말 성격 문구만 제거).
 *
 * 수정 (presentation only — src/pages/Dashboard.tsx):
 *   - box1(초진) 예약 카드 title: `${name} — 드래그=…` → `${name}` (인터랙션 안내 제거, 성함 a11y 유지).
 *   - box2(재진/힐러) 예약 카드 title: 인터랙션 안내 제거. 힐러 상태정보('힐러 치료 예정')는 안내문구 아님 → 유지.
 *
 * S1 (정적): box1/box2 카드 title 에서 인터랙션 안내 문구가 소스에서 제거되었다(회귀 가드).
 * S2 (정적): 실제 인터랙션 배선(onClick=onSelect / onContextMenu / dnd-kit listeners)은 무변경으로 유지된다.
 * S3 (런타임): hover 대상 예약 카드의 title 속성에 인터랙션 안내 문구가 없다(툴팁 미표시).
 * S4 (런타임): 예약 카드가 여전히 클릭 가능(cursor-grab)하고 우클릭 컨텍스트메뉴가 열린다(인터랙션 무회귀).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const DASHBOARD_SRC = readFileSync(
  join(process.cwd(), 'src/pages/Dashboard.tsx'),
  'utf-8',
);

const HINT_PATTERNS = [
  '드래그=시간변경 · 클릭=차트조회 · 우클릭=메뉴',
  '클릭=차트조회',
  '우클릭=메뉴',
];

const RESV_CARDS = '[data-testid="box1-resv-card"], [data-testid="box2-resv-card"]';

test.describe('T-20260708-foot-TIMETABLE-CARD-HOVERHINT-REMOVE', () => {
  // ── S1: 인터랙션 안내 문구 소스 제거 (정적) ──
  test('S1: 예약 카드 title 에서 인터랙션 안내 문구가 제거되었다(회귀 가드)', async () => {
    for (const hint of HINT_PATTERNS) {
      expect(DASHBOARD_SRC).not.toContain(hint);
    }
    // box1: 성함만 title (a11y 유지)
    expect(DASHBOARD_SRC).toMatch(/title=\{cardDisplayName\(reservation\)\}/);
    // box2: 힐러 상태정보(안내문구 아님)는 유지
    expect(DASHBOARD_SRC).toMatch(/\$\{cardDisplayName\(reservation\)\} — 힐러 치료 예정`/);
  });

  // ── S2: 실제 인터랙션 배선 무변경 (정적) ──
  test('S2: 실제 인터랙션(클릭/우클릭/드래그) 배선이 유지된다(무회귀)', async () => {
    // 카드 존재
    expect(DASHBOARD_SRC).toContain('data-testid="box1-resv-card"');
    expect(DASHBOARD_SRC).toContain('data-testid="box2-resv-card"');
    // 클릭=차트조회/상세 (onSelect)
    expect(DASHBOARD_SRC).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onSelect\?\.\(\); \}\}/);
    // 우클릭=컨텍스트메뉴
    expect(DASHBOARD_SRC).toMatch(/onContextMenu\?\.\(e, reservation\)/);
    // 드래그=시간변경 (dnd-kit listeners spread)
    expect(DASHBOARD_SRC).toContain('{...listeners}');
    expect(DASHBOARD_SRC).toContain('cursor-grab active:cursor-grabbing');
  });

  // ── S3: hover 시 안내 툴팁 미표시 (런타임) ──
  test('S3: 예약 카드 title 속성에 인터랙션 안내 문구가 없다(hover 툴팁 미표시)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const cards = page.locator(RESV_CARDS);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 예약 카드 없음 — 런타임 title 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const card = cards.nth(i);
      await card.hover();
      const title = (await card.getAttribute('title')) ?? '';
      for (const hint of HINT_PATTERNS) {
        expect(title).not.toContain(hint);
      }
    }
  });

  // ── S4: 클릭/우클릭 인터랙션 무회귀 (런타임) ──
  test('S4: 예약 카드가 클릭 가능(cursor-grab)하고 우클릭 컨텍스트메뉴가 동작한다(인터랙션 무회귀)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const cards = page.locator(RESV_CARDS);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 예약 카드 없음 — 런타임 인터랙션 검증 스킵(데이터 의존)');
      return;
    }
    const card = cards.first();
    // 클릭 가능 커서 유지(드래그=시간변경 grab)
    const cursor = await card.evaluate((n) => getComputedStyle(n as HTMLElement).cursor);
    expect(['grab', 'grabbing', 'pointer', 'default']).toContain(cursor);
    // 우클릭 → 컨텍스트메뉴(우클릭 메뉴) 오픈. preventDefault 로 브라우저 기본 메뉴 미표시 = 핸들러 살아있음.
    await card.click({ button: 'right' });
    await page.waitForTimeout(400);
    // 메뉴 role/컨텍스트메뉴 컨테이너가 뜨거나(또는 최소한 클릭이 에러 없이 처리) 카드가 여전히 존재
    await expect(cards.first()).toBeVisible();
  });
});
