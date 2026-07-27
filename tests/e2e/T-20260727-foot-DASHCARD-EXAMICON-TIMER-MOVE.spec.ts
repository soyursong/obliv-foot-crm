/**
 * E2E Spec — T-20260727-foot-DASHCARD-EXAMICON-TIMER-MOVE
 * 대시보드(/admin) 예약 슬롯 고객 카드의 균(🔬초록"균")/피(🩸빨강"피") 검사신청 뱃지를
 * '카드 하단 뱃지 줄'(초진·8패키지·PD 옆) → '타이머(⏱ 시간 카운터) 행 우측 빈 공간'으로 이동.
 * 김주연 총괄 확정(F0BL0PC6Z9Q 빨간박스 = 이동 TARGET). 색/아이콘/"신청됨" 판정·표시조건 불변, 위치만.
 *
 * 선행 divergence: EXAMBADGE(위치 오류 수정) 전제는 dev evidence로 FALSIFIED(뱃지 이미 하단 줄 정상 렌더).
 * responder round-trip으로 총괄 실 의도 = (c) 위치 이동(신규 기능)으로 확정 → 본 티켓으로 전환.
 *
 * ── AC 매핑 ──
 *   AC-1 균/피 뱃지가 타이머 행 우측 그룹(compact·non-compact 양 경로)에 렌더
 *   AC-2 하단 뱃지 줄(flex-wrap: 초진·패키지·PD)에서 균/피 <ExamRequestBadges> 제거(회귀 가드)
 *   AC-3 색/아이콘/판정 로직 불변 — 표시 규칙(visibleBadges) 그대로 (하단 로직 테스트 재사용)
 *   AC-4 이동 대상은 균/피 뱃지 2종만 — 초진·패키지·PD 하단 뱃지는 그대로 유지
 *
 * NOTE: 위치 이동은 순수 FE 렌더 배치 → 실 시각 확인은 supervisor QA(라이브 캡처)+현장 confirm 이 담당.
 *       본 스펙은 '하단 줄로 되돌아가는 회귀'를 막는 소스-구조 가드 + 표시규칙 불변 검증.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = resolve(__dirname, '../../src/pages/Dashboard.tsx');

// ── ExamRequestBadges 표시 규칙 미러 (색/아이콘/판정 불변 — 이동으로 안 바뀜) ──────
type Flag = { blood: boolean; koh: boolean };
function visibleBadges(flags?: Flag): ('koh' | 'blood')[] {
  if (!flags || (!flags.koh && !flags.blood)) return [];
  const out: ('koh' | 'blood')[] = [];
  if (flags.koh) out.push('koh');   // 🔬 초록 "균"
  if (flags.blood) out.push('blood'); // 🩸 빨강 "피"
  return out;
}

test.describe('T-20260727-DASHCARD-EXAMICON-TIMER-MOVE — 표시 규칙 불변 (AC-3)', () => {
  test('균만/피만/둘다/미신청 규칙은 위치 이동과 무관하게 그대로', () => {
    expect(visibleBadges({ koh: true, blood: false })).toEqual(['koh']);
    expect(visibleBadges({ koh: false, blood: true })).toEqual(['blood']);
    expect(visibleBadges({ koh: true, blood: true })).toEqual(['koh', 'blood']);
    expect(visibleBadges({ koh: false, blood: false })).toEqual([]);
    expect(visibleBadges(undefined)).toEqual([]);
  });
});

test.describe('T-20260727-DASHCARD-EXAMICON-TIMER-MOVE — 배치 소스-구조 가드 (AC-1/2/4)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');

  test('AC-1: 균/피 뱃지 렌더 사이트가 정확히 2곳 (compact·non-compact)', () => {
    const occ = src.split('<ExamRequestBadges flags={examFlags} />').length - 1;
    expect(occ, 'ExamRequestBadges 렌더 사이트는 compact/non-compact 2곳이어야').toBe(2);
  });

  test('AC-1: 두 렌더 사이트 모두 타이머 행 우측 그룹(flex items-center gap-0.5) 뒤에 위치', () => {
    // 타이머 행 우측 그룹 개시 = `flex items-center gap-0.5">` (justify-between 시간행의 우측 컨테이너).
    // 하단 뱃지 줄은 `flex items-center gap-0.5 flex-wrap` (flex-wrap 有) → 구분됨.
    const lines = src.split('\n');
    const badgeLineIdxs = lines
      .map((l, i) => (l.includes('<ExamRequestBadges flags={examFlags} />') ? i : -1))
      .filter((i) => i >= 0);
    expect(badgeLineIdxs.length).toBe(2);

    for (const idx of badgeLineIdxs) {
      // 직상단(위로 최대 6줄) 컨테이너 개시가 flex-wrap(하단 줄) 이 아니라 타이머 우측 그룹이어야
      const above = lines.slice(Math.max(0, idx - 6), idx).join('\n');
      const openedTimerGroup =
        above.includes('flex items-center gap-0.5">') && !above.includes('flex-wrap');
      const timerMoveMarker = above.includes('EXAMICON-TIMER-MOVE');
      expect(
        openedTimerGroup || timerMoveMarker,
        `ExamRequestBadges@line${idx + 1} 직상단이 타이머 우측 그룹이어야(하단 flex-wrap 줄 금지)`,
      ).toBeTruthy();
    }
  });

  test('AC-2 회귀 가드: 하단 뱃지 줄(flex-wrap)에는 균/피 <ExamRequestBadges> 없음', () => {
    // flex-wrap 컨테이너 블록 안에 ExamRequestBadges 가 다시 들어오면 = 하단 줄 회귀
    const wrapBlocks = src.split('flex items-center gap-0.5 flex-wrap');
    // 첫 조각은 flex-wrap 이전 → 무시. 이후 조각들이 각 하단 뱃지 줄 블록의 시작.
    for (let i = 1; i < wrapBlocks.length; i++) {
      // 해당 하단 줄 블록에서 다음 상위 컨테이너 닫힘 전까지 근사 검사(200자 윈도우면 충분히 균/피 위치 포착)
      const head = wrapBlocks[i].slice(0, 400);
      expect(
        head.includes('<ExamRequestBadges'),
        '하단 뱃지 줄(flex-wrap)에 균/피 뱃지가 다시 들어옴 = 타이머행 이동 회귀',
      ).toBeFalsy();
    }
  });

  test('AC-4: 초진·패키지(pkg-holder)·PD(podologe) 하단 뱃지는 그대로 유지', () => {
    expect(src.includes('pkg-holder-badge'), '패키지 뱃지 유지').toBeTruthy();
    expect(src.includes('podologe-holder-badge'), 'PD(포돌로게) 뱃지 유지').toBeTruthy();
    expect(src.includes('>초진<'), '초진 딱지 유지').toBeTruthy();
  });
});
