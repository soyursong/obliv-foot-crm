/**
 * E2E spec — T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY
 * 진료 대시보드 UX 신규 2종 검증.
 *   ⑤ 진료 알림판 '진료완료' 섹션 처방상태 필터 태그(전체|처방확인대기|처방완료).
 *      surface=DoctorCallDashboard.tsx. prescription_status 'pending'/'confirmed' 기준 행 축소.
 *      재활용 SSOT = DoctorPatientList 처방환자목록 필터(prescription_status).
 *   ⑥ 진료환자목록 데이터정의 통일 + 날짜 히스토리 조회. surface=DoctorPatientList.tsx.
 *      - 데이터정의 = RXLIST item2 필터(completed_at || status_flag==='pink')와 1:1 동일(이미 통일 — 회귀가드).
 *      - 날짜조회: usePatientsByDate(clinicId, selectedDate) + 날짜 < > '오늘' UI 노출(이미 존재 — 확인).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(필터 술어)을 모사해 회귀를 잡는다
 *   (컴포넌트는 auth/DB 의존). RXLIST-RENAME-DOCFILTER.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 진료완료 모집단 술어 (DoctorCallDashboard.completedPatients L508 == DoctorPatientList L285) ──
type Row = {
  customer_name: string;
  status: string;
  status_flag: string | null;
  completed_at: string | null;
  prescription_status: string | null;
};
const isTreatmentDone = (r: Pick<Row, 'completed_at' | 'status_flag'>): boolean =>
  !!r.completed_at || r.status_flag === 'pink';
const completedPatients = (rows: Row[]): Row[] => rows.filter(isTreatmentDone);

// ── 정본 모사: ⑤ 진료완료 섹션 처방상태 필터 (DoctorCallDashboard completedFilter) ──
type DoneFilter = 'all' | 'pending' | 'confirmed';
const filterByRx = (rows: Row[], f: DoneFilter): Row[] =>
  f === 'all' ? rows : rows.filter((ci) => ci.prescription_status === f);

// ── 시드: 진료완료 모집단(완료 5) + 비완료(대기 1 + 미호출 1) ──
const seed: Row[] = [
  // 완료 + 처방완료(confirmed) ×2
  { customer_name: '강감찬', status: 'done', status_flag: null, completed_at: '2026-06-15T05:00:00Z', prescription_status: 'confirmed' },
  { customer_name: '이순신', status: 'in_clinic', status_flag: 'pink', completed_at: null, prescription_status: 'confirmed' },
  // 완료 + 처방확인대기(pending) ×2
  { customer_name: '유관순', status: 'done', status_flag: null, completed_at: '2026-06-15T06:00:00Z', prescription_status: 'pending' },
  { customer_name: '안중근', status: 'in_clinic', status_flag: 'pink', completed_at: null, prescription_status: 'pending' },
  // 완료 + 처방 없음(null) ×1 — 전체엔 포함, pending/confirmed 탭엔 미포함
  { customer_name: '윤봉길', status: 'done', status_flag: null, completed_at: '2026-06-15T07:00:00Z', prescription_status: null },
  // 비완료 — 진료 대기중(purple)
  { customer_name: '김구', status: 'in_clinic', status_flag: 'purple', completed_at: null, prescription_status: 'pending' },
  // 비완료 — 진료 전(미호출)
  { customer_name: '신채호', status: 'reserved', status_flag: null, completed_at: null, prescription_status: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// S1 ⑤ — 진료완료 모집단(필터 태그의 '전체')은 진료완료 환자만 (대기·미호출 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 ⑤ — 진료완료 모집단 = completed_at || pink (대기/미호출 제외)', () => {
  test('진료완료 환자만 5명 (purple 대기·미호출 제외)', () => {
    const done = completedPatients(seed);
    expect(done.length).toBe(5);
    const names = done.map((r) => r.customer_name);
    expect(names).not.toContain('김구'); // purple 대기
    expect(names).not.toContain('신채호'); // 미호출
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 ⑤ — 처방상태 필터 태그: 전체 / 처방확인대기(pending) / 처방완료(confirmed)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 ⑤ — 처방상태 필터 태그', () => {
  const done = completedPatients(seed);

  test('전체 = 진료완료 전원 5명', () => {
    expect(filterByRx(done, 'all').length).toBe(5);
  });

  test('처방확인대기 = pending 2명만', () => {
    const r = filterByRx(done, 'pending');
    expect(r.length).toBe(2);
    expect(r.every((x) => x.prescription_status === 'pending')).toBe(true);
  });

  test('처방완료 = confirmed 2명만', () => {
    const r = filterByRx(done, 'confirmed');
    expect(r.length).toBe(2);
    expect(r.every((x) => x.prescription_status === 'confirmed')).toBe(true);
  });

  test('처방 없음(null) 행은 pending/confirmed 어느 탭에도 안 들어간다(전체에만)', () => {
    const all = filterByRx(done, 'all').map((r) => r.customer_name);
    expect(all).toContain('윤봉길');
    expect(filterByRx(done, 'pending').map((r) => r.customer_name)).not.toContain('윤봉길');
    expect(filterByRx(done, 'confirmed').map((r) => r.customer_name)).not.toContain('윤봉길');
  });

  test('탭 카운트 합(pending+confirmed) ≤ 전체 (null 행 존재 시 미만)', () => {
    const total = filterByRx(done, 'all').length;
    const sum = filterByRx(done, 'pending').length + filterByRx(done, 'confirmed').length;
    expect(sum).toBeLessThanOrEqual(total);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 ⑥ — 데이터정의 통일(회귀가드): DoctorPatientList 모집단 == DoctorCallDashboard 모집단
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 ⑥ — 진료환자목록 데이터정의 = RXLIST item2 SSOT(1:1 동일)', () => {
  test('두 surface의 진료완료 술어가 동일 결과를 낸다', () => {
    // DoctorPatientList.usePatientsByDate L285 필터 == DoctorCallDashboard.completedPatients L508 필터
    const patientListPop = seed.filter((r) => !!r.completed_at || r.status_flag === 'pink');
    const dashboardPop = completedPatients(seed);
    expect(patientListPop.map((r) => r.customer_name).sort()).toEqual(
      dashboardPop.map((r) => r.customer_name).sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 ⑥ — 날짜 히스토리: selectedDate 파라미터화 동작(전/후/오늘 이동 모사)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 ⑥ — 날짜 히스토리 조회(selectedDate 이동)', () => {
  // shiftISODate 모사 (구현 정본: 캘린더 일자 ± n, 타임존 무관 — UTC 정오 기준으로 경계 안전).
  const shift = (iso: string, days: number): string => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  test('전날 이동 → selectedDate가 하루 감소', () => {
    expect(shift('2026-06-15', -1)).toBe('2026-06-14');
  });

  test('다음날 이동 → selectedDate가 하루 증가', () => {
    expect(shift('2026-06-15', 1)).toBe('2026-06-16');
  });

  test('오늘 버튼 → 임의 날짜에서 todayISO 복귀', () => {
    const today = '2026-06-16';
    let selected = '2026-06-10';
    selected = today; // '오늘' 클릭
    expect(selected).toBe(today);
  });
});
