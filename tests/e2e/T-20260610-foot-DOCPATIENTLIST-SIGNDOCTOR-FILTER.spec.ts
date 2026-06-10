/**
 * E2E spec — T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER
 * 진료환자목록(DoctorPatientList)에 '서명한 의사별' 필터 드롭다운 추가 검증.
 *
 * 핵심(STEP1 그라운딩):
 *   - signing_doctor_{id,name} 은 medical_charts 기존 컬럼(MEDCHART-SIGN-AUDIT deployed) — 신규 스키마 불요.
 *   - medical_charts 엔 check_in_id 없음 → 연결키 = customer_id + visit_date(= 선택 날짜).
 *     같은 날짜·클리닉 차트를 customer_id 로 매핑. 1환자 N차트 = 진료의 id Set 합집합.
 *     미서명(NULL)/레거시/차트없음 = 'unsigned' 그룹.
 *   - 기본값 'all'(전체) = 현 동작 유지.
 *
 * AC-0 시퀀싱 가드: 기존 산출(처방상태 필터·원내 우선 정렬)과 AND 누적, 회귀 없음.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(SigningDoctorIndex 빌드 + filtered 술어 +
 *   effectiveDoctorFilter 폴백)을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: useSigningDoctorsByDate 인덱스 빌드 ─────────────────────────────
type ChartRow = { customer_id: string | null; signing_doctor_id: string | null; signing_doctor_name: string | null };
interface Index {
  byCustomer: Map<string, Set<string>>;
  signedCustomers: Set<string>;
  doctors: { id: string; name: string }[];
}
function buildIndex(rows: ChartRow[]): Index {
  const byCustomer = new Map<string, Set<string>>();
  const signedCustomers = new Set<string>();
  const nameById = new Map<string, string>();
  for (const raw of rows) {
    const cid = raw.customer_id;
    const did = raw.signing_doctor_id;
    if (!cid || !did) continue; // 미서명/레거시 NULL → unsigned 그룹(매핑 제외)
    signedCustomers.add(cid);
    let set = byCustomer.get(cid);
    if (!set) { set = new Set(); byCustomer.set(cid, set); }
    set.add(did);
    if (!nameById.has(did)) nameById.set(did, (raw.signing_doctor_name ?? '').trim() || '이름없음');
  }
  const doctors = [...nameById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { byCustomer, signedCustomers, doctors };
}

// ── 정본 모사: filtered 술어(처방상태 필터 AND 서명의사 필터) ─────────────────
type Patient = { customer_id: string | null; prescription_status: 'none' | 'pending' | 'confirmed' };
function applyFilters(
  patients: Patient[],
  filter: 'all' | 'pending' | 'confirmed',
  effectiveDoctorFilter: string,
  idx: Index,
): Patient[] {
  return patients.filter((p) => {
    if (filter === 'pending' && p.prescription_status !== 'pending') return false;
    if (filter === 'confirmed' && p.prescription_status !== 'confirmed') return false;
    if (effectiveDoctorFilter === 'all') return true;
    const cid = p.customer_id;
    if (effectiveDoctorFilter === '__unsigned__') return !cid || !idx.signedCustomers.has(cid);
    return !!cid && (idx.byCustomer.get(cid)?.has(effectiveDoctorFilter) ?? false);
  });
}

// ── 정본 모사: effectiveDoctorFilter 폴백 ─────────────────────────────────────
function effective(doctorFilter: string, idx: Index, hasUnsigned: boolean): string {
  const valid = new Set(idx.doctors.map((d) => d.id));
  return doctorFilter === 'all' ||
    (doctorFilter === '__unsigned__' && hasUnsigned) ||
    valid.has(doctorFilter)
    ? doctorFilter
    : 'all';
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 인덱스 빌드 (연결키 customer_id + 1환자 N차트 합집합 + 미서명 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 인덱스 빌드', () => {
  const charts: ChartRow[] = [
    { customer_id: 'c1', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
    { customer_id: 'c1', signing_doctor_id: 'd2', signing_doctor_name: '강원장' }, // 1환자 N차트
    { customer_id: 'c2', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
    { customer_id: 'c3', signing_doctor_id: null, signing_doctor_name: null },     // 미서명(레거시)
    { customer_id: null, signing_doctor_id: 'd1', signing_doctor_name: '문지은' }, // 비정상 customer
  ];
  const idx = buildIndex(charts);

  test('1환자 N차트 = 진료의 id 합집합', () => {
    expect([...(idx.byCustomer.get('c1') ?? [])].sort()).toEqual(['d1', 'd2']);
  });

  test('서명 차트 보유 환자만 signedCustomers', () => {
    expect(idx.signedCustomers.has('c1')).toBe(true);
    expect(idx.signedCustomers.has('c2')).toBe(true);
    expect(idx.signedCustomers.has('c3')).toBe(false); // 미서명
  });

  test('드롭다운 옵션 = 등장 진료의 distinct, 이름 가나다', () => {
    expect(idx.doctors.map((d) => d.name)).toEqual(['강원장', '문지은']);
    expect(idx.doctors).toHaveLength(2);
  });

  test('차트 0건이면 옵션 0 → 드롭다운 미노출(현 동작 유지)', () => {
    const empty = buildIndex([]);
    expect(empty.doctors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 필터 적용 (전체 / 의사별 / 미서명)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 서명한 의사별 필터', () => {
  const charts: ChartRow[] = [
    { customer_id: 'c1', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
    { customer_id: 'c2', signing_doctor_id: 'd2', signing_doctor_name: '강원장' },
  ];
  const idx = buildIndex(charts);
  const patients: Patient[] = [
    { customer_id: 'c1', prescription_status: 'confirmed' }, // 문지은 서명
    { customer_id: 'c2', prescription_status: 'pending' },   // 강원장 서명
    { customer_id: 'c3', prescription_status: 'none' },      // 미서명(차트없음)
    { customer_id: null, prescription_status: 'none' },      // customer_id 없음 → 미서명 취급
  ];

  test('기본 전체 — 현 동작 유지(전 행)', () => {
    expect(applyFilters(patients, 'all', 'all', idx)).toHaveLength(4);
  });

  test('의사별(d1) — 해당 진료의 서명 환자만', () => {
    const out = applyFilters(patients, 'all', 'd1', idx).map((p) => p.customer_id);
    expect(out).toEqual(['c1']);
  });

  test('미서명 — 서명 차트 없는 환자(차트없음·customer_id null 포함)', () => {
    const out = applyFilters(patients, 'all', '__unsigned__', idx).map((p) => p.customer_id);
    expect(out).toEqual(['c3', null]);
  });

  test('미서명 옵션 노출 조건 = hasUnsigned', () => {
    const hasUnsigned = patients.some((p) => !p.customer_id || !idx.signedCustomers.has(p.customer_id));
    expect(hasUnsigned).toBe(true);
    const allSigned: Patient[] = [{ customer_id: 'c1', prescription_status: 'confirmed' }];
    expect(allSigned.some((p) => !p.customer_id || !idx.signedCustomers.has(p.customer_id!))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: effectiveDoctorFilter 폴백 (날짜 이동/stale 선택 방어)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 폴백 방어', () => {
  const idx = buildIndex([
    { customer_id: 'c1', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
  ]);

  test('옵션에 없는 doctor_id → all 폴백(전 행 누락 방지)', () => {
    expect(effective('d2', idx, true)).toBe('all'); // d2 미존재
    expect(effective('d1', idx, true)).toBe('d1');  // 존재 → 유지
  });

  test('미서명 행 없는데 __unsigned__ → all 폴백', () => {
    expect(effective('__unsigned__', idx, false)).toBe('all');
    expect(effective('__unsigned__', idx, true)).toBe('__unsigned__');
  });

  test('all 은 항상 유효', () => {
    expect(effective('all', idx, false)).toBe('all');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: AC-0 누적 — 처방상태 필터 AND 서명의사 필터(회귀 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 처방상태 × 서명의사 AND 누적', () => {
  const idx = buildIndex([
    { customer_id: 'c1', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
    { customer_id: 'c2', signing_doctor_id: 'd1', signing_doctor_name: '문지은' },
  ]);
  const patients: Patient[] = [
    { customer_id: 'c1', prescription_status: 'confirmed' },
    { customer_id: 'c2', prescription_status: 'pending' },
  ];

  test('처방나감(confirmed) AND 의사 d1 → c1만', () => {
    const out = applyFilters(patients, 'confirmed', 'd1', idx).map((p) => p.customer_id);
    expect(out).toEqual(['c1']);
  });

  test('의사 필터 all 일 때 처방상태 필터 단독 동작 보존(회귀)', () => {
    expect(applyFilters(patients, 'pending', 'all', idx).map((p) => p.customer_id)).toEqual(['c2']);
    expect(applyFilters(patients, 'confirmed', 'all', idx).map((p) => p.customer_id)).toEqual(['c1']);
  });
});
