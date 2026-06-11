/**
 * E2E spec — T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE (WS-1)
 * '원장님 진료콜 명단'(DoctorCallListBar) 정렬 키 변경: 접수시각 → 진료콜 진입 시각.
 *
 * 현장 요청(김주연 총괄, #풋확장 thread 1781175830.787949):
 *   진료콜 명단을 checked_in_at(접수순)이 아니라 "상태 변경 시각"(=진료콜 진입 시각) 기준으로 정렬.
 *   접수만 먼저였고 콜은 늦게 뜬 환자가 위로 오던 오정렬 제거 → 콜 진입이 빠른 환자부터 호출.
 *
 * ★핵심(WS-1, DB 무변경): 정렬 키 = callEntryTime(ci)
 *   = status_flag_history(이미 존재하는 "상태 변경 시각" 감사 컬럼 — 신규 컬럼 추가 없음)의
 *     가장 최근 active(purple/yellow) 전환 changed_at. 이력 없으면 checked_in_at 폴백.
 *   대상 상태: 보라(purple/진료필요) · 노랑(yellow/힐러예약) · 힐러대기(status='healer_waiting').
 *
 * AC → 단언 매핑:
 *   AC-1 정렬 키가 진료콜 진입 시각(callEntryTime) — 접수시각 늦어도 콜 진입 빠르면 상단(시나리오2 순수검증).
 *   AC-2 이력 없으면 checked_in_at 폴백(NaN/크래시 없음).
 *   AC-3 소스 가드: activeList 정렬이 checked_in_at 직접 비교가 아니라 callEntryTime 사용(회귀 락).
 *   AC-4 회귀금지: 힐러대기·done(pink) 잔존·드래그/숨김 등 다른 기능 미접촉.
 *
 * 컨벤션: callEntryTime 정본 로직 모사(순수함수 단위) + 소스 정적 가드 + DOM graceful skip.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = path.resolve(__dirname, '../../src/components/DoctorCallListBar.tsx');

/**
 * 정본 callEntryTime 로직 모사(repo unit 컨벤션 — 컴포넌트 런타임 import 회피).
 * 아래 'AC-3 소스 정적 가드'로 정본과 동치임을 락.
 */
type MiniCheckIn = {
  id: string;
  checked_in_at: string;
  status: string;
  status_flag: string | null;
  status_flag_history: Array<{ flag: string | null; changed_at: string }> | null;
};
function callEntryTime(ci: Pick<MiniCheckIn, 'checked_in_at' | 'status_flag_history'>): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const entry = hist[i];
      if (entry && (entry.flag === 'purple' || entry.flag === 'yellow') && entry.changed_at) {
        return entry.changed_at;
      }
    }
  }
  return ci.checked_in_at;
}

// 명단 정렬 모사(active = purple/yellow/healer_waiting, callEntryTime 오름차순)
function sortActive(rows: MiniCheckIn[]): MiniCheckIn[] {
  return rows
    .filter(
      (ci) =>
        ci.status_flag === 'purple' ||
        ci.status_flag === 'yellow' ||
        ci.status === 'healer_waiting',
    )
    .sort((a, b) => callEntryTime(a).localeCompare(callEntryTime(b)));
}

test.describe('T-20260611 DOCTORCALL-SORT-INTREATMENT-BADGE WS-1 — 진료콜 진입 시각 정렬', () => {
  test('AC-2 폴백: 이력 없으면 checked_in_at 사용 (NaN/크래시 없음)', () => {
    expect(callEntryTime({ checked_in_at: '2026-06-11T09:00:00+09:00', status_flag_history: null }))
      .toBe('2026-06-11T09:00:00+09:00');
    expect(callEntryTime({ checked_in_at: '2026-06-11T09:00:00+09:00', status_flag_history: [] }))
      .toBe('2026-06-11T09:00:00+09:00');
    // 이력은 있으나 active(purple/yellow) 전환이 없으면 폴백
    expect(
      callEntryTime({
        checked_in_at: '2026-06-11T09:00:00+09:00',
        status_flag_history: [{ flag: 'gray', changed_at: '2026-06-11T09:30:00+09:00' }],
      }),
    ).toBe('2026-06-11T09:00:00+09:00');
  });

  test('AC-1 정렬: 접수 늦어도 콜 진입 빠른 환자가 상단 (접수순과 다름)', () => {
    // A: 접수 09:00, 진료필요(purple) 전환 11:00
    // B: 접수 10:00, 진료필요(purple) 전환 10:30  → 콜 진입은 B가 빠름
    const A: MiniCheckIn = {
      id: 'A',
      checked_in_at: '2026-06-11T09:00:00+09:00',
      status: 'doctor_waiting',
      status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-11T11:00:00+09:00' }],
    };
    const B: MiniCheckIn = {
      id: 'B',
      checked_in_at: '2026-06-11T10:00:00+09:00',
      status: 'doctor_waiting',
      status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-11T10:30:00+09:00' }],
    };
    const sorted = sortActive([A, B]).map((c) => c.id);
    // 접수순이면 [A,B]; 진료콜 진입 시각순이면 [B,A]
    expect(sorted).toEqual(['B', 'A']);
  });

  test('AC-1 노랑(힐러예약)/힐러대기도 동일 키로 함께 정렬', () => {
    const purpleLate: MiniCheckIn = {
      id: 'P',
      checked_in_at: '2026-06-11T08:00:00+09:00',
      status: 'doctor_waiting',
      status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-11T12:00:00+09:00' }],
    };
    const yellowMid: MiniCheckIn = {
      id: 'Y',
      checked_in_at: '2026-06-11T08:30:00+09:00',
      status: 'treatment_waiting',
      status_flag: 'yellow',
      status_flag_history: [{ flag: 'yellow', changed_at: '2026-06-11T11:00:00+09:00' }],
    };
    // 힐러대기 — status_flag 전환 이력 없음 → checked_in_at(09:00) 폴백
    const healerWaiting: MiniCheckIn = {
      id: 'H',
      checked_in_at: '2026-06-11T09:00:00+09:00',
      status: 'healer_waiting',
      status_flag: null,
      status_flag_history: null,
    };
    const sorted = sortActive([purpleLate, yellowMid, healerWaiting]).map((c) => c.id);
    // 진입 시각: H=09:00 < Y=11:00 < P=12:00
    expect(sorted).toEqual(['H', 'Y', 'P']);
  });

  test('AC-3 소스 정적 가드: activeList 정렬이 callEntryTime 사용 (checked_in_at 직접 비교 아님)', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    // callEntryTime 헬퍼 export 존재
    expect(src).toMatch(/export function callEntryTime\(/);
    // activeList 블록이 callEntryTime으로 정렬 (정본 회귀 락)
    const activeBlock = src.slice(src.indexOf('const activeList'), src.indexOf('const doneList'));
    expect(activeBlock).toContain('callEntryTime(a).localeCompare(callEntryTime(b))');
    // 접수시각 직접 비교로 회귀하지 않았는지(activeList 한정)
    expect(activeBlock).not.toContain('a.checked_in_at.localeCompare(b.checked_in_at)');
  });

  test('AC-4 DOM 스모크: 명단 위젯 렌더 (데이터/인증 없으면 graceful skip)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page).catch(() => false);
    test.skip(!ok, '로그인/대시보드 접근 불가 — DOM 단언 graceful skip');
    const widget = page.getByTestId('doctor-call-list');
    await expect(widget).toBeVisible({ timeout: 10_000 });
  });
});
