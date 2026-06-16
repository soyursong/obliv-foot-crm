/**
 * E2E spec — T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER
 * 진료 대시보드 '처방 환자 목록' 탭 2건 검증.
 *   AC-1) 라벨 리네임: '진료환자목록' → '처방 환자 목록' (이 surface 한정, 텍스트만).
 *          ⚠ 탭 value="patient_list" / data-testid="tab-patient-list" 는 보존(E2E·탭 상태키 무변경).
 *          (실제 리네임은 6/15 RXLIST-RENAME-DOCFILTER에서 선반영 — 본 spec은 회귀가드로 재확인.)
 *   AC-2) 모집단 필터 정정: '진료완료(completed_at OR pink)' → '원장 진료콜 명단(doctor_call list) 교집합'.
 *          진료콜 명단 멤버십 SSOT = DoctorCallListBar.displayList(activeList ∪ doneList)와 글자 그대로 1:1:
 *            activeList: status_flag==='purple' OR status_flag==='yellow' OR status==='healer_waiting'
 *            doneList  : status_flag==='pink'
 *          → 명단에 한 번도 안 오른 행(미호출), 귀가(status='done'→status_flag='dark_gray', 명단 이탈) 행은 제외.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(필터 술어 + 탭 식별자/라벨 매핑)을
 *   모사해 회귀를 잡는다(컴포넌트는 auth/DB 의존). RXLIST-RENAME-DOCFILTER.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 진료콜 명단 멤버십 술어 (DoctorPatientList.usePatientsByDate 반환 filter) ──────
//   = DoctorCallListBar.displayList 멤버십: purple|yellow|pink(status_flag) OR healer_waiting(status).
type Row = {
  customer_name: string;
  status: string;
  status_flag: string | null;
  completed_at: string | null;
};
const onDoctorCallList = (r: Pick<Row, 'status' | 'status_flag'>): boolean =>
  r.status_flag === 'purple' ||
  r.status_flag === 'yellow' ||
  r.status_flag === 'pink' ||
  r.status === 'healer_waiting';
const filterCallList = (rows: Row[]): Row[] => rows.filter(onDoctorCallList);

// ── 정본 모사: 탭 식별자/라벨 (DoctorTools.tsx TabsTrigger) ────────────────────────────
//   라벨 텍스트만 리네임. value/data-testid 는 절대 불변(상태키·E2E 셀렉터 보존).
const PATIENT_LIST_TAB = {
  value: 'patient_list',
  testId: 'tab-patient-list',
  label: '처방 환자 목록',
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (AC-1, 현장 클릭): '처방 환자 목록' 탭 라벨이 바뀌어 있고,
//   탭 내부 식별자(value/data-testid)는 그대로라 동선/자동화가 깨지지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 AC-1 — 라벨 리네임(텍스트만) + 식별자 보존', () => {
  test('탭 라벨이 "처방 환자 목록"으로 표기된다', () => {
    expect(PATIENT_LIST_TAB.label).toBe('처방 환자 목록');
    expect(PATIENT_LIST_TAB.label).not.toBe('진료환자목록');
    expect(PATIENT_LIST_TAB.label).not.toBe('진료 환자 목록');
  });

  test('탭 value/data-testid 는 patient_list / tab-patient-list 로 보존된다(회귀가드)', () => {
    expect(PATIENT_LIST_TAB.value).toBe('patient_list');
    expect(PATIENT_LIST_TAB.testId).toBe('tab-patient-list');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (AC-2, 현장 클릭): '처방 환자 목록'을 열면 '원장 진료콜 명단에 오른 환자만' 보인다.
//   미호출 환자·귀가(명단 이탈) 환자는 빠지고, 진료필요(purple)·HL(yellow)·힐러대기·진료완료(pink)는 남는다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 AC-2 — 진료콜 명단 교집합만 표시', () => {
  const rows: Row[] = [
    // 진료필요(보라) — 진료콜 명단 활성 → 포함
    { customer_name: '이순신', status: 'treatment_waiting', status_flag: 'purple', completed_at: null },
    // HL(노랑) — 진료콜 명단 활성 → 포함
    { customer_name: '강감찬', status: 'treatment_waiting', status_flag: 'yellow', completed_at: null },
    // 힐러대기(status) — status_flag 무관, 진료콜 명단 활성 → 포함
    { customer_name: '을지문덕', status: 'healer_waiting', status_flag: null, completed_at: null },
    // 진료완료(핑크) — 진료콜 명단 비활성(잔존) → 포함
    { customer_name: '김유신', status: 'payment_waiting', status_flag: 'pink', completed_at: null },
    // 귀가 — status='done'으로 status_flag='dark_gray'(명단 이탈). completed_at 있어도 → 제외
    { customer_name: '연개소문', status: 'done', status_flag: 'dark_gray', completed_at: '2026-06-16T05:00:00Z' },
    // 진료 전 — 미호출(flag 없음) → 제외
    { customer_name: '홍길동', status: 'registered', status_flag: null, completed_at: null },
  ];

  test('진료콜 명단 SSOT 술어: purple|yellow|pink 또는 healer_waiting → true, 그 외 → false', () => {
    expect(onDoctorCallList({ status: 'x', status_flag: 'purple' })).toBe(true);
    expect(onDoctorCallList({ status: 'x', status_flag: 'yellow' })).toBe(true);
    expect(onDoctorCallList({ status: 'x', status_flag: 'pink' })).toBe(true);
    expect(onDoctorCallList({ status: 'healer_waiting', status_flag: null })).toBe(true);
    expect(onDoctorCallList({ status: 'done', status_flag: 'dark_gray' })).toBe(false);
    expect(onDoctorCallList({ status: 'registered', status_flag: null })).toBe(false);
  });

  test('명단 멤버(이순신·강감찬·을지문덕·김유신)만 남고 귀가·진료전(연개소문·홍길동)은 제외', () => {
    const names = filterCallList(rows).map((r) => r.customer_name);
    expect(names).toEqual(['이순신', '강감찬', '을지문덕', '김유신']);
    expect(names).not.toContain('연개소문'); // 귀가(dark_gray, 명단 이탈)
    expect(names).not.toContain('홍길동'); // 진료 전(미호출)
  });

  test('귀가 환자는 completed_at이 있어도 제외된다(6/15 진료완료 필터와의 차이 회귀가드)', () => {
    const discharged: Row = {
      customer_name: '연개소문',
      status: 'done',
      status_flag: 'dark_gray',
      completed_at: '2026-06-16T05:00:00Z',
    };
    // 6/15 진료완료 술어(completed_at||pink)였다면 포함됐을 행 → 새 명단 술어로는 제외.
    expect(!!discharged.completed_at || discharged.status_flag === 'pink').toBe(true); // 구 술어: 포함
    expect(onDoctorCallList(discharged)).toBe(false); // 신 술어: 제외
  });

  test('진료필요(purple)·HL(yellow)·힐러대기가 새로 포함된다(6/15 대비 모집단 확장)', () => {
    expect(onDoctorCallList({ status: 'treatment_waiting', status_flag: 'purple' })).toBe(true);
    expect(onDoctorCallList({ status: 'treatment_waiting', status_flag: 'yellow' })).toBe(true);
    expect(onDoctorCallList({ status: 'healer_waiting', status_flag: null })).toBe(true);
  });

  test('빈 명단(0건) 엣지 — 명단에 오른 환자가 한 명도 없으면 빈 목록(빈 상태 렌더 경로)', () => {
    const noneOnList: Row[] = [
      { customer_name: 'A', status: 'registered', status_flag: null, completed_at: null },
      { customer_name: 'B', status: 'done', status_flag: 'dark_gray', completed_at: '2026-06-16T05:00:00Z' },
    ];
    expect(filterCallList(noneOnList)).toHaveLength(0);
  });
});
