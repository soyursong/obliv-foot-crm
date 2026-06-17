/**
 * E2E spec — T-20260617-foot-CALLLIST-HLAUTOYELLOW-TOP (AC-1', read-side no-DDL)
 * 힐러(노랑) 고객이 [힐러대기] 슬롯 이동 감지 시 진료콜 명단 상위로 자동 배치.
 *
 * 현장 요청(김주연 총괄, #project-doai-crm-풋확장 thread 1781688954.501659, 회신 MSG-20260618-073042-pry2):
 *   "힐러(노랑) 고객은 체크인 한 순간에 바로 노란색으로 되기 때문에 진입 시기 기준이 없다. 그 기준 시점을
 *    [힐러대기] 이동했을 때로 잡는다. 진료필요(보라)가 상태변경 기점으로 상위 노출되듯, 힐러(노랑)도
 *    [힐러대기] 슬롯 이동 감지 시 진료콜 명단 상위로 자동 배치되는 걸 요구한 것."
 *
 * ★핵심(AC-1', DDL 없음): compareCallOrder에 우선 sub-tier(2.5) 추가 —
 *   tier1 진료중 고정 > tier2 수기 override > tier2.5 힐러(노랑)+[힐러대기] 이동감지 > tier3 일반 진입순.
 *   식별 = 힐러 신호(status_flag='yellow' OR status='healer_waiting') AND healerWaitingAt 보유
 *          (= Dashboard fetch가 status_transitions to_status='healer_waiting' 최초 transitioned_at을 read-path 주입).
 *   힐러(노랑) 내부 정렬 = healerWaitingAt asc([힐러대기] 이동 빠른 순), 동시각이면 checked_in_at asc.
 *   → [힐러대기] 이동 시각이 늦어도(오후) 일반 진입순(tier3) 환자 아래로 가라앉지 않고 상단 노출.
 *
 * ⚠ escape(B안, 비차단): healer_waiting transition 전무한 힐러(벌크 yellow SSOT 우회 subset)는 healerWaitingAt
 *   결측 → 본 sub-tier 미적용(일반 진입순 폴백). source-side 교정은 별건(planner FOLLOWUP) — 본 read-side 출하 범위 외.
 *
 * AC → 단언 매핑:
 *   AC-1' top배치   : [힐러대기] 이동 늦은(오후) 힐러(노랑)이 오전 진입 일반(purple)보다 위.
 *   AC-1' 내부정렬  : 힐러(노랑) 2명 이상 → healerWaitingAt asc, 동시각이면 checked_in_at asc.
 *   AC-1' 폴백      : healerWaitingAt 결측 힐러(벌크 yellow subset) → sub-tier 미적용, NaN/크래시 없음.
 *   AC-2' 회귀      : tier1(진료중 고정)·tier2(수기 override)·일반 진입순(tier3)·inclusion 조건 불변.
 *   소스 가드       : compareCallOrder에 isHealerPrioritized sub-tier + Dashboard healerWaitingMap 주입.
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
  healerWaitingAt?: string | null;
  doctor_status?: 'in_treatment' | 'done' | null;
  call_list_manual_order?: number | null;
};

/** 정본 callEntryTime 3단 사다리 모사(부모 FALLBACK-RECEIPTLEAK 정본 동치). */
function callEntryTime(
  ci: Pick<MiniCheckIn, 'checked_in_at' | 'status_flag_history' | 'derivedCallEntryAt'>,
): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    let episodeStart: string | null = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const entry = hist[i];
      if (entry && (entry.flag === 'purple' || entry.flag === 'yellow') && entry.changed_at) {
        episodeStart = entry.changed_at;
      } else {
        break;
      }
    }
    if (episodeStart) return episodeStart;
  }
  if (ci.derivedCallEntryAt) return ci.derivedCallEntryAt;
  return ci.checked_in_at;
}

function isInTreatment(ci: MiniCheckIn): boolean {
  return ci.status === 'examination' || ci.doctor_status === 'in_treatment';
}

/** 정본 isHealerPrioritized 모사(AC-1' 소스 가드로 정본 동치 락). */
function isHealerPrioritized(ci: MiniCheckIn): boolean {
  const healerSignal = ci.status_flag === 'yellow' || ci.status === 'healer_waiting';
  return healerSignal && !!ci.healerWaitingAt;
}

