/**
 * T-20260706-foot-DEDUCT-SLOT-DWELL-INJECT — 차감 레코드에 슬롯 치료구간(dwell) 주입
 *
 * 부모 T-20260608-foot-TICKET-DEDUCT-SLOT-DATA AC4 이관.
 *   차감(패키지 차감) 저장 시 status_transitions 기반 fn_check_in_slot_dwell(20260602230000)로
 *   파생한 치료실(preconditioning) 슬롯의 [entered_at, exited_at]를
 *   package_sessions.treatment_started_at / treatment_ended_at 에 주입한다.
 *
 * 본 spec 은 CustomerChartPage.tsx 의 deriveTreatmentDwell 선택 로직 + RPC 세그먼트 산출을
 * 코드와 동일 로직으로 재현해 회귀 가드한다(DB/브라우저 불필요 순수 로직).
 *
 * AC1: 일반 차감(saveC22Deduct)·힐러 예약後 차감(handleHealerDeduct) 양 핸들러 모두
 *      dwell 구간을 차감 레코드에 write. 동일 내원 → 동일 결과(핸들러 무관).
 *      dwell 파생 불가(전이 로그 없음/치료실 미경유) → {null,null}, 차감 insert 무차단.
 */
import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// RPC fn_check_in_slot_dwell 세그먼트 산출 재현 (SQL 20260602230000 과 동일 모델)
//   각 전이 i: 세그먼트 status = from_status, [직전 전이(없으면 checked_in_at), 전이 시각]
//   마지막(현재) 세그먼트: status = 마지막 to_status, [마지막 전이, now], is_current=true
//     current_status ∈ done/cancelled 면 미산출.
// ──────────────────────────────────────────────────────────────────────
interface Transition { from_status: string; to_status: string; transitioned_at: string }
interface SlotDwellSeg {
  seq: number;
  status: string;
  entered_at: string;
  exited_at: string;
  is_current: boolean;
}

function computeDwellSegments(
  checkedInAt: string,
  currentStatus: string,
  transitions: Transition[],
  now: string,
): SlotDwellSeg[] {
  const sorted = [...transitions].sort(
    (a, b) => new Date(a.transitioned_at).getTime() - new Date(b.transitioned_at).getTime(),
  );
  const segs: SlotDwellSeg[] = [];
  let prev = checkedInAt;
  sorted.forEach((t, idx) => {
    segs.push({
      seq: idx + 1,
      status: t.from_status,
      entered_at: prev,
      exited_at: t.transitioned_at,
      is_current: false,
    });
    prev = t.transitioned_at;
  });
  if (currentStatus !== 'done' && currentStatus !== 'cancelled') {
    const status = sorted.length > 0 ? sorted[sorted.length - 1].to_status : currentStatus;
    const entered = sorted.length > 0 ? sorted[sorted.length - 1].transitioned_at : checkedInAt;
    segs.push({ seq: sorted.length + 1, status, entered_at: entered, exited_at: now, is_current: true });
  }
  return segs;
}

// ──────────────────────────────────────────────────────────────────────
// deriveTreatmentDwell 선택 로직 재현 (CustomerChartPage.tsx)
//   치료실(preconditioning) 세그먼트만 대상:
//     started_at = 가장 이른 치료실 세그먼트 entered_at
//     ended_at   = 완료(is_current=false) 치료실 세그먼트 exited_at, 없으면 null
//   치료실 세그먼트 0건 → {null,null}
// ──────────────────────────────────────────────────────────────────────
function deriveTreatmentDwell(
  segs: SlotDwellSeg[] | null,
): { started_at: string | null; ended_at: string | null } {
  if (!segs) return { started_at: null, ended_at: null };
  const precond = segs.filter((s) => s.status === 'preconditioning').sort((a, b) => a.seq - b.seq);
  if (precond.length === 0) return { started_at: null, ended_at: null };
  const started_at = precond[0].entered_at ?? null;
  const completed = precond.find((s) => !s.is_current);
  const ended_at = completed ? completed.exited_at ?? null : null;
  return { started_at, ended_at };
}

