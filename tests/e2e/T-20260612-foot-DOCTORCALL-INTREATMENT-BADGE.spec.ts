/**
 * E2E spec — T-20260612-foot-DOCTORCALL-INTREATMENT-BADGE (WS-2, 방법 B)
 * '원장님 진료콜 명단'(DoctorCallListBar) — "진료 중" 실시간 표시 + 최상단 고정 + 다음 순서 강조.
 *
 * 현장 요청(김주연 총괄, #풋확장 thread 1781175830.787949 / C 옵션 확정 1781230334.270109):
 *   원장이 명단 행을 '진료 중'으로 전환 → 직원/간호사 화면에도 realtime(check_ins 구독)로
 *   "🟢 진료 중 [환자명]" 뱃지 + 최상단 고정. 그 바로 다음 순서 환자(명단 2위)를 "다음"으로 강조.
 *
 * ★DB(prod 적용 완료 2026-06-14): check_ins.doctor_status(in_treatment|done|NULL) +
 *   doctor_started_at + doctor_ended_at. CHECK(doctor_status IN ('in_treatment','done') OR NULL).
 *   본 티켓 코드분은 순수 FE 렌더 레이어(배지·강조) — DB 무변경.
 *
 * AC → 단언 매핑:
 *   AC-5  원장 '진료중' 전환 = doctor_status='in_treatment'+doctor_started_at / '완료'=done+doctor_ended_at
 *         → DoctorStageStepper(별 컴포넌트)에서 이미 write. 여기선 stepper 소스 존재 정적 가드로 회귀 락.
 *   AC-6  "🟢 진료 중" 배지 = isInTreatment(status='examination' OR doctor_status='in_treatment') 판정.
 *   AC-8  진료 중 환자 최상단 고정(compareCallOrder tier-1) — 진입순보다 우선.
 *   AC-9  '완료'(done) 전환 시 진료중 판정 해제 → 배지/고정 해제, 진입순 정렬 복귀.
 *   AC-11 다음 순서 강조 = activeList(진료중 고정 정렬) 중 진료중 아닌 첫 행. 진료중 없으면 1위.
 *   회귀금지: done(pink) 잔존·진입순 정렬·힐러대기 등 다른 기능 미접촉.
 *
 * 컨벤션(repo 표준): 정본 로직 순수함수 모사(런타임 import 회피) + 소스 정적 가드 + DOM graceful skip.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = path.resolve(__dirname, '../../src/components/DoctorCallListBar.tsx');
const STEPPER_SRC = path.resolve(__dirname, '../../src/components/doctor/DoctorStageStepper.tsx');

type MiniCheckIn = {
  id: string;
  checked_in_at: string;
  status?: string;
  status_flag: string | null;
  doctor_status?: string | null;
  status_flag_history?: Array<{ flag: string | null; changed_at: string }> | null;
  call_list_manual_order?: number | null;
};

// ── 정본 로직 모사 (아래 '소스 정적 가드'로 정본 동치 락) ────────────────────────────────
/** isInTreatment: status='examination' OR doctor_status='in_treatment' */
function isInTreatment(ci: Pick<MiniCheckIn, 'status' | 'doctor_status'>): boolean {
  return ci.status === 'examination' || ci.doctor_status === 'in_treatment';
}
function callEntryTime(ci: Pick<MiniCheckIn, 'checked_in_at' | 'status_flag_history'>): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const e = hist[i];
      if (e && (e.flag === 'purple' || e.flag === 'yellow') && e.changed_at) return e.changed_at;
    }
  }
  return ci.checked_in_at;
}
/** compareCallOrder: tier1 진료중 고정 > tier2 수기 override > tier3 진입순 */
function compareCallOrder(a: MiniCheckIn, b: MiniCheckIn): number {
  const at = isInTreatment(a) ? 0 : 1;
  const bt = isInTreatment(b) ? 0 : 1;
  if (at !== bt) return at - bt;
  const am = a.call_list_manual_order;
  const bm = b.call_list_manual_order;
  if (typeof am === 'number' && typeof bm === 'number' && am !== bm) return am - bm;
  if (typeof am === 'number' && typeof bm !== 'number') return -1;
  if (typeof am !== 'number' && typeof bm === 'number') return 1;
  return callEntryTime(a).localeCompare(callEntryTime(b));
}
function activeSort(rows: MiniCheckIn[]): MiniCheckIn[] {
  return rows
    .filter((ci) => ci.status_flag === 'purple' || ci.status_flag === 'yellow' || ci.status === 'healer_waiting')
    .sort(compareCallOrder);
}
/** nextHighlightId: activeList 중 진료중 아닌 첫 행(id). 없으면 null. */
function nextHighlightId(rows: MiniCheckIn[]): string | null {
  const next = activeSort(rows).find((ci) => !isInTreatment(ci));
  return next?.id ?? null;
}

const row = (o: Partial<MiniCheckIn> & { id: string; checked_in_at: string }): MiniCheckIn => ({
  status_flag: 'purple',
  ...o,
});

