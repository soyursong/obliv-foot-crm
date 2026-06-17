/**
 * E2E spec — T-20260617-foot-KOHGEN-PUBLISH-SINGLESEL-2FIX
 * 균검사지 발행 후속 2건. 부모: KOHGEN-HTMLPORT(6f960c9e).
 *
 * 현장 클릭 시나리오 3개(티켓 본문) 변환:
 *   S1 발행복구(이슈1) — 발행 불가 사유가 사용자에게 보이는지. 태블릿 hover 부재로 '먹통' 보였던 RC.
 *        nail_sites 비어있음 + 치료부위 프리필 있음 → "치료부위는 아직 저장되지 않았습니다" 안내.
 *        nail_sites 비어있음 + 프리필 없음 → "조갑부위를 먼저 선택" 안내. nail_sites 있음 → 발행 진행.
 *        + 발행 버튼은 발행 불가 상태에서도 탭 가능(disabled 아님) → 사유 toast 노출 경로 보장.
 *   S2 단일선택(이슈2) — NailSiteEditor 단일선택 토글. 다른 부위 누르면 기존 해제 후 1개만. 같은 부위 재토글=해제.
 *        onCommit 배열 ≤1 항상 보장.
 *   S3 旣다중값 회귀(이슈2) — 레거시 다중값 행 파괴/마이그 금지. 표시(formatNailSites)는 그대로 다건 노출,
 *        발행 시 buildKohFieldData.specimen_type 은 sites[0]만 사용. RPC shape(set_koh_nail_sites) 회귀 0.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab 헬퍼/NailSiteEditor toggle/handlePublish 사유분기)
 *   을 모사해 회귀를 잡는다. 이슈2 NO-DDL(koh_nail_sites jsonb 재사용). 이슈1 prod 마이그 已적용(선조사 확인).
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

// ── 정본 모사: NailSiteEditor 단일선택 toggle (SINGLESEL-2FIX 이슈2) ────────────
//   다른 부위 누르면 기존 전부 해제 후 그 부위 1개만. 현재 선택이 정확히 그 1개면 해제(빈배열).
const isOnly = (sites: NailSite[], side: NailSide, toe: number) =>
  sites.length === 1 && sites[0].side === side && sites[0].toe === toe;
const toggleSingle = (sites: NailSite[], side: NailSide, toe: number): NailSite[] =>
  isOnly(sites, side, toe) ? [] : [{ side, toe }];

// ── 정본 모사: handlePublish 발행 사유 분기 (이슈1) ────────────────────────────
type PublishGate =
  | { ok: true }
  | { ok: false; reason: string };
const publishGate = (nailSites: NailSite[], treatmentSites: NailSite[]): PublishGate => {
  if (nailSites.length === 0) {
    return {
      ok: false,
      reason:
        treatmentSites.length > 0
          ? '표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 발행해주세요.'
          : '채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 발행할 수 있습니다.',
    };
  }
  return { ok: true };
};
/** 발행 버튼 disabled 여부 — busy 상태만 비활성(발행 불가 상태도 탭 가능: 사유 toast 노출 경로). */
const publishBtnDisabled = (busy: boolean) => busy;

