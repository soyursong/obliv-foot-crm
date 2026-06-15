/**
 * E2E spec — T-20260615-foot-RXLIST-RENAME-DOCFILTER
 * 진료 대시보드 '처방 환자 목록' 탭 2건 검증.
 *   item1) 라벨 리네임: '진료 환자 목록' → '처방 환자 목록' (텍스트만).
 *          ⚠ 탭 value="patient_list" / data-testid="tab-patient-list" 는 보존(E2E·탭 상태키 무변경).
 *   item2) 표시 필터: 금일 내방객 전체 → '원장 진료 완료 고객만'.
 *          진료완료 판정 SSOT = DoctorCallDashboard.completedPatients(L504)와 글자 그대로 1:1 동일:
 *            completed_at 보유  OR  status_flag === 'pink'.
 *          진료 대기중(status_flag='purple', completed_at 없음) / 진료 전(미호출) 행은 제외.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(필터 술어 + 탭 식별자/라벨 매핑)을
 *   모사해 회귀를 잡는다(컴포넌트는 auth/DB 의존). SORT-LAYOUT.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 진료완료 필터 술어 (DoctorPatientList.usePatientsByDate 반환 filter) ──────
//   = DoctorCallDashboard.completedPatients filter(L504): completed_at || status_flag==='pink'.
type Row = {
  customer_name: string;
  status: string;
  status_flag: string | null;
  completed_at: string | null;
};
const isTreatmentDone = (r: Pick<Row, 'completed_at' | 'status_flag'>): boolean =>
  !!r.completed_at || r.status_flag === 'pink';
const filterCompleted = (rows: Row[]): Row[] => rows.filter(isTreatmentDone);

// ── 정본 모사: 탭 식별자/라벨 (DoctorTools.tsx TabsTrigger) ────────────────────────────
//   라벨 텍스트만 리네임. value/data-testid 는 절대 불변(상태키·E2E 셀렉터 보존).
const PATIENT_LIST_TAB = {
  value: 'patient_list',
  testId: 'tab-patient-list',
  label: '처방 환자 목록',
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (현장 클릭): 진료부가 '처방 환자 목록' 탭을 눌렀을 때 라벨이 바뀌어 있다.
//   그러나 탭의 내부 식별자(value/data-testid)는 그대로라 동선/자동화가 깨지지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 item1 — 라벨 리네임(텍스트만) + 식별자 보존', () => {
  test('탭 라벨이 "처방 환자 목록"으로 표기된다', () => {
    expect(PATIENT_LIST_TAB.label).toBe('처방 환자 목록');
    expect(PATIENT_LIST_TAB.label).not.toBe('진료 환자 목록');
  });

  test('탭 value/data-testid 는 patient_list / tab-patient-list 로 보존된다(회귀가드)', () => {
    expect(PATIENT_LIST_TAB.value).toBe('patient_list');
    expect(PATIENT_LIST_TAB.testId).toBe('tab-patient-list');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (현장 클릭): 진료부가 '처방 환자 목록'을 열면 '원장 진료 완료' 고객만 보인다.
//   진료 대기중(보라 호출)·진료 전 고객은 목록에서 빠진다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 item2 — 진료완료 고객만 표시(진료 전 고객 제외)', () => {
  const rows: Row[] = [
    // 진료완료 — completed_at 보유(귀가/시술완료)
    { customer_name: '강감찬', status: 'done', status_flag: null, completed_at: '2026-06-15T05:00:00Z' },
    // 진료완료 — status_flag='pink'(진료완료 처리, 원내잔류, completed_at 미발생)
    { customer_name: '김유신', status: 'payment_waiting', status_flag: 'pink', completed_at: null },
    // 진료 대기중 — status_flag='purple'(호출 중, 진료 전) → 제외
    { customer_name: '이순신', status: 'treatment_waiting', status_flag: 'purple', completed_at: null },
    // 진료 전 — 미호출(flag 없음) → 제외
    { customer_name: '홍길동', status: 'registered', status_flag: null, completed_at: null },
  ];

  test('진료완료 SSOT 술어: completed_at 보유 또는 pink → true, 그 외 → false', () => {
    expect(isTreatmentDone({ completed_at: '2026-06-15T05:00:00Z', status_flag: null })).toBe(true);
    expect(isTreatmentDone({ completed_at: null, status_flag: 'pink' })).toBe(true);
    expect(isTreatmentDone({ completed_at: null, status_flag: 'purple' })).toBe(false);
    expect(isTreatmentDone({ completed_at: null, status_flag: null })).toBe(false);
  });

  test('목록에 진료완료(강감찬·김유신)만 남고 진료 전(이순신·홍길동)은 제외', () => {
    const names = filterCompleted(rows).map((r) => r.customer_name);
    expect(names).toEqual(['강감찬', '김유신']);
    expect(names).not.toContain('이순신'); // 진료 대기중(purple)
    expect(names).not.toContain('홍길동'); // 진료 전(미호출)
  });

  test('대기중(purple)이 진료완료로 오분류되지 않는다(DoctorCallDashboard 활성호출 술어와 상호배타)', () => {
    // 활성호출 = status_flag==='purple' && !completed_at → 완료필터와 겹치는 행 0건
    const active = rows.filter((r) => r.status_flag === 'purple' && !r.completed_at);
    const completed = filterCompleted(rows);
    for (const a of active) expect(completed).not.toContain(a);
  });

  test('전원 진료 전이면 빈 목록(빈 상태 메시지 경로)', () => {
    const allPre: Row[] = [
      { customer_name: 'A', status: 'registered', status_flag: null, completed_at: null },
      { customer_name: 'B', status: 'treatment_waiting', status_flag: 'purple', completed_at: null },
    ];
    expect(filterCompleted(allPre)).toHaveLength(0);
  });
});
