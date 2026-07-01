/**
 * T-20260630-foot-RESVMGMT-GRID-CLICKCREATE-7ADJ
 * 풋 예약관리 세부조정 7건 (FE-only, DB 무변경). reporter: 김주연 총괄(풋센터).
 *
 * 구현 요약:
 *  ① 상단 배너 컴팩트화: 페이지 여백 p-6→px-4 py-2, 헤더 mb-4→mb-2, 일간/주간 토글 min-h 44→34, 좌측 컨트롤 h-9→h-8.
 *  ② 우측 상단 [+새 예약] 버튼 제거 → 신규예약은 격자 빈 칸 클릭으로만 진입.
 *  ③ ★슬롯 카드(가로 컬럼) → 대시보드 통합시간표식 엑셀 격자(시간 행 × 초진/재진 열, grid-cols-[64px_1fr_1fr]).
 *     빈 칸 클릭 → openNewSlot(신규예약 모달). CUSTCTX-PREFILL initialCustomer 경유 보존(§dependency 가드).
 *  ④ 시간 라벨 중앙정렬 + 폰트 1.5배(10px→15px).
 *  ⑤ 고객박스 간략메모(brief_note)를 고객 정보 상단 위에 표기(있을 때 박스 높이 자동 확장).
 *  ⑥ 취소건: '취소됨' 텍스트·이름 취소선 제거 → 회색+음각(shadow-inner). 취소건 hover 툴팁 미노출(plain-span 분기).
 *  ⑦ 고객박스 1번 클릭 → 선택 → Ctrl+X/C/V(잘라내기/복사/붙여넣기) — 주간캘린더 키보드 핸들러 재사용.
 *
 * 데이터/로그인 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoReservations(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
}

async function enterDayView(page: import('@playwright/test').Page) {
  const dayToggle = page.getByRole('button', { name: '일간', exact: true });
  if ((await dayToggle.count()) > 0) {
    await dayToggle.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function dayGridReady(page: import('@playwright/test').Page): Promise<boolean> {
  const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
  return horizontal.isVisible({ timeout: 5000 }).catch(() => false);
}

// ② [+새 예약] 버튼 제거
test.describe('7ADJ ② 우측 상단 [+새 예약] 버튼 제거', () => {
  test('예약관리 상단에 "새 예약" 버튼이 노출되지 않는다', async ({ page }) => {
    await gotoReservations(page);
    const ready = await page.locator('[data-testid="resv-timetable-scroll"]').isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!ready, '예약관리 미렌더(로그인/clinic 미할당) — skip');

    // 상단 컨트롤 영역의 '새 예약' 버튼 부재. (셀 (+) 버튼과 혼동 방지: role=button name '새 예약')
    const newResvBtn = page.getByRole('button', { name: '새 예약', exact: true });
    expect(await newResvBtn.count()).toBe(0);
  });
});

// ③ 엑셀 격자 렌더 + 빈 칸 클릭 신규예약
// [SUPERSEDED by T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL] 총괄(김주연) 스크린샷 SSOT 지시로 격자 축을 전치:
//   시간 = 상단 가로 헤더(좌→우), 초진/재진 = 세로 좌측 행. grid-cols-[64px_1fr_1fr] 세로격자 + 칸 (+)버튼 폐기.
//   ③의 '엑셀 격자 + 빈칸 클릭 신규예약' 본질은 유지되나 축 방향·트리거(+제거)만 재정의 →
//   축·트리거 검증은 신 스펙 T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL.spec.ts 로 이관. 여기서는 skip.
test.describe.skip('7ADJ ③ 엑셀 격자(시간 행 × 초진/재진 열) + 칸클릭 신규예약 (SUPERSEDED TIMEAXIS-EXCELCELL)', () => {
  test('일간 뷰가 grid-cols-[64px_1fr_1fr] 엑셀 격자로 렌더 + 초진/재진 헤더', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const xaxis = page.locator('[data-testid="resv-day-xaxis"]');
    await expect(xaxis).toBeVisible();
    const xaxisCls = (await xaxis.getAttribute('class')) ?? '';
    expect(xaxisCls).toContain('grid-cols-[64px_1fr_1fr]');
    await expect(xaxis.getByText('초진', { exact: true })).toBeVisible();
    await expect(xaxis.getByText('재진', { exact: true })).toBeVisible();

    const rows = page.locator('[data-testid^="resv-day-col-"]:not([data-testid*="cards"])');
    expect(await rows.count()).toBeGreaterThan(0);
    const rowCls = (await rows.first().getAttribute('class')) ?? '';
    expect(rowCls).toContain('grid-cols-[64px_1fr_1fr]');
    expect(rowCls).not.toContain('w-[90px]');

    expect(await page.locator('[data-testid^="resv-day-cell-new-"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid^="resv-day-col-cards-"]').count()).toBeGreaterThan(0);
  });

  test('빈 초진 칸 클릭 → 신규예약 모달 오픈(openNewSlot 경유)', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const plus = page.locator('[data-testid^="resv-day-slot-plus-"]').first();
    test.skip((await plus.count()) === 0, '빈 슬롯 없음(전 슬롯 예약 존재) — skip');
    await plus.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.first()).toBeVisible({ timeout: 4000 });
  });
});

// ④ 시간 라벨 중앙정렬 + 폰트 1.5배
test.describe('7ADJ ④ 시간 라벨 중앙정렬 + 폰트 1.5배(15px)', () => {
  test('resv-day-hslot 시간 라벨이 text-[15px] + 중앙정렬', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const hslot = page.locator('[data-testid^="resv-day-hslot-"]:not([data-testid*="count"])').first();
    expect(await hslot.count()).toBeGreaterThan(0);
    const cls = (await hslot.getAttribute('class')) ?? '';
    expect(cls).toContain('items-center'); // 중앙정렬
    expect(cls).toContain('text-center');
    // 시간 텍스트 span 폰트 1.5배
    const timeSpan = hslot.locator('span.text-\\[15px\\]').first();
    expect(await timeSpan.count()).toBeGreaterThan(0);
  });
});

// ⑥ 취소건 시각 처리
test.describe('7ADJ ⑥ 취소건 회색+음각 / 취소됨·취소선 제거', () => {
  test('취소 예약 카드에 "취소됨" 텍스트·취소선 없음 + shadow-inner(음각)', async ({ page }) => {
    await gotoReservations(page);
    const ready = await page.locator('[data-testid="resv-timetable-scroll"]').isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!ready, '예약관리 미렌더 — skip');

    // 페이지 전체에서 '취소됨' 텍스트 배지가 렌더되지 않음(정상·취소 무관, 배지 제거).
    const cancelBadge = page.getByText('취소됨', { exact: true });
    expect(await cancelBadge.count()).toBe(0);

    // 취소 카드가 있으면 line-through 클래스 없음 + shadow-inner 포함.
    const cards = page.locator('[data-testid^="resv-card-"]');
    const cnt = await cards.count();
    for (let i = 0; i < Math.min(cnt, 30); i++) {
      const cls = (await cards.nth(i).getAttribute('class')) ?? '';
      if (cls.includes('shadow-inner')) {
        expect(cls).not.toContain('line-through');
        expect(cls).toContain('bg-gray-200');
      }
    }
  });
});

// ⑦ 클립보드 잘라내기/복사/붙여넣기 (일간 격자에서도 동작)
test.describe('7ADJ ⑦ 고객박스 클릭 선택 → Ctrl+C 클립보드 힌트', () => {
  test('일간 격자 카드 클릭 → Ctrl+C → 클립보드 힌트 바 노출', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    test.skip((await card.count()) === 0, '예약 카드 없음 — skip');
    await card.click();
    await page.waitForTimeout(350); // 선택 상태 반영
    await page.keyboard.press('Control+c');
    const hint = page.getByTestId('clipboard-hint');
    await expect(hint).toBeVisible({ timeout: 3000 });
  });
});
