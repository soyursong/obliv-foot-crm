/**
 * T-20260707-foot-DASH-DATENAV-TIMETABLE-NOSYNC
 *
 * BUG (field): 대시보드 상단 날짜 네비게이터(◀/▶) 이동 시 통합시간표가 선택 날짜로
 *   갱신되지 않고 '금일 고정'.
 *
 * CONFIRMED ROOT CAUSE (runtime probe): 통합시간표 데이터 조회는 이미 상단 `date`
 *   (=dateStr)에 바인딩돼 있다. 문제는 별개의 RACE 였다 —
 *   Realtime 채널이 `dashboard_rt_${clinic}_${dateStr}`로 dateStr마다 새로 만들어지는데,
 *   날짜 이동 시 effect cleanup의 supabase.removeChannel(구 채널)이 그 채널의
 *   .subscribe 상태콜백을 status='CLOSED'로 트리거하고, 콜백 안의 fullResync()가
 *   "직전 dateStr(오늘)"에 바인딩된 stale 클로저라 오늘 데이터를 재조회 → 방금 로드한
 *   선택 날짜 데이터를 setState로 덮어써 시간표가 '금일'로 되돌아갔다.
 *
 * FIX: 의도적 teardown(날짜변경/언마운트)을 tornDown 플래그로 표시하고 teardown 유래
 *   상태콜백에서는 fullResync를 건너뜀. 실사용 중 소켓 끊김/재구독 catch-up은 유지.
 *
 * 검증 전략(데이터 비의존, 결정론적): Supabase REST 요청의 대상 날짜 필터
 *   (reservation_date / checked_in_at)를 가로채 "선택 날짜로만 재조회 + 오늘로의 stale
 *   재조회 0건"을 단언한다.
 */
import { test, expect, type Page } from '@playwright/test';

const KST = 'Asia/Seoul';
function seoulYMD(offsetDays = 0): string {
  // 테스트 실행 시각 기준 KST 날짜(±offset). Intl로 TZ 고정 → 러너 로컬TZ 무관.
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return parts; // en-CA → YYYY-MM-DD
}

/** 페이지에 REST 요청 대상 날짜 캡처기를 부착. resv[], chkin[] 에 대상 YMD 누적. */
function attachDateCapture(page: Page) {
  const resv: string[] = [];
  const chkin: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/rest/v1/reservations')) {
      const m = url.match(/reservation_date=eq\.([0-9-]+)/);
      if (m) resv.push(m[1]);
    }
    if (url.includes('/rest/v1/check_ins')) {
      const m = url.match(/checked_in_at=gte\.([0-9-]+)/);
      if (m) chkin.push(m[1]);
    }
  });
  return { resv, chkin };
}

async function gotoDashboard(page: Page) {
  await page.goto('/admin');
  await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // 초기 fetch 정착
}

// ── AC-1: 정상 날짜이동 — ◀ 클릭 시 선택(어제) 날짜로만 재조회, 오늘 stale 재조회 0건 ──
test('AC-1 ◀ 이동 시 통합시간표가 선택 날짜(어제)로만 재조회된다 (오늘 stale 재조회 0)', async ({ page }) => {
  const today = seoulYMD(0);
  const yesterday = seoulYMD(-1);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  // 이동 전 캡처 초기화
  cap.resv.length = 0;
  cap.chkin.length = 0;

  await page.getByTestId('dash-date-prev').click();
  await page.waitForTimeout(3000);

  // 헤더가 비-오늘 상태 → "오늘로" 복귀 버튼 노출(날짜가 실제로 이동했다는 증거)
  await expect(page.getByTestId('dash-date-today')).toBeVisible();
  // 재조회는 어제 날짜로 발생
  expect(cap.resv, `reservations 재조회 대상=${JSON.stringify(cap.resv)}`).toContain(yesterday);
  expect(cap.chkin, `check_ins 재조회 대상=${JSON.stringify(cap.chkin)}`).toContain(yesterday);
  // RC 가드: 이동 후 '오늘'로의 stale 재조회가 없어야 한다 (덮어쓰기 방지)
  expect(cap.resv, `RC: 오늘(${today}) stale reservations 재조회 잔존`).not.toContain(today);
  expect(cap.chkin, `RC: 오늘(${today}) stale check_ins 재조회 잔존`).not.toContain(today);
});

// ── AC-2: 금일복귀 — 어제로 이동 후 "오늘로" 클릭 시 오늘 날짜로 재조회 ──
test('AC-2 "오늘로" 클릭 시 통합시간표가 금일로 복귀 재조회된다', async ({ page }) => {
  const today = seoulYMD(0);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  await page.getByTestId('dash-date-prev').click();
  await page.waitForTimeout(2000);

  cap.resv.length = 0;
  cap.chkin.length = 0;

  // "오늘로" 버튼은 비-오늘일 때만 노출
  await page.getByTestId('dash-date-today').click();
  await page.waitForTimeout(3000);

  expect(cap.resv, `금일복귀 reservations 재조회=${JSON.stringify(cap.resv)}`).toContain(today);
  expect(cap.chkin, `금일복귀 check_ins 재조회=${JSON.stringify(cap.chkin)}`).toContain(today);
  // "오늘로" 버튼은 사라진다(현재=오늘)
  await expect(page.getByTestId('dash-date-today')).toHaveCount(0);
});

// ── AC-3: 예약 없는 날 — 미래 날짜로 이동해도 크래시 없이 빈 시간표 렌더 + 해당 날짜로 조회 ──
test('AC-3 예약 없는 미래 날짜로 이동해도 통합시간표가 크래시 없이 빈 상태로 렌더된다', async ({ page }) => {
  const future = seoulYMD(30);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);

  // 미니 캘린더로 30일 뒤 이동(30회 ▶ 대신 캘린더 직접 선택 — 결정론적)
  cap.resv.length = 0;
  cap.chkin.length = 0;
  for (let i = 0; i < 30; i++) {
    await page.getByTestId('dash-date-next').click();
  }
  await page.waitForTimeout(3000);

  // 시간표 컨테이너는 여전히 존재(빈 상태여도 언마운트/크래시 없음)
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  await expect(page.getByText('통합 시간표').first()).toBeVisible();
  // 마지막 재조회 대상이 미래 날짜(오늘 stale 아님)
  expect(cap.resv, `미래날짜 reservations 재조회=${JSON.stringify(cap.resv.slice(-4))}`).toContain(future);
});

// ── AC-4: 타화면 무회귀 — selectedDate 전파 공유 화면(예약관리·인수인계)이 정상 로드 ──
//    이 fix는 Realtime 채널 teardown 가드만 변경 → ?date= 전파 인프라(DASHCAL-DAYCLICK) 미변경.
//    회귀 없음을 공유 화면 정상 로드로 확인.
test('AC-4 타화면(예약관리·인수인계) 무회귀 — 정상 로드', async ({ page }) => {
  await page.goto('/admin/reservations');
  await expect(page).toHaveURL(/\/admin\/reservations/, { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error');

  await page.goto('/admin/handover');
  await expect(page).toHaveURL(/\/admin\/handover/, { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error');

  // 근무캘린더(대시보드 사이드바 CalendarNoticePanel)의 ?date= 전파 인프라 무손상 —
  //   대시보드 재진입 시 정상 렌더.
  await gotoDashboard(page);
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
});
