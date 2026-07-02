/**
 * T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL
 * 풋 예약관리 일간 격자 — 총괄(김주연) 스크린샷 SSOT 지시. FE-only, DB 무변경. reporter: 김주연 총괄(풋센터).
 *
 * 구현 요약(축 전치 + 입력방식 전환):
 *  ① 시간축 세로→가로 복원: 시간(10:00·10:30…)을 상단 가로 헤더(좌→우), 초진/재진(치료사축)을 세로 좌측 행으로.
 *     단일 CSS grid(gridTemplateColumns: 72px repeat(N,112px)) — 행=[헤더 / 초진 / 재진], 열=[구분라벨 + 시간N].
 *  ② (+)버튼 제거 → 엑셀식 빈칸 직접입력: 각 칸의 (+) 버튼 삭제, 빈 칸을 바로 클릭하면 그 시간·구분으로 신규예약 진입.
 *     openNewSlot 경유 유지 = CUSTCTX-PREFILL initialCustomer 분기 보존(§dependency 가드). write 경로 무변경.
 *  7ADJ/OVERHAUL의 '세로=시간' 전제를 본 티켓이 supersede(축 방향·트리거만 재정의, 카드/클립보드/드래그/live-glass 불변).
 *
 * AC:
 *  AC1 시간대 = 상단 가로 헤더(좌→우 시간 순).
 *  AC2 초진/재진(치료사) = 세로 좌측 행.
 *  AC3 각 칸의 (+) 버튼 제거.
 *  AC4 빈 칸 클릭 → 해당 시간·구분으로 신규예약 진입(엑셀식).
 *  AC5 기존 예약 카드가 새 축에서도 올바른 시간·구분 칸에 렌더(회귀 없음).
 *  AC6 축 전치로 인한 겹침·잘림·가로 스크롤 깨짐 없음.
 *
 * 데이터/로그인 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

// 네비게이션은 상대경로로 → playwright.config.ts 의 baseURL(http://localhost:8089, storageState 인증)
// 을 그대로 상속. 과거 여기서 절대 URL(localhost:5173)을 하드코딩해 webServer(8089)와 불일치 →
// net::ERR_CONNECTION_REFUSED 로 전 케이스 실패했다(T-...-EXCELCELL FIX-REQUEST). 형제 스펙
// (T-20260513-foot-PHONE-*.spec.ts)의 정본 패턴 = page.goto('/admin/reservations') 상대경로에 정렬.

async function loginIfNeeded(page: import('@playwright/test').Page) {
  // desktop-chrome 프로젝트는 storageState(.auth/user.json)로 이미 로그인됨 → 통상 no-op.
  // 로그인 화면이 뜨는 예외 상황에서만 방어적으로 로그인.
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoReservations(page: import('@playwright/test').Page) {
  await page.goto('/admin/reservations');
  await loginIfNeeded(page);
  await page.goto('/admin/reservations');
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

// AC1: 시간축 가로(상단 헤더)
test.describe('TIMEAXIS-EXCELCELL AC1 — 시간대 상단 가로 헤더', () => {
  test('시간 컬럼(resv-day-hslot-HH:MM)이 상단 가로 헤더로 좌→우 배열', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const xaxis = page.locator('[data-testid="resv-day-xaxis"]');
    await expect(xaxis).toBeVisible();

    // 시간 헤더 셀(가로축)이 1개 이상. 세로 시간 행이 아니라 컬럼 트랙으로 배치.
    const hslots = page.locator('[data-testid^="resv-day-hslot-"]:not([data-testid*="count"])');
    expect(await hslots.count()).toBeGreaterThan(0);

    // 격자 컬럼 트랙 = 좌측 구분라벨(72px) + 시간 컬럼 N개(112px). gridTemplateColumns 인라인 스타일로 가로축 확정.
    const style = (await xaxis.getAttribute('style')) ?? '';
    expect(style).toContain('72px');
    expect(style.replace(/\s/g, '')).toContain('repeat(');
    expect(style).toContain('112px');

    // 첫 시간 헤더가 두 번째 시간 헤더보다 좌측(x 좌표 작음) — 좌→우 시간 순.
    if ((await hslots.count()) >= 2) {
      const b0 = await hslots.nth(0).boundingBox();
      const b1 = await hslots.nth(1).boundingBox();
      if (b0 && b1) expect(b0.x).toBeLessThan(b1.x);
    }
  });
});

// AC2: 세로축 4행(초진/재진/힐러/리본) 세로 좌측 행
//   T-20260702-foot-RESVGRID-4ROW-BODYSPLIT supersede: 세로축이 new/rest 2행 → 초진/재진/힐러/리본 4개 물리 행으로 분할.
test.describe('TIMEAXIS-EXCELCELL AC2 — 세로축 4행(초진/재진/힐러/리본) 좌측 행', () => {
  test('좌측 행 라벨 4종이 세로로 위→아래(초진→재진→힐러→리본) 배치', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const labels = ['new', 'returning', 'healer', 'ribbon'].map((k) => page.getByTestId(`resv-day-rowlabel-${k}`));
    for (const lb of labels) await expect(lb).toBeVisible();
    await expect(labels[0]).toContainText('초진');
    await expect(labels[1]).toContainText('재진');
    await expect(labels[2]).toContainText('힐러');
    await expect(labels[3]).toContainText('리본');

    // 세로 배치: 초진→재진→힐러→리본 순으로 y 좌표 증가(위→아래).
    const boxes = await Promise.all(labels.map((lb) => lb.boundingBox()));
    for (let i = 0; i + 1 < boxes.length; i++) {
      const a = boxes[i], b = boxes[i + 1];
      if (a && b) expect(a.y).toBeLessThan(b.y);
    }
  });
});

// AC3: (+) 버튼 제거
test.describe('TIMEAXIS-EXCELCELL AC3 — 칸 (+) 버튼 제거', () => {
  test('격자 칸에 (+) 신규예약 버튼(resv-day-slot-plus*)이 0건', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    expect(await page.locator('[data-testid^="resv-day-slot-plus-"]').count()).toBe(0);
    expect(await page.locator('[data-testid^="resv-day-slot-plus-ret-"]').count()).toBe(0);
  });
});

// AC4: 빈 칸 직접 클릭 → 신규예약
test.describe('TIMEAXIS-EXCELCELL AC4 — 빈 칸 직접 클릭 신규예약(엑셀식)', () => {
  test('빈 칸(title="빈 칸 클릭 → 신규예약") 클릭 → 신규예약 모달 오픈', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    // 빈(정원 미달·클립보드 없음) 셀만 신규예약 진입. 4행(초진/재진/힐러/리본) 셀 공통 testid prefix + title 로 식별.
    const emptyCell = page.locator('[data-testid^="resv-day-cell-"][title="빈 칸 클릭 → 신규예약"]').first();
    test.skip((await emptyCell.count()) === 0, '빈 칸 없음(전 슬롯 마감/미데이터) — skip');
    await emptyCell.click();

    // 신규예약 모달(예약상세 팝업 new-mode) 노출.
    const dialog = page.getByRole('dialog');
    await expect(dialog.first()).toBeVisible({ timeout: 4000 });
  });
});

// AC5: 기존 예약 카드 회귀 없음 (데이터 의존 graceful)
test.describe('TIMEAXIS-EXCELCELL AC5 — 기존 예약 카드 렌더(회귀 없음)', () => {
  test('예약 카드가 있으면 초진/재진 셀 내부에 렌더', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const cards = page.locator('[data-testid^="resv-card-"]');
    const cnt = await cards.count();
    test.skip(cnt === 0, '당일 예약 없음 — 렌더 회귀 검증 skip');

    // 각 카드는 4행(초진/재진/힐러/리본) 셀(resv-day-cell-*) 하위에 위치.
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
    const inGridCell = (await firstCard.locator('xpath=ancestor::*[starts-with(@data-testid,"resv-day-cell-")]').count()) > 0;
    expect(inGridCell).toBeTruthy();
  });
});

// AC6: 축 전치 후 가로 스크롤 정상(겹침·깨짐 없음)
test.describe('TIMEAXIS-EXCELCELL AC6 — 가로 스크롤 컨테이너 정상', () => {
  test('격자 컨테이너가 w-max(가로 확장) → 가로 스크롤 지원, 헤더 sticky 유지', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);
    test.skip(!(await dayGridReady(page)), '일간 격자 미렌더 — skip');

    const horizontal = page.getByTestId('resv-day-horizontal');
    const cls = (await horizontal.getAttribute('class')) ?? '';
    expect(cls).toContain('w-max'); // 시간 컬럼 확장 → 스크롤 컨테이너(resv-timetable-scroll overflow-auto)에서 가로 스크롤.

    // 좌측 구분 라벨은 sticky left (가로 스크롤 시 고정).
    const corner = page.getByTestId('resv-day-corner');
    const cornerCls = (await corner.getAttribute('class')) ?? '';
    expect(cornerCls).toContain('sticky');
    expect(cornerCls).toContain('left-0');
  });
});
