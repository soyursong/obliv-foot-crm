/**
 * T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT — [랭킹] 탭 변동표 월간 추가 + 행 포맷 재편
 *
 * 원본 T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC(주간 변동표) 위 additive 보완.
 *  작업1 월간 변동표 추가 — '실장별 랭킹 변동(월간)' = 전월(1일~말일) 순위 vs 당월(1일~선택일) 순위.
 *         당월 순위 = perfRows(월매출) 재사용(재산정 없음). 전월매출 = fetchConsultantPerf 동일 엔진 READ 파생.
 *  작업2 행 포맷 재편(주간·월간 공통) — [실장명 → 변동(↑N/↓N/-) → 이번(당월) 순위 → 전(전월/전주) 순위].
 *         예 `엄경은 ↑1 | 1위 | 2위`. 이번(당월) 순위 오름차순 정렬(기존과 동일).
 *
 * ── divergence 가드(CHART-ORDER R2 좀비 교훈) ──
 *  · durable marker=assignments-ranking-variation-card(주간 인스턴스 testid 유지) / ranking-variation-delta.
 *  · 주간/월간을 단일 VariationTable 컴포넌트로 렌더(포맷 단일 소스). 병렬 신규 변동표 컴포넌트 없음.
 *  · R1 매출정합(재직 실장 필터·풋 payments·clinic·deleted_at 제외) = fetchConsultantPerf 동일 엔진 계승(월간도 동일).
 *
 * ── 검증 방식(예측가능·결정론) ──
 *  · 순수 로직 재현(컴포넌트 파생 규칙과 동일) + 정적 소스 구조 단언(read(PAGE)).
 *  · 실렌더 클릭(갤탭 실브라우저)·라이브 매출 정합은 supervisor QA 커버.
 *  · db_change=false: 신규 컬럼/테이블 0, 전월매출도 기존 payments RPC(fetchConsultantPerf) READ 파생.
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
// 컴포넌트 rankingRanges 재현(전월 경계 추가분 포함).
function rankingRanges(sel: string) {
  const thisWeekMon = mondayOfIso(sel);
  const monthStart = monthStartOfIso(sel);
  const prevMonthEnd = isoAddDays(monthStart, -1);
  return {
    monthStart,
    thisWeekMon,
    prevWeekMon: isoAddDays(thisWeekMon, -7),
    prevWeekSun: isoAddDays(thisWeekMon, -1),
    prevMonthStart: monthStartOfIso(prevMonthEnd),
    prevMonthEnd,
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

interface PerfLike {
  consultant_id: string;
  name: string;
  total_amount?: number;
}
// 컴포넌트 monthVariationRows 파생 재현 — 전월 순위(prevMonthRevenue) vs 당월 순위(perfRows.total_amount).
function deriveMonthVariation(perfRows: PerfLike[], prevMonth: Map<string, number>) {
  const ids = perfRows.map((r) => r.consultant_id);
  const nameMap = new Map(perfRows.map((r) => [r.consultant_id, r.name ?? '—']));
  const nameOf = (id: string) => nameMap.get(id) ?? '—';
  const thisMonthRev = new Map(perfRows.map((r) => [r.consultant_id, r.total_amount ?? 0]));
  const prevRankMap = rankByRevenue(ids, (id) => prevMonth.get(id) ?? 0, nameOf);
  const thisRankMap = rankByRevenue(ids, (id) => thisMonthRev.get(id) ?? 0, nameOf);
  return ids
    .map((id) => {
      const pr = prevRankMap.get(id) ?? null;
      const tr = thisRankMap.get(id) ?? null;
      return {
        name: nameOf(id),
        prevRank: pr,
        thisRank: tr,
        delta: pr != null && tr != null ? pr - tr : null,
      };
    })
    .sort((a, b) => (a.thisRank ?? 9999) - (b.thisRank ?? 9999));
}

test.describe('T-20260729 [랭킹] 변동표 월간 추가 + 행 포맷 재편', () => {
  // ── 시나리오 1: 전월 경계 산출(월 경계·연 경계 넘김 안전) ──
  test('S1 전월 경계(prevMonthStart/prevMonthEnd) — 캘린더 정확(월/연 경계 안전)', () => {
    // 2026-07-15 선택 → 전월 = 6/1~6/30.
    const r = rankingRanges('2026-07-15');
    expect(r.monthStart).toBe('2026-07-01');
    expect(r.prevMonthStart).toBe('2026-06-01');
    expect(r.prevMonthEnd).toBe('2026-06-30');

    // 월초(1일) 선택도 전월 전체 = 6/1~6/30(당월 구간이 1일 당일이어도 전월은 온전한 달).
    const r1 = rankingRanges('2026-07-01');
    expect(r1.prevMonthStart).toBe('2026-06-01');
    expect(r1.prevMonthEnd).toBe('2026-06-30');

    // 3월(전월=2월, 평년 28일) 경계.
    const rFeb = rankingRanges('2026-03-10');
    expect(rFeb.prevMonthStart).toBe('2026-02-01');
    expect(rFeb.prevMonthEnd).toBe('2026-02-28');

    // 연 경계 넘김 — 1월 선택 → 전월 = 전년 12월.
    const rJan = rankingRanges('2026-01-20');
    expect(rJan.monthStart).toBe('2026-01-01');
    expect(rJan.prevMonthStart).toBe('2025-12-01');
    expect(rJan.prevMonthEnd).toBe('2025-12-31');
  });

  // ── 시나리오 2: 월간 변동표 파생(전월 순위 vs 당월 순위) ──
  test('S2 월간 변동(작업1) — 전월 순위 vs 당월 순위, ↑N/↓N/- 파생 + 당월 오름차순 정렬', () => {
    const perf: PerfLike[] = [
      { consultant_id: 'a', name: '엄경은', total_amount: 30_000_000 },
      { consultant_id: 'b', name: '송지현', total_amount: 20_000_000 },
      { consultant_id: 'c', name: '강경민', total_amount: 10_000_000 },
    ];
    // 전월: 송지현 1위 > 강경민 2위 > 엄경은 3위. 당월(perf desc): 엄경은 1위 > 송지현 2위 > 강경민 3위.
    const prevMonth = new Map([['b', 900], ['c', 500], ['a', 100]]);
    const v = deriveMonthVariation(perf, prevMonth);

    // 당월 순위 오름차순.
    expect(v.map((x) => x.name)).toEqual(['엄경은', '송지현', '강경민']);
    // 엄경은: 전월 3위 → 당월 1위 = ↑2 (예: `엄경은 ↑2 | 1위 | 3위`).
    expect(v[0]).toMatchObject({ name: '엄경은', prevRank: 3, thisRank: 1, delta: 2 });
    // 송지현: 전월 1위 → 당월 2위 = ↓1.
    expect(v[1]).toMatchObject({ name: '송지현', prevRank: 1, thisRank: 2, delta: -1 });
    // 강경민: 전월 2위 → 당월 3위 = ↓1.
    expect(v[2]).toMatchObject({ name: '강경민', prevRank: 2, thisRank: 3, delta: -1 });
  });

  // ── 시나리오 3: 엣지 — 전월 무매출 신규 실장 / 순위 유지 / 빈 랭킹 ──
  test('S3 엣지 — 전월 0매출(신규 실장)도 안정, 순위 유지 = 0(-), 빈 랭킹', () => {
    const perf: PerfLike[] = [
      { consultant_id: 'a', name: '엄경은', total_amount: 30_000_000 },
      { consultant_id: 'n', name: '신입실장', total_amount: 5_000_000 }, // 전월 데이터 없음
    ];
    const prevMonth = new Map([['a', 100]]); // 신입은 전월 0 → 전월 순위 후순위(2위)
    const v = deriveMonthVariation(perf, prevMonth);
    // 당월: 엄경은 1위 > 신입 2위. 전월: 엄경은 1위 > 신입(0) 2위. 둘 다 유지 → delta 0.
    expect(v.map((x) => x.name)).toEqual(['엄경은', '신입실장']);
    expect(v[0].delta).toBe(0);
    expect(v[1].delta).toBe(0);

    // 단일 실장 → 전월/당월 동일 1위 → 유지(delta 0 = '-' 렌더).
    const single = deriveMonthVariation(
      [{ consultant_id: 'x', name: '단독', total_amount: 0 }],
      new Map(),
    );
    expect(single).toHaveLength(1);
    expect(single[0].delta).toBe(0);

    // 빈 랭킹 → 빈 배열(에러 없음).
    expect(deriveMonthVariation([], new Map())).toEqual([]);
  });

  // ── 정적 소스 구조: 월간 카드 랜딩 + 행 포맷 재편(변동을 이름 옆·이번/전 컬럼 순서) ──
  test('STATIC 소스 구조 — 월간 변동표 카드 + 공통 컴포넌트 + 행 포맷 재편', () => {
    const src = read(PAGE);
    const rankingBlockIdx = src.indexOf("mainTab === 'ranking' && canViewRanking");
    expect(rankingBlockIdx).toBeGreaterThan(-1);

    // divergence 가드: durable marker(주간 카드 testid) 유지 + 월간 카드 추가.
    //  카드 testid 는 VariationTable 에 cardTestId prop 으로 전달 → 컴포넌트 내부에서 data-testid={cardTestId} 로 렌더.
    const weekCardIdx = src.indexOf('cardTestId="assignments-ranking-variation-card"');
    const monthCardIdx = src.indexOf('cardTestId="assignments-ranking-variation-card-monthly"');
    expect(weekCardIdx).toBeGreaterThan(rankingBlockIdx);
    expect(monthCardIdx).toBeGreaterThan(weekCardIdx); // 소스 순서: 주간(좌) 먼저, 월간(우) 다음
    // 배치 = 2단(2-column grid): 주간 좌 / 월간 우, 모바일 stack fallback (김주연 총괄 확정 ts 1785314923.938779).
    //  두 VariationTable 을 감싼 grid 래퍼가 주간 카드 앞에 위치해야 함(grid-cols-1 md:grid-cols-2).
    const gridWrapIdx = src.indexOf('grid grid-cols-1 gap-4 md:grid-cols-2');
    expect(gridWrapIdx).toBeGreaterThan(rankingBlockIdx);
    expect(gridWrapIdx).toBeLessThan(weekCardIdx);
    // 컴포넌트가 durable marker 를 실제 data-testid 로 렌더(주간 인스턴스 마커 유지).
    expect(src).toContain('data-testid={cardTestId}');
    // delta durable marker 유지(공통 컴포넌트 내 렌더).
    expect(src).toContain('data-testid="ranking-variation-delta"');

    // 단일 VariationTable 컴포넌트로 주간·월간 렌더(병렬 신규 컴포넌트 금지 — 두 인스턴스, 한 정의).
    expect(src).toContain('function VariationTable(');
    const varTableUses = src.match(/<VariationTable/g) ?? [];
    expect(varTableUses.length).toBe(2);

    // 작업1 월간 데이터 파생 + 전월 소스 존재.
    expect(src).toContain('monthVariationRows');
    expect(src).toContain('prevMonthRevenue');
    expect(src).toContain('setPrevMonthRevenue');
    // 전월매출은 랭킹 소스 엔진 READ 파생 — 전월 구간 인자로 호출(db_change=false 보증).
    // T-20260807-foot-RANKING-STAFFATTR: 귀속축 = assigned_staff_id → fetchConsultantPerfByAssignedStaff 로 교체.
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, prevMonthStart, prevMonthEnd\)/);

    // 작업2 행 포맷 재편 — 헤더 라벨: 변동이 실장명 다음, 그 뒤 이번/당월 순위, 전주/전월 순위.
    expect(src).toContain('실장별 랭킹 변동 (주간)');
    expect(src).toContain('실장별 랭킹 변동 (월간)');
    // 공통 컴포넌트 헤더 순서: 실장명 → 변동 → {thisLabel} → {prevLabel}.
    expect(src).toMatch(
      /실장명<\/th>[\s\S]{0,120}>변동<\/th>[\s\S]{0,160}\{thisLabel\}<\/th>[\s\S]{0,160}\{prevLabel\}<\/th>/,
    );
    // 라벨 prop 전달값 — 이번주/전주(주간) + 당월/전월(월간).
    expect(src).toContain('thisLabel="이번주 순위"');
    expect(src).toContain('prevLabel="전주 순위"');
    expect(src).toContain('thisLabel="당월 순위"');
    expect(src).toContain('prevLabel="전월 순위"');
  });

  // ── 회귀 가드: 랭킹 탭 admin 전용 잠금 유지 + 주간표 파생 불변 ──
  test('REGRESS admin 전용 잠금 + 주간 변동표(variationRows) 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/mainTab !== 'ranking' \|\| !canViewRanking \|\| !clinic\) return;/);
    expect(src).toContain("mainTab === 'ranking' && canViewRanking");
    // 주간 변동표 파생 로직 유지(월간 추가가 주간을 대체하지 않음).
    expect(src).toContain('const variationRows =');
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, prevWeekMon, prevWeekSun\)/);
    expect(src).toMatch(/fetchConsultantPerfByAssignedStaff\(clinicId, thisWeekMon, rankingDate\)/);
  });
});
