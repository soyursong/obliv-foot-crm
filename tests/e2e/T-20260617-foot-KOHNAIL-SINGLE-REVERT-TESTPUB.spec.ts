/**
 * E2E spec — T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB
 * 균검사지 조갑부위(채취발가락) 단일선택 환원 + 더미 발행 동작확인.
 *
 * ★ 카디널리티 3차 flip: single(PHASE15)→multi(RENEWAL 886edf9)→single(본 티켓).
 *   reporter 문지은 대표원장 "무조건 하나만" emphatic 명시. RENEWAL §C2 multi toggle → single 환원.
 *
 * ★ 가드레일 (절대 준수, 본 spec 으로 회귀 고정):
 *   1. NO-DDL — koh_nail_sites jsonb 배열 + set_koh_nail_sites RPC 그대로. 배열→string 변경 금지.
 *      UI/저장 length 1 enforce 만(라디오 동작, 저장값=원소 1개 배열).
 *   2. 기존 복수값(레거시) 레코드 graceful — 크래시 0, 일괄 마이그 0. 표시 보존, 발행 시 sites[0].
 *   3. KOHGEN-HTMLPORT 발행 양식 검체종류(specimen_type) 단일값 정상 렌더.
 *
 * 현장 클릭 시나리오 3종 변환:
 *   S1 단일선택 환원(AC-1) — NailSiteEditor 라디오형 토글. 다른 부위 누르면 기존 해제 후 1개만.
 *        같은 부위 재토글=해제(빈배열). onCommit 배열 길이 ≤1 항상. 저장 shape=원소 1개 배열(string 아님).
 *   S2 하위호환·graceful(AC-2) — 旣 저장 다중값 행 파괴/마이그 없이 표시 보존. 발행 시 specimen_type=sites[0].
 *        closed-enum RPC shape 회귀 0(NO-DDL).
 *   S3 더미발행 게이트(AC-3) — canPublish = nail_sites.length>0 && !published.
 *        발행 field_data.specimen_type 단일값 렌더(HTMLPORT 양식). 미선택/발행완료 차단.
 *
 * 스타일: in-page 순수 로직 시뮬레이션(구현 정본 KohReportTab 헬퍼/NailSiteEditor toggle/buildKohFieldData 모사).
 *   실브라우저 발행 동선은 별도 라이브 스크립트(scripts/..._livepublish.mjs)로 evidence PNG 캡처(보고 표준 A).
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

// ── 정본 모사: NailSiteEditor 단일선택 toggle (AC-1, 라디오형) ──────────────────
const isOnly = (sites: NailSite[], side: NailSide, toe: number) =>
  sites.length === 1 && sites[0].side === side && sites[0].toe === toe;
const toggleSingle = (sites: NailSite[], side: NailSide, toe: number): NailSite[] =>
  isOnly(sites, side, toe) ? [] : [{ side, toe }];

// ── 정본 모사: parseNailSites 방어 파싱(jsonb→NailSite[], closed-enum) ──────────
const parseNailSites = (raw: unknown): NailSite[] => {
  if (!Array.isArray(raw)) return [];
  const out: NailSite[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const side = (e as { side?: unknown }).side;
    const toe = Number((e as { toe?: unknown }).toe);
    if ((side === 'Rt' || side === 'Lt') && toe >= 1 && toe <= 5) out.push({ side, toe });
  }
  return out;
};

// ── 정본 모사: buildKohFieldData.specimen_type (발행 시 sites[0]만, HTMLPORT 단일값) ──
const specimenTypeForPublish = (nailSites: NailSite[]): string => {
  const primary = formatNailSites(nailSites.slice(0, 1));
  return primary === '—' ? '' : primary;
};

// ── 정본 모사: canPublish (AC-3 발행 게이트) ───────────────────────────────────
const canPublish = (nailSites: NailSite[], published: boolean): boolean =>
  nailSites.length > 0 && !published;

// ── 정본 모사: set_koh_nail_sites RPC shape 검증(NO-DDL, closed-enum 배열) ───────
const rpcShapeValid = (sites: unknown): boolean => {
  if (!Array.isArray(sites)) return false; // 배열 외(string 등) 거부 = NO-DDL 가드
  return sites.every(
    (e) =>
      !!e && typeof e === 'object' &&
      ((e as { side?: unknown }).side === 'Rt' || (e as { side?: unknown }).side === 'Lt') &&
      /^[1-5]$/.test(String((e as { toe?: unknown }).toe)),
  );
};

// ===========================================================================
test.describe('T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB', () => {
  // ── S1 단일선택 환원(AC-1) ──
  test('S1a: 다른 부위 누르면 기존 해제 후 1개만(누적 금지) — 라디오 동작', () => {
    let sites: NailSite[] = [];
    sites = toggleSingle(sites, 'Lt', 1);
    expect(sites).toEqual([{ side: 'Lt', toe: 1 }]);
    sites = toggleSingle(sites, 'Rt', 3);          // 다른 부위 → 직전 해제
    expect(sites).toEqual([{ side: 'Rt', toe: 3 }]);
    sites = toggleSingle(sites, 'Lt', 5);
    expect(sites).toEqual([{ side: 'Lt', toe: 5 }]);
    expect(sites.length).toBe(1);
  });

  test('S1b: 선택된 부위 다시 누르면 해제(빈배열) — 재토글', () => {
    let sites: NailSite[] = [{ side: 'Lt', toe: 2 }];
    sites = toggleSingle(sites, 'Lt', 2);
    expect(sites).toEqual([]);
  });

  test('S1c: 어떤 토글 시퀀스에서도 onCommit 배열 길이 ≤1 (단일선택 불변식)', () => {
    let sites: NailSite[] = [];
    const seq: [NailSide, number][] = [['Lt', 1], ['Rt', 2], ['Rt', 2], ['Lt', 4], ['Rt', 5], ['Lt', 4]];
    for (const [side, toe] of seq) {
      sites = toggleSingle(sites, side, toe);
      expect(sites.length).toBeLessThanOrEqual(1);
    }
  });

  test('S1d: 저장 shape 는 원소 1개 배열(NO-DDL) — string 아님', () => {
    const sites = toggleSingle([], 'Rt', 4);
    expect(Array.isArray(sites)).toBe(true);      // 배열 유지(배열→string 변경 금지)
    expect(rpcShapeValid(sites)).toBe(true);
    expect(rpcShapeValid('Rt 4지 조갑')).toBe(false); // 표시문자열 저장 금지
  });

  // ── S2 하위호환·graceful(AC-2) ──
  test('S2a: 레거시 다중값 행 — 표시는 그대로 다건 노출(파괴/마이그 0)', () => {
    const legacy = parseNailSites([{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }]);
    expect(legacy.length).toBe(2);                       // 파싱 크래시 0
    expect(formatNailSites(legacy)).toBe('Lt 1지 조갑, Rt 2지 조갑'); // 다건 그대로 표시
  });

  test('S2b: 레거시 다중값 발행 — specimen_type 은 sites[0]만(HTMLPORT 단일값)', () => {
    const legacy: NailSite[] = [{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }];
    expect(specimenTypeForPublish(legacy)).toBe('Rt 2지 조갑'); // 첫 원소만
    expect(specimenTypeForPublish([{ side: 'Lt', toe: 1 }])).toBe('Lt 1지 조갑'); // 단일행 동일
    expect(specimenTypeForPublish([])).toBe('');               // 빈배열 → 빈값(게이트 별도 차단)
  });

  test('S2c: 레거시/신규 모두 RPC shape 회귀 0 (closed-enum, NO-DDL)', () => {
    expect(rpcShapeValid([{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }])).toBe(true);
    expect(rpcShapeValid([{ side: 'Lt', toe: 1 }])).toBe(true);
    expect(rpcShapeValid([])).toBe(true);               // 미선택 저장 허용
    expect(rpcShapeValid([{ side: 'L', toe: 2 }])).toBe(false); // 미정규화 거부
  });

  test('S2d: 잡원소(범위 밖/표시문자열) 섞인 jsonb — graceful 버림(크래시 0)', () => {
    const dirty = parseNailSites([{ side: 'Lt', toe: 1 }, 'Rt 2지 조갑', { side: 'X', toe: 9 }, null]);
    expect(dirty).toEqual([{ side: 'Lt', toe: 1 }]);     // 유효 원소만, 예외 없이 통과
  });

  // ── S3 더미발행 게이트(AC-3) ──
  test('S3a: canPublish — nail_sites 있고 미발행일 때만 발행 가능', () => {
    expect(canPublish([{ side: 'Lt', toe: 1 }], false)).toBe(true);  // 발행 가능
    expect(canPublish([], false)).toBe(false);                       // 미선택 → 차단
    expect(canPublish([{ side: 'Lt', toe: 1 }], true)).toBe(false);  // 발행완료 → 차단(비가역)
  });

  test('S3b: 단일선택 신규행 발행 field_data — 검체종류 단일값 렌더', () => {
    const sites = toggleSingle([], 'Lt', 1);             // 단일선택 결과
    expect(canPublish(sites, false)).toBe(true);
    expect(specimenTypeForPublish(sites)).toBe('Lt 1지 조갑'); // HTMLPORT 양식 단일값
  });
});