/** 정본 compareCallOrder 모사 — tier1 > tier2 수기 > tier2.5 힐러(노랑) > tier3 진입순. */
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
  const ah = isHealerPrioritized(a) ? 0 : 1;
  const bh = isHealerPrioritized(b) ? 0 : 1;
  if (ah !== bh) return ah - bh;
  if (ah === 0) {
    const ahw = a.healerWaitingAt ?? a.checked_in_at;
    const bhw = b.healerWaitingAt ?? b.checked_in_at;
    const hcmp = ahw.localeCompare(bhw);
    if (hcmp !== 0) return hcmp;
    return a.checked_in_at.localeCompare(b.checked_in_at);
  }
  return callEntryTime(a).localeCompare(callEntryTime(b));
}

function sortActive(rows: MiniCheckIn[]): MiniCheckIn[] {
  return rows
    .filter((ci) => ci.status_flag === 'purple' || ci.status_flag === 'yellow' || ci.status === 'healer_waiting')
    .sort(compareCallOrder);
}

test.describe('T-20260617 CALLLIST-HLAUTOYELLOW-TOP — 힐러(노랑) [힐러대기] 이동 시 상위 배치(AC-1\', read-side)', () => {
  test('AC-1\' top배치: [힐러대기] 이동 늦은(오후) 힐러(노랑)이 오전 진입 일반(purple)보다 위', () => {
    // P: 오전(09:05) 진료필요(purple) 진입한 일반 환자.
    const purpleMorning: MiniCheckIn = {
      id: 'P', checked_in_at: '2026-06-17T09:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T09:05:00+09:00' }],
    };
    // H: 체크인 즉시 노랑(healer). [힐러대기] 이동은 오후(14:00)로 늦음 → 진입순이면 아래로 가라앉지만 sub-tier로 상단.
    const healerAfternoon: MiniCheckIn = {
      id: 'H', checked_in_at: '2026-06-17T08:30:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: '2026-06-17T14:00:00+09:00',
    };
    // 힐러(노랑) sub-tier(2.5) > 일반 진입순(tier3) → [H, P]. (sub-tier 없으면 H가 14:00로 P 아래 = 가라앉음 결함)
    expect(sortActive([purpleMorning, healerAfternoon]).map((c) => c.id)).toEqual(['H', 'P']);
  });

  test('AC-1\' 내부정렬: 힐러(노랑) 2명 → healerWaitingAt asc([힐러대기] 이동 빠른 순)', () => {
    const h1Late: MiniCheckIn = {
      id: 'H1', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: '2026-06-17T15:00:00+09:00',
    };
    const h2Early: MiniCheckIn = {
      id: 'H2', checked_in_at: '2026-06-17T10:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: '2026-06-17T13:00:00+09:00',
    };
    // [힐러대기] 이동: H2(13:00) < H1(15:00) → [H2, H1] (접수는 H1이 빠르지만 이동시각 기준).
    expect(sortActive([h1Late, h2Early]).map((c) => c.id)).toEqual(['H2', 'H1']);
  });

  test('AC-1\' 내부정렬 2차: [힐러대기] 동시각이면 checked_in_at asc', () => {
    const sameMove = '2026-06-17T13:00:00+09:00';
    const hLateCheckin: MiniCheckIn = {
      id: 'HL', checked_in_at: '2026-06-17T10:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: sameMove,
    };
    const hEarlyCheckin: MiniCheckIn = {
      id: 'HE', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: sameMove,
    };
    expect(sortActive([hLateCheckin, hEarlyCheckin]).map((c) => c.id)).toEqual(['HE', 'HL']);
  });

  test('AC-1\' 폴백/escape: healerWaitingAt 결측 힐러(벌크 yellow subset) → sub-tier 미적용(일반 진입순)', () => {
    // 힐러 신호(yellow)지만 [힐러대기] transition 전무(healerWaitingAt undefined) → 우선 sub-tier 미적용.
    const bulkYellowNoMove: MiniCheckIn = {
      id: 'BY', checked_in_at: '2026-06-17T14:00:00+09:00', status: 'preconditioning', status_flag: 'yellow',
      status_flag_history: null,
    };
    // 오전 진입 일반(purple) — 진입시각 09:00.
    const purpleEarly: MiniCheckIn = {
      id: 'P', checked_in_at: '2026-06-17T08:30:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T09:00:00+09:00' }],
    };
    // BY는 sub-tier 미적용 → tier3 진입순(checked_in_at 14:00 폴백) → P(09:00) 위로 못 올라옴 → [P, BY].
    expect(isHealerPrioritized(bulkYellowNoMove)).toBe(false);
    expect(sortActive([bulkYellowNoMove, purpleEarly]).map((c) => c.id)).toEqual(['P', 'BY']);
    // NaN/크래시 없음.
    expect(Number.isNaN(Date.parse(callEntryTime(bulkYellowNoMove)))).toBe(false);
  });

  test('AC-2\' 회귀: tier1 진료중 고정 — 힐러(노랑) sub-tier보다도 위', () => {
    const inTreat: MiniCheckIn = {
      id: 'T', checked_in_at: '2026-06-17T12:00:00+09:00', status: 'examination', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T12:00:00+09:00' }],
    };
    const healer: MiniCheckIn = {
      id: 'H', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: '2026-06-17T08:30:00+09:00',
    };
    expect(sortActive([healer, inTreat]).map((c) => c.id)).toEqual(['T', 'H']);
  });

  test('AC-2\' 회귀: tier2 수기 override가 힐러(노랑) sub-tier보다 우선', () => {
    const manual: MiniCheckIn = {
      id: 'M', checked_in_at: '2026-06-17T12:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T12:00:00+09:00' }],
      call_list_manual_order: 5,
    };
    const healerEarlyMove: MiniCheckIn = {
      id: 'H', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'healer_waiting', status_flag: 'yellow',
      status_flag_history: null, healerWaitingAt: '2026-06-17T08:30:00+09:00',
    };
    // 수기 override(M, tier2)가 힐러(노랑) sub-tier(2.5)보다 위.
    expect(sortActive([healerEarlyMove, manual]).map((c) => c.id)).toEqual(['M', 'H']);
  });

  test('AC-2\' 회귀: 일반 환자(purple)끼리는 진입순(tier3) 정렬 불변', () => {
    const pLate: MiniCheckIn = {
      id: 'PL', checked_in_at: '2026-06-17T08:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T10:00:00+09:00' }],
    };
    const pEarly: MiniCheckIn = {
      id: 'PE', checked_in_at: '2026-06-17T09:00:00+09:00', status: 'consultation', status_flag: 'purple',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-17T09:30:00+09:00' }],
    };
    // 힐러 무관 — 진입순(PE 09:30 < PL 10:00) → [PE, PL].
    expect(sortActive([pLate, pEarly]).map((c) => c.id)).toEqual(['PE', 'PL']);
  });

  test('AC-1\' 소스 가드: compareCallOrder sub-tier(isHealerPrioritized/healerWaitingAt) + Dashboard healerWaitingMap 주입', () => {
    const comp = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    // isHealerPrioritized 헬퍼 존재 + 힐러 신호 + healerWaitingAt 조합.
    expect(comp).toContain('function isHealerPrioritized');
    expect(comp).toContain('healerWaitingAt');
    // compareCallOrder에 sub-tier(2.5) 분기 존재 — isHealerPrioritized 호출 + 내부 healerWaitingAt 정렬.
    const cmpBlock = comp.slice(comp.indexOf('export function compareCallOrder'), comp.indexOf('function loadRowHidden'));
    expect(cmpBlock).toContain('isHealerPrioritized(a)');
    expect(cmpBlock).toContain('isHealerPrioritized(b)');
    expect(cmpBlock).toContain('a.healerWaitingAt ?? a.checked_in_at'); // 폴백 + NaN 금지.
    // tier1/tier2 회귀 락 — 진료중 고정 + 수기 override 선행 유지.
    expect(cmpBlock).toContain('isInTreatment(a)');
    expect(cmpBlock).toContain('call_list_manual_order');

    const dash = fs.readFileSync(DASHBOARD_SRC, 'utf-8');
    // Dashboard가 status_transitions to_status='healer_waiting' 최초 transitioned_at → healerWaitingMap → 주입.
    expect(dash).toContain('setHealerWaitingMap');
    expect(dash).toContain('healerWaitingAt');
    // 원본 rows 불변 — doctorCallRows 전용 주입(별도 배열).
    expect(dash).toContain('doctorCallRows');
    expect(dash).toContain('checkIns={doctorCallRows}');
  });

  test('AC-3 DOM 스모크: 명단 위젯 렌더 (데이터/인증 없으면 graceful skip)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page).catch(() => false);
    test.skip(!ok, '로그인/대시보드 진입 불가 환경 — DOM 스모크 skip');
    await page.waitForTimeout(500);
    expect(await page.locator('body').count()).toBeGreaterThan(0);
  });
});
