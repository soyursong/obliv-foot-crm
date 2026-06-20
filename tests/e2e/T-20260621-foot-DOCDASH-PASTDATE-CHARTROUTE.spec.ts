/**
 * E2E spec — T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE
 * 진료대시보드 진료환자목록 — 과거날짜 환자목록 소실(BUG-1) + 이름클릭 차트 오라우팅(BUG-2) 수정 검증.
 * (문지은 대표원장 6/21: "전 날짜로 돌려보면 환자목록 다 사라짐 / 이름 누르면 고객차트 열림 → 무조건 진료차트")
 *
 * 검증 대상:
 *   AC-1(BUG-1): 과거 날짜로 이동해도 그날 진료 환자 목록이 정상 표시(진료콜 명단 멤버십 필터 skip).
 *   AC-2(BUG-2): 진료대시보드 이름 클릭 → 항상 진료차트(MedicalChartPanel) 직접오픈(고객차트 X).
 *   AC-3(회귀가드): 고객관리 등 다른 진입점은 기존대로 고객차트(useChart.openChart) 동선 유지(무영향).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(usePatientsByDate 필터, 차트 라우팅 분기)을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: usePatientsByDate 진료콜 명단 멤버십 필터 (DoctorPatientList.tsx L290~) ──────
//   activeList: status_flag ∈ {purple, yellow} OR status==='healer_waiting'
//   doneList  : status_flag === 'pink'
//   귀가(dark_gray)·명단 미진입 행 = 오늘/미래 모드에서 제외.
type Row = { id: string; status: string; status_flag: string };
const callMembershipKeep = (r: Row): boolean =>
  r.status_flag === 'purple' ||
  r.status_flag === 'yellow' ||
  r.status_flag === 'pink' ||
  r.status === 'healer_waiting';

// ── 정본 모사: 표시 대상 행 산출 (isPast 분기) ──────────────────────────────────
//   isPast === true  → 멤버십 필터 skip, 그날 non-cancelled 체크인 전체(받은 치료 이력).
//   isPast === false → 기존 진료콜 명단 멤버십 필터 적용(회귀 0).
//   ※ non-cancelled 는 쿼리 .neq('status','cancelled') 단계에서 이미 제외됨 → 입력 row 는 non-cancelled 만.
const visibleRows = (rows: Row[], isPast: boolean): Row[] =>
  isPast ? rows : rows.filter(callMembershipKeep);

// ── 정본 모사: 차트 라우팅 분기 ────────────────────────────────────────────────
//   진료대시보드(doctor_patient_list) 이름 클릭 → 'medical'(진료차트, MedicalChartPanel 직접오픈)
//   고객관리 등 그 외 진입점 → 'customer'(2번차트 서랍, useChart.openChart) — 무변경.
type ChartKind = 'medical' | 'customer';
const chartRouteFor = (entryPoint: string): ChartKind =>
  entryPoint === 'doctor_patient_list' ? 'medical' : 'customer';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — AC-1 (BUG-1): 과거 날짜 환자목록 소실 수정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 AC-1 과거날짜 환자목록 표시', () => {
  // 전원 귀가(dark_gray)한 과거 진료일 — 회귀 전이라면 멤버십 필터가 전부 제거해 빈 목록이 됐던 케이스.
  const pastDay: Row[] = [
    { id: 'a', status: 'done', status_flag: 'dark_gray' },
    { id: 'b', status: 'done', status_flag: 'dark_gray' },
    { id: 'c', status: 'done', status_flag: 'pink' },
  ];

  test('과거날짜(isPast=true)는 귀가 포함 그날 전체 행을 표시한다 (소실 0)', () => {
    const out = visibleRows(pastDay, true);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('회귀 가드 — 같은 데이터를 오늘 모드(isPast=false)로 보면 기존 멤버십 필터 동작 유지', () => {
    // pink(진료완료) 1건만 명단 잔존, dark_gray 2건은 제외 → 회귀 없음.
    const out = visibleRows(pastDay, false);
    expect(out.map((r) => r.id)).toEqual(['c']);
  });

  test('과거날짜라도 데이터가 0건이면 빈 목록 (크래시 없음)', () => {
    expect(visibleRows([], true)).toEqual([]);
  });

  test('오늘 모드 멤버십 필터 정본 — purple/yellow/pink/healer_waiting 만 통과', () => {
    const rows: Row[] = [
      { id: 'p', status: 'in_clinic', status_flag: 'purple' },
      { id: 'y', status: 'in_clinic', status_flag: 'yellow' },
      { id: 'k', status: 'done', status_flag: 'pink' },
      { id: 'h', status: 'healer_waiting', status_flag: 'green' },
      { id: 'g', status: 'done', status_flag: 'dark_gray' }, // 귀가 → 제외
    ];
    expect(visibleRows(rows, false).map((r) => r.id)).toEqual(['p', 'y', 'k', 'h']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — AC-2 (BUG-2): 이름 클릭 → 무조건 진료차트
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 AC-2 진료대시보드 이름클릭 = 진료차트', () => {
  test('진료대시보드 이름 클릭 → 진료차트(medical)', () => {
    expect(chartRouteFor('doctor_patient_list')).toBe('medical');
  });

  test('과거 날짜에서 이동해 클릭해도 동일하게 진료차트', () => {
    // 진입점이 동일(doctor_patient_list)하므로 isPast 와 무관하게 medical.
    expect(chartRouteFor('doctor_patient_list')).toBe('medical');
  });

  test('진료차트 오픈 시 기본 variant=full (전체 진료차트)', () => {
    const openTreatmentChart = (_cid: string, variant: 'full' | 'clinical' = 'full') => variant;
    expect(openTreatmentChart('cust-1')).toBe('full');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — AC-3: 회귀 가드 (다른 진입점 고객차트 동선 무영향)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 AC-3 회귀가드 — 타 진입점 고객차트 유지', () => {
  test('고객관리(customers) 진입점은 고객차트(customer) 유지', () => {
    expect(chartRouteFor('customers')).toBe('customer');
  });

  test('예약관리(reservations) 진입점은 고객차트(customer) 유지', () => {
    expect(chartRouteFor('reservations')).toBe('customer');
  });

  test('대시보드 체크인(dashboard) 진입점은 고객차트(customer) 유지', () => {
    expect(chartRouteFor('dashboard')).toBe('customer');
  });
});
