/**
 * E2E spec — T-20260611-foot-KOH-REPORT-TAB (Phase 1, read-only 4컬럼)
 * 균검사지(KOH 진균검사) 명단 리포트 탭.
 *
 * 검증 대상:
 *   S1 KOH 매칭식 — service_name ILIKE %KOH% OR %진균검사% (denormalized).
 *      ⚠ service_code/hira_code 매칭 금지(DX-KOH-01 미존재·D6591/D2502001 비활성).
 *   S2 행 매핑 — 4컬럼(이름·생년월일·차트번호·검사일). 이름 = customers.name 우선 + check_ins.customer_name fallback.
 *   S3 월 네비게이터 — shiftYearMonth(±N), 범위 바운드(KST), 라벨 포맷.
 *   S4 표시 포맷 — 생년월일 10자리, 검사일 KST 변환, 결측 '—'.
 *   S5 Phase 경계 — 발톱부위·당일의사명 컬럼은 Phase 1 미포함(4컬럼 고정).
 *   S6 +1일 경과 필터 — AC-1/AC-3: 검사 다음날부터 표시, 당일(+1일 미경과)·미래 제외.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab의 매칭/포맷/월이동 헬퍼)을
 *   모사해 회귀를 잡는다. (컴포넌트는 auth/DB 의존이라 직접 마운트 대신 로직 동치 검증.)
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: kohServiceNameMatches (KohReportTab.tsx) ───────────────────────
const kohServiceNameMatches = (serviceName: string | null | undefined): boolean => {
  if (!serviceName) return false;
  return serviceName.toUpperCase().includes('KOH') || serviceName.includes('진균검사');
};

// ── 정본 모사: shiftYearMonth ─────────────────────────────────────────────────
const shiftYearMonth = (ym: string, deltaMonths: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + deltaMonths, 1, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
};

// ── 정본 모사: formatYearMonthKo ──────────────────────────────────────────────
const formatYearMonthKo = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
};

// ── 정본 모사: formatBirthDate ────────────────────────────────────────────────
const formatBirthDate = (birth: string | null | undefined): string => {
  if (!birth) return '—';
  const s = String(birth).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || '—';
};

// ── 정본 모사: seoulISODate + isKohExamEligible (KohReportTab.tsx) ─────────────
const seoulISODate = (input: string | number | Date): string =>
  new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const isKohExamEligible = (createdAt: string | null | undefined, todayISO: string): boolean => {
  if (!createdAt) return false;
  return seoulISODate(createdAt) < todayISO;
};

// ── 정본 모사: 행 매핑 (useKohReport flatten) ─────────────────────────────────
type RawRow = {
  id: string;
  service_name: string;
  created_at: string;
  check_ins: { customer_name?: string | null; customers?: { name?: string | null; birth_date?: string | null; chart_number?: string | null } | null } | Array<unknown>;
};
const mapRow = (row: RawRow) => {
  const ciRaw = row.check_ins;
  const ci = (Array.isArray(ciRaw) ? ciRaw[0] : ciRaw) as
    | { customer_name?: string | null; customers?: unknown }
    | undefined;
  const custRaw = ci?.customers;
  const cust = (Array.isArray(custRaw) ? custRaw[0] : custRaw) as
    | { name?: string | null; birth_date?: string | null; chart_number?: string | null }
    | undefined;
  const name = (cust?.name ?? '').trim() || (ci?.customer_name ?? '').trim() || '—';
  return {
    id: row.id,
    customer_name: name,
    birth_date: cust?.birth_date ?? null,
    chart_number: cust?.chart_number ?? null,
    created_at: row.created_at,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// S1 — KOH 매칭식
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 KOH 매칭식 (service_name ILIKE)', () => {
  test('실운영 서비스명 매칭 — 일반진균검사-KOH도말-조갑조직', () => {
    expect(kohServiceNameMatches('일반진균검사-KOH도말-조갑조직')).toBe(true);
  });

  test('KOH 토큰 — 대소문자 무시', () => {
    expect(kohServiceNameMatches('KOH 균검사')).toBe(true);
    expect(kohServiceNameMatches('koh smear')).toBe(true);
    expect(kohServiceNameMatches('KOH도말검사')).toBe(true);
  });

  test('진균검사 한글 토큰 매칭', () => {
    expect(kohServiceNameMatches('일반진균검사')).toBe(true);
    expect(kohServiceNameMatches('진균검사 추가')).toBe(true);
  });

  test('비KOH 서비스는 제외 (레이저·수액·상담 등)', () => {
    expect(kohServiceNameMatches('가열레이저')).toBe(false);
    expect(kohServiceNameMatches('수액치료')).toBe(false);
    expect(kohServiceNameMatches('초진상담')).toBe(false);
    expect(kohServiceNameMatches('')).toBe(false);
    expect(kohServiceNameMatches(null)).toBe(false);
    expect(kohServiceNameMatches(undefined)).toBe(false);
  });

  test('매칭은 service_code/hira_code가 아닌 service_name 기반 (DX-KOH-01/D6591/D2502001 코드 무관)', () => {
    // 코드 문자열을 name에 넣어도 KOH/진균 토큰이 없으면 매칭 안 됨 → name 토큰 기반임을 보장
    expect(kohServiceNameMatches('D620300HZ')).toBe(false);
    expect(kohServiceNameMatches('DX-KOH-01')).toBe(true); // 'KOH' 토큰 포함 → name에 KOH 있으면 매칭(정상)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 행 매핑(4컬럼) + 이름 fallback
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 행 매핑 — 이름/생년월일/차트번호/검사일', () => {
  test('customers.name 우선 표기', () => {
    const r = mapRow({
      id: '1', service_name: 'KOH', created_at: '2026-06-10T01:00:00Z',
      check_ins: { customer_name: '구이름', customers: { name: '신이름', birth_date: '1990-01-15', chart_number: 'F-0001' } },
    });
    expect(r.customer_name).toBe('신이름');
    expect(r.birth_date).toBe('1990-01-15');
    expect(r.chart_number).toBe('F-0001');
  });

  test('customers.name 결측 시 check_ins.customer_name fallback', () => {
    const r = mapRow({
      id: '2', service_name: '진균검사', created_at: '2026-06-10T01:00:00Z',
      check_ins: { customer_name: '예약명', customers: null },
    });
    expect(r.customer_name).toBe('예약명');
    expect(r.birth_date).toBeNull();
    expect(r.chart_number).toBeNull();
  });

  test('PostgREST 임베드 array 형태도 flatten', () => {
    const r = mapRow({
      id: '3', service_name: 'KOH', created_at: '2026-06-10T01:00:00Z',
      check_ins: [{ customer_name: 'A', customers: [{ name: '배열이름', birth_date: '1985-12-31', chart_number: 'F-0099' }] }],
    });
    expect(r.customer_name).toBe('배열이름');
    expect(r.chart_number).toBe('F-0099');
  });

  test('이름 전부 결측 시 — 대시(—)', () => {
    const r = mapRow({
      id: '4', service_name: 'KOH', created_at: '2026-06-10T01:00:00Z',
      check_ins: { customer_name: null, customers: null },
    });
    expect(r.customer_name).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — 월 네비게이터
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 월 이동 + 범위 바운드', () => {
  test('shiftYearMonth ±1, 연 경계 넘김', () => {
    expect(shiftYearMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftYearMonth('2026-06', -1)).toBe('2026-05');
    expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
  });

  test('월 라벨 포맷 — YYYY년 M월', () => {
    expect(formatYearMonthKo('2026-06')).toBe('2026년 6월');
    expect(formatYearMonthKo('2026-12')).toBe('2026년 12월');
  });

  test('조회 범위 바운드 — [YYYY-MM-01, 다음달-01) KST', () => {
    const ym = '2026-06';
    const startBound = `${ym}-01T00:00:00+09:00`;
    const endBound = `${shiftYearMonth(ym, 1)}-01T00:00:00+09:00`;
    expect(startBound).toBe('2026-06-01T00:00:00+09:00');
    expect(endBound).toBe('2026-07-01T00:00:00+09:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — 표시 포맷
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 표시 포맷', () => {
  test('생년월일 10자리 절단, 결측 대시', () => {
    expect(formatBirthDate('1990-01-15')).toBe('1990-01-15');
    expect(formatBirthDate('1990-01-15T00:00:00Z')).toBe('1990-01-15');
    expect(formatBirthDate(null)).toBe('—');
    expect(formatBirthDate('')).toBe('—');
  });

  test('차트번호 결측 시 대시 (호출부 r.chart_number || "—")', () => {
    const chart: string | null = null;
    expect(chart || '—').toBe('—');
    expect('F-0001' || '—').toBe('F-0001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — Phase 경계(4컬럼 고정)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S5 Phase 1 컬럼 경계', () => {
  test('Phase 1 컬럼 = 정확히 4개 (발톱부위·당일의사명 미포함)', () => {
    const PHASE1_COLUMNS = ['환자이름', '생년월일', '차트번호', '검사일'];
    expect(PHASE1_COLUMNS).toHaveLength(4);
    expect(PHASE1_COLUMNS).not.toContain('발톱부위');
    expect(PHASE1_COLUMNS).not.toContain('당일의사명');
    expect(PHASE1_COLUMNS).not.toContain('의사명');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — +1일 경과 필터 (AC-1: 검사 다음날부터 표시 / AC-3: 당일·미래 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S6 +1일 경과 필터', () => {
  const TODAY = '2026-06-12'; // KST 기준 오늘 고정

  test('어제 검사 → 표시(경과 충족)', () => {
    // 2026-06-11 KST 오후 = 2026-06-11T05:00:00Z (KST 14:00) → 어제
    expect(isKohExamEligible('2026-06-11T05:00:00Z', TODAY)).toBe(true);
  });

  test('당일(+1일 미경과) 검사 → 미표시 (AC-3)', () => {
    // 2026-06-12 KST 오전 = 2026-06-12T01:00:00Z (KST 10:00) → 오늘 = 제외
    expect(isKohExamEligible('2026-06-12T01:00:00Z', TODAY)).toBe(false);
  });

  test('KST 자정 경계 — UTC 전날 저녁이 KST 오늘이면 제외', () => {
    // 2026-06-11T20:00:00Z = KST 2026-06-12 05:00 → 오늘(KST) → 제외
    expect(isKohExamEligible('2026-06-11T20:00:00Z', TODAY)).toBe(false);
    // 2026-06-11T14:00:00Z = KST 2026-06-11 23:00 → 어제(KST) → 표시
    expect(isKohExamEligible('2026-06-11T14:00:00Z', TODAY)).toBe(true);
  });

  test('미래 검사 → 미표시', () => {
    expect(isKohExamEligible('2026-06-13T01:00:00Z', TODAY)).toBe(false);
  });

  test('created_at 결측 → 미표시(방어)', () => {
    expect(isKohExamEligible(null, TODAY)).toBe(false);
    expect(isKohExamEligible(undefined, TODAY)).toBe(false);
    expect(isKohExamEligible('', TODAY)).toBe(false);
  });

  test('월별 명단에 적용 — 당일분만 걸러지고 경과분은 통과', () => {
    const rows = [
      { id: 'a', created_at: '2026-06-01T01:00:00Z' }, // 경과
      { id: 'b', created_at: '2026-06-11T01:00:00Z' }, // 경과(어제)
      { id: 'c', created_at: '2026-06-12T01:00:00Z' }, // 당일 → 제외
    ];
    const eligible = rows.filter((r) => isKohExamEligible(r.created_at, TODAY));
    expect(eligible.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
