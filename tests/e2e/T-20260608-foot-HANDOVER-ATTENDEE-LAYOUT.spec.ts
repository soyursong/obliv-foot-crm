/**
 * T-20260608-foot-HANDOVER-ATTENDEE-LAYOUT
 * [직원 근무 캘린더](/admin/handover) 출근자 명단 UI 배치 개선 — A안 + B안 (둘 다)
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH) — "상단 단독 나열이 불편" → "둘 다 할랭"(A+B 확정).
 * 선행 deployed T-20260606-…-TODAY-ATTENDEES 의 상단 배너 풀 명단을 supersede:
 *   - A안: 캘린더 날짜 셀 안에 그날 출근자 이름 표시(월/주뷰, 상위 N명 + "+M" 오버플로).
 *   - B안: 날짜 클릭 → "선택 날짜 인수인계 목록" 하단에 그날 출근자 명단(빈 날 "출근자 없음").
 *   - 상단 배너는 슬림 카운트(N명)만 유지(풀 중복 나열 제거).
 *
 * 데이터 소스: 기존 Edge Function `duty-sheet-read` → gviz CSV → 블록 파서(lib/dutySheet).
 *   gid당 CSV 1회 fetch 후 날짜별 맵(fetchAttendeesByDate). 결정적 테스트 위해 route mock.
 *
 * E2E 원칙(planner 지시): 셀/하단섹션의 DOM 존재·레이아웃 무붕괴 중심. 특정 직원명
 *   하드코딩 의존 최소화(주입한 mock 이름만 검증).
 *
 * 커버:
 *   A1. 월뷰 — 오늘 셀에 출근자 이름 + 오버플로 "+M" (AC-A1/A3)
 *   A2. 주뷰 — 동일 맵 재사용, 오늘 셀에 출근자 표시 (AC-A2)
 *   B1. 선택일(기본=오늘) 하단 명단에 출근자 칩 (AC-B1)
 *   B2. 데이터 없는 날 클릭 → "출근자 없음" 빈 상태 (AC-B3)
 *   C1. 인수인계 CRUD 진입·뷰 전환·개수 배지 무회귀 (AC-C1)
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');
const DUTY_FN_GLOB = '**/functions/v1/duty-sheet-read*';

/** KST 기준 오늘의 (year, month, day) — 앱의 todaySeoulISODate 와 정합 */
function kstYmd(): { y: number; m: number; d: number } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth() + 1, d: kst.getUTCDate() };
}

/**
 * 오늘 열(col index 1)에 todayNames 를 채운 최소 블록 캘린더 CSV(gviz 따옴표 포맷).
 * 날짜 행은 오늘(d)을 첫 칼럼에 두고 d+1..d+3 을 채워 isDateRow(>=3) 충족 + 월 롤오버 회피
 * (오름차순). 오늘이 월말이면 d-3..d-1 이 아니라 d 를 충분히 작은 값으로 가정하기 어려우므로
 * 본 스펙은 오늘 col 만 사용(다른 날 클릭은 "데이터 없는 날"로 검증).
 */
function buildTodayCsv(todayNames: string[]): string {
  const { m, d } = kstYmd();
  // 오름차순 유지 → 롤오버 트리거 회피. 월말이면 작은 day 들을 today 뒤가 아닌 앞에 못 두므로
  // today 단일 칼럼만 의미를 갖게 하고 나머지는 빈 칼럼.
  const dateRow = [d, d + 1 > 28 ? d : d + 1, d + 2 > 28 ? d : d + 2, d + 3 > 28 ? d : d + 3];
  const q = (arr: (string | number)[]) => arr.map((c) => `"${c}"`).join(',');
  const lines: string[] = [];
  lines.push(q(['', '2026', `${m}월`, '', '', '']));
  lines.push(q(['', '월', '화', '수', '목', '금']));
  lines.push(q(['', ...dateRow, '']));
  for (const name of todayNames) {
    lines.push(q(['', name, '', '', '']));
  }
  return lines.join('\n');
}

async function mockDutySheet(page: Page, names: string[]) {
  await page.route(DUTY_FN_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, gid: '341864863', csv: buildTodayCsv(names) }),
    });
  });
}

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({
    timeout: 15_000,
  });
}

/** 오늘이 아닌, 현재 월 안의 "데이터 없는" 날짜 ISO (B2 빈 상태 클릭용) */
function emptyDayInMonth(): string {
  const { y, m, d } = kstYmd();
  const target = d === 15 ? 10 : 15; // 오늘과 겹치지 않는 현재 월 내 임의일
  return `${y}-${String(m).padStart(2, '0')}-${String(target).padStart(2, '0')}`;
}

