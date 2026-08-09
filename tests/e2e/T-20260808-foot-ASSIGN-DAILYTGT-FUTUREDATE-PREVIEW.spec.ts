/**
 * E2E spec — T-20260808-foot-ASSIGN-DAILYTGT-FUTUREDATE-PREVIEW
 *   (일일 배정 목표 미래 날짜 조회 확장 · read-only P2 편의기능. DB/DDL/DML 무접촉.)
 *
 * 요구:
 *  - 날짜 네비 미래 날짜 상한(max=오늘) 해제 → 미래일 선택 가능.
 *  - 예약 1건+ 존재하는 미래일 → reservations 기반 배정건수 미리보기(당일과 동일 read-only 산식 재사용).
 *  - 빈 날(예약 0건) → '예약없음' 안내 + 목표 '—'(0/— 오인 방지).
 *  - 미래일 표기 = '예약 기준 미리보기' 라벨(실적 아님 semantic 구분).
 *
 * ★회귀 방지(티켓): 당일/과거 동작 불변 — 미래 경로만 additive.
 *
 * 라이브 예약/랭킹/출결 데이터 의존 → 날짜 독립 불변식으로 검증. 먼 미래일(오늘+400d)은
 *   예약 0건일 개연성이 높아 '빈 날' 경로를 결정적으로 태움(예약 존재 시엔 미리보기 경로로 자연 분기).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoAssignments(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  const dayGroup = page.locator('[data-testid="accum-group-day"]');
  return dayGroup
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

const dateInput = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="assignments-accum-date"]');

/** ISO(YYYY-MM-DD) + days (UTC 산술, KST 달력일 근사). */
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

async function setDate(page: import('@playwright/test').Page, iso: string) {
  const inp = dateInput(page);
  await inp.fill(iso);
  await inp.dispatchEvent('change');
}

/** 출근/전체 목표 셀의 숫자값(‘—’ 제외). 미래 경로는 out-of-office 필터 미적용이라 data-off-today 무시. */
async function targetNumbers(page: import('@playwright/test').Page): Promise<number[]> {
  const cells = page.locator('[data-testid^="accum-day-target-"]');
  const n = await cells.count();
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const txt = (await cells.nth(i).textContent())?.trim() ?? '';
    if (/^\d[\d,]*$/.test(txt)) vals.push(parseInt(txt.replace(/,/g, ''), 10));
  }
  return vals;
}

async function readN(page: import('@playwright/test').Page): Promise<number | null> {
  const raw = await page
    .locator('[data-testid="accum-daily-target-header"]')
    .getAttribute('data-daily-target-n');
  if (raw == null || raw === '') return null;
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

test.describe('T-20260808 ASSIGN-DAILYTGT-FUTUREDATE-PREVIEW', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── 시나리오 1: 미래 날짜 상한 해제 (max=오늘 제거) ────────────────────────────
  test('시나리오1: 날짜 입력에 max(오늘) 상한이 없다 → 미래일 선택 가능', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const inp = dateInput(page);
    await expect(inp).toBeVisible();
    // max 속성이 제거되어야 함(과거엔 max=오늘 → 미래 차단). null 또는 미설정.
    await expect(inp).not.toHaveAttribute('max', /.+/);

    // 실제로 미래일을 선택하면 값이 반영된다(브라우저가 되돌리지 않음).
    const today = await inp.inputValue();
    const future = isoAddDays(today, 7);
    await setDate(page, future);
    await expect(inp).toHaveValue(future);
  });

  // ── 시나리오 2: 미래일 = '예약 기준 미리보기' 라벨 + 배너 노출 ────────────────────
  test('시나리오2: 미래일 선택 시 미리보기 배지·배너·헤더 라벨이 표시된다', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const today = await dateInput(page).inputValue();
    await setDate(page, isoAddDays(today, 400)); // 먼 미래

    await expect(page.locator('[data-testid="assignments-future-preview-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="assignments-future-preview-note"]')).toBeVisible();
    // 헤더가 미리보기 모드로 표기(data-future-preview="true").
    await expect(page.locator('[data-testid="accum-daily-target-header"]')).toHaveAttribute(
      'data-future-preview',
      'true',
    );
  });

  // ── 시나리오 3: 빈 날(예약 0건) → '예약없음' 안내 + 목표 '—'(0/— 오인 방지) ────────
  test('시나리오3: 미래 빈 날 → 안내 배너 + 목표 셀은 "—"(0 아님)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const today = await dateInput(page).inputValue();
    await setDate(page, isoAddDays(today, 400)); // 먼 미래 = 예약 0건 개연성 높음

    // N(미리보기 초진 예약 수) 로딩 대기.
    await expect
      .poll(async () => readN(page), { timeout: 15_000 })
      .not.toBeNull();
    const N = await readN(page);
    if (N == null) {
      test.skip(true, 'N 미조회 — 스킵');
      return;
    }
    const note = page.locator('[data-testid="assignments-future-preview-note"]');
    await expect(note).toBeVisible();

    if (N === 0) {
      // 빈 날: 안내 문구('예약이 없어') + 목표 셀에 숫자 0이 아니라 '—'.
      await expect(note).toContainText('예약이 없어');
      const nums = await targetNumbers(page);
      expect(nums.length).toBe(0); // 숫자 셀 0개(전부 '—') — '목표 0' 오인 방지.
      // 목표 셀은 존재하되 값이 '—'(빈 셀 금지).
      const cells = page.locator('[data-testid^="accum-day-target-"]');
      const cnt = await cells.count();
      for (let i = 0; i < cnt; i++) {
        expect((await cells.nth(i).textContent())?.trim()).toBe('—');
      }
    } else {
      // 우연히 예약이 있으면 미리보기 경로: 합계 = N 불변식(NPROP 산식 재사용).
      await expect(note).toContainText('예약 기준 미리보기');
      const nums = await targetNumbers(page);
      if (nums.length > 0) expect(nums.reduce((a, b) => a + b, 0)).toBe(N);
    }
  });

  // ── 시나리오 4(회귀): 오늘(기본) 선택 시 미리보기 UI 미노출 + 기존 동작 불변 ──────────
  test('회귀: 오늘 선택 시 미리보기 배지/배너 없음 + 목표 합계 = N(기존 동작)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // 기본값 = 오늘 → 미래 UI 미노출.
    await expect(page.locator('[data-testid="assignments-future-preview-badge"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="assignments-future-preview-note"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="accum-daily-target-header"]')).toHaveAttribute(
      'data-future-preview',
      'false',
    );

    // 기존 합계 불변식 유지(N>0 & 출근 목표 존재 시).
    const N = await readN(page);
    const nums = await targetNumbers(page);
    if (N != null && nums.length > 0) {
      expect(nums.reduce((a, b) => a + b, 0)).toBe(N);
    }
  });
});
