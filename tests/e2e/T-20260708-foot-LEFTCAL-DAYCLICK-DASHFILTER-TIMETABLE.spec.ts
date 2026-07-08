/**
 * T-20260708-foot-LEFTCAL-DAYCLICK-DASHFILTER-TIMETABLE
 *
 * GAP (field, 김주연 총괄): 풋 대시보드 좌측 공통 캘린더(CalendarNoticePanel 사이드 패널)에서
 *   특정 일자 클릭 시 대시보드 전체(날짜의존 위젯/현황판) + 통합시간표 예약 명단이
 *   선택 날짜 기준으로 필터링돼야 하는데, 통합시간표/위젯이 금일 기준에 머무른다.
 *
 * ROOT CAUSE (dev-foot): 좌측 캘린더 day-click은 기존 selectedDate 전파 소스
 *   (DASHCAL-DAYCLICK, 6/29 배포)로 `navigate('/admin?date=YYYY-MM-DD')`를 이미 갱신했지만,
 *   Dashboard의 `date` 상태(통합시간표 + 모든 dateStr 조회 구동)가 그 `?date=` 파라미터를
 *   구독하지 않아(구 comment "?date= 소비처 없음") 반영되지 않았다.
 *
 * FIX: 신규 상태 분기 없이, 그 단일 소스(?date=)를 Dashboard `date`에 배선(useSearchParams).
 *   `date`는 이미 DATENAV(T-20260707) tornDown Realtime 가드 채널에 바인딩돼 있어,
 *   date만 동기화하면 stale fullResync 없이 선택 날짜로 재조회된다.
 *   effect 의존성은 `dateParam`만 → 상단 ◀/▶(setDate만, ?date= 미변경)로 이동한 뒤에도
 *   stale param으로 되돌아가지 않는다(AC-4 무회귀).
 *
 * 검증 전략(데이터 비의존·결정론적): Supabase REST 요청의 대상 날짜 필터
 *   (reservation_date / checked_in_at)를 가로채 "선택 날짜로만 재조회 + 오늘로의 stale
 *   재조회 0"을 단언. 좌측 공통 캘린더 진입점은 cal-day-YYYY-MM-DD 셀 클릭으로 구동.
 */
import { test, expect, type Page } from '@playwright/test';

const KST = 'Asia/Seoul';