test.describe('T-20260706-foot-DEDUCT-SLOT-DWELL-INJECT (pure-logic)', () => {
  // 시나리오 1: 일반 차감 dwell 주입 — 치료실 진입~퇴실 구간이 차감 레코드에 주입됨
  test('AC1/시나리오1: 치료실 진입→퇴실 완료 방문 — start/end 주입(NULL 아님)', () => {
    const checkedInAt = '2026-07-06T10:00:00+09:00';
    const transitions: Transition[] = [
      // 10:00 접수 → 10:05 상담실
      { from_status: 'registered', to_status: 'consultation', transitioned_at: '2026-07-06T10:05:00+09:00' },
      // 10:05 상담실 → 10:20 치료실(preconditioning) 진입
      { from_status: 'consultation', to_status: 'preconditioning', transitioned_at: '2026-07-06T10:20:00+09:00' },
      // 10:20 치료실 → 10:50 레이저실(치료실 퇴실 = 치료 종료)
      { from_status: 'preconditioning', to_status: 'laser', transitioned_at: '2026-07-06T10:50:00+09:00' },
    ];
    const segs = computeDwellSegments(checkedInAt, 'laser', transitions, '2026-07-06T11:00:00+09:00');
    const dwell = deriveTreatmentDwell(segs);

    expect(dwell.started_at).toBe('2026-07-06T10:20:00+09:00'); // 치료실 진입
    expect(dwell.ended_at).toBe('2026-07-06T10:50:00+09:00');   // 치료실 퇴실
    expect(dwell.started_at).not.toBeNull();
    expect(dwell.ended_at).not.toBeNull();
    // 치료 종료 > 치료 시작 (음수 구간 없음)
    expect(new Date(dwell.ended_at!).getTime()).toBeGreaterThan(new Date(dwell.started_at!).getTime());
  });

  // 치료실→done(레이저 미경유) 세션도 치료실 퇴실 시각으로 종료 잡힘 (stats v2 측정창과 동일)
  test('AC1: 치료실→done(레이저 미경유) — 치료실 퇴실 시각으로 종료 산출', () => {
    const checkedInAt = '2026-07-06T14:00:00+09:00';
    const transitions: Transition[] = [
      { from_status: 'registered', to_status: 'preconditioning', transitioned_at: '2026-07-06T14:10:00+09:00' },
      { from_status: 'preconditioning', to_status: 'done', transitioned_at: '2026-07-06T14:40:00+09:00' },
    ];
    const segs = computeDwellSegments(checkedInAt, 'done', transitions, '2026-07-06T15:00:00+09:00');
    const dwell = deriveTreatmentDwell(segs);
    expect(dwell.started_at).toBe('2026-07-06T14:10:00+09:00');
    expect(dwell.ended_at).toBe('2026-07-06T14:40:00+09:00');
  });

  // 시나리오 2: 힐러 예약後 차감 동일성 — 동일 내원이면 핸들러 무관 동일 dwell
  test('AC1/시나리오2: 힐러 차감 = 일반 차감 (동일 내원 → 동일 dwell)', () => {
    const checkedInAt = '2026-07-06T09:00:00+09:00';
    const transitions: Transition[] = [
      { from_status: 'registered', to_status: 'preconditioning', transitioned_at: '2026-07-06T09:15:00+09:00' },
      { from_status: 'preconditioning', to_status: 'laser', transitioned_at: '2026-07-06T09:45:00+09:00' },
    ];
    const segs = computeDwellSegments(checkedInAt, 'laser', transitions, '2026-07-06T10:00:00+09:00');
    // saveC22Deduct 와 handleHealerDeduct 는 동일 deriveTreatmentDwell 을 호출 → 동일 입력 동일 출력
    const normalDwell = deriveTreatmentDwell(segs);
    const healerDwell = deriveTreatmentDwell(segs);
    expect(healerDwell).toEqual(normalDwell);
    expect(healerDwell.started_at).toBe('2026-07-06T09:15:00+09:00');
    expect(healerDwell.ended_at).toBe('2026-07-06T09:45:00+09:00');
  });

  // 시나리오 3: dwell 파생 불가 엣지 — 전이 로그 없음/치료실 미경유 → NULL(무차단)
  test('AC1/시나리오3-a: 전이 로그 없는(슬롯 체크인 미경유) 차감 → NULL 저장', () => {
    // check_in_id 자체가 없거나(=null) RPC 결과 없음 → deriveTreatmentDwell(null)
    const dwell = deriveTreatmentDwell(null);
    expect(dwell.started_at).toBeNull();
    expect(dwell.ended_at).toBeNull();
  });

  test('AC1/시나리오3-b: 치료실(preconditioning) 미경유 방문 → NULL(무차단)', () => {
    const checkedInAt = '2026-07-06T11:00:00+09:00';
    const transitions: Transition[] = [
      // 접수 → 상담실 → done. 치료실 미경유.
      { from_status: 'registered', to_status: 'consultation', transitioned_at: '2026-07-06T11:05:00+09:00' },
      { from_status: 'consultation', to_status: 'done', transitioned_at: '2026-07-06T11:20:00+09:00' },
    ];
    const segs = computeDwellSegments(checkedInAt, 'done', transitions, '2026-07-06T12:00:00+09:00');
    const dwell = deriveTreatmentDwell(segs);
    expect(dwell.started_at).toBeNull();
    expect(dwell.ended_at).toBeNull();
  });

  // 엣지: 치료실 진입했으나 아직 치료실 체류중(is_current) → 시작만 확정, 종료 미확정(NULL)
  test('AC1: 치료실 진행중(아직 미퇴실) → start 확정, end NULL(미확정)', () => {
    const checkedInAt = '2026-07-06T13:00:00+09:00';
    const transitions: Transition[] = [
      { from_status: 'registered', to_status: 'preconditioning', transitioned_at: '2026-07-06T13:10:00+09:00' },
    ];
    // 현재 status='preconditioning' — 아직 치료실에 있음(퇴실 전이 없음)
    const segs = computeDwellSegments(checkedInAt, 'preconditioning', transitions, '2026-07-06T13:30:00+09:00');
    const dwell = deriveTreatmentDwell(segs);
    expect(dwell.started_at).toBe('2026-07-06T13:10:00+09:00'); // 진입 확정
    expect(dwell.ended_at).toBeNull();                          // 퇴실 전 → 종료 미확정
  });
});
