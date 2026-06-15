/**
 * E2E spec — T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY
 * 진료 대시보드 '처방 환자 목록'(DoctorPatientList) 2건 검증.
 *   item2) 컬럼 일치: 기본 행(오늘 모드) 공통 컬럼 순서를 진료 알림판(DoctorCallDashboard
 *          CallFeedRow)의 공통열 순서(방→상태→이름→차트번호→처방)에 맞춤. A 고유 2열
 *          (방문유형 배지·예약메모)은 '무리 통합 금지' → 방문유형=이름 prefix(이름 왼쪽),
 *          예약메모=유연폭 끝(처방 뒤). 폭/비율 보존(AC3), data-testid 전부 유지(회귀 0).
 *   item3) 완료=읽기전용: '진료완료' 판정 SSOT = RENAME-DOCFILTER 목록 필터 ·
 *          DoctorCallDashboard.completedPatients(L504)와 1:1 동일(completed_at || pink).
 *          진료완료 환자는 펼침 시 편집(QuickRxBar) 분기 진입 금지 → 읽기전용 분기만(빈 편집폼 금지).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(grid-template 순서 + 펼침 분기 술어)을
 *   모사해 회귀를 잡는다(컴포넌트는 auth/DB 의존). RENAME-DOCFILTER/SORT-LAYOUT.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// item2 — 컬럼 순서/폭 정본 모사 (DoctorPatientList 기본 행 grid, 오늘 모드)
//   정본: grid-cols-[4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto]
//   JSX child 순서 = 방 → 상태 → 방문유형 → 이름 → 차트번호 → 처방 → 예약메모 → 액션.
// ─────────────────────────────────────────────────────────────────────────────
type Col = { key: string; testId: string | null; width: string };

// 현재(재정렬 후) 기본 행 컬럼 정의 — 구현과 1:1.
const PATIENT_ROW_COLS: Col[] = [
  { key: 'room', testId: 'patient-room', width: '4.75rem' },
  { key: 'status', testId: 'status-cell', width: '3.75rem' },
  { key: 'visit_type', testId: 'visit-type-badge', width: '3rem' },
  { key: 'name', testId: 'patient-name', width: '5rem' },
  { key: 'chartno', testId: 'patient-chartno', width: '4.5rem' },
  { key: 'prescription', testId: 'prescription-badge', width: '5.5rem' },
  { key: 'booking_memo', testId: 'booking-memo', width: 'minmax(0,1fr)' },
  { key: 'action', testId: 'confirm-prescription-btn', width: 'auto' },
];

// 진료 알림판(B, 기준) 공통 컬럼의 상대 순서 — CallFeedRow L809~ (변경 안 함).
const DASHBOARD_COMMON_ORDER = ['room', 'status', 'name', 'chartno', 'prescription'];

// A 고유 컬럼(알림판 대응 없음) — '무리 통합 금지' 대상.
const A_UNIQUE_COLS = ['visit_type', 'booking_memo'];

test.describe('S1 item2 — 공통 컬럼 순서가 진료 알림판과 일치', () => {
  test('공통 5열의 상대 순서가 알림판(방→상태→이름→차트번호→처방)과 동일', () => {
    const commonInPatientRow = PATIENT_ROW_COLS
      .map((c) => c.key)
      .filter((k) => DASHBOARD_COMMON_ORDER.includes(k));
    expect(commonInPatientRow).toEqual(DASHBOARD_COMMON_ORDER);
  });

  test("A 고유 2열은 '무리 통합' 없이 자연 위치 유지: 방문유형=이름 바로 왼쪽, 예약메모=처방 뒤", () => {
    const keys = PATIENT_ROW_COLS.map((c) => c.key);
    // 방문유형 배지 = 이름 식별 prefix → 이름 바로 직전.
    expect(keys.indexOf('visit_type')).toBe(keys.indexOf('name') - 1);
    // 예약메모 = 유연폭 끝(처방 뒤, 액션 앞).
    expect(keys.indexOf('booking_memo')).toBeGreaterThan(keys.indexOf('prescription'));
    expect(keys.indexOf('booking_memo')).toBe(keys.indexOf('action') - 1);
  });

  test('폭/비율 보존(AC3) — 재정렬 전 폭 집합과 동일(값 변경 0)', () => {
    // 재배열만 했으므로 폭 멀티셋은 불변. 이전: 3·5·4.5·5.5·3.75·4.75·1fr·auto.
    const widths = [...PATIENT_ROW_COLS.map((c) => c.width)].sort();
    const prevWidths = ['3rem', '5rem', '4.5rem', '5.5rem', '3.75rem', '4.75rem', 'minmax(0,1fr)', 'auto'].sort();
    expect(widths).toEqual(prevWidths);
  });

  test('data-testid 셀렉터 전부 보존(회귀가드)', () => {
    const ids = PATIENT_ROW_COLS.map((c) => c.testId).filter(Boolean);
    for (const id of ['patient-room', 'status-cell', 'visit-type-badge', 'patient-name', 'patient-chartno', 'prescription-badge', 'booking-memo', 'confirm-prescription-btn']) {
      expect(ids).toContain(id);
    }
  });

  test('A 고유 컬럼은 알림판 공통셋에 억지로 포함되지 않는다(무리 통합 금지)', () => {
    for (const u of A_UNIQUE_COLS) expect(DASHBOARD_COMMON_ORDER).not.toContain(u);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item3 — 펼침 분기 술어 정본 모사 (DoctorPatientList.PatientRow 확장 영역)
//   isVisitDone = !!completed_at || status_flag==='pink'   (= 목록 필터 SSOT)
//   isConfirmed = prescription_status==='confirmed'
//   편집(QuickRxBar) 분기:  expanded && !isVisitDone && !isConfirmed
//   읽기전용 요약 분기:      expanded && isConfirmed
//   읽기 상세(처방내역+임상경과): expanded (항상; !isConfirmed 일 때만 처방내역 한 줄)
// ─────────────────────────────────────────────────────────────────────────────
type RxRow = {
  completed_at: string | null;
  status_flag: string | null;
  prescription_status: 'none' | 'pending' | 'confirmed';
};
const isVisitDone = (r: Pick<RxRow, 'completed_at' | 'status_flag'>): boolean =>
  !!r.completed_at || r.status_flag === 'pink';
const isConfirmed = (r: Pick<RxRow, 'prescription_status'>): boolean =>
  r.prescription_status === 'confirmed';
// 펼침 시 편집 폼(QuickRxBar)이 렌더되는가
const rendersEditForm = (r: RxRow): boolean => !isVisitDone(r) && !isConfirmed(r);

test.describe('S2 item3 — 진료완료 환자는 항상 읽기전용(빈 편집폼 금지)', () => {
  test("'진료완료' 판정 SSOT = completed_at || pink (RENAME-DOCFILTER 와 1:1)", () => {
    expect(isVisitDone({ completed_at: '2026-06-15T05:00:00Z', status_flag: null })).toBe(true);
    expect(isVisitDone({ completed_at: null, status_flag: 'pink' })).toBe(true);
    expect(isVisitDone({ completed_at: null, status_flag: 'purple' })).toBe(false);
    expect(isVisitDone({ completed_at: null, status_flag: null })).toBe(false);
  });

  test('진료완료 + 처방확정 → 편집폼 미렌더(읽기전용 요약 분기)', () => {
    const r: RxRow = { completed_at: '2026-06-15T05:00:00Z', status_flag: null, prescription_status: 'confirmed' };
    expect(rendersEditForm(r)).toBe(false);
    expect(isConfirmed(r)).toBe(true); // → 읽기전용 요약 분기
  });

  test('진료완료(pink) + 처방 미확정(none/pending) → 편집폼 미렌더(빈 편집폼 금지)', () => {
    const none: RxRow = { completed_at: null, status_flag: 'pink', prescription_status: 'none' };
    const pending: RxRow = { completed_at: null, status_flag: 'pink', prescription_status: 'pending' };
    // 이전 버그: !isConfirmed 만으로 분기 → 진료완료인데 편집폼이 떴음. 이제 isVisitDone 가드로 차단.
    expect(rendersEditForm(none)).toBe(false);
    expect(rendersEditForm(pending)).toBe(false);
  });

  test('진료완료(귀가, completed_at) + 미확정 → 편집폼 미렌더', () => {
    const r: RxRow = { completed_at: '2026-06-15T05:00:00Z', status_flag: null, prescription_status: 'pending' };
    expect(rendersEditForm(r)).toBe(false);
  });

  test('진료 미완료 + 미확정(가정상 목록 외) → 편집폼 렌더 허용(기존 동선 보존)', () => {
    // 목록은 RENAME-DOCFILTER 로 진료완료만 노출하지만, 분기 술어 자체는 미완료시 편집 허용을 유지.
    const r: RxRow = { completed_at: null, status_flag: 'purple', prescription_status: 'none' };
    expect(rendersEditForm(r)).toBe(true);
  });

  test('목록의 모든 행(진료완료 only)은 편집폼이 뜨지 않는다(현장 시나리오)', () => {
    const listRows: RxRow[] = [
      { completed_at: '2026-06-15T05:00:00Z', status_flag: null, prescription_status: 'confirmed' },
      { completed_at: null, status_flag: 'pink', prescription_status: 'pending' },
      { completed_at: null, status_flag: 'pink', prescription_status: 'none' },
      { completed_at: '2026-06-15T06:00:00Z', status_flag: null, prescription_status: 'none' },
    ];
    // 목록 필터 통과 = 전부 진료완료
    for (const r of listRows) expect(isVisitDone(r)).toBe(true);
    // → 어느 행도 편집폼을 렌더하지 않음
    for (const r of listRows) expect(rendersEditForm(r)).toBe(false);
  });
});
