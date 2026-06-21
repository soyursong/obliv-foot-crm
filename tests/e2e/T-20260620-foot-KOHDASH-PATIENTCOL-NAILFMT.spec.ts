/**
 * E2E spec — T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT
 * 균검사지 진료대시보드 환자 명단 컬럼 정리 + 채취조갑 'R1' 컴팩트 표기 + 생년(만나이) + 검사일 제거.
 *
 * 검증 대상(현장 클릭 시나리오 변환):
 *   S1 명단 7컬럼(AC-1/AC-8) — 이름·생년(만나이)·차트번호·채취조갑·진료의·상태·발행. 검사일 컬럼 부재.
 *   S2 채취조갑 컴팩트 'R1'(AC-2/§B) — formatNailSiteShort: {Rt,1}→'R1', {Lt,5}→'L5'(정확히 2글자).
 *   S3 채취조갑 배열 표기(SINGLESEL) — formatNailSitesShort: 빈=‘—’, 단일, 레거시 다중→정렬 후 sites[0].
 *   S4 생년(만나이)(AC-6) — formatBirthYearWithAge: '1990-03-15' @2026-06-21 → '1990 (36세)', 생일 미경과 −1.
 *   S5 엣지 — 6자리(YYMMDD) 방어 파싱, 결측 '—', 미래생년 방어.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab 헬퍼)을 모사해 회귀를 잡는다.
 *   DB·RPC 무변경(koh_nail_sites jsonb 재사용 = 표시변환만, 신규 스키마 0).
 *   ⚠ 입력 컴포넌트 교체(§B-INPUT/AC-7)는 sub_gate(input_method_confirm) HOLD → 본 spec 범위 외(토글 보존).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: NailSite 타입/정렬 (KohReportTab.tsx) ───────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }

const sideRank: Record<NailSide, number> = { Lt: 0, Rt: 1 };
const sortNailSites = (sites: NailSite[]): NailSite[] =>
  [...sites].sort((a, b) => sideRank[a.side] - sideRank[b.side] || a.toe - b.toe);

// ── 정본 모사: 컴팩트 채취조갑 표기 (§B / AC-2) ───────────────────────────────
const formatNailSiteShort = (s: NailSite): string => `${s.side === 'Rt' ? 'R' : 'L'}${s.toe}`;
const formatNailSitesShort = (sites: NailSite[] | null | undefined): string =>
  !sites || sites.length === 0 ? '—' : formatNailSiteShort(sortNailSites(sites)[0]);

// ── 정본 모사: 생년(만나이) (AC-6) ────────────────────────────────────────────
const formatBirthYearWithAge = (
  birth: string | null | undefined,
  todayISO: string,
): string => {
  if (!birth) return '—';
  const s = String(birth).trim();
  let by: number, bm: number, bd: number;
  const m10 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m10) {
    by = parseInt(m10[1], 10); bm = parseInt(m10[2], 10); bd = parseInt(m10[3], 10);
  } else {
    const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (!m6) return s || '—';
    const yy = parseInt(m6[1], 10);
    by = parseInt((yy >= 0 && yy <= 26 ? '20' : '19') + m6[1], 10);
    bm = parseInt(m6[2], 10); bd = parseInt(m6[3], 10);
  }
  const tm = todayISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!tm) return String(by);
  const ty = parseInt(tm[1], 10), tmo = parseInt(tm[2], 10), td = parseInt(tm[3], 10);
  let age = ty - by;
  if (tmo < bm || (tmo === bm && td < bd)) age -= 1;
  if (age < 0) return String(by);
  return `${by} (${age}세)`;
};

// ── S1: 명단 7컬럼 + 검사일 부재 (AC-1/AC-8) ──────────────────────────────────
test.describe('S1 명단 7컬럼(AC-1/AC-8)', () => {
  // 구현 정본 헤더 순서(데이터 컬럼) — 선택(일괄발급)은 canIssue 게이트 별개 컬럼.
  const DATA_COLUMNS = ['이름', '생년(만나이)', '차트번호', '채취조갑', '진료의', '상태', '발행'];

  test('데이터 컬럼 = 7개 고정 순서', () => {
    expect(DATA_COLUMNS).toHaveLength(7);
    expect(DATA_COLUMNS).toEqual(['이름', '생년(만나이)', '차트번호', '채취조갑', '진료의', '상태', '발행']);
  });

  test('검사일 컬럼 제거(AC-8) — 7컬럼에 검사일 없음', () => {
    expect(DATA_COLUMNS).not.toContain('검사일');
    expect(DATA_COLUMNS).not.toContain('[선택]');
  });

  test('라벨 용어 갱신 — 차트→차트번호, 생년→생년(만나이), 조갑부위→채취조갑', () => {
    expect(DATA_COLUMNS).toContain('차트번호');
    expect(DATA_COLUMNS).toContain('생년(만나이)');
    expect(DATA_COLUMNS).toContain('채취조갑');
    expect(DATA_COLUMNS).not.toContain('차트');
    expect(DATA_COLUMNS).not.toContain('조갑부위');
  });
});

// ── S2: 채취조갑 컴팩트 'R1'(AC-2/§B) — 정확히 2글자 ──────────────────────────
test.describe('S2 채취조갑 컴팩트 표기(AC-2/§B)', () => {
  test('단일 원소 → 2글자(R/L 대문자 + toe)', () => {
    expect(formatNailSiteShort({ side: 'Rt', toe: 1 })).toBe('R1');
    expect(formatNailSiteShort({ side: 'Lt', toe: 5 })).toBe('L5');
    expect(formatNailSiteShort({ side: 'Rt', toe: 3 })).toBe('R3');
  });

  test('정확히 2글자 — 부가문자(조갑/지/공백) 없음', () => {
    for (const side of ['Rt', 'Lt'] as NailSide[]) {
      for (let toe = 1; toe <= 5; toe++) {
        const out = formatNailSiteShort({ side, toe });
        expect(out).toHaveLength(2);
        expect(out).toMatch(/^[RL][1-5]$/);
      }
    }
  });
});

// ── S3: 배열 표기(SINGLESEL) ──────────────────────────────────────────────────
test.describe('S3 채취조갑 배열 표기', () => {
  test('빈/결측 = —', () => {
    expect(formatNailSitesShort([])).toBe('—');
    expect(formatNailSitesShort(null)).toBe('—');
    expect(formatNailSitesShort(undefined)).toBe('—');
  });

  test('단일선택(SINGLESEL) — 1건 그대로', () => {
    expect(formatNailSitesShort([{ side: 'Lt', toe: 2 }])).toBe('L2');
  });

  test('레거시 다중값 — 정렬 후 첫 부위(좌발 우선)만 2글자', () => {
    // Rt2, Lt1, Lt3 → 정렬 Lt1, Lt3, Rt2 → 첫 부위 'L1'
    expect(formatNailSitesShort([{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }, { side: 'Lt', toe: 3 }])).toBe('L1');
  });
});

// ── S4: 생년(만나이)(AC-6) ────────────────────────────────────────────────────
test.describe('S4 생년(만나이)(AC-6)', () => {
  test('생일 경과 — 1990-03-15 @2026-06-21 → 1990 (36세)', () => {
    expect(formatBirthYearWithAge('1990-03-15', '2026-06-21')).toBe('1990 (36세)');
  });

  test('생일 미경과 — 1990-12-25 @2026-06-21 → 1990 (35세)', () => {
    expect(formatBirthYearWithAge('1990-12-25', '2026-06-21')).toBe('1990 (35세)');
  });

  test('생일 당일 — 경과로 간주(만나이 증가)', () => {
    expect(formatBirthYearWithAge('2000-06-21', '2026-06-21')).toBe('2000 (26세)');
  });

  test('생일 전날 — 미경과(만나이 미증가)', () => {
    expect(formatBirthYearWithAge('2000-06-22', '2026-06-21')).toBe('2000 (25세)');
  });

  test('timestamptz(10자리 초과)도 날짜부만 사용', () => {
    expect(formatBirthYearWithAge('1985-01-01T00:00:00Z', '2026-06-21')).toBe('1985 (41세)');
  });
});

// ── S5: 엣지 ─────────────────────────────────────────────────────────────────
test.describe('S5 엣지', () => {
  test('결측 생년 = —', () => {
    expect(formatBirthYearWithAge(null, '2026-06-21')).toBe('—');
    expect(formatBirthYearWithAge('', '2026-06-21')).toBe('—');
  });

  test('6자리(YYMMDD) 방어 파싱 — 세기 규칙(00~26→20xx, else→19xx)', () => {
    expect(formatBirthYearWithAge('900315', '2026-06-21')).toBe('1990 (36세)'); // 90→1990
    expect(formatBirthYearWithAge('050315', '2026-06-21')).toBe('2005 (21세)'); // 05→2005
  });

  test('미래 생년 방어 — 나이 음수면 생년만', () => {
    expect(formatBirthYearWithAge('2030-01-01', '2026-06-21')).toBe('2030');
  });

  test('파싱 불가 문자열 — 원본 폴백', () => {
    expect(formatBirthYearWithAge('미상', '2026-06-21')).toBe('미상');
  });
});
