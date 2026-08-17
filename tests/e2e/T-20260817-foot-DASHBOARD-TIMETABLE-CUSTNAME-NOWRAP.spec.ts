/**
 * T-20260817-foot-DASHBOARD-TIMETABLE-CUSTNAME-NOWRAP (P3)
 *   대시보드 > 통합 시간표(초진/재진 칼럼) 고객 성함 셀이 열 너비 부족 시 음절 중간에서 꺾임
 *   ("한정사"→"한정/사", "구병중"→"구병/중"). → 한 줄 고정(nowrap).
 *
 * RC: 성함 span 3사이트(초진 예약 box1 / 재진 예약 box2 / 초진·재진 체크인 카드)가
 *     whitespace-normal + break-words 로 렌더 → 한글은 공백이 없어 break-words 가 음절 경계에서 꺾음.
 *     (선행 T-20260708-CUSTBOX-WIDEN-MEMOLINE 이 '잘림 금지' 목적으로 break-words 채택했으나
 *      2~3글자 성함이 좁은 칼럼에서 음절 중간 꺾이는 부작용 발생 → 현장 신고.)
 * FIX: 3사이트 성함 span 을 whitespace-nowrap + overflow-hidden + text-ellipsis 로 전환.
 *      한 줄 고정(음절 중간 꺾임 0), 셀 폭 초과 시 말줄임(레이아웃 안정 우선, AC2).
 *      전체 성함은 기존 카드 title(hover/tap tooltip)로 보존 → 잘림 정보손실 완화.
 *      스타일 전용(CSS 클래스만). DB/RPC/스키마/산식 무변경.
 *
 * S1 (AC1/AC3 정적): 3사이트 성함 span 이 whitespace-nowrap 보유, break-words 잔재 0.
 * S2 (AC4 정적): 카드 레이아웃 마커(box1/box2/checkin testid, min-w-0, title) 불변.
 * S3 (AC1/AC2 런타임): 통합시간표 성함 셀이 computed whiteSpace=nowrap, 세로 wrap 없음(1줄 높이).
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
// 정적 소스 불변식 — 토큰/DB 무관 견고 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (T-20260817-foot-DASHBOARD-TIMETABLE-CUSTNAME-NOWRAP)', () => {
  const dash = read('src/pages/Dashboard.tsx');

  test('S1-a: 초진 예약(box1) 성함 span 에 whitespace-nowrap + ellipsis 적용', () => {
    expect(dash).toMatch(
      /className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis leading-tight text-gray-900 font-semibold" data-testid="timeline-name"/,
    );
  });

  test('S1-b: 재진 예약(box2) 성함 span 에 whitespace-nowrap + ellipsis 적용', () => {
    expect(dash).toMatch(
      /className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis leading-tight text-gray-800" data-testid="timeline-name"/,
    );
  });

  test('S1-c: 초진·재진 체크인 카드 성함 span 에 whitespace-nowrap + ellipsis 적용', () => {
    expect(dash).toMatch(
      /'min-w-0 whitespace-nowrap overflow-hidden text-ellipsis leading-tight',\s*visitType === 'returning' \? 'text-gray-800' : 'text-gray-900'/,
    );
  });

  test('S1-d: 성함 셀에서 break-words(음절 중간 꺾임 원인) 잔재 0', () => {
    // timeline-name 을 담은 span 라인 어디에도 break-words 가 남지 않아야 한다.
    const nameLines = dash
      .split('\n')
      .filter((l) => l.includes('data-testid="timeline-name"'));
    expect(nameLines.length).toBe(3);
    for (const l of nameLines) {
      expect(l).not.toMatch(/break-words/);
      expect(l).not.toMatch(/whitespace-normal/);
      expect(l).toMatch(/whitespace-nowrap/);
    }
  });

  test('S2: 카드 레이아웃/식별 마커 불변(회귀 0)', () => {
    expect(dash).toMatch(/data-testid="box1-resv-card"/);
    expect(dash).toMatch(/data-testid="box2-resv-card"/);
    expect(dash).toMatch(/data-testid="timeline-checkin-card"/);
    // 전체 성함 tooltip 보존 — 카드 title 에 cardDisplayName 유지.
    expect(dash).toMatch(/title=\{cardDisplayName\(reservation\)\}/);
    // min-w-0 (flex ellipsis 발동 전제) 유지.
    expect(dash).toMatch(/min-w-0 whitespace-nowrap overflow-hidden text-ellipsis/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만(데이터 의존 시 skip)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('통합 시간표 성함 셀 1줄 고정 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오: 초진/재진 칼럼 성함 셀이 nowrap(음절 중간 꺾임 0, 1줄)', async ({ page }) => {
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
          // 1줄이면 clientHeight ≈ line-height(약 lh*1). 2줄 wrap 시 대략 2배.
          clientHeight: h.clientHeight,
          lineHeightPx: parseFloat(cs.lineHeight) || 0,
          text: (h.textContent ?? '').trim(),
        };
      });
      expect(r.whiteSpace).toBe('nowrap');
      // 세로 wrap 없음: 성함 셀 높이가 2줄로 늘어나지 않음(line-height 측정 가능 시).
      if (r.lineHeightPx > 0) {
        expect(r.clientHeight).toBeLessThan(r.lineHeightPx * 1.8);
      }
    }
    console.log('[TIMETABLE-CUSTNAME-NOWRAP] 통합시간표 성함 셀 nowrap 1줄 렌더 OK');
  });
});
