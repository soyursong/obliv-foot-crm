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
 * S2 (AC4 정적): 카드 레이아웃 마커(box1/box2/checkin testid, title) 불변.
 * S3 (AC1/AC2 런타임): 통합시간표 성함 셀이 computed whiteSpace=nowrap, 세로 wrap 없음(1줄 높이).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ R2 REOPEN (P3→P1 상향, 현장 최우선 — 김주연 총괄):
 *   R1(6ef70bdd) 의 ellipsis(말줄임) 적용 부작용 = 셀 폭 초과 이름이 "…"로 잘림("한정자"→"한정…").
 *   현장 판정 — 고객 이름이 잘리는 것 자체가 불가(중간 꺾임도, 말줄임도 모두 잘림 = 불허).
 *   R2 요건: [최우선] 성함은 어떤 경우에도 온전히 전체 표시(중간꺾임 X · ellipsis 말줄임 X).
 *     1안(CSS): nowrap 유지 + overflow-hidden/text-ellipsis 제거 + min-w-0 제거 → shrink-0 로 셀이 전체 수용.
 *     2안(배지 단축): 내원콜 compact 배지 '내원예정'→'내원' 단축(성함 공간 병목 완화). 1안+2안 병행.
 *   본 spec 은 R2 AC 를 직접 담는다: [AC1] 말줄임/중간꺾임 부재(S1) · [AC2 배지 텍스트 불변식](S3) · [AC4 회귀 0](S2).
 *   (동일 fix 의 전면 런타임 잘림-0 실증은 T-…-NAME-NOTRUNCATE-BADGE.spec.ts 로도 수렴 — 중복 soak 방지.)
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

  // ★ SUPERSEDED: ellipsis 전제(min-w-0/overflow-hidden/text-ellipsis)는 NAME-NOTRUNCATE-BADGE 가 제거.
  //   nowrap 불변식(음절 중간 꺾임 방지)만 잔존 검증. 말줄임 assertion 은 후속 티켓 현실(shrink-0 전체수용)으로 갱신.
  test('S1-a: 초진 예약(box1) 성함 span 에 whitespace-nowrap 유지(nowrap 불변식)', () => {
    expect(dash).toMatch(
      /className="shrink-0 whitespace-nowrap leading-tight text-gray-900 font-semibold" data-testid="timeline-name"/,
    );
  });

  test('S1-b: 재진 예약(box2) 성함 span 에 whitespace-nowrap 유지(nowrap 불변식)', () => {
    expect(dash).toMatch(
      /className="shrink-0 whitespace-nowrap leading-tight text-gray-800" data-testid="timeline-name"/,
    );
  });

  test('S1-c: 초진·재진 체크인 카드 성함 span 에 whitespace-nowrap 유지(nowrap 불변식)', () => {
    expect(dash).toMatch(
      /'shrink-0 whitespace-nowrap leading-tight',\s*visitType === 'returning' \? 'text-gray-800' : 'text-gray-900'/,
    );
  });

  test('S1-d [R2 AC1]: 성함 셀 3사이트 — 잘림 유발 클래스 전부 부재(중간꺾임+말줄임 0), nowrap 유지', () => {
    // R2 최우선: 성함은 어떤 경우에도 온전히 전체 표시. 잘림 유발 클래스는 3사이트 어디에도 없어야 한다.
    const nameLines = dash
      .split('\n')
      .filter((l) => l.includes('data-testid="timeline-name"'));
    expect(nameLines.length).toBe(3);
    for (const l of nameLines) {
      // 중간 꺾임 원인(R1 이전) 잔재 0
      expect(l).not.toMatch(/break-words/);
      expect(l).not.toMatch(/whitespace-normal/);
      // ★ R2: 말줄임(ellipsis)·하드클립·셀 축소 전제 잔재 0 — 이 셋이 있으면 이름이 잘린다.
      expect(l).not.toMatch(/text-ellipsis/);
      expect(l).not.toMatch(/overflow-hidden/);
      expect(l).not.toMatch(/\bmin-w-0\b/);
      // 한 줄 고정(음절 중간 꺾임 방지) 유지 + 셀이 전체 수용
      expect(l).toMatch(/whitespace-nowrap/);
      expect(l).toMatch(/shrink-0/);
    }
  });

  test('S2: 카드 레이아웃/식별 마커 불변(회귀 0)', () => {
    expect(dash).toMatch(/data-testid="box1-resv-card"/);
    expect(dash).toMatch(/data-testid="box2-resv-card"/);
    expect(dash).toMatch(/data-testid="timeline-checkin-card"/);
    // 전체 성함 tooltip 보존 — 카드 title 에 cardDisplayName 유지.
    expect(dash).toMatch(/title=\{cardDisplayName\(reservation\)\}/);
    // ★ R2: 셀은 성함 전체를 수용(축소 없이) — shrink-0 + nowrap 유지.
    expect(dash).toMatch(/shrink-0 whitespace-nowrap leading-tight/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 [R2 AC2] 배지 텍스트 불변식 — 2안(내원예정→내원 단축), 로직/canonical/전체라벨 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 내원콜 배지 텍스트 불변식 (R2 2안: compact 단축 only)', () => {
  const badge = read('src/components/VisitCallResultBadge.tsx');
  const types = read('src/lib/types.ts');

  test('S3-a: compact reachable 배지 = 단축 문구 "내원"(성함 공간 확보)', () => {
    expect(badge).toMatch(/isReachable \? '내원' : VISIT_CALL_RESULT_LABEL\[result\]/);
  });

  test('S3-b: non-compact 배지 = 전체 라벨(내원콜 …) 불변(회귀 0)', () => {
    expect(badge).toMatch(/`내원콜 \$\{VISIT_CALL_RESULT_LABEL\[result\]\}`/);
  });

  test('S3-c: 전체 라벨 title(hover/tap) 보존 — 정보손실 0', () => {
    expect(badge).toMatch(/title=\{`도파민TM 내원콜: \$\{VISIT_CALL_RESULT_LABEL\[result\]\}`\}/);
  });

  test('S3-d: SSOT canonical 라벨 불변 — reachable=내원예정 / absent=부재 (배지 로직 무변경)', () => {
    // 2안은 표시 문구만 단축. 데이터/canonical 라벨(SSOT)은 절대 불변 → 다른 상태 표기 회귀 0.
    expect(types).toMatch(/reachable:\s*'내원예정'/);
    expect(types).toMatch(/absent:\s*'부재'/);
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