test.describe('T-20260608-foot-HANDOVER-ATTENDEE-LAYOUT 출근자 셀(A)+선택일 하단(B)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── A1. 월뷰 셀 내 출근자 + 오버플로 (AC-A1/A3) ─────────────────────────────
  test('A1 월뷰 오늘 셀에 출근자 이름 표시 + 상위 3명 + "+M" 오버플로', async ({ page }) => {
    const names = ['김주연', '김수린', '엄경은', '박민지', '이서연']; // 5명 → 월뷰 max 3
    await mockDutySheet(page, names);
    await gotoHandover(page);

    // 월뷰 기본
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');

    const cell = page.getByTestId(`handover-cell-attendees-${TODAY}`);
    await expect(cell).toBeVisible({ timeout: 10_000 });
    // 상위 3명 노출 + "+2" 오버플로 (레이아웃 무붕괴)
    await expect(cell.getByText('김주연')).toBeVisible();
    await expect(cell.getByText('+2')).toBeVisible();
    console.log('[LAYOUT] A1 월뷰 셀 출근자 + 오버플로 OK');
  });

  // ── A2. 주뷰 셀에도 동일 맵 재사용 (AC-A2) ──────────────────────────────────
  test('A2 주뷰 전환 후 오늘 셀에 출근자 표시', async ({ page }) => {
    await mockDutySheet(page, ['김주연', '엄경은']);
    await gotoHandover(page);

    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');

    const cell = page.getByTestId(`handover-cell-attendees-${TODAY}`);
    await expect(cell).toBeVisible({ timeout: 10_000 });
    await expect(cell.getByText('김주연')).toBeVisible();
    console.log('[LAYOUT] A2 주뷰 셀 출근자 OK');
  });

  // ── B1. 선택일(기본=오늘) 하단 명단 칩 (AC-B1) ──────────────────────────────
  test('B1 선택일 하단 명단에 출근자 칩 노출 + 카운트 정합', async ({ page }) => {
    const names = ['김주연', '김수린', '엄경은'];
    await mockDutySheet(page, names);
    await gotoHandover(page);

    const section = page.getByTestId('handover-selected-attendees');
    await expect(section).toBeVisible({ timeout: 10_000 });

    const chips = section.getByTestId('handover-selected-attendee-chip');
    await expect(chips).toHaveCount(names.length, { timeout: 10_000 });

    const countEl = page.getByTestId('handover-selected-attendees-count');
    await expect(countEl).toHaveText(`${names.length}명`);
    for (const nm of names) {
      await expect(chips.filter({ hasText: nm })).toHaveCount(1);
    }
    console.log('[LAYOUT] B1 선택일 하단 명단 정합 OK');
  });

  // ── B2. 데이터 없는 날 클릭 → "출근자 없음" (AC-B3) ─────────────────────────
  test('B2 데이터 없는 날 클릭 → 빈 상태 문구', async ({ page }) => {
    await mockDutySheet(page, ['김주연']); // 오늘만 데이터, 다른 날은 없음
    await gotoHandover(page);

    const emptyIso = emptyDayInMonth();
    await page.getByTestId(`handover-day-${emptyIso}`).click();

    const section = page.getByTestId('handover-selected-attendees');
    await expect(section.getByTestId('handover-selected-attendees-empty')).toBeVisible({
      timeout: 10_000,
    });
    await expect(section.getByText('출근자 없음')).toBeVisible();
    await expect(section.getByTestId('handover-selected-attendee-chip')).toHaveCount(0);
    console.log('[LAYOUT] B2 빈 날 출근자 없음 OK');
  });

  // ── C1. 무회귀: 뷰 전환·개수 배지·작성 진입 (AC-C1) ────────────────────────
  test('C1 인수인계 뷰 전환·작성 다이얼로그 무회귀', async ({ page }) => {
    await mockDutySheet(page, ['김주연']);
    await gotoHandover(page);

    // 상단 슬림 카운트 유지
    await expect(page.getByTestId('handover-attendees-count')).toHaveText(/^\d+명$/, {
      timeout: 10_000,
    });

    // 월↔주↔일 뷰 전환
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-day').click();
    await expect(page.getByTestId('handover-view-day')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');

    // 작성 다이얼로그 진입
    await page.getByTestId(`handover-day-${TODAY}`).click();
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });
    console.log('[LAYOUT] C1 무회귀 OK');
  });
});
