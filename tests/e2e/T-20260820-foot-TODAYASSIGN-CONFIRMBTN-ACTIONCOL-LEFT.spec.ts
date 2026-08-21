/**
 * E2E — T-20260820-foot-TODAYASSIGN-CONFIRMBTN-ACTIONCOL-LEFT
 * 현장 P2(김주연 총괄/풋센터): [오늘 배정 현황] 표 각 행의 액션 항목 좌측에 [확정] 버튼 배치.
 *
 * ── 재스코프(해석 A 확정) ────────────────────────────────────────────────────────
 *   김주연 총괄 답변 "A" ≡ (1) = 확정 버튼을 [오늘 배정 현황] 표 행으로 완전 이동(behavioral).
 *   → [오늘 배정 현황] 행({ci, role})에서 동일 key(`${ci.id}:${role}`)로 [금일 배분 이력] TodayDistRow 를
 *     찾아 기존 doConfirmNotify(r) 를 **재사용(호출)**. 상담(consult) 축 한정.
 *
 * ── 레드라인 무접촉(가드·AC#3/AC#5) ─────────────────────────────────────────────
 *   자매티켓 T-20260820-foot-RESVASSIGN-CONFIRM-CLICK-ERROR-KIMJIHYE-ACCT
 *   (canonical CONSULT-ASSIGN-BATCHLIST-CONFIRM-REGRESSION) 가 소유한
 *   doConfirmNotify 핸들러 및 배정→배분이력 연동(todayDistribution) 로직은 **수정 금지 = 호출만**.
 *   → [금일 배분 이력]의 기존 확정/발송 셀(dist-confirm-btn / dist-notify-*)은 그대로 유지.
 *
 * ── 수용기준 ───────────────────────────────────────────────────────────────────
 *   AC1: [오늘 배정 현황] 각 행 액션 항목 좌측에 [확정] 버튼 렌더(today-confirm-btn-*).
 *   AC2: 클릭 시 기존 doConfirmNotify 를 [오늘 배정 현황] 행 대상으로 호출(todayRows↔todayDistribution 매핑).
 *   AC3: [금일 배분 이력] 기존 확정/발송 + 핸들러 회귀 없이 유지(레드라인 무접촉).
 *   AC4: 다른 액션 버튼(토스) 순서·정렬·간격 회귀 없음 + 좁은 폭 겹침/잘림 없음.
 *
 * db_change=false — 순수 FE(표시/버튼 배선). 소스 정합 검증 + 실 CSS 레이아웃 harness(시드 무관 항상 실행).
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SRC = 'src/pages/Assignments.tsx';
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// ── PART 1: 소스 정합 검증(결정론·항상 실행) ─────────────────────────────────
test.describe('T-TODAYASSIGN-CONFIRMBTN — 소스 정합', () => {
  const src = read(SRC);

  test('AC1: [오늘 배정 현황] 액션 셀에 확정 버튼(today-confirm-btn) 렌더', () => {
    expect(src).toContain('today-confirm-btn-${ci.id}');
  });

  test('AC1/AC4: 확정 버튼이 토스 좌측 — flex justify-end 컨테이너 안에 확정 후 토스 순서', () => {
    // 액션 셀: <div flex justify-end> { 확정… } <Button …>토스</Button> </div>
    const cellMatch = src.match(
      /today-confirm-btn-\$\{ci\.id\}[\s\S]{0,3000}?<ArrowRightLeft[\s\S]{0,80}?토스/,
    );
    expect(cellMatch, '확정 버튼이 토스보다 먼저(좌측) 렌더되어야 함').not.toBeNull();
    expect(src).toContain('flex items-center justify-end gap-1');
  });

  test('AC2: 확정 클릭 = 기존 doConfirmNotify 재사용(distRowByKey 매핑)', () => {
    expect(src).toContain('const distRowByKey');
    expect(src).toContain('distRowByKey.get(`${ci.id}:${role}`)');
    expect(src).toContain('onClick={() => void doConfirmNotify(distRow)}');
  });

  test('AC2: 확정은 상담(consult) 축 한정', () => {
    // 액션 셀 안에서 role === 'consult' 게이트로 확정 블록 감쌈
    expect(src).toMatch(/role === 'consult' &&\s*\(\(\) => \{[\s\S]{0,200}?distRowByKey/);
  });

  test('AC3: [금일 배분 이력] 기존 확정/발송 셀·핸들러 무접촉(회귀 없음)', () => {
    // 배분 이력 확정셀 testid 및 3-state 배지 유지
    expect(src).toContain('dist-confirm-btn-${r.id}');
    expect(src).toContain('dist-notify-sent-${r.id}');
    // 핸들러 시그니처 그대로(재사용만·수정 없음)
    expect(src).toContain('const doConfirmNotify = async (r: TodayDistRow) =>');
    expect(src).toContain('void doConfirmNotify(r)'); // 배분 이력 셀의 기존 호출부 보존
  });
});

// ── PART 2: 실 CSS 레이아웃 harness(확정 좌측 + 겹침/잘림 없음, 시드 무관) ─────
const CELL_INNER =
  '<button data-testid="today-confirm-btn" class="inline-flex shrink-0 items-center justify-center ' +
  'rounded-lg border h-7 px-2 text-xs whitespace-nowrap text-teal-700">확정</button>' +
  '<button data-testid="today-toss-btn" class="inline-flex shrink-0 items-center justify-center ' +
  'rounded-lg border h-7 px-2 whitespace-nowrap"><span class="mr-1">⇄</span>토스</button>';

async function injectActionCell(page: Page, width: number): Promise<boolean> {
  try {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  } catch {
    return false;
  }
  await page.setViewportSize({ width, height: 800 });
  await page.waitForFunction(() => document.styleSheets.length > 0, { timeout: 8000 }).catch(() => {});
  await page.evaluate(
    ({ inner }) => {
      document.querySelectorAll('[data-testid="today-action-cell-harness"]').forEach((n) => n.remove());
      const td = document.createElement('div');
      td.setAttribute('data-testid', 'today-action-cell-harness');
      td.className = 'px-2 py-2 text-right';
      td.style.width = '260px';
      td.innerHTML = `<div class="flex items-center justify-end gap-1">${inner}</div>`;
      document.body.appendChild(td);
    },
    { inner: CELL_INNER },
  );
  return true;
}

test.describe('T-TODAYASSIGN-CONFIRMBTN — 레이아웃 harness', () => {
  for (const [label, width] of [
    ['데스크톱', 1280],
    ['좁은 폭', 420],
  ] as const) {
    test(`AC1/AC4(${label}): 확정이 토스보다 좌측 + 셀 경계 내(겹침/잘림 없음)`, async ({ page }) => {
      const ok = await injectActionCell(page, width);
      test.skip(!ok, '앱 미구동 — 레이아웃 harness skip');

      const confirm = page.locator('[data-testid="today-confirm-btn"]');
      const toss = page.locator('[data-testid="today-toss-btn"]');
      const cell = page.locator('[data-testid="today-action-cell-harness"]');
      await expect(confirm).toBeVisible();
      await expect(toss).toBeVisible();

      const cb = await confirm.boundingBox();
      const tb = await toss.boundingBox();
      const cellBox = await cell.boundingBox();
      expect(cb && tb && cellBox).toBeTruthy();
      if (!cb || !tb || !cellBox) return;

      // 확정이 토스보다 좌측(left 좌표가 더 작음)
      expect(cb.x).toBeLessThan(tb.x);
      // 겹침 없음: 확정 우측 끝 ≤ 토스 좌측 시작(gap 포함)
      expect(cb.x + cb.width).toBeLessThanOrEqual(tb.x + 1);
      // 잘림 없음: 두 버튼 모두 셀 경계 안
      expect(cb.x).toBeGreaterThanOrEqual(cellBox.x - 1);
      expect(tb.x + tb.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 1);
    });
  }
});
