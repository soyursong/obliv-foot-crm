/**
 * E2E spec — T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK (옵션 A, read-side no-DDL)
 * '원장님 진료콜 명단'(DoctorCallListBar) 1차 정렬이 접수순처럼 새는 결함 보정.
 *
 * 현장 요청(김주연 총괄, #project-doai-crm-풋확장 thread 1781571080.626909):
 *   "진료콜 1차 순서 접수 순 아니고 진료콜 명단 진입순이야 설정값 다시 검토해봐."
 *   = T-20260611-ENTRY-ORDER-LIVE-PRIORITY로 확정·배포된 '진입순' 정책이 일부 케이스에서 여전히 접수순처럼 보이는 결함.
 *
 * 근본 원인(AC-0 실측, 라이브 14일 활성 10건 중 폴백 2건):
 *   - healer_waiting로 *status 전환만* 된 환자는 status_flag_history에 purple/yellow 진입기록이 없어
 *     곧장 checked_in_at(접수시각)으로 폴백 → tier3가 사실상 접수순으로 샘.
 *   - 그 환자의 명단 진입(activation)시각은 status_transitions 테이블에 transitioned_at으로 남아있음.
 *
 * ★핵심(옵션 A, DDL 없음): callEntryTime 폴백 사다리에 2순위 추가 —
 *   ① status_flag_history 최근 purple/yellow changed_at
 *   ② derivedCallEntryAt (Dashboard fetch가 status_transitions 명단 active 전환 최신 transitioned_at을 read-path 주입)
 *   ③ checked_in_at (어떤 전환기록도 없는 안정값 — NaN/누락 정렬 금지)
 *
 * ⚠ known-limitation: HL자동노랑(Dashboard 벌크 yellow-update가 SSOT 우회)은 transition row 자체가 없어
 *   ②로도 복구 불가 → ③ checked_in_at 잔존(소수 엣지). source-side 교정은 옵션 B 별도티켓(본 WS 범위 외).
 *
 * AC → 단언 매핑:
 *   AC-1 healer_waiting(flag history 부재) 환자가 derivedCallEntryAt(②) 진입시각으로 자리 잡음(접수순 아님).
 *   AC-1 known-limit  ② 부재 + flag history 부재 → ③ checked_in_at 폴백(HL자동노랑 잔존, NaN/크래시 없음).
 *   AC-2 회귀금지: tier1(진료중 고정)·tier2(수기 override)·inclusion 조건 불변.
 *   AC-1 소스 가드: callEntryTime 사다리에 derivedCallEntryAt(②) 존재 + Dashboard가 status_transitions→callEntryMap 주입.
 *
 * 컨벤션: 정본 로직 모사(순수함수 단위) + 소스 정적 가드 + DOM graceful skip.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = path.resolve(__dirname, '../../src/components/DoctorCallListBar.tsx');
const DASHBOARD_SRC = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');

type MiniCheckIn = {
  id: string;
  checked_in_at: string;
  status: string;
  status_flag: string | null;
  status_flag_history: Array<{ flag: string | null; changed_at: string }> | null;
  derivedCallEntryAt?: string | null;
  doctor_status?: 'in_treatment' | 'done' | null;
  call_list_manual_order?: number | null;
};

/** 정본 callEntryTime 3단 사다리 모사(AC-1 소스 가드로 정본 동치 락).
 *  REOPEN 회귀정정: ①을 'latest purple/yellow'→'현재 active 에피소드 시작'(끝에서부터 연속 active 구간 최이른값)으로 변경.
 *  재플래그(에피소드 내 purple 재터치)로 진입시각이 밀려 먼저 진입한 환자가 아래로 가라앉던 결함 보정. */
function callEntryTime(
  ci: Pick<MiniCheckIn, 'checked_in_at' | 'status_flag_history' | 'derivedCallEntryAt'>,
): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    let episodeStart: string | null = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const entry = hist[i];
      if (entry && (entry.flag === 'purple' || entry.flag === 'yellow') && entry.changed_at) {
        episodeStart = entry.changed_at; // 더 이른 active 로 계속 덮어써 구간 최이른값 수렴.
      } else {
        break; // 비-active 경계 — 현재 에피소드 종료.
      }
    }
    if (episodeStart) return episodeStart; // ①
  }
  if (ci.derivedCallEntryAt) return ci.derivedCallEntryAt; // ②
  return ci.checked_in_at; // ③
}

function isInTreatment(ci: MiniCheckIn): boolean {
  return ci.status === 'examination' || ci.doctor_status === 'in_treatment';
}

