/**
 * T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC — [랭킹] 탭 6스펙 보완 E2E
 *
 * 원본 T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK(deployed) 위 additive 보완.
 *  #1 상단 DatePicker(기본=오늘) — 선택일 기준 전 수치 재계산(기존 native date input 재사용, 신규 npm 0).
 *  #2 컬럼 재구성: 월누적매출→월매출(1일~선택일) / 주매출→전주매출(직전주 월~일) / +객단가(유지) / +당월 배정 예상 비율 / +배정 건 수
 *  #3 하단 실장별 랭킹 변동표(주간: 전주 순위 vs 이번주 순위, ↑N/↓N/-)
 *  #4 전주매출 = 선택일 직전 주(월~일) 총매출
 *  #5 당월 배정 예상 비율 = 당월 초진예약 총건수 × 랭크 배정비율(assignment_daily_target_config 재사용, 신규 저장 0)
 *  #6 배정 건 수 = 선택일 당일 누적 배정건수(check_ins.consultant_id — 배정 SSOT). TM 별도필터 미적용(전건).
 *
 * ── 검증 방식(예측가능·결정론) ──
 *  · 순수 로직 재현(컴포넌트 파생 규칙과 동일) + 정적 소스 구조 단언(read(PAGE)) 위주.
 *  · 실렌더 클릭(갤탭 실브라우저)·라이브 매출 정합은 supervisor QA 커버. 여기선 산식·구조·회귀 고정.
 *  · db_change=false: 신규 컬럼/테이블 0, 모든 값은 기존 소스(payments RPC / check_ins / reservations / daily_target_config) READ.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ── 컴포넌트 module-scope 날짜 헬퍼와 동일 규칙(순수 재현, KST DATE-only) ─────────────
const pad2 = (n: number) => String(n).padStart(2, '0');
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return isoAddDays(iso, -((dow + 6) % 7));
}
function monthStartOfIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function rankingRanges(sel: string) {
  const thisWeekMon = mondayOfIso(sel);
  return {
    monthStart: monthStartOfIso(sel),
    thisWeekMon,
    prevWeekMon: isoAddDays(thisWeekMon, -7),
    prevWeekSun: isoAddDays(thisWeekMon, -1),
  };
}
function rankByRevenue(
  ids: string[],
  revenueOf: (id: string) => number,
  nameOf: (id: string) => string,
): Map<string, number> {
  const sorted = [...ids].sort(
    (a, b) => revenueOf(b) - revenueOf(a) || nameOf(a).localeCompare(nameOf(b), 'ko'),
  );
  const m = new Map<string, number>();
  sorted.forEach((id, i) => m.set(id, i + 1));
  return m;
}
// interpolateDailyTargets(assignmentStrategy) 순수 재현 — 랭크별 목표(1등=top, 꼴등=bottom, 선형보간·반올림·min1).
function interpolateDailyTargets(rankedIds: string[], top: number, bottom: number): Map<string, number> {
  const m = new Map<string, number>();
  const n = rankedIds.length;
  if (n === 0) return m;
  if (n === 1) {
    m.set(rankedIds[0], top);
    return m;
  }
  for (let i = 0; i < n; i++) {
    const t = top - ((top - bottom) * i) / (n - 1);
    m.set(rankedIds[i], Math.max(1, Math.round(t)));
  }
  return m;
}

interface PerfLike {
  consultant_id: string;
  name: string;
  total_amount?: number;
  avg_amount?: number | null;
}
// 컴포넌트 rankingRows 파생 규칙 재현(#2/#5/#6).
function deriveRankingRows(
  perfRows: PerfLike[],
  prevWeek: Map<string, number>,
  dayAssign: Map<string, number>,
  monthInitResv: number,
  cfg: { top: number; bottom: number } | null,
) {
  const sorted = [...perfRows].sort(
    (a, b) =>
      (b.total_amount ?? 0) - (a.total_amount ?? 0) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'ko'),
  );
  const rankedIds = sorted.map((r) => r.consultant_id);
  const targets = cfg ? interpolateDailyTargets(rankedIds, cfg.top, cfg.bottom) : null;
  let sum = 0;
  if (targets) for (const v of targets.values()) sum += v;
  return sorted.map((r, i) => {
    const ratio = targets && sum > 0 ? (targets.get(r.consultant_id) ?? 0) / sum : null;
    return {
      rank: i + 1,
      consultantId: r.consultant_id,
      name: r.name ?? '—',
      monthRevenue: r.total_amount ?? 0,
      prevWeekRevenue: prevWeek.get(r.consultant_id) ?? 0,
      avgTicket: r.avg_amount ?? null,
      expectedRatio: ratio,
      expectedCount: ratio != null ? Math.round(monthInitResv * ratio) : null,
      dayAssignCount: dayAssign.get(r.consultant_id) ?? 0,
    };
  });
}
// 컴포넌트 variationRows 파생(#3/#4 주간).
function deriveVariation(
  perfRows: PerfLike[],
  prevWeek: Map<string, number>,
  thisWeek: Map<string, number>,
) {
  const ids = perfRows.map((r) => r.consultant_id);
  const nameMap = new Map(perfRows.map((r) => [r.consultant_id, r.name ?? '—']));
  const nameOf = (id: string) => nameMap.get(id) ?? '—';
  const prevRankMap = rankByRevenue(ids, (id) => prevWeek.get(id) ?? 0, nameOf);
  const thisRankMap = rankByRevenue(ids, (id) => thisWeek.get(id) ?? 0, nameOf);
  return ids
    .map((id) => {
      const pr = prevRankMap.get(id) ?? null;
      const tr = thisRankMap.get(id) ?? null;
      return { name: nameOf(id), prevRank: pr, thisRank: tr, delta: pr != null && tr != null ? pr - tr : null };
    })
    .sort((a, b) => (a.thisRank ?? 9999) - (b.thisRank ?? 9999));
}

test.describe('T-20260727 [랭킹] 탭 DatePicker + 6스펙', () => {
  // ── 시나리오 1: 일자 선택 → 수치 재계산(구간 산출 정합) ──
  test('S1 선택일 기준 구간(월누적/이번주/전주) 산출 — 캘린더 정확(월~일 주)', () => {
    // ⚠ 티켓 §4 예시는 7/27을 '일요일'로 적었으나 실 캘린더상 2026-07-27=월요일(티켓 요일표기 off-by-one).
    //   코드는 캘린더 정확(월~일 주). 아래는 실 캘린더 기준 검증.
    // 2026-07-27(월) 선택 → 이번주 월=7/27, 직전주 = 7/20(월)~7/26(일).
    const r = rankingRanges('2026-07-27');
    expect(r.monthStart).toBe('2026-07-01'); // 월매출 = 1일~선택일
    expect(r.thisWeekMon).toBe('2026-07-27');
    expect(r.prevWeekMon).toBe('2026-07-20');
    expect(r.prevWeekSun).toBe('2026-07-26');

    // 티켓 의도(일요일 선택 → 직전주 월~일) = 실제 일요일(2026-07-26) 로 검증.
    //   7/26(일) → 이번주 월=7/20, 직전주 = 7/13(월)~7/19(일).
    const rSun = rankingRanges('2026-07-26');
    expect(rSun.thisWeekMon).toBe('2026-07-20');
    expect(rSun.prevWeekMon).toBe('2026-07-13');
    expect(rSun.prevWeekSun).toBe('2026-07-19');

    // 시나리오1 5~7단계: 과거일(7/20 월) 선택 재계산 — 월매출 7/1~7/20, 직전주 7/13~7/19.
    const r2 = rankingRanges('2026-07-20');
    expect(r2.monthStart).toBe('2026-07-01');
    expect(r2.thisWeekMon).toBe('2026-07-20');
    expect(r2.prevWeekMon).toBe('2026-07-13');
    expect(r2.prevWeekSun).toBe('2026-07-19');

    // 월 경계 넘김 안전(전주가 전월로 넘어가는 케이스) — 2026-07-05(일) → 직전주 6/22~6/28.
    const r3 = rankingRanges('2026-07-05');
    expect(r3.monthStart).toBe('2026-07-01');
    expect(r3.thisWeekMon).toBe('2026-06-29');
    expect(r3.prevWeekMon).toBe('2026-06-22');
    expect(r3.prevWeekSun).toBe('2026-06-28');
  });

  // ── 시나리오 3: 배정 예상 비율 + 배정 건 수 표시 ──
  test('S3 배정 예상 비율(#5) = 초진예약 × 랭크비율, 배정 건 수(#6) = 당일 누적', () => {
    const perf: PerfLike[] = [
      { consultant_id: 'a', name: '엄경은', total_amount: 30_000_000, avg_amount: 1_200_000 },
      { consultant_id: 'b', name: '송지현', total_amount: 20_000_000, avg_amount: 900_000 },
      { consultant_id: 'c', name: '김주연', total_amount: 10_000_000, avg_amount: 700_000 },
    ];
    const prevWeek = new Map([['a', 5_000_000], ['b', 6_000_000], ['c', 1_000_000]]);
    const dayAssign = new Map([['a', 4], ['b', 2]]); // c=당일 배정 없음
    const monthInitResv = 30; // 당월 초진예약 총건수
    const cfg = { top: 8, bottom: 4 }; // 1등=8, 꼴등=4 (2:1)

    const rows = deriveRankingRows(perf, prevWeek, dayAssign, monthInitResv, cfg);

    // 순위 = 월매출 desc.
    expect(rows.map((r) => r.name)).toEqual(['엄경은', '송지현', '김주연']);
    // #2 전주매출 매핑 + 객단가 유지.
    expect(rows[0].prevWeekRevenue).toBe(5_000_000);
    expect(rows[0].avgTicket).toBe(1_200_000);
    // #5 랭크 배정비율: targets = [8,6,4] (선형보간) → sum=18 → 8/18≈44%, 6/18≈33%, 4/18≈22%.
    expect(Math.round((rows[0].expectedRatio ?? 0) * 100)).toBe(44);
    expect(Math.round((rows[1].expectedRatio ?? 0) * 100)).toBe(33);
    expect(Math.round((rows[2].expectedRatio ?? 0) * 100)).toBe(22);
    // 예상 건수 = round(30 × 비율) = 13 / 10 / 7 (합≈30).
    expect(rows[0].expectedCount).toBe(13);
    expect(rows[1].expectedCount).toBe(10);
    expect(rows[2].expectedCount).toBe(7);
    // #6 배정 건 수 = 당일 누적(c는 0).
    expect(rows.map((r) => r.dayAssignCount)).toEqual([4, 2, 0]);
  });

  // ── 시나리오 2: 하단 랭킹 변동표(주간) ──
  test('S2 변동표(#3/#4) — 전주 순위 vs 이번주 순위, ↑N/↓N/- 파생', () => {
    const perf: PerfLike[] = [
      { consultant_id: 'a', name: '엄경은' },
      { consultant_id: 'b', name: '송지현' },
      { consultant_id: 'c', name: '강경민' },
    ];
    // 전주: 송지현 1위 > 강경민 2위 > 엄경은 3위. 이번주: 엄경은 1위 > 송지현 2위 > 강경민 3위.
    const prevWeek = new Map([['b', 900], ['c', 500], ['a', 100]]);
    const thisWeek = new Map([['a', 900], ['b', 500], ['c', 100]]);
    const v = deriveVariation(perf, prevWeek, thisWeek);

    // 이번주 순위 오름차순 정렬.
    expect(v.map((x) => x.name)).toEqual(['엄경은', '송지현', '강경민']);
    // 엄경은: 전주 3위 → 이번주 1위 = ↑2 (delta=+2).
    expect(v[0]).toMatchObject({ name: '엄경은', prevRank: 3, thisRank: 1, delta: 2 });
    // 송지현: 전주 1위 → 이번주 2위 = ↓1 (delta=-1).
    expect(v[1]).toMatchObject({ name: '송지현', prevRank: 1, thisRank: 2, delta: -1 });
    // 강경민: 전주 2위 → 이번주 3위 = ↓1.
    expect(v[2]).toMatchObject({ name: '강경민', prevRank: 2, thisRank: 3, delta: -1 });
  });

  // ── 시나리오 4: 엣지 케이스 ──
  test('S4 엣지 — 월초 선택 / 배정이력 0 / cfg 부재 / 빈 랭킹', () => {
    // 월초(1일) 선택 → 월매출 구간 = 1일 당일(monthStart=1일).
    const r = rankingRanges('2026-07-01');
    expect(r.monthStart).toBe('2026-07-01');

    // cfg 부재 → 배정 예상 비율 null('—'), 배정건수 0 실장 정상 렌더.
    const perf: PerfLike[] = [{ consultant_id: 'x', name: '무배정', total_amount: 0, avg_amount: null }];
    const rows = deriveRankingRows(perf, new Map(), new Map(), 30, null);
    expect(rows[0].expectedRatio).toBeNull();
    expect(rows[0].expectedCount).toBeNull();
    expect(rows[0].dayAssignCount).toBe(0);
    expect(rows[0].avgTicket).toBeNull();

    // 빈 랭킹 → 빈 배열(에러 없음).
    expect(deriveRankingRows([], new Map(), new Map(), 0, null)).toEqual([]);
    expect(deriveVariation([], new Map(), new Map())).toEqual([]);

    // 배정이력 없는 실장 → 변동표에서도 안정(delta는 0 이면 '-' 렌더).
    const v = deriveVariation(perf, new Map(), new Map());
    expect(v).toHaveLength(1);
    expect(v[0].delta).toBe(0); // 단일 실장 = 전주/이번주 동일 1위 → 유지 '-'
  });

  // ── 정적 소스 구조 단언(회귀 고정): DatePicker · 7컬럼 · 변동표 카드 랜딩 ──
  test('STATIC 소스 구조 — DatePicker + 신규 컬럼/testid + 변동표 카드가 랭킹 탭 블록 내 랜딩', () => {
    const src = read(PAGE);
    const rankingBlockIdx = src.indexOf("mainTab === 'ranking' && canViewRanking");
    expect(rankingBlockIdx).toBeGreaterThan(-1);

    // #1 DatePicker(native date input 재사용, 신규 npm 0) — testid + max=오늘.
    const dateIdx = src.indexOf('data-testid="ranking-date"');
    expect(dateIdx).toBeGreaterThan(rankingBlockIdx);
    expect(src).toMatch(/id="ranking-date"[\s\S]*?type="date"[\s\S]*?value=\{rankingDate\}[\s\S]*?max=\{todaySeoulISODate\(\)\}/);

    // #2 신규/변경 컬럼 testid 5종.
    for (const tid of [
      'ranking-revenue', // 월매출
      'ranking-prevweek-revenue', // 전주매출
      'ranking-avg-ticket', // 객단가
      'ranking-expected-ratio', // 당월 배정 예상 비율
      'ranking-assign-count', // 배정 건 수
    ]) {
      expect(src.indexOf(`data-testid="${tid}"`)).toBeGreaterThan(rankingBlockIdx);
    }
    // 컬럼 헤더 라벨(월누적매출/주매출 → 월매출/전주매출).
    expect(src).toContain('>월매출<');
    expect(src).toContain('>전주매출<');
    expect(src).toContain('>당월 배정 예상 비율<');
    expect(src).toContain('>배정 건 수<');

    // #3 변동표 카드 — 랭킹 카드 뒤, 랭킹 블록 안. ↑/↓ 파생.
    //  T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT: 변동표를 공통 VariationTable 컴포넌트로 추출 →
    //   카드 testid 는 cardTestId prop 으로 전달(data-testid={cardTestId}). delta testid 는 컴포넌트 정의부(모듈 스코프).
    const varCardIdx = src.indexOf('cardTestId="assignments-ranking-variation-card"');
    const rankCardIdx = src.indexOf('data-testid="assignments-ranking-card"');
    expect(varCardIdx).toBeGreaterThan(rankCardIdx); // 변동표 카드는 랭킹 카드 뒤(랭킹 블록 안)
    expect(src).toContain('data-testid="ranking-variation-delta"'); // ↑/↓ delta durable marker 유지

    // #6 배정 건 수 = 당일(check_ins) — 소스에 dayAssignCounts 소비 + 당일 구간 fetch.
    expect(src).toContain('dayAssignCount');
    expect(src).toMatch(/gte\('checked_in_at', dayStart\)/);

    // db_change=false 보증: 이 페이지에 신규 테이블/컬럼 DDL 없음 — 기존 소스만 READ.
    expect(src).toContain('fetchConsultantPerf'); // 월/전주/이번주 매출
    expect(src).toContain('fetchDailyTargetConfig'); // 배정비율 설정값 재사용
    expect(src).toContain("visit_type', 'new'"); // 당월 초진예약 count
  });

  // ── 회귀 가드: 랭킹 탭은 여전히 admin 전용(canViewRanking 게이트 유지) ──
  test('REGRESS 관리자 전용 잠금 유지(canViewRanking 술어 불변)', () => {
    const src = read(PAGE);
    // 탭 게이트/데이터 fetch effect 가 canViewRanking 하에 유지.
    expect(src).toMatch(/mainTab !== 'ranking' \|\| !canViewRanking \|\| !clinic\) return;/);
    expect(src).toContain("mainTab === 'ranking' && canViewRanking");
  });
});
