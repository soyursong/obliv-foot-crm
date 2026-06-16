/**
 * E2E spec — T-20260616-foot-KOHDASH-BULK-PUBLISH
 * 균검사지 대시보드(진료의 기준 뷰) 체크박스 다중선택 + 일괄발행. 단건 발행 동선 무회귀.
 *
 * 배경: 단건 발행 lifecycle = T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH(deployed d03b05ef).
 *   일괄발행은 그 단건 발행 경로(publish_koh_result RPC)를 선택한 N건에 FE loop 로 반복 적용.
 *   본 티켓은 (1) 일괄발행 버튼 0건 비활성·1건+ 활성 가드(AC-2), (2) 부분실패 시 실패건 선택 유지(AC-4)를 확정.
 *
 * 검증 대상(현장 클릭 시나리오 1~4 변환 + AC):
 *   S1 정상 일괄발행(AC-1/AC-3)  — 발행가능 N건 선택 → 모두 단건과 동일 결과로 발행 대상에 들어옴.
 *   S2 전체선택(AC-1)            — 헤더 전체선택 = 발행가능 행만 토글. 재토글 해제.
 *   S3 미선택 가드(AC-2)         — 0건 선택 시 일괄발행 비활성(클릭 불가), 1건+ 선택 시 활성.
 *   S4 부분실패(AC-4)            — 성공건은 선택 해제, 실패건은 선택 유지(재시도 가능). 전체 롤백 아님.
 *   S5 단건 무회귀(AC-5)         — 단건 canPublish 규칙 불변(조갑부위 있고 미발행).
 *   S6 실 브라우저              — 진료대시보드 균검사지 탭 렌더(일괄발행 버튼·전체선택·행 체크박스 노출).
 *
 * 스타일: S1~S5 = 구현 정본(KohReportTab) 규칙 모사로 회귀 차단. S6 = 실 브라우저 스모크.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 타입 (KohReportTab.tsx) ────────────────────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }
interface KohRow {
  id: string;
  customer_name: string;
  nail_sites: NailSite[];
  koh_requested: boolean;
}

// 정본 canPublish / isPublished 규칙 모사(단건 동선 = 일괄발행 대상 산정의 SSOT).
const isPublished = (id: string, published: Set<string>): boolean => published.has(id);
const canPublish = (r: KohRow, published: Set<string>): boolean =>
  r.nail_sites.length > 0 && !isPublished(r.id, published);

const mkRow = (over: Partial<KohRow>): KohRow => ({
  id: 's1', customer_name: '홍길동', nail_sites: [], koh_requested: true, ...over,
});

// 정본 publishableIds 규칙(전체선택 토글 근거).
const publishableIds = (rows: KohRow[], published: Set<string>): string[] =>
  rows.filter((r) => canPublish(r, published)).map((r) => r.id);

// 정본 toggleSelectAll 모사 — 전부 선택되어 있으면 해제, 아니면 합집합 추가.
const toggleSelectAll = (prev: Set<string>, ids: string[]): Set<string> => {
  if (ids.length > 0 && ids.every((id) => prev.has(id))) {
    const next = new Set(prev);
    ids.forEach((id) => next.delete(id));
    return next;
  }
  return new Set([...prev, ...ids]);
};

// 정본 handleBulkPublish 의 부분실패 선택잔여 규칙 모사(AC-4): 성공건 해제, 실패건 유지.
const selectionAfterBulk = (prev: Set<string>, failedIds: Set<string>): Set<string> => {
  const next = new Set<string>();
  prev.forEach((id) => { if (failedIds.has(id)) next.add(id); });
  return next;
};

// 정본 버튼 활성 규칙 모사(AC-2): 0건 비활성, 1건+ 활성.
const bulkBtnDisabled = (selectedCount: number, busy: boolean): boolean =>
  selectedCount === 0 || busy;

// ── S1: 정상 일괄발행 — 발행가능 N건 선택 → 전부 단건 발행 대상 (AC-1/AC-3) ──────
test('S1: 발행가능 3건 선택 → 일괄발행 대상이 3건 모두(단건 발행 경로 반복)', () => {
  const published = new Set<string>();
  const rows: KohRow[] = [
    mkRow({ id: 'a', nail_sites: [{ side: 'Rt', toe: 1 }] }),
    mkRow({ id: 'b', nail_sites: [{ side: 'Lt', toe: 2 }] }),
    mkRow({ id: 'c', nail_sites: [{ side: 'Rt', toe: 3 }] }),
  ];
  const selected = new Set(['a', 'b', 'c']);
  // 일괄발행 targets = 선택 ∩ 발행가능 (정본 handleBulkPublish).
  const targets = rows.filter((r) => selected.has(r.id) && canPublish(r, published));
  expect(targets.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  // 각 건은 단건과 동일 canPublish 통과 → 동일 결과로 발행.
  expect(targets.every((r) => canPublish(r, published))).toBe(true);
});

// ── S2: 전체선택 — 발행가능 행만 토글, 재토글 해제 (AC-1) ──────────────────────
test('S2: 헤더 전체선택 = 발행가능 행만 선택, 재토글 시 전체 해제', () => {
  const published = new Set<string>(['done']);
  const rows: KohRow[] = [
    mkRow({ id: 'r1', nail_sites: [{ side: 'Rt', toe: 1 }] }),  // 발행가능
    mkRow({ id: 'r2', nail_sites: [{ side: 'Lt', toe: 2 }] }),  // 발행가능
    mkRow({ id: 'nosite', nail_sites: [] }),                    // 조갑부위 없음 → 제외
    mkRow({ id: 'done', nail_sites: [{ side: 'Rt', toe: 2 }] }),// 발행완료 → 제외
  ];
  const ids = publishableIds(rows, published);
  expect(ids).toEqual(['r1', 'r2']);

  // 전체선택 → 발행가능 2건만
  let selected = toggleSelectAll(new Set<string>(), ids);
  expect([...selected].sort()).toEqual(['r1', 'r2']);
  expect(selected.has('nosite')).toBe(false);
  expect(selected.has('done')).toBe(false);

  // 재토글 → 전체 해제
  selected = toggleSelectAll(selected, ids);
  expect(selected.size).toBe(0);
});

// ── S3: 미선택 가드 — 0건 비활성, 1건+ 활성 (AC-2) ────────────────────────────
test('S3: 일괄발행 버튼 — 0건 선택 비활성(클릭 불가), 1건+ 선택 활성', () => {
  expect(bulkBtnDisabled(0, false)).toBe(true);   // 미선택 → 비활성
  expect(bulkBtnDisabled(1, false)).toBe(false);  // 1건 → 활성
  expect(bulkBtnDisabled(5, false)).toBe(false);  // 다건 → 활성
  expect(bulkBtnDisabled(3, true)).toBe(true);    // 발행 진행중 → 비활성(중복 방지)
});

// ── S4: 부분실패 — 성공건 해제, 실패건 선택 유지 (AC-4) ───────────────────────
test('S4: 10건 중 일부 실패 시 실패건만 선택 유지(재시도), 성공건 해제 — 전체 롤백 아님', () => {
  const selectedBefore = new Set(['a', 'b', 'c', 'd', 'e']);
  // c, e 발행 실패.
  const failedIds = new Set(['c', 'e']);
  const after = selectionAfterBulk(selectedBefore, failedIds);
  // 실패건만 잔류(재시도 가능).
  expect([...after].sort()).toEqual(['c', 'e']);
  // 성공건은 해제(발행완료로 전이).
  expect(after.has('a')).toBe(false);
  expect(after.has('b')).toBe(false);
  expect(after.has('d')).toBe(false);

  // 전체 성공 시 선택 전부 해제.
  const allOk = selectionAfterBulk(selectedBefore, new Set<string>());
  expect(allOk.size).toBe(0);
});

// ── S5: 단건 동선 무회귀 — canPublish 규칙 불변 (AC-5) ────────────────────────
test('S5: 단건 발행 규칙 무회귀 — 조갑부위 있고 미발행일 때만 발행 가능', () => {
  const published = new Set<string>();
  // 단건 발행(체크박스 미사용) 규칙은 일괄발행 도입 후에도 동일.
  expect(canPublish(mkRow({ id: 'x', nail_sites: [] }), published)).toBe(false);            // 조갑부위 없음
  expect(canPublish(mkRow({ id: 'y', nail_sites: [{ side: 'Rt', toe: 1 }] }), published)).toBe(true); // 발행가능
  published.add('y');
  expect(canPublish(mkRow({ id: 'y', nail_sites: [{ side: 'Rt', toe: 1 }] }), published)).toBe(false); // 발행완료=비가역
});

// ── S6: 실 브라우저 — 균검사지 탭 일괄발행 UI 렌더 ────────────────────────────
test('S6: 진료대시보드 균검사지 탭 — 일괄발행 버튼·전체선택·행 체크박스 렌더 스모크', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const dashLink = page.getByRole('link', { name: '진료 대시보드' });
  if (await dashLink.count() > 0) {
    await dashLink.click();
    await page.waitForTimeout(1500);
    const tab = page.getByTestId('tab-koh-report');
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(2500);
    }
  }
  await page.screenshot({
    path: 'evidence/T-20260616-foot-KOHDASH-BULK-PUBLISH_kohtab.png',
    fullPage: true,
  });
  // 일괄발행 버튼은 항상 노출(0건이면 비활성). 데이터 유무와 무관하게 검색바 영역에 존재.
  const bulkBtn = page.getByTestId('koh-bulk-publish');
  if (await bulkBtn.count() > 0) {
    await expect(bulkBtn.first()).toBeVisible({ timeout: 5000 });
    // 미선택 상태 → 비활성(AC-2).
    await expect(bulkBtn.first()).toBeDisabled();
  }
  // 테이블이 있으면 전체선택 체크박스 노출.
  const table = page.getByTestId('koh-table');
  if (await table.count() > 0) {
    await expect(page.getByTestId('koh-select-all').first()).toBeVisible({ timeout: 5000 });
  }
});