test.describe('T-20260612 DOCTORCALL-INTREATMENT-BADGE WS-2', () => {
  test('AC-6 진료중 판정: doctor_status=in_treatment 또는 status=examination', () => {
    expect(isInTreatment({ doctor_status: 'in_treatment' })).toBe(true);
    expect(isInTreatment({ status: 'examination' })).toBe(true);
    expect(isInTreatment({ doctor_status: null })).toBe(false);
    expect(isInTreatment({ doctor_status: 'done' })).toBe(false);
    expect(isInTreatment({})).toBe(false); // 마이그 전 폴백(undefined) — 크래시 없음
  });

  test('AC-8 진료중 환자는 진입순보다 앞서 최상단 고정', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00' }), // 진입 가장 빠름
      row({ id: 'B', checked_in_at: '2026-06-12T09:30:00+09:00', doctor_status: 'in_treatment' }),
    ];
    const sorted = activeSort(rows);
    expect(sorted.map((r) => r.id)).toEqual(['B', 'A']); // 진료중 B가 진입 빠른 A보다 위
  });

  test('AC-9 완료(done) 전환 시 진료중 해제 → 진입순 정렬 복귀', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00' }),
      row({ id: 'B', checked_in_at: '2026-06-12T09:30:00+09:00', doctor_status: 'done' }),
    ];
    expect(isInTreatment(rows[1])).toBe(false); // done은 진료중 아님
    expect(activeSort(rows).map((r) => r.id)).toEqual(['A', 'B']); // 진입순 복귀
  });

  test('AC-11 다음 강조: 진료중 없으면 명단 1위', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00' }),
      row({ id: 'B', checked_in_at: '2026-06-12T09:30:00+09:00' }),
    ];
    expect(nextHighlightId(rows)).toBe('A'); // 진입 빠른 1위
  });

  test('AC-11 다음 강조: 진료중 있으면 그 바로 다음(명단 2위)', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00', doctor_status: 'in_treatment' }),
      row({ id: 'B', checked_in_at: '2026-06-12T09:30:00+09:00' }),
      row({ id: 'C', checked_in_at: '2026-06-12T10:00:00+09:00' }),
    ];
    // A(진료중)=최상단, 다음 강조는 진료중 아닌 첫 행 = B
    expect(nextHighlightId(rows)).toBe('B');
  });

  test('AC-11 엣지: 진료중 2명이면 진료중 블록 바로 아래(첫 비진료중) 강조', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00', doctor_status: 'in_treatment' }),
      row({ id: 'B', checked_in_at: '2026-06-12T09:10:00+09:00', status: 'examination' }),
      row({ id: 'C', checked_in_at: '2026-06-12T09:30:00+09:00' }),
    ];
    expect(nextHighlightId(rows)).toBe('C');
  });

  test('AC-11 엣지: 전원 진료중이면 다음 강조 없음(null)', () => {
    const rows = [
      row({ id: 'A', checked_in_at: '2026-06-12T09:00:00+09:00', doctor_status: 'in_treatment' }),
      row({ id: 'B', checked_in_at: '2026-06-12T09:30:00+09:00', status: 'examination' }),
    ];
    expect(nextHighlightId(rows)).toBeNull();
  });

  // ── 소스 정적 가드: 정본이 위 모사와 동치임을 락 ─────────────────────────────────────
  test('소스 가드: isInTreatment 판정식(examination OR in_treatment) 유지', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    expect(src).toMatch(/ci\.status === 'examination' \|\| ci\.doctor_status === 'in_treatment'/);
  });

  test('AC-6 소스 가드: 🟢 진료 중 배지 렌더(doctor-call-intreatment-badge)', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    expect(src).toContain('doctor-call-intreatment-badge');
    expect(src).toMatch(/inTreatment\s*&&/); // 진료중일 때만 배지
    expect(src).toContain('진료 중');
  });

  test('AC-11 소스 가드: nextHighlightId + "다음" 배지(doctor-call-next-badge)', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    expect(src).toContain('nextHighlightId');
    expect(src).toContain('doctor-call-next-badge');
    expect(src).toMatch(/isNext\s*&&\s*!inTreatment/); // 진료중이면 다음 배지 미노출(중복 방지)
  });

  test('AC-8 소스 가드: compareCallOrder tier-1 진료중 고정 유지', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    expect(src).toMatch(/isInTreatment\(a\)/);
    expect(src).toMatch(/\.sort\(compareCallOrder\)/);
  });

  test('AC-5 소스 가드: stepper가 doctor_status(in_treatment/done)+started/ended write', () => {
    const src = fs.readFileSync(STEPPER_SRC, 'utf-8');
    expect(src).toContain("doctor_status: 'in_treatment'");
    expect(src).toContain("doctor_status: 'done'");
    expect(src).toContain('doctor_started_at');
    expect(src).toContain('doctor_ended_at');
  });
});