/** 테스트 실행 시각 기준 KST 날짜(±offset) → YYYY-MM-DD. 러너 로컬TZ 무관. */
function seoulYMD(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** KST 기준 '다음 달 15일'(항상 오늘보다 미래 + 그리드에 표시 가능) → YYYY-MM-DD. */
function seoulNextMonth15(): string {
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit',
  }).format(new Date()); // "YYYY-MM"
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-15`;
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

/** 좌측 공통 캘린더에서 특정 일자 셀 클릭. 대상 월이 안 보이면 월-다음(cal-month-next)으로 전진. */
async function clickLeftCalDate(page: Page, ymd: string) {
  const cell = page.getByTestId(`cal-day-${ymd}`);
  for (let i = 0; i < 3 && (await cell.count()) === 0; i++) {
    await page.getByTestId('cal-month-next').click();
    await page.waitForTimeout(300);
  }
  await cell.first().click();
}

// ── 시나리오 1 (AC-1 + AC-2): 좌측 캘린더로 다른 날짜(내일) 클릭 → 통합시간표 예약 명단 +
//    대시보드 날짜의존 위젯이 선택 날짜로 재조회. 오늘 stale 재조회 0. 예약관리로 전환 안 됨. ──
test('AC-1/AC-2 좌측 공통 캘린더 내일 클릭 → 통합시간표+위젯이 선택 날짜로 재조회 (오늘 stale 0, 예약관리 미전환)', async ({ page }) => {
  const today = seoulYMD(0);
  const tomorrow = seoulYMD(1);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  // 클릭 전 캡처 초기화
  cap.resv.length = 0;
  cap.chkin.length = 0;

  await clickLeftCalDate(page, tomorrow);
  await page.waitForTimeout(3000);

  // 화면이 예약관리로 넘어가지 않음(AC-3 정책 유지) — /admin 유지
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  expect(page.url()).not.toContain('/reservations');

  // 상단 날짜가 비-오늘로 동기화됨(글로벌 date 반영 → 모든 날짜의존 위젯 필터 근거) = "오늘로" 노출
  await expect(page.getByTestId('dash-date-today')).toBeVisible();

  // 통합시간표(예약 명단 + 체크인)가 내일 날짜로 재조회
  expect(cap.resv, `reservations 재조회 대상=${JSON.stringify(cap.resv)}`).toContain(tomorrow);
  expect(cap.chkin, `check_ins 재조회 대상=${JSON.stringify(cap.chkin)}`).toContain(tomorrow);
  // 오늘로의 stale 재조회가 없어야 함(금일 명단 잔류/덮어쓰기 방지, DATENAV tornDown 가드 재사용)
  expect(cap.resv, `RC: 오늘(${today}) stale reservations 재조회 잔존`).not.toContain(today);
  expect(cap.chkin, `RC: 오늘(${today}) stale check_ins 재조회 잔존`).not.toContain(today);
});

// ── 시나리오 2 (AC-3): 금일 복귀 — 다른 날짜 상태에서 좌측 캘린더 '오늘' 클릭 → 금일 재조회 ──
test('AC-3 좌측 캘린더 오늘 클릭 시 금일로 복귀 재조회 + 예약관리 미전환', async ({ page }) => {
  const today = seoulYMD(0);
  const tomorrow = seoulYMD(1);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  await clickLeftCalDate(page, tomorrow);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('dash-date-today')).toBeVisible(); // 비-오늘 상태 확인

  cap.resv.length = 0;
  cap.chkin.length = 0;

  await clickLeftCalDate(page, today);
  await page.waitForTimeout(3000);

  // 금일 데이터로 복귀 재조회
  expect(cap.resv, `금일복귀 reservations 재조회=${JSON.stringify(cap.resv)}`).toContain(today);
  expect(cap.chkin, `금일복귀 check_ins 재조회=${JSON.stringify(cap.chkin)}`).toContain(today);
  // "오늘로" 버튼 사라짐(현재=오늘) + 예약관리로 넘어가지 않음
  await expect(page.getByTestId('dash-date-today')).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  expect(page.url()).not.toContain('/reservations');
});

// ── 시나리오 3 (엣지): 예약 없는 미래 날짜(다음 달 15일) 클릭 → 크래시 없이 선택 날짜로 재조회,
//    통합시간표가 금일 명단을 잔류시키지 않음. ──
test('AC-1(엣지) 예약 없는 미래 날짜 클릭 → 크래시 없이 선택 날짜로 재조회 (금일 잔류 없음)', async ({ page }) => {
  const today = seoulYMD(0);
  const future = seoulNextMonth15();
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  cap.resv.length = 0;
  cap.chkin.length = 0;

  await clickLeftCalDate(page, future);
  await page.waitForTimeout(3000);

  // 크래시/언마운트 없음 — 대시보드 + 통합시간표 컨테이너 유지
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  await expect(page.getByText('통합 시간표').first()).toBeVisible();
  // 선택 미래 날짜로 재조회, 오늘 stale 아님
  expect(cap.resv, `미래날짜 reservations 재조회=${JSON.stringify(cap.resv.slice(-4))}`).toContain(future);
  expect(cap.resv, `RC: 오늘(${today}) stale 잔존`).not.toContain(today);
});

// ── 시나리오 4 (AC-4 무회귀): 좌측 캘린더 선택 후 상단 ◀/▶(DATENAV) 정상 동작(stale param 되돌림 없음)
//    + 예약관리·인수인계 화면 무회귀. ──
test('AC-4 좌측 캘린더 선택 후 상단 ▶ 이동 정상(stale param 미복귀) + 예약관리·인수인계 무회귀', async ({ page }) => {
  const tomorrow = seoulYMD(1);
  const dayAfter = seoulYMD(2);
  const cap = attachDateCapture(page);

  await gotoDashboard(page);
  // 좌측 캘린더로 내일 선택(?date=내일 세팅)
  await clickLeftCalDate(page, tomorrow);
  await page.waitForTimeout(2000);

  cap.resv.length = 0;
  cap.chkin.length = 0;

  // 상단 ▶(다음 날) 이동 → date=모레. ?date= 파라미터는 여전히 내일(미변경)이지만
  //   effect 의존성이 dateParam뿐이라 재실행되지 않음 → 모레로 이동한 date가 내일로 되돌아가지 않아야 함.
  await page.getByTestId('dash-date-next').click();
  await page.waitForTimeout(3000);

  // 모레로 재조회됨(DATENAV 정상 동작)
  expect(cap.resv, `▶이동 reservations 재조회=${JSON.stringify(cap.resv)}`).toContain(dayAfter);
  // stale param(내일)으로의 되돌림 재조회가 뒤따르지 않음 — 마지막 재조회가 내일이 아님
  expect(cap.resv[cap.resv.length - 1], `RC: 마지막 재조회가 stale param(내일)으로 되돌아감`).not.toBe(tomorrow);

  // 예약관리·인수인계 무회귀(공유 selectedDate 전파 인프라 무손상)
  await page.goto('/admin/reservations');
  await expect(page).toHaveURL(/\/admin\/reservations/, { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error');

  await page.goto('/admin/handover');
  await expect(page).toHaveURL(/\/admin\/handover/, { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Application error');

  // 대시보드 재진입 정상 렌더
  await gotoDashboard(page);
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
});
