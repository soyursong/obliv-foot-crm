/**
 * T-20260708-foot-TIMETABLE-PTNAME-TRUNCATE (P0/hotfix)
 * 대시보드 통합시간표 현황판 — 환자 성함이 셀/박스 영역 밖으로 넘쳐 잘리는 문제 수정.
 *
 * ⚠ 접근 정정/통합 (T-20260708-foot-TIMETABLE-CUSTBOX-WIDEN-MEMOLINE, 김주연 총괄):
 *   초기 P0 는 '말줄임(truncate …)+title tooltip' 방식이었으나, 리포터가 "성함 절대 잘림 금지 = 전체표시,
 *   말줄임/tooltip 불가"를 명시 확정하고 "가로 칸 너비 확대(접기 기능 있음)"를 해법으로 지정.
 *   → 성함 span 을 whitespace-normal + break-words 로 '전체표시(넘치면 줄바꿈, 잘림 0)'하고,
 *     통합시간표 패널 폭을 w-80→w-96 로 확대. truncate/ellipsis/title tooltip 방식은 폐기(superseded).
 *   본 spec 은 그 통합 결과(전체표시)를 P0 회귀 가드로 재정의한다.
 *
 * 현장 클릭 시나리오 → E2E:
 *   S1 (AC-1): 성함 span 이 전체표시된다 — whitespace:normal(말줄임 아님) + 시각적 clip 없음(scrollWidth ≤ clientWidth).
 *   S2 (AC-1): 표시 성함에 말줄임(…) 잔재가 없다(전체표시, tooltip 의존 아님).
 *   S3 (정적 가드, AC-1): Dashboard.tsx 활성 3사이트 성함 span 이 whitespace-normal break-words(전체표시) 이고
 *                        truncate/title(말줄임+tooltip) 을 갖지 않는다. + 패널 펼침폭 w-96.
 *   S4 (정적 가드, 무회귀): 간략메모 칩(box1-brief-note) 렌더는 유지(BRIEFMEMO-CHIPONLY 정합, 소스 무접촉).
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
const NAME_CELLS = [
  '[data-testid="box1-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="box2-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="timeline-checkin-card"] [data-testid="timeline-name"]',
].join(', ');

test.describe('T-20260708-foot-TIMETABLE-PTNAME-TRUNCATE', () => {
  // ── S1: 성함이 전체표시된다 — whitespace:normal + clip 없음 (AC-1) ──
  test('S1: 통합시간표 성함 span 이 전체표시(whitespace:normal, 시각적 clip 없음)된다(AC-1)', async ({ page }) => {
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
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow,
          // 전체표시(줄바꿈 허용)면 텍스트가 span 폭 내에 wrap → 가로 clip 없음
          clipped: (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 1,
          shown: (node.textContent ?? '').trim(),
        };
      });
      // 말줄임(nowrap) 아님 — 전체표시 위해 줄바꿈 허용
      expect(s.whiteSpace).toBe('normal');
      // ellipsis 말줄임 방식 아님
      expect(s.textOverflow).not.toBe('ellipsis');
      // 성함이 가로로 잘려 넘치지 않음(줄바꿈으로 전체표시)
      expect(s.clipped).toBe(false);
      expect(s.shown.length).toBeGreaterThan(0);
    }
  });

  // ── S2: 표시 성함에 말줄임(…) 잔재가 없다 — 전체표시 (AC-1) ──
  test('S2: 성함 표시 텍스트에 말줄임(…)이 없다(전체표시, tooltip 의존 아님)(AC-1)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const shown = ((await names.nth(i).textContent()) ?? '').trim();
      // 전체표시 → 말줄임 문자(…) 로 끝나지 않는다
      expect(shown.endsWith('…')).toBe(false);
    }
  });

  // ── S3: 정적 가드 — 활성 3사이트 성함 span 전체표시(whitespace-normal break-words) + truncate/title 부재 + 패널 w-96 ──
  test('S3: Dashboard.tsx 활성 3사이트 성함 span 이 전체표시(whitespace-normal break-words)이고 말줄임/tooltip 을 갖지 않는다 + 패널 펼침폭 w-96', async () => {
    // 초진 박스(DraggableBox1Card)
    expect(DASHBOARD_SRC).toContain(
      'className="min-w-0 whitespace-normal break-words leading-tight text-gray-900 font-semibold" data-testid="timeline-name"',
    );
    // 재진 박스(DraggableBox2ResvCard)
    expect(DASHBOARD_SRC).toContain(
      'className="min-w-0 whitespace-normal break-words leading-tight text-gray-800" data-testid="timeline-name"',
    );
    // 체크인 카드(TimelineCheckInCard) — cn() 표현식
    expect(DASHBOARD_SRC).toMatch(
      /className=\{cn\('min-w-0 whitespace-normal break-words leading-tight', visitType === 'returning'.*\)\} data-testid="timeline-name"/,
    );
    // 성함 span 에 말줄임 truncate 방식 잔재 없음
    expect(DASHBOARD_SRC).not.toMatch(/min-w-0 truncate text-gray-900 font-semibold/);
    expect(DASHBOARD_SRC).not.toMatch(/min-w-0 truncate text-gray-800" title=/);
    // 통합시간표 패널 펼침폭 확대(w-80→w-96)
    expect(DASHBOARD_SRC).toMatch(/timelineFolded \? 'w-8' : 'w-96'/);
  });

  // ── S4: 정적 가드 — 무회귀(간략메모 칩 렌더 유지, BRIEFMEMO-CHIPONLY 소스 무접촉) ──
  test('S4: 간략메모 칩(box1-brief-note) 렌더는 유지된다(BRIEFMEMO-CHIPONLY 정합, 무회귀)', async () => {
    expect(DASHBOARD_SRC).toContain('data-testid="box1-brief-note"');
    expect(DASHBOARD_SRC).toMatch(/\[\{reservation\.brief_note\.trim\(\)\}\]/);
  });
});
