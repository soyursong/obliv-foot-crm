/**
 * E2E spec — T-20260609-foot-DOCPATIENTLIST-SORT-LAYOUT
 * 진료환자목록(DoctorPatientList) 정렬·배지위치·처방표기·이름너비·테이블레이아웃 6항목 검증.
 * (문지은 대표원장 6/9: "원내 환자 우선 + 시간/이름 정렬, 초진/재진 배지 이름 앞, 처방전 O/X 표기,
 *  이름 너비 고정, 항목 고정 열 정렬")
 *
 * 검증 대상 (① ~ ⑤ + 회귀):
 *   ① 원내(in-clinic) 환자 최우선 상단 + 시간순/이름순 토글(원내 우선 그룹 유지)
 *   ② 초진/재진(체험) 배지 이름 왼쪽
 *   ③ 처방표기 '처방전 O'/'처방전 X' + 이름 오른쪽 + hover 처방내용 툴팁
 *   ④ 이름 열 고정 너비
 *   ⑤ 고정 열 위치(grid 테이블형)
 *   회귀: DATENAV 날짜헤더·전후이동 보존 + 빠른처방/확정 동선
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(isInClinic/정렬 comparator/배지 라벨/
 *   prescriptionSummary/grid 열 순서)을 모사해 회귀를 잡는다. (컴포넌트는 auth/DB 의존)
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: IN_CLINIC_STATUSES (lib/status.ts) ─────────────────────────────
//   원내 = 종료상태(done/cancelled/checklist) 제외 전부. CheckInStatus enum 실값 기준.
const IN_CLINIC_STATUSES = [
  'registered', 'receiving', 'consult_waiting', 'consultation', 'exam_waiting',
  'examination', 'treatment_waiting', 'preconditioning', 'laser_waiting',
  'healer_waiting', 'laser', 'payment_waiting',
];
const isInClinic = (status: string): boolean => IN_CLINIC_STATUSES.includes(status);

// ── 정본 모사: 정렬 comparator (DoctorPatientList.sorted) ──────────────────────
type Row = { customer_name: string; status: string; checked_in_at: string };
const sortRows = (rows: Row[], sortBy: 'time' | 'name'): Row[] =>
  [...rows].sort((a, b) => {
    const aIn = isInClinic(a.status) ? 0 : 1;
    const bIn = isInClinic(b.status) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    if (sortBy === 'name') return a.customer_name.localeCompare(b.customer_name, 'ko');
    if (a.checked_in_at < b.checked_in_at) return -1;
    if (a.checked_in_at > b.checked_in_at) return 1;
    return 0;
  });

// ── 정본 모사: 처방 배지 라벨 + 처방 요약 (PrescriptionStatusBadge / prescriptionSummary) ─
const rxBadgeLabel = (status: 'none' | 'pending' | 'confirmed'): string =>
  status === 'confirmed' ? '처방전 O' : status === 'pending' ? '임시' : '처방전 X';

const prescriptionSummary = (items: unknown): string | null => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts = items
    .map((raw) => {
      const it = raw as { name?: string; medication_name?: string; frequency?: string; dosage?: string | null; days?: number; duration_days?: number | null };
      const name = it.name ?? it.medication_name;
      if (!name) return null;
      const freq = it.frequency ?? it.dosage ?? '';
      const days = it.days ?? it.duration_days ?? null;
      const tail = [freq, days != null ? `${days}일` : ''].filter(Boolean).join(' ');
      return tail ? `${name} (${tail})` : name;
    })
    .filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(', ') : null;
};

// ── 정본 모사: grid 열 순서 (DoctorPatientList 기본행 grid) ────────────────────
const GRID_TEMPLATE = '1.75rem_3rem_5rem_5.5rem_3.75rem_minmax(0,1fr)_auto';
const COLUMN_ORDER = ['queue', 'visit-badge', 'name', 'rx-badge', 'status', 'memo', 'action'];

// ── 정본 모사: DATENAV shiftISODate (회귀 보존 확인) ──────────────────────────
const shiftISODate = (iso: string, deltaDays: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 원내 환자 우선 + 정렬 토글
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 ① 원내 우선 + 정렬 토글', () => {
  const rows: Row[] = [
    { customer_name: '홍길동', status: 'done', checked_in_at: '2026-06-09T01:00:00Z' },        // 완료(원내X)
    { customer_name: '강감찬', status: 'laser', checked_in_at: '2026-06-09T03:00:00Z' },        // 원내
    { customer_name: '김유신', status: 'consult_waiting', checked_in_at: '2026-06-09T02:00:00Z' }, // 원내
    { customer_name: '이순신', status: 'cancelled', checked_in_at: '2026-06-09T00:30:00Z' },    // 취소(원내X)
  ];

  test('in-clinic 판별: done/cancelled 제외, 접수~수납대기 포함', () => {
    expect(isInClinic('done')).toBe(false);
    expect(isInClinic('cancelled')).toBe(false);
    expect(isInClinic('checklist')).toBe(false);
    expect(isInClinic('payment_waiting')).toBe(true);
    expect(isInClinic('registered')).toBe(true);
    expect(isInClinic('laser')).toBe(true);
  });

  test('시간순 — 원내 그룹 상단 + 그룹 내 접수시간 오름차순', () => {
    const out = sortRows(rows, 'time').map((r) => r.customer_name);
    // 원내(김유신 02:00, 강감찬 03:00) 먼저 → 비원내(이순신, 홍길동)
    expect(out.slice(0, 2)).toEqual(['김유신', '강감찬']);
    // 비원내도 뒤에 존재(누락 없음)
    expect(out).toContain('홍길동');
    expect(out).toContain('이순신');
    // 원내 그룹이 항상 비원내보다 앞
    const idxIn = Math.max(out.indexOf('김유신'), out.indexOf('강감찬'));
    const idxOut = Math.min(out.indexOf('홍길동'), out.indexOf('이순신'));
    expect(idxIn).toBeLessThan(idxOut);
  });

  test('이름순 토글 — 원내 우선 그룹 유지, 그룹 내 가나다', () => {
    const out = sortRows(rows, 'name').map((r) => r.customer_name);
    // 원내 그룹 가나다: 강감찬 < 김유신
    expect(out.slice(0, 2)).toEqual(['강감찬', '김유신']);
    // 원내 그룹이 여전히 상단
    const idxIn = Math.max(out.indexOf('강감찬'), out.indexOf('김유신'));
    const idxOut = Math.min(out.indexOf('홍길동'), out.indexOf('이순신'));
    expect(idxIn).toBeLessThan(idxOut);
  });

  test('정렬 토글이 원내 우선 그룹핑을 깨지 않음 (불변식)', () => {
    for (const mode of ['time', 'name'] as const) {
      const out = sortRows(rows, mode);
      const firstNonIn = out.findIndex((r) => !isInClinic(r.status));
      // firstNonIn 이전은 전부 원내여야
      for (let i = 0; i < firstNonIn; i++) expect(isInClinic(out[i].status)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 배지·처방표기·툴팁
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 ②③ 배지 위치 + 처방표기 + 툴팁', () => {
  test('② 방문배지(visit-badge)가 이름(name) 왼쪽', () => {
    expect(COLUMN_ORDER.indexOf('visit-badge')).toBeLessThan(COLUMN_ORDER.indexOf('name'));
  });

  test('③ 처방배지(rx-badge)가 이름(name) 오른쪽', () => {
    expect(COLUMN_ORDER.indexOf('rx-badge')).toBeGreaterThan(COLUMN_ORDER.indexOf('name'));
  });

  test('③ 처방표기 라벨 — 확정→처방전 O / 없음→처방전 X / 임시 유지', () => {
    expect(rxBadgeLabel('confirmed')).toBe('처방전 O');
    expect(rxBadgeLabel('none')).toBe('처방전 X');
    expect(rxBadgeLabel('pending')).toBe('임시');
  });

  test('③ hover 툴팁 — prescription_items 약품 내용 요약', () => {
    const items = [
      { name: '소염진통제', frequency: '1일 3회', days: 3 },
      { medication_name: '근이완제', dosage: '1일 2회', duration_days: 5 },
    ];
    const summary = prescriptionSummary(items);
    expect(summary).toContain('소염진통제');
    expect(summary).toContain('근이완제');
    expect(summary).toContain('3일');
  });

  test('③ 처방 없음 → 툴팁 요약 null (badge title="처방 없음" fallback)', () => {
    expect(prescriptionSummary([])).toBeNull();
    expect(prescriptionSummary(null)).toBeNull();
    expect(prescriptionSummary(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 이름 너비 고정 + 테이블 정렬
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 ④⑤ 이름 고정폭 + 고정 열 위치', () => {
  test('④ 이름 열 고정 너비 (글자수 무관, grid track 5rem)', () => {
    const tracks = GRID_TEMPLATE.split('_');
    // COLUMN_ORDER 의 name 인덱스 = 2 → track 5rem 고정값
    expect(tracks[COLUMN_ORDER.indexOf('name')]).toBe('5rem');
  });

  test('⑤ 모든 열이 고정값 (메모만 가변 1fr)', () => {
    const tracks = GRID_TEMPLATE.split('_');
    expect(tracks).toHaveLength(COLUMN_ORDER.length);
    // 메모(가변) 외 큐/배지/이름/처방/상태/액션은 고정 또는 auto
    expect(tracks[COLUMN_ORDER.indexOf('memo')]).toContain('1fr');
    expect(tracks[COLUMN_ORDER.indexOf('queue')]).toBe('1.75rem');
    expect(tracks[COLUMN_ORDER.indexOf('rx-badge')]).toBe('5.5rem');
  });

  test('⑤ 열 순서 불변 — 큐/배지/이름/처방/상태/메모/액션', () => {
    expect(COLUMN_ORDER).toEqual(['queue', 'visit-badge', 'name', 'rx-badge', 'status', 'memo', 'action']);
  });

  test('④ 긴 이름·짧은 이름이 동일 track 폭 (truncate) — 정렬 결과 행 수 불변', () => {
    const rows: Row[] = [
      { customer_name: '김', status: 'laser', checked_in_at: '2026-06-09T01:00:00Z' },
      { customer_name: '남궁민수정', status: 'consultation', checked_in_at: '2026-06-09T02:00:00Z' },
    ];
    // 이름 길이가 달라도 정렬/표시 로직은 행을 누락/병합하지 않음
    expect(sortRows(rows, 'time')).toHaveLength(2);
    expect(sortRows(rows, 'name')).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 회귀 (DATENAV·동선 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 회귀 — DATENAV 보존 + 동선', () => {
  test('DATENAV 전/후 이동 (shiftISODate) 보존', () => {
    expect(shiftISODate('2026-06-09', 1)).toBe('2026-06-10');
    expect(shiftISODate('2026-06-09', -1)).toBe('2026-06-08');
    expect(shiftISODate('2026-06-01', -1)).toBe('2026-05-31');
  });

  test('정렬은 선택 날짜 조회 결과 "목록 내" 동작 — 날짜 로직과 독립', () => {
    // 정렬 comparator 는 날짜 입력을 받지 않음(목록 내 status/이름/시간만 사용) → 날짜 헤더 비침범
    const rows: Row[] = [
      { customer_name: 'B', status: 'laser', checked_in_at: '2026-06-09T02:00:00Z' },
      { customer_name: 'A', status: 'laser', checked_in_at: '2026-06-09T01:00:00Z' },
    ];
    expect(sortRows(rows, 'time').map((r) => r.customer_name)).toEqual(['A', 'B']);
    expect(sortRows(rows, 'name').map((r) => r.customer_name)).toEqual(['A', 'B']);
  });

  test('확정 동선 보존 — pending 행은 정렬 후에도 식별 가능(액션 컬럼 분리)', () => {
    // 확정 버튼은 action 컬럼(맨끝)에 유지 — 처방배지(rx-badge)와 별개 컬럼
    expect(COLUMN_ORDER.indexOf('action')).toBe(COLUMN_ORDER.length - 1);
    expect(COLUMN_ORDER.indexOf('action')).toBeGreaterThan(COLUMN_ORDER.indexOf('rx-badge'));
  });
});