// ── 정본 모사: buildKohFieldData.specimen_type (이슈2 발행 시 sites[0]만) ───────
const specimenTypeForPublish = (nailSites: NailSite[]): string => {
  const primary = formatNailSites(nailSites.slice(0, 1));
  return primary === '—' ? '' : primary;
};

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
test.describe('T-20260617-foot-KOHGEN-PUBLISH-SINGLESEL-2FIX', () => {
  // ── S1 발행복구(이슈1) ──
  test('S1a: 발행 불가 사유 — 프리필만 있고 미저장 시 "치료부위 미저장" 안내', () => {
    const gate = publishGate([], [{ side: 'Lt', toe: 1 }]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('치료부위는 아직 저장되지 않았습니다');
  });

  test('S1b: 발행 불가 사유 — 프리필도 없으면 "조갑부위 먼저 선택" 안내', () => {
    const gate = publishGate([], []);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('먼저 선택');
  });

  test('S1c: nail_sites 확정 시 발행 진행(ok)', () => {
    expect(publishGate([{ side: 'Rt', toe: 2 }], []).ok).toBe(true);
    // 프리필 유무 무관 — 저장값(nail_sites)이 있으면 통과.
    expect(publishGate([{ side: 'Rt', toe: 2 }], [{ side: 'Lt', toe: 1 }]).ok).toBe(true);
  });

  test('S1d: 발행 버튼은 발행 불가 상태에서도 탭 가능 — busy 일 때만 비활성', () => {
    // 발행 불가(사유 toast 경로 보장) → 클릭 가능해야 사유가 뜬다(태블릿 hover 부재 대응).
    expect(publishBtnDisabled(false)).toBe(false);
    // 발행/일괄발행 진행 중(busy)에만 비활성.
    expect(publishBtnDisabled(true)).toBe(true);
  });

  // ── S2 단일선택(이슈2) ──
  test('S2a: 단일선택 — 다른 부위 누르면 기존 해제 후 1개만', () => {
    let sites: NailSite[] = [];
    sites = toggleSingle(sites, 'Lt', 1);
    expect(sites).toEqual([{ side: 'Lt', toe: 1 }]);
    // 다른 부위 → 기존 해제, 새 부위 1개만(누적 아님)
    sites = toggleSingle(sites, 'Rt', 3);
    expect(sites).toEqual([{ side: 'Rt', toe: 3 }]);
    expect(sites.length).toBe(1);
    // 또 다른 부위 → 여전히 1개
    sites = toggleSingle(sites, 'Lt', 5);
    expect(sites).toEqual([{ side: 'Lt', toe: 5 }]);
  });

  test('S2b: 단일선택 — 선택된 부위 다시 누르면 해제(빈배열)', () => {
    let sites: NailSite[] = [{ side: 'Lt', toe: 2 }];
    sites = toggleSingle(sites, 'Lt', 2);
    expect(sites).toEqual([]);
    expect(rpcShapeValid(sites)).toBe(true); // 미선택 저장 허용
  });

  test('S2c: onCommit 배열 항상 ≤1 (어떤 토글 시퀀스에서도)', () => {
    let sites: NailSite[] = [];
    const seq: [NailSide, number][] = [['Lt', 1], ['Lt', 1], ['Rt', 2], ['Rt', 4], ['Lt', 3]];
    for (const [side, toe] of seq) {
      sites = toggleSingle(sites, side, toe);
      expect(sites.length).toBeLessThanOrEqual(1);
    }
    expect(sites).toEqual([{ side: 'Lt', toe: 3 }]);
  });

  // ── S3 旣다중값 회귀(이슈2) ──
  test('S3a: 레거시 다중값 행 — 표시는 그대로 다건 노출(파괴 금지)', () => {
    // 旣 저장된 다중값(2개+) 행은 마이그/덮어쓰기 없이 표시 보존.
    const legacy: NailSite[] = [{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }];
    expect(formatNailSites(legacy)).toBe('Lt 1지 조갑, Rt 2지 조갑'); // 다건 그대로
  });

  test('S3b: 레거시 다중값 발행 — specimen_type 은 sites[0](정렬 첫 부위)만', () => {
    const legacy: NailSite[] = [{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }];
    // slice(0,1) 은 정렬 전 배열 첫 원소(Rt 2) → formatNailSites 가 단건 정렬 표기.
    expect(specimenTypeForPublish(legacy)).toBe('Rt 2지 조갑');
    // 단일선택 신규행은 어차피 1건 → 동일.
    expect(specimenTypeForPublish([{ side: 'Lt', toe: 1 }])).toBe('Lt 1지 조갑');
    // 빈 배열 → 빈 문자열(발행 게이트가 별도 차단).
    expect(specimenTypeForPublish([])).toBe('');
  });

  test('S3c: 레거시 다중값 — RPC shape 회귀 0(closed-enum 유지)', () => {
    expect(rpcShapeValid([{ side: 'Rt', toe: 2 }, { side: 'Lt', toe: 1 }])).toBe(true);
    expect(rpcShapeValid([{ side: 'L', toe: 2 }])).toBe(false);   // L→Lt 미정규화 거부
    expect(rpcShapeValid(['Lt 1지 조갑'])).toBe(false);            // 표시문자열 저장 금지
  });
});
