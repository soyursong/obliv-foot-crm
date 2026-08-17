/**
 * T-20260817-foot-DASHBOARD-TIMETABLE-NAME-NOTRUNCATE-BADGE (P1, 현장 최우선)
 *   현장 재지시(김주연 총괄): 선행 CUSTNAME-NOWRAP 의 ellipsis(말줄임)=이름 잘림 → 현장 요건 위배.
 *   "고객 이름 절대 안 잘림"이 최우선 요건(P3→P1 상향).
 *
 * FIX (CSS/문구 전용, db_change=false):
 *   1안(성함 셀 확장): 성함 span 3사이트(초진 box1 / 재진 box2 / 초진·재진 체크인 카드)에서
 *       말줄임(overflow-hidden text-ellipsis) 제거 + min-w-0(셀 축소 허용) 제거 → shrink-0 로 셀이
 *       성함 전체를 수용. whitespace-nowrap(음절 중간 꺾임 방지)만 유지.
 *   2안(배지 단축): 내원콜 compact 배지 reachable 라벨 '내원예정'(4자)→'내원'(2자)로 단축(성함 공간 압박 완화).
 *       canonical 값·배지 로직 불변(VISIT_CALL_RESULT_LABEL SSOT 그대로), 전체 라벨은 title 보존.
 *
 * 판정 기준(AC):
 *   1. 초진·재진 칼럼 2~3글자 이름 = 한 줄, 잘림/말줄임/중간꺾임 없이 전체 표시.
 *   2. ellipsis 잔재(성함 요소) 0.
 *   3. 배지 로직 무변경(문구만 단축). db_change=false, 순수 표시.
 *   4. 인접 칼럼 밀림 회귀 0.
 *
 * S1 (AC1/AC2 정적): 3사이트 성함 span 에 shrink-0 + whitespace-nowrap, ellipsis/overflow-hidden/min-w-0/break-words 잔재 0.
 * S2 (AC3 정적): 배지 compact reachable='내원' 단축, SSOT VISIT_CALL_RESULT_LABEL.reachable='내원예정' 불변, title 전체라벨 보존.
 * S3 (AC4 정적): 카드 레이아웃/식별 마커(box1/box2/checkin testid, 카드 title) 불변.
 * S4 (AC1/AC2 런타임): 통합시간표 성함 셀 computed whiteSpace=nowrap · textOverflow≠ellipsis · 잘림 없음(scrollWidth≤clientWidth) · 1줄.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const NAME_CELLS = [
  '[data-testid="box1-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="box2-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="timeline-checkin-card"] [data-testid="timeline-name"]',
].join(', ');

// ─────────────────────────────────────────────────────────────────────────────
// S1 정적 — 성함 셀: 말줄임 제거, 전체 수용(shrink-0 + nowrap)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 성함 셀 말줄임 제거 (T-20260817-foot-NAME-NOTRUNCATE)', () => {
  const dash = read('src/pages/Dashboard.tsx');

  test('S1-a: 초진 예약(box1) 성함 span = shrink-0 + whitespace-nowrap', () => {
    expect(dash).toMatch(
      /className="shrink-0 whitespace-nowrap leading-tight text-gray-900 font-semibold" data-testid="timeline-name"/,
    );
  });

  test('S1-b: 재진 예약(box2) 성함 span = shrink-0 + whitespace-nowrap', () => {
    expect(dash).toMatch(
      /className="shrink-0 whitespace-nowrap leading-tight text-gray-800" data-testid="timeline-name"/,
    );
  });

  test('S1-c: 초진·재진 체크인 카드 성함 span = shrink-0 + whitespace-nowrap', () => {
    expect(dash).toMatch(
      /'shrink-0 whitespace-nowrap leading-tight',\s*visitType === 'returning' \? 'text-gray-800' : 'text-gray-900'/,
    );
  });

  test('S1-d: 성함 셀 3사이트 — ellipsis/overflow-hidden/min-w-0/break-words/whitespace-normal 잔재 0, nowrap 유지', () => {
    const nameLines = dash
      .split('\n')
      .filter((l) => l.includes('data-testid="timeline-name"'));
    expect(nameLines.length).toBe(3);
    for (const l of nameLines) {
      expect(l).not.toMatch(/text-ellipsis/); // AC2: 말줄임 잔재 0
      expect(l).not.toMatch(/overflow-hidden/); // 클립(하드 잘림)도 금지
      expect(l).not.toMatch(/\bmin-w-0\b/); // 셀 축소 허용 제거 → 전체 수용
      expect(l).not.toMatch(/break-words/); // 음절 중간 꺾임 원인 0
      expect(l).not.toMatch(/whitespace-normal/);
      expect(l).toMatch(/whitespace-nowrap/); // 한 줄 고정 유지
      expect(l).toMatch(/shrink-0/); // 셀이 성함 전체 수용
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 정적 — 배지 문구만 단축(로직/canonical 불변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 배지 문구 단축 (내원예정→내원, compact only)', () => {
  const badge = read('src/components/VisitCallResultBadge.tsx');
  const types = read('src/lib/types.ts');

  test('S2-a: compact reachable 라벨 = 축약 문구 "내원"', () => {
    expect(badge).toMatch(/isReachable \? '내원' : VISIT_CALL_RESULT_LABEL\[result\]/);
  });

  test('S2-b: non-compact 는 전체 라벨(내원콜 …) 유지', () => {
    expect(badge).toMatch(/`내원콜 \$\{VISIT_CALL_RESULT_LABEL\[result\]\}`/);
  });

  test('S2-c: 전체 라벨 title(hover/tap) 보존', () => {
    expect(badge).toMatch(/title=\{`도파민TM 내원콜: \$\{VISIT_CALL_RESULT_LABEL\[result\]\}`\}/);
  });

  test('S2-d: SSOT canonical 라벨 불변 — reachable=내원예정 / absent=부재 (배지 로직 무변경)', () => {
    expect(types).toMatch(/reachable:\s*'내원예정'/);
    expect(types).toMatch(/absent:\s*'부재'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 정적 — 인접 마커/식별 불변(AC4 회귀 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 카드 레이아웃/식별 마커 불변', () => {
  const dash = read('src/pages/Dashboard.tsx');

  test('S3: box1/box2/checkin testid + 카드 title(cardDisplayName) 불변', () => {
    expect(dash).toMatch(/data-testid="box1-resv-card"/);
    expect(dash).toMatch(/data-testid="box2-resv-card"/);
    expect(dash).toMatch(/data-testid="timeline-checkin-card"/);
    expect(dash).toMatch(/title=\{cardDisplayName\(reservation\)\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 브라우저 런타임 — 로그인 가능 시에만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 통합시간표 성함 셀 잘림 없음 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오: 성함 셀 nowrap · 말줄임/잘림 없음 · 1줄', async ({ page }) => {
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const el = names.nth(i);
      const r = await el.evaluate((node) => {
        const h = node as HTMLElement;
        const cs = getComputedStyle(h);
        return {
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow,
          clientHeight: h.clientHeight,
          scrollWidth: h.scrollWidth,
          clientWidth: h.clientWidth,
          lineHeightPx: parseFloat(cs.lineHeight) || 0,
          text: (h.textContent ?? '').trim(),
        };
      });
      // nowrap(음절 중간 꺾임 0)
      expect(r.whiteSpace).toBe('nowrap');
      // 말줄임 없음(AC2)
      expect(r.textOverflow).not.toBe('ellipsis');
      // 잘림 없음: 콘텐츠 전체 폭이 셀 안에 수용(overflow 로 잘리지 않음) — 성함 전체 노출(최종 판정 기준)
      expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth + 1);
      // 세로 wrap 없음(1줄)
      if (r.lineHeightPx > 0) {
        expect(r.clientHeight).toBeLessThan(r.lineHeightPx * 1.8);
      }
    }
    console.log('[NAME-NOTRUNCATE-BADGE] 통합시간표 성함 셀 전체 노출(잘림 0)·nowrap 1줄 OK');
  });
});
