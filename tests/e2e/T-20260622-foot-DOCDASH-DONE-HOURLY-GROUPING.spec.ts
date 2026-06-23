/**
 * E2E spec — T-20260622-foot-DOCDASH-DONE-HOURLY-GROUPING
 * 진료 대시보드 [완료] 섹션을 '진료 완료 처리 시각'의 정시(HH:00) 단위로 그룹핑.
 *   surface = DoctorCallDashboard.tsx '진료 완료' 섹션(completedHourGroups + tbody 그룹 헤더행).
 *   - 기준 시각 = completed_at ?? getCallTime(ci) (정렬키와 동일; pink 원내잔류는 completed_at 미발생 → 콜시각 폴백).
 *   - 10:30 완료건 → '10시' 그룹. FE presentation only(저장 시각 불변, 행/상세엔 실제 시각).
 *   - 범위 격리: 예약관리 캘린더·대기·진료중 섹션 무관(본 spec은 완료 섹션 그룹핑 로직만).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(completedHourGroups 메모)을 모사해 회귀를 잡는다
 *   (컴포넌트는 auth/DB 의존). DONEFILTER-DATEHISTORY.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: seoulHHMM(t).slice(0,2) → Asia/Seoul 정시(HH) (src/lib/format.ts seoulHHMM) ──
const seoulHourStr = (input: string): string =>
  new Date(input)
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
    .slice(0, 2);

// ── 정본 모사: completedPatients 모집단 술어 (completed_at || pink) ──
type Row = {
  id: string;
  customer_name: string;
  status_flag: string | null;
  completed_at: string | null;
  checked_in_at: string; // getCallTime 폴백(이력 없을 때)
};
const isTreatmentDone = (r: Pick<Row, 'completed_at' | 'status_flag'>): boolean =>
  !!r.completed_at || r.status_flag === 'pink';

// getCallTime 모사(이력 없음 → checked_in_at)
const getCallTime = (r: Row): string => r.checked_in_at;

// ── 정본 모사: completedHourGroups 메모 (정렬·그룹핑 정시 묶음) ──
type Group = { hour: number; label: string; items: Row[] };
const buildGroups = (rows: Row[]): Group[] => {
  // completedPatients = 모집단 필터 + 완료시각 내림차순(정본 sort)
  const done = rows
    .filter(isTreatmentDone)
    .sort((a, b) => (b.completed_at ?? getCallTime(b)).localeCompare(a.completed_at ?? getCallTime(a)));
  const groups: Group[] = [];
  const indexByHour = new Map<number, number>();
  for (const ci of done) {
    const t = ci.completed_at ?? getCallTime(ci);
    const hh = Number(seoulHourStr(t));
    const key = Number.isNaN(hh) ? -1 : hh;
    let idx = indexByHour.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByHour.set(key, idx);
      groups.push({ hour: key, label: key < 0 ? '시각 미상' : `${key}시`, items: [] });
    }
    groups[idx].items.push(ci);
  }
  return groups;
};

// ── 시드: Asia/Seoul(UTC+9) — 10시대(01:00Z,01:30Z) + 11시대(02:00Z) + pink 폴백(checked_in 12:30 Seoul) ──
const seed: Row[] = [
  { id: 'a', customer_name: '강감찬', status_flag: null, completed_at: '2026-06-22T01:00:00Z', checked_in_at: '2026-06-22T00:50:00Z' }, // 10:00 Seoul
  { id: 'b', customer_name: '이순신', status_flag: null, completed_at: '2026-06-22T01:30:00Z', checked_in_at: '2026-06-22T00:55:00Z' }, // 10:30 Seoul → 10시
  { id: 'c', customer_name: '유관순', status_flag: null, completed_at: '2026-06-22T02:00:00Z', checked_in_at: '2026-06-22T01:40:00Z' }, // 11:00 Seoul → 11시
  { id: 'd', customer_name: '안중근', status_flag: 'pink', completed_at: null, checked_in_at: '2026-06-22T03:30:00Z' }, // pink 폴백 → 12:30 Seoul → 12시
  // 비완료(제외 대상)
  { id: 'e', customer_name: '김구', status_flag: 'purple', completed_at: null, checked_in_at: '2026-06-22T01:00:00Z' },
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 완료 섹션 정시(1시간) 단위 그룹핑
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 정시 단위 그룹핑', () => {
  test('정시 라벨(…시)로 그룹 생성, 30분 별도 구분 없음', () => {
    const groups = buildGroups(seed);
    const labels = groups.map((g) => g.label);
    // 10시 / 11시 / 12시 — 30분(반시) 별도 그룹 없음
    expect(labels).toEqual(['12시', '11시', '10시']); // 완료시각 내림차순 → 최신 정시 상단
    expect(labels.some((l) => l.includes(':30') || l.includes('30분'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — HH:30 완료건을 정시 그룹에 흡수
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 HH:30 → 정시 그룹 흡수', () => {
  test('10:30 완료건(이순신)이 "10시" 그룹에 포함', () => {
    const groups = buildGroups(seed);
    const ten = groups.find((g) => g.hour === 10);
    expect(ten).toBeTruthy();
    expect(ten!.items.map((r) => r.customer_name)).toContain('이순신');
  });

  test('데이터 불변: 그룹핑은 표시만 — 원본 completed_at 변경 없음', () => {
    const before = seed.find((r) => r.id === 'b')!.completed_at;
    buildGroups(seed);
    const after = seed.find((r) => r.id === 'b')!.completed_at;
    expect(after).toBe(before);
    expect(after).toBe('2026-06-22T01:30:00Z'); // 실제 시각 그대로
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 한 정시 그룹에 여러 완료건 동시 표시
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 같은 정시 다건 흡수', () => {
  test('10:00 + 10:30 두 건이 모두 "10시" 그룹에 함께', () => {
    const groups = buildGroups(seed);
    const ten = groups.find((g) => g.hour === 10)!;
    const names = ten.items.map((r) => r.customer_name);
    expect(names).toContain('강감찬'); // 10:00
    expect(names).toContain('이순신'); // 10:30
    expect(ten.items.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 무결성 + 범위 격리
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 무결성: 누락 0, 한 그룹 1회', () => {
  test('완료건 전원이 정확히 한 그룹에 1회씩 (누락·중복 0)', () => {
    const groups = buildGroups(seed);
    const flat = groups.flatMap((g) => g.items.map((r) => r.id));
    const doneIds = seed.filter(isTreatmentDone).map((r) => r.id).sort();
    expect(flat.slice().sort()).toEqual(doneIds); // 누락 0
    expect(new Set(flat).size).toBe(flat.length); // 중복 0
  });

  test('비완료(purple 대기)는 어떤 그룹에도 안 들어감', () => {
    const groups = buildGroups(seed);
    const flat = groups.flatMap((g) => g.items.map((r) => r.customer_name));
    expect(flat).not.toContain('김구'); // purple 대기 — 범위 외
  });

  test('pink(원내잔류, completed_at 없음)는 콜시각 폴백으로 정시 그룹핑', () => {
    const groups = buildGroups(seed);
    const twelve = groups.find((g) => g.hour === 12);
    expect(twelve).toBeTruthy();
    expect(twelve!.items.map((r) => r.customer_name)).toContain('안중근');
  });

  test('빈 입력 → 빈 그룹 배열(회귀 0, 렌더 안전)', () => {
    expect(buildGroups([])).toEqual([]);
  });
});
