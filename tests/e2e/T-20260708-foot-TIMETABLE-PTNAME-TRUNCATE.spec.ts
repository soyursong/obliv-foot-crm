/**
 * T-20260708-foot-TIMETABLE-PTNAME-TRUNCATE (P0/hotfix)
 * 대시보드 통합시간표 현황판 — 환자 성함이 셀/박스 영역 밖으로 넘쳐 잘리는 문제 수정.
 *
 * 배경 (slack F0BFYFEP136 / thread 1783476021.644499):
 *   통합시간표 예약·체크인 고객박스의 성함 span 이 truncate 클래스를 가졌으나 flex 자식의
 *   기본 min-width:auto 때문에 truncate(overflow:hidden)가 발동하지 못하고 셀 밖으로 넘쳐
 *   말줄임 없이 잘렸다. 초진 박스는 간략메모(DASH-INTAKEBOX-BRIEFMEMO-SHOW) 동반 시 더 밀림.
 *
 * 수정 (presentation only / DB·RPC·스키마 무변경 — src/pages/Dashboard.tsx):
 *   - 활성 3개 렌더 사이트(체크인카드/초진박스/재진박스) 성함 span 에 min-w-0 추가 → truncate 발동.
 *   - 각 성함 span 에 title={전체 성함} 추가 → hover(PC)/tap(태블릿) tooltip 으로 전체 성함 확인(AC-2).
 *   - 셀 레이아웃·간략메모 소스 무변경(성함 overflow/tooltip 만 본 P0 소유; 간략메모 소스교정=형제 P2).
 *
 * 현장 클릭 시나리오 → E2E:
 *   S1 (AC-1): 성함 span 이 셀(부모 박스) 폭을 넘어 넘치지 않는다(scrollWidth ≤ clientWidth + 여유).
 *   S2 (AC-2): 성함 span 에 전체 성함 title(tooltip) 이 있고 표시 텍스트와 정합(말줄임 시 title=전체).
 *   S3 (정적 가드, AC-1): Dashboard.tsx 활성 3사이트 성함 span 이 min-w-0 truncate + title 을 갖는다.
 *   S4 (정적 가드, AC-4 무회귀): 간략메모 span(box1-brief-note)·shrink-0 식별자 렌더는 미변경(레이아웃 무재작업).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const DASHBOARD_SRC = readFileSync(
  join(process.cwd(), 'src/pages/Dashboard.tsx'),
  'utf-8',
);

// 통합시간표 성함 렌더 셀렉터 — 활성 3사이트(초진/재진 예약 박스 + 체크인 카드) 성함 span.
// 성함 span 은 data-testid="timeline-name" 로 마킹 — 간략메모/pkgtype 등 형제 truncate span 과 구분.
const NAME_CELLS = [
  '[data-testid="box1-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="box2-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="timeline-checkin-card"] [data-testid="timeline-name"]',
].join(', ');

test.describe('T-20260708-foot-TIMETABLE-PTNAME-TRUNCATE', () => {
  // ── S1: 성함이 셀 폭을 넘어 넘치지 않는다 — truncate 발동 메커니즘 검증 (AC-1) ──
  // 넘침의 근본 원인은 flex 자식의 기본 min-width:auto 로 truncate(overflow:hidden)가 shrink 하지 못한 것.
  // 픽셀 경계는 형제 crowding/서브픽셀에 취약하므로, 성함 텍스트 spill 을 막는 실제 메커니즘
  // (min-width:0 + overflow:hidden + text-overflow:ellipsis + white-space:nowrap)이 활성인지 검증한다.
  test('S1: 통합시간표 성함 span 에 truncate 발동 메커니즘(min-width:0 + overflow hidden ellipsis nowrap)이 활성이다(AC-1)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 미내원/체크인 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const el = names.nth(i);
      const s = await el.evaluate((node) => {
        const cs = getComputedStyle(node as HTMLElement);
        return {
          minWidth: cs.minWidth,
          overflow: cs.overflowX,
          textOverflow: cs.textOverflow,
          whiteSpace: cs.whiteSpace,
          // 텍스트가 span 을 넘어도(scrollWidth>clientWidth) overflow:hidden 이 clip → 시각적 spill 0
          clipped: (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth,
          shown: (node.textContent ?? '').trim(),
        };
      });
      // min-w-0 → flex 자식이 shrink 가능해야 truncate 발동
      expect(s.minWidth).toBe('0px');
      expect(s.overflow).toBe('hidden');
      expect(s.textOverflow).toBe('ellipsis');
      expect(s.whiteSpace).toBe('nowrap');
      // 성함 span 은 비어있지 않음(폴백 '이름없음' 포함)
      expect(s.shown.length).toBeGreaterThan(0);
    }
  });

  // ── S2: 말줄임 시 전체 성함 tooltip(title) 로 확인 가능 (AC-2) ──
  test('S2: 성함 span 에 전체 성함 title(tooltip) 이 표시 텍스트와 정합한다(AC-2)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const el = names.nth(i);
      const title = (await el.getAttribute('title')) ?? '';
      const shown = ((await el.textContent()) ?? '').trim();
      // title 은 비어있지 않아야 하고(전체 성함 tooltip 존재), 표시 텍스트를 포함해야 한다.
      // (말줄임 시 shown⊂title, 전체표시 시 shown==title)
      expect(title.trim().length).toBeGreaterThan(0);
      expect(title).toContain(shown.replace(/…$/, ''));
    }
  });

  // ── S3: 정적 가드 — 활성 3사이트 성함 span 이 min-w-0 truncate + title (AC-1 결정적) ──
  test('S3: Dashboard.tsx 활성 3사이트 성함 span 이 min-w-0 truncate + title 을 갖는다', async () => {
    // 초진 박스(DraggableBox1Card)
    expect(DASHBOARD_SRC).toMatch(
      /className="min-w-0 truncate text-gray-900 font-semibold" title=\{cardDisplayName\(reservation\) \|\| '이름없음'\} data-testid="timeline-name"/,
    );
    // 재진 박스(DraggableBox2ResvCard)
    expect(DASHBOARD_SRC).toMatch(
      /className="min-w-0 truncate text-gray-800" title=\{cardDisplayName\(reservation\) \|\| '이름없음'\} data-testid="timeline-name"/,
    );
    // 체크인 카드(TimelineCheckInCard) — cn() 표현식
    expect(DASHBOARD_SRC).toMatch(
      /className=\{cn\('min-w-0 truncate', visitType === 'returning'.*\)\} title=\{cardDisplayName\(checkIn\)\} data-testid="timeline-name"/,
    );
  });

  // ── S4: 정적 가드 — AC-4 무회귀(간략메모·shrink-0 식별자 렌더 미변경) ──
  test('S4: 간략메모 span·shrink-0 식별자 렌더는 미변경(레이아웃 무재작업, AC-4)', async () => {
    // 간략메모(형제 P2 소유) 렌더는 그대로 유지 — 성함 P0 수정이 간략메모 소스를 건드리지 않음
    expect(DASHBOARD_SRC).toContain('data-testid="box1-brief-note"');
    expect(DASHBOARD_SRC).toMatch(/\[\{reservation\.brief_note\.trim\(\)\}\]/);
    // 성함 span 에는 shrink-0 을 부여하지 않음(shrink 되어야 truncate 발동) — min-w-0 와 상호 배타
    expect(DASHBOARD_SRC).not.toContain('shrink-0 min-w-0 truncate text-gray-900 font-semibold');
    expect(DASHBOARD_SRC).not.toContain('min-w-0 shrink-0 truncate text-gray-900 font-semibold');
  });
});