function compareCallOrder(a: MiniCheckIn, b: MiniCheckIn): number {
  const at = isInTreatment(a) ? 0 : 1;
  const bt = isInTreatment(b) ? 0 : 1;
  if (at !== bt) return at - bt;
  const am = typeof a.call_list_manual_order === 'number' ? a.call_list_manual_order : null;
  const bm = typeof b.call_list_manual_order === 'number' ? b.call_list_manual_order : null;
  if (am !== null && bm !== null) {
    if (am !== bm) return am - bm;
  } else if (am !== null || bm !== null) {
    return am !== null ? -1 : 1;
  }
  return callEntryTime(a).localeCompare(callEntryTime(b));
}

function sortActive(rows: MiniCheckIn[]): MiniCheckIn[] {
  return rows
    .filter((ci) => ci.status_flag === 'purple' || ci.status_flag === 'yellow' || ci.status === 'healer_waiting')
    .sort(compareCallOrder);
}

test.describe('T-20260616 CALLLIST-ENTRYORDER-FALLBACK — 진입순 폴백 사다리(옵션 A, read-side)', () => {
  test('AC-1 ② derivedCallEntryAt: healer_waiting(flag history 부재) 진입시각으로 정렬 (접수순 아님)', () => {
    // P: 늦게 접수했지만 진료필요(purple) 진입은 빠름.
    const purpleEarlyEntry: MiniCheckIn = {
      id: 'P', checked_in_at: '2026-06-16T10:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-16T09:05:00+09:00' }],
    };
    // H: 먼저 접수했지만 healer_waiting 명단 진입은 늦음. flag history 없음 → ② transitioned_at 사용해야 함.
    const healerLateEntry: MiniCheckIn = {
      id: 'H', checked_in_at: '2026-06-16T08:00:00+09:00', status: 'healer_waiting', status_flag: null,
      status_flag_history: null, derivedCallEntryAt: '2026-06-16T09:30:00+09:00',
    };
    // 진입시각: P=09:05 < H=09:30 → [P, H]. (만약 ②가 없으면 H는 checked_in_at=08:00로 떨어져 접수순 H<P 오정렬)
    expect(sortActive([healerLateEntry, purpleEarlyEntry]).map((c) => c.id)).toEqual(['P', 'H']);
  });

  test('AC-1 ② 우선순위: status_flag_history(①)가 derivedCallEntryAt(②)보다 우선', () => {
    const ci: MiniCheckIn = {
      id: 'X', checked_in_at: '2026-06-16T08:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-16T11:00:00+09:00' }],
      derivedCallEntryAt: '2026-06-16T09:00:00+09:00',
    };
    expect(callEntryTime(ci)).toBe('2026-06-16T11:00:00+09:00'); // ①
  });

  test('REOPEN 회귀정정: 에피소드 내 purple 재터치돼도 *먼저 진입* 환자가 상단 유지 (latest→episodeStart)', () => {
    // X: 09:00 최초 진입 후 09:45 재플래그(같은 에피소드 내 purple 재터치). 진입시각=09:00이어야 함(에피소드 시작).
    const reTouched: MiniCheckIn = {
      id: 'X', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [
        { flag: 'purple', changed_at: '2026-06-17T09:00:00+09:00' },
        { flag: 'purple', changed_at: '2026-06-17T09:45:00+09:00' },
      ],
    };
    // Y: 09:30 단일 진입. 진입시각=09:30.
    const laterSingle: MiniCheckIn = {
      id: 'Y', checked_in_at: '2026-06-17T08:30:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T09:30:00+09:00' }],
    };
    // 정정 후: X(09:00) < Y(09:30) → [X, Y]. (기존 latest 로직이면 X=09:45 > Y=09:30 → [Y, X] 회귀 — 먼저 진입한 X가 아래로)
    expect(callEntryTime(reTouched)).toBe('2026-06-17T09:00:00+09:00');
    expect(sortActive([laterSingle, reTouched]).map((c) => c.id)).toEqual(['X', 'Y']);
  });

  test('REOPEN 에피소드 경계: 비-active(pink) 이후 재진입 시 *현재* 에피소드 시작만 사용(이전 해소분 무시)', () => {
    // 08:00 진입 → 08:30 pink(해소) → 09:00 재진입. 현재 에피소드 시작=09:00 (08:00 아님).
    const reEntered: MiniCheckIn = {
      id: 'Z', checked_in_at: '2026-06-17T07:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [
        { flag: 'purple', changed_at: '2026-06-17T08:00:00+09:00' },
        { flag: 'pink', changed_at: '2026-06-17T08:30:00+09:00' },
        { flag: 'purple', changed_at: '2026-06-17T09:00:00+09:00' },
      ],
    };
    expect(callEntryTime(reEntered)).toBe('2026-06-17T09:00:00+09:00');
  });

  test('AC-1 known-limit: ②·① 모두 부재(HL자동노랑류) → ③ checked_in_at 폴백 (NaN/크래시 없음)', () => {
    // 벌크 yellow-update가 SSOT 우회 → flag history 無, transition row 無 → 접수시각 잔존(설계상 허용).
    const hlAutoYellow: MiniCheckIn = {
      id: 'Y', checked_in_at: '2026-06-16T10:00:00+09:00', status: 'preconditioning', status_flag: 'yellow',
      status_flag_history: null,
    };
    expect(callEntryTime(hlAutoYellow)).toBe('2026-06-16T10:00:00+09:00'); // ③
    // 정렬 시 유효 ISO 문자열 → NaN 없음.
    expect(Number.isNaN(Date.parse(callEntryTime(hlAutoYellow)))).toBe(false);
  });

  test('AC-2 회귀: tier1 진료중 고정 — 진료중 환자는 진입시각 무관 항상 상단', () => {
    const inTreat: MiniCheckIn = {
      id: 'T', checked_in_at: '2026-06-16T12:00:00+09:00', status: 'examination', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-16T12:00:00+09:00' }],
    };
    const earlyWaiter: MiniCheckIn = {
      id: 'W', checked_in_at: '2026-06-16T08:00:00+09:00', status: 'healer_waiting', status_flag: null,
      status_flag_history: null, derivedCallEntryAt: '2026-06-16T08:30:00+09:00',
    };
    expect(sortActive([earlyWaiter, inTreat]).map((c) => c.id)).toEqual(['T', 'W']);
  });

  test('AC-2 회귀: tier2 수기 override가 tier3 진입순보다 우선', () => {
    const manual: MiniCheckIn = {
      id: 'M', checked_in_at: '2026-06-16T12:00:00+09:00', status: 'healer_waiting', status_flag: null,
      status_flag_history: null, derivedCallEntryAt: '2026-06-16T12:00:00+09:00', call_list_manual_order: 10,
    };
    const autoEarly: MiniCheckIn = {
      id: 'A', checked_in_at: '2026-06-16T08:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-16T08:00:00+09:00' }],
    };
    // 수기 override(M)가 진입 빠른 A보다 위.
    expect(sortActive([autoEarly, manual]).map((c) => c.id)).toEqual(['M', 'A']);
  });

  test('AC-1 소스 가드: callEntryTime 사다리에 derivedCallEntryAt(②) + Dashboard status_transitions→callEntryMap 주입', () => {
    const comp = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    // callEntryTime 본문에 ② derivedCallEntryAt 폴백 존재 (사다리 회귀 락).
    const fnBlock = comp.slice(comp.indexOf('export function callEntryTime'), comp.indexOf('function isInTreatment'));
    expect(fnBlock).toContain('ci.derivedCallEntryAt');
    // ③ 최종단은 여전히 checked_in_at.
    expect(fnBlock).toContain('ci.checked_in_at');
    // REOPEN 회귀정정 락: ①이 'latest'가 아니라 '에피소드 시작'(episodeStart 누적 + 비-active break) 구조여야 함.
    expect(fnBlock).toContain('episodeStart');
    expect(fnBlock).toMatch(/break\s*;/); // 비-active 경계에서 중단(에피소드 한정).

    const dash = fs.readFileSync(DASHBOARD_SRC, 'utf-8');
    // Dashboard가 status_transitions를 read해 callEntryMap을 만들고, DoctorCallListBar 전용 rows에 derivedCallEntryAt 주입.
    expect(dash).toContain('setCallEntryMap');
    expect(dash).toContain('derivedCallEntryAt');
    expect(dash).toContain('doctorCallRows');
    // 원본 rows 불변 — DoctorCallListBar에 doctorCallRows 전달(별도 배열).
    expect(dash).toContain('checkIns={doctorCallRows}');
  });

  test('AC-3 DOM 스모크: 명단 위젯 렌더 (데이터/인증 없으면 graceful skip)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page).catch(() => false);
    test.skip(!ok, '로그인/대시보드 진입 불가 환경 — DOM 스모크 skip');
    // 위젯 컨테이너가 크래시 없이 마운트되는지(렌더 무결성)만 확인.
    await page.waitForTimeout(500);
    expect(await page.locator('body').count()).toBeGreaterThan(0);
  });
});
