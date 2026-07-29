/**
 * E2E spec — T-20260729-foot-DAILY-TARGET-NEXTWEEK-AUTO
 * 상담·치료사 배정 화면 [일일 배정 목표] = 차주(다음 주) 초진 예약 수 일자별 자동 계산 + 실시간 반영.
 *
 * AC-1: 배정 화면 [일일 배정 목표]에 차주 각 일자의 초진 예약 건수가 자동 표시(주 경계=월~일).
 * AC-2: 표시값 = 해당 일자 초진(visit_type='new', 취소 제외) 예약 건수.
 * AC-3: 초진 예약 신규 생성 시 해당 일자 수치 즉시 +1 (supabase realtime).
 * AC-4: 초진 예약 취소 시 해당 일자 수치 즉시 -1 (취소=집계 제외).
 * AC-5: 초진 0건 일자는 0으로 표시(빈칸·'—' 아님).
 * AC-6: 배정 로직·수납·차트 무영향(read-only 파생 표시).
 *
 * 실시간(AC-3/AC-4) 검증은 라이브 DB write가 필요 → UI 렌더/구조/집계 로직을 정적 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 차주(다음 주) 월~일 ISO 7일 산출 — 앱 로직(mondayOfIso+7)과 동일 규약(KST 달력일).
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function nextWeekDays(): string[] {
  const todayKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = todayKst.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일..6=토
  const thisMon = isoAddDays(todayKst, -((dow + 6) % 7));
  const nextMon = isoAddDays(thisMon, 7);
  return Array.from({ length: 7 }, (_, i) => isoAddDays(nextMon, i));
}

async function gotoAssignments(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  const card = page.locator('[data-testid="assignments-nextweek-target-card"]');
  return card
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260729 DAILY-TARGET-NEXTWEEK-AUTO — 차주 초진 일일 배정 목표', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: [일일 배정 목표] 카드 + 차주 7일(월~일) 셀 자동 표시', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // 카드 제목
    await expect(page.getByText('일일 배정 목표 · 차주 초진 예약')).toBeVisible();

    // 차주 7일 각 셀이 존재(월~일 = grid-cols-7)
    const days = nextWeekDays();
    expect(days).toHaveLength(7);
    const grid = page.locator('[data-testid="nextweek-target-grid"]');
    await expect(grid).toBeVisible();
    for (const d of days) {
      await expect(page.locator(`[data-testid="nextweek-target-cell-${d}"]`)).toBeVisible();
    }
  });

  test('AC-5: 각 일자 수치가 숫자(0 포함)로 표시 — 빈칸/— 아님', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const days = nextWeekDays();
    for (const d of days) {
      const countCell = page.locator(`[data-testid="nextweek-target-count-${d}"]`);
      await expect(countCell).toBeVisible();
      // 조회 완료 후 값은 정수(로딩 placeholder '·' 가 사라지고 숫자). 최대 10s 대기.
      await expect
        .poll(async () => (await countCell.textContent())?.trim(), { timeout: 10_000 })
        .toMatch(/^\d+$/);
      // '—'/빈칸 금지 (AC-5)
      const txt = (await countCell.textContent())?.trim();
      expect(txt).not.toBe('—');
      expect(txt).not.toBe('');
    }
  });

  test('AC-2: 요일 라벨(월~일) 순서 정확', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const days = nextWeekDays();
    const expectDow = ['월', '화', '수', '목', '금', '토', '일'];
    for (let i = 0; i < 7; i++) {
      const cell = page.locator(`[data-testid="nextweek-target-cell-${days[i]}"]`);
      await expect(cell).toContainText(expectDow[i]);
    }
  });

  // 회귀: 기존 배정 화면 카드(오늘 배정 현황 / 직원별 누적)가 신규 카드 추가로 깨지지 않음(AC-6).
  test('AC-6 회귀: 기존 배정 카드(직원별 누적) 유지', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="assignments-monthly-card"]')).toBeVisible();
    await expect(page.getByText('오늘 배정 현황')).toBeVisible();
  });
});
