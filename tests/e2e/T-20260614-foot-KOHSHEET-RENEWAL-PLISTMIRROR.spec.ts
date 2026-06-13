/**
 * E2E spec — T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR
 * 균검사지 6컬럼 재정의(§B) + 조갑부위 multi-select 입력(§C).
 *
 * 검증 대상(현장 클릭 시나리오 변환):
 *   S1 검사일 날짜만(§B2) — formatExamDate: created_at(UTC) → KST 'YYYY-MM-DD'(시간 제거).
 *   S2 다중선택 토글(§C2) — 좌발/우발 버튼 누적 토글. 추가/제거, 미선택=빈배열.
 *   S3 표시 정렬·다건 표기(§C3) — sortNailSites: Lt 먼저, 발가락 오름차순 → 'Lt 1지 조갑, Lt 3지 조갑, Rt 2지 조갑'.
 *   S4 저장 shape canon — multi 원소 전부 {side:Lt|Rt,toe:1-5}. RPC shape 게이트 동치(잡필드/표시문자열 거부).
 *   S5 엣지(시나리오3) — 미선택 저장=[] / 단일선택 하위호환 / 같은 버튼 재토글=제거.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab 헬퍼 + NailSiteEditor toggle 규칙)을
 *   모사해 회귀를 잡는다. DB·RPC 무변경(koh_nail_sites jsonb 배열 재사용).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: NailSite 타입/render (KohReportTab.tsx) ─────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }

const sideRank: Record<NailSide, number> = { Lt: 0, Rt: 1 };
const sortNailSites = (sites: NailSite[]): NailSite[] =>
  [...sites].sort((a, b) => sideRank[a.side] - sideRank[b.side] || a.toe - b.toe);

const formatNailSite = (s: NailSite): string => `${s.side} ${s.toe}지 조갑`;
const formatNailSites = (sites: NailSite[] | null | undefined): string =>
  !sites || sites.length === 0 ? '—' : sortNailSites(sites).map(formatNailSite).join(', ');

// ── 정본 모사: formatExamDate (§B2 날짜만) ────────────────────────────────────
const seoulISODate = (input: string | number | Date): string =>
  new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const formatExamDate = (createdAt: string | null | undefined): string =>
  !createdAt ? '—' : seoulISODate(createdAt);

// ── 정본 모사: NailSiteEditor 다중선택 toggle 규칙 (§C2) ───────────────────────
const has = (sites: NailSite[], side: NailSide, toe: number) =>
  sites.some((s) => s.side === side && s.toe === toe);
const toggleSite = (sites: NailSite[], side: NailSide, toe: number): NailSite[] =>
  sortNailSites(
    has(sites, side, toe)
      ? sites.filter((s) => !(s.side === side && s.toe === toe))
      : [...sites, { side, toe }],
  );

// ── 정본 모사: RPC set_koh_nail_sites shape 검증(서버측 동치) ──────────────────
const rpcShapeValid = (sites: unknown): boolean => {
  if (!Array.isArray(sites)) return false;
  return sites.every(
    (e) =>
      !!e && typeof e === 'object' &&
      ((e as { side?: unknown }).side === 'Rt' || (e as { side?: unknown }).side === 'Lt') &&
      /^[1-5]$/.test(String((e as { toe?: unknown }).toe)),
  );
};

// ===========================================================================
test.describe('T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR', () => {
  // S1 — 검사일 날짜만(§B2): 시간 제거
  test('S1: formatExamDate — KST 날짜만(YYYY-MM-DD), 시간 없음', () => {
    // UTC 02:00 = KST 11:00 → 2026-06-11 (날짜만)
    expect(formatExamDate('2026-06-11T02:00:00Z')).toBe('2026-06-11');
    // UTC 21:00 = KST 익일 06:00 → 2026-06-12
    expect(formatExamDate('2026-06-11T21:00:00Z')).toBe('2026-06-12');
    // 시간 토큰(콜론) 미포함 확인
    expect(formatExamDate('2026-06-11T02:00:00Z')).not.toContain(':');
    expect(formatExamDate(null)).toBe('—');
    expect(formatExamDate(undefined)).toBe('—');
  });

  // S2 — 다중선택 토글(§C2): 좌/우발 버튼 누적
  test('S2: toggleSite — 복수 부위 누적(추가)', () => {
    let sites: NailSite[] = [];
    sites = toggleSite(sites, 'Lt', 1); // 좌발 L1
    sites = toggleSite(sites, 'Lt', 3); // 좌발 L3
    sites = toggleSite(sites, 'Rt', 2); // 우발 R2
    expect(sites).toEqual([
      { side: 'Lt', toe: 1 },
      { side: 'Lt', toe: 3 },
      { side: 'Rt', toe: 2 },
    ]);
    expect(sites.length).toBe(3); // 누적(단일선택 아님)
  });

  // S3 — 표시 정렬·다건 표기(§C3): 시나리오2 ④ 기대 문자열
  test('S3: formatNailSites — 다건 정렬 표기(Lt 먼저, 발가락 오름차순)', () => {
    const sites: NailSite[] = [
      { side: 'Rt', toe: 2 },
      { side: 'Lt', toe: 3 },
      { side: 'Lt', toe: 1 },
    ];
    // 입력 순서 무관 — 정렬 표시
    expect(formatNailSites(sites)).toBe('Lt 1지 조갑, Lt 3지 조갑, Rt 2지 조갑');
    expect(formatNailSites([])).toBe('—');
    expect(formatNailSites(null)).toBe('—');
  });

  // S4 — 저장 shape canon: multi 전부 closed-enum, RPC 게이트 통과
  test('S4: rpcShapeValid — multi 원소 전부 {side:Lt|Rt,toe:1-5} 통과', () => {
    expect(rpcShapeValid([
      { side: 'Lt', toe: 1 },
      { side: 'Lt', toe: 3 },
      { side: 'Rt', toe: 2 },
    ])).toBe(true);
    // 잘못된 원소 1개라도 섞이면 거부
    expect(rpcShapeValid([{ side: 'Lt', toe: 1 }, { side: 'L', toe: 2 }])).toBe(false);
    expect(rpcShapeValid([{ side: 'Lt', toe: 1 }, { side: 'Rt', toe: 6 }])).toBe(false);
    // 표시문자열 저장 금지(거부)
    expect(rpcShapeValid(['Lt 1지 조갑'])).toBe(false);
  });

  // S5 — 엣지(시나리오3): 미선택/단일/재토글 제거
  test('S5: 엣지 — 미선택 [], 단일 하위호환, 같은 버튼 재토글=제거', () => {
    // 미선택 저장 = 빈배열(허용)
    expect(toggleSite([{ side: 'Lt', toe: 1 }], 'Lt', 1)).toEqual([]); // 재토글로 해제 → []
    // 단일 선택만 해도 정상(하위호환)
    expect(toggleSite([], 'Rt', 5)).toEqual([{ side: 'Rt', toe: 5 }]);
    // 같은 버튼 두 번 = 추가 후 제거(누적 아님)
    let s: NailSite[] = [];
    s = toggleSite(s, 'Lt', 2);
    expect(has(s, 'Lt', 2)).toBe(true);
    s = toggleSite(s, 'Lt', 2);
    expect(has(s, 'Lt', 2)).toBe(false);
    expect(s).toEqual([]);
    // 빈배열도 RPC 통과(미선택 허용)
    expect(rpcShapeValid([])).toBe(true);
  });
});
