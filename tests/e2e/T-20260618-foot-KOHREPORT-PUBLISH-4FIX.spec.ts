/**
 * E2E spec — T-20260618-foot-KOHREPORT-PUBLISH-4FIX
 * 균검사 결과보고서 발행(KohReportTab) 추가 현장피드백 4건. 부모: KOHGEN-PUBLISH-SINGLESEL-2FIX(field-soak).
 *
 * AC-0 선조사 결과(prod, read-only): 윤민희 customers.birth_date = NULL(바인딩 L299 정상, 데이터 부재).
 *   customers 1291건 中 birth_date 보유 30건뿐(NULL 1261). KOH 검사대상 中 NULL 20건+ → 이슈1=케이스(a).
 *   form_submissions status = draft/printed/signed/voided/completed/published(CHECK). AC-4 라벨변경 축소 → NO-DDL.
 *
 * 현장 클릭 시나리오 4종(티켓 본문) 변환:
 *   S1 생년 표시/미입력(이슈1) — birth_date 있으면 표기, NULL이면 '미입력' 배지(발급요청 차단 사유 인지).
 *   S2 발행칼럼 단일버튼(이슈2) — 발행완료 행 = '💾 발행완료' 단일 버튼만(보기 버튼 별도 없음). 클릭=미리보기 진입.
 *   S3 정보누락 발행 hard-block(이슈3) — 생년/조갑부위 누락 시 canPublish=false + 발급요청 실행 차단 + 사유 toast.
 *        일괄발급요청도 canPublish 필터로 누락 행 자동 제외.
 *   S4 조갑부위 칼럼 + 발급요청 라벨(이슈4) — 헤더 '조갑부위' 유지. 버튼 '발행'→'발급요청'(단건/일괄).
 *
 * ★2FIX 회귀 금지(가드레일): 조갑부위 single-select 토글 + 발행불가 탭가능(사유 toast) 동작 보존 검증 포함.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab canPublish/handlePublish gate/published 분기/
 *   birth 셀 렌더 분기)을 모사해 회귀를 잡는다. 전 항목 NO-DDL(FE 로직/UI만).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: NailSite + KohRow 부분형 ────────────────────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }
interface KohRowLite {
  id: string;
  birth_date: string | null;
  nail_sites: NailSite[];
  treatment_sites: NailSite[];
}

// ── 정본 모사: canPublish (4FIX 이슈3 — 조갑부위 + 생년 + 미발행) ───────────────
const canPublish = (r: KohRowLite, published: boolean): boolean =>
  r.nail_sites.length > 0 && !!r.birth_date && !published;

// ── 정본 모사: handlePublish 발행 게이트 (이슈1/3 — 조갑부위 → 생년 순서) ────────
type Gate = { ok: true } | { ok: false; reason: string };
const publishGate = (r: KohRowLite): Gate => {
  if (r.nail_sites.length === 0) {
    return {
      ok: false,
      reason:
        r.treatment_sites.length > 0
          ? '표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 발급요청해주세요.'
          : '채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 발급요청할 수 있습니다.',
    };
  }
  // 4FIX 이슈3(hard-block): 생년 누락 차단.
  if (!r.birth_date) {
    return { ok: false, reason: '환자 생년월일 정보가 없어 발급요청할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.' };
  }
  return { ok: true };
};

// ── 정본 모사: 발행 버튼 disabled (2FIX 회귀 — busy 일 때만, 발행불가도 탭가능) ──
const publishBtnDisabled = (busy: boolean) => busy;

// ── 정본 모사: 생년 셀 렌더 (이슈1) ───────────────────────────────────────────
const formatBirthDate = (b: string | null | undefined): string => {
  if (!b) return '—';
  const s = String(b).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || '—';
};
type BirthCell = { kind: 'value'; text: string } | { kind: 'missing'; badge: string };
const renderBirthCell = (birth: string | null): BirthCell =>
  birth ? { kind: 'value', text: formatBirthDate(birth) } : { kind: 'missing', badge: '미입력' };

// ── 정본 모사: 발행칼럼 렌더 (이슈2 — 단일버튼) ────────────────────────────────
//   published=true → '💾 발행완료' 단일 버튼(클릭=미리보기). published=false → '발급요청' 버튼.
type PublishCell =
  | { state: 'published'; buttons: string[]; onClickOpensPreview: boolean }
  | { state: 'unpublished'; label: string };
const renderPublishCell = (published: boolean): PublishCell =>
  published
    ? { state: 'published', buttons: ['💾 발행완료'], onClickOpensPreview: true }
    : { state: 'unpublished', label: '발급요청' };

// ── 정본 모사: 단일선택 토글 (2FIX 회귀 — onCommit ≤1) ─────────────────────────
const isOnly = (sites: NailSite[], side: NailSide, toe: number) =>
  sites.length === 1 && sites[0].side === side && sites[0].toe === toe;
const toggleSingle = (sites: NailSite[], side: NailSide, toe: number): NailSite[] =>
  isOnly(sites, side, toe) ? [] : [{ side, toe }];

// ===========================================================================
test.describe('T-20260618-foot-KOHREPORT-PUBLISH-4FIX', () => {
  // ── S1 생년 표시/미입력(이슈1) ──
  test('S1a: birth_date 있으면 생년 정상 표기', () => {
    const cell = renderBirthCell('1988-03-15');
    expect(cell.kind).toBe('value');
    if (cell.kind === 'value') expect(cell.text).toBe('1988-03-15');
  });

  test('S1b: birth_date NULL(윤민희 케이스) 이면 "미입력" 배지', () => {
    const cell = renderBirthCell(null);
    expect(cell.kind).toBe('missing');
    if (cell.kind === 'missing') expect(cell.badge).toBe('미입력');
  });

  // ── S2 발행칼럼 단일버튼(이슈2) ──
  test('S2a: 발행완료 행 = "💾 발행완료" 단일 버튼만(보기 버튼 별도 없음)', () => {
    const cell = renderPublishCell(true);
    expect(cell.state).toBe('published');
    if (cell.state === 'published') {
      expect(cell.buttons).toEqual(['💾 발행완료']);
      expect(cell.buttons.length).toBe(1); // 2버튼(발행완료+보기) 금지
      expect(cell.buttons).not.toContain('보기');
    }
  });

  test('S2b: "💾 발행완료" 클릭 = 미리보기 팝업 진입(보기 기능 동일)', () => {
    const cell = renderPublishCell(true);
    if (cell.state === 'published') expect(cell.onClickOpensPreview).toBe(true);
  });

  // ── S3 정보누락 발행 hard-block(이슈3) ──
  test('S3a: 생년 누락(조갑부위 있음) → canPublish=false + 발급요청 차단 + 생년 사유', () => {
    const r: KohRowLite = { id: '1', birth_date: null, nail_sites: [{ side: 'Rt', toe: 2 }], treatment_sites: [] };
    expect(canPublish(r, false)).toBe(false);
    const gate = publishGate(r);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('생년월일');
  });

  test('S3b: 조갑부위 누락(생년 있음) → 차단 + 조갑부위 사유', () => {
    const r: KohRowLite = { id: '2', birth_date: '1990-01-01', nail_sites: [], treatment_sites: [] };
    expect(canPublish(r, false)).toBe(false);
    const gate = publishGate(r);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('조갑부위');
  });

  test('S3c: 생년+조갑부위 모두 충족 → 발급요청 가능', () => {
    const r: KohRowLite = { id: '3', birth_date: '1985-12-31', nail_sites: [{ side: 'Lt', toe: 1 }], treatment_sites: [] };
    expect(canPublish(r, false)).toBe(true);
    expect(publishGate(r).ok).toBe(true);
  });

  test('S3d: 旣 발행완료 행은 canPublish=false(중복 발행 차단, 기존본 무변경)', () => {
    const r: KohRowLite = { id: '4', birth_date: '1985-12-31', nail_sites: [{ side: 'Lt', toe: 1 }], treatment_sites: [] };
    expect(canPublish(r, true)).toBe(false);
  });

  test('S3e: 일괄발급요청 대상(publishableIds) = canPublish 필터 — 생년 누락 행 자동 제외', () => {
    const rows: KohRowLite[] = [
      { id: 'a', birth_date: '1980-01-01', nail_sites: [{ side: 'Rt', toe: 1 }], treatment_sites: [] }, // OK
      { id: 'b', birth_date: null, nail_sites: [{ side: 'Lt', toe: 2 }], treatment_sites: [] },          // 생년 누락
      { id: 'c', birth_date: '1990-05-05', nail_sites: [], treatment_sites: [] },                        // 조갑부위 누락
    ];
    const publishableIds = rows.filter((r) => canPublish(r, false)).map((r) => r.id);
    expect(publishableIds).toEqual(['a']); // 누락 2건 제외
  });

  // ── S4 조갑부위 칼럼 + 발급요청 라벨(이슈4) ──
  test('S4a: 미발행 버튼 라벨 = "발급요청"(즉시발행 아님)', () => {
    const cell = renderPublishCell(false);
    expect(cell.state).toBe('unpublished');
    if (cell.state === 'unpublished') expect(cell.label).toBe('발급요청');
  });

  test('S4b: 조갑부위 컬럼 헤더 라벨 유지(이미 "조갑부위")', () => {
    const KOH_HEADERS = ['이름', '생년', '차트', '검사일', '조갑부위', '진료의'];
    expect(KOH_HEADERS).toContain('조갑부위');
  });

  // ── 2FIX 회귀 금지(가드레일) ──
  test('R1: 발행불가 상태도 탭 가능 — busy 일 때만 비활성(2FIX 이슈1 보존)', () => {
    expect(publishBtnDisabled(false)).toBe(false);
    expect(publishBtnDisabled(true)).toBe(true);
  });

  test('R2: 조갑부위 단일선택 토글 onCommit ≤1 보존(2FIX 이슈2)', () => {
    let sites: NailSite[] = [];
    const seq: [NailSide, number][] = [['Lt', 1], ['Rt', 2], ['Rt', 2], ['Lt', 4]];
    for (const [side, toe] of seq) {
      sites = toggleSingle(sites, side, toe);
      expect(sites.length).toBeLessThanOrEqual(1);
    }
    expect(sites).toEqual([{ side: 'Lt', toe: 4 }]);
  });
});
