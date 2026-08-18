/**
 * T-20260818-foot-DASHBOARD-TIMETABLE-HOVER-MEMO-POPUP (P2, 김주연 총괄)
 *   대시보드 '통합시간표'에서도 고객 성함 hover 시 예약관리와 동일한 간략정보 팝업(툴팁)을 표시.
 *   필드 구성: 예약일시 · 차트번호+성함+방문경로 · 연락처 · 간략메모 · 예약메모.
 *
 * 구현: 예약관리(Reservations.tsx)가 쓰는 CustomerHoverCard(reservationInfo 변형)를 통합시간표 3카드
 *   (초진 예약 box1 / 재진 예약 box2 / 체크인 카드)의 성함 span 에 children 모드로 재사용.
 *   - CustomerHoverCard children 모드: display:contents 로 레이아웃 박스를 만들지 않아 호출부 성함 span
 *     (data-testid="timeline-name")의 testid/클래스를 원형 보존 → T-20260817 nowrap/notruncate 회귀 0.
 *   - 클릭/드래그/우클릭은 부모 카드가 처리(hover 카드에 onClick/onContextMenu 미전달).
 *   - db_change=false: 예약 native 필드(booking_memo/brief_note/registrar_name/visit_route/referral_source) read-only.
 *
 * 판정 기준(AC):
 *   1. 통합시간표 성함 span 3사이트가 CustomerHoverCard 로 감싸짐(reservationInfo 전달).
 *   2. CustomerHoverCard 가 children 트리거 모드(display:contents)를 지원 + reservationInfo 팝업 필드 유지.
 *   3. 회귀 가드: timeline-name span 3개(testid/nowrap/shrink-0) 원형 보존(T-20260817).
 *   4. buildResvHoverInfo 가 예약관리와 동일 필드로 구성(예약메모=booking_memo, 간략메모=brief_note).
 *   5. 런타임(데이터 있을 때): 성함 hover → customer-hover-card 팝업 출현 + 간략/예약메모 라벨. 빈 메모여도 팝업 정상.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const NAME_CELLS = [
  '[data-testid="box1-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="box2-resv-card"] [data-testid="timeline-name"]',
  '[data-testid="timeline-checkin-card"] [data-testid="timeline-name"]',
].join(', ');

// ─────────────────────────────────────────────────────────────────────────────
// S1 정적 — 통합시간표 3카드 성함이 CustomerHoverCard(reservationInfo)로 감싸짐
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 통합시간표 성함 hover 팝업 배선', () => {
  const dash = read('src/pages/Dashboard.tsx');

  test('S1-a: 초진 예약(box1) 성함 = CustomerHoverCard(reservationInfo=buildResvHoverInfo) 래핑', () => {
    // box1/box2 예약 카드는 자기 reservation 객체를 어댑터로 넘긴다.
    expect(dash).toMatch(
      /<CustomerHoverCard checkIn=\{resvToHoverCheckIn\(reservation\)\} reservationTime=\{reservation\.reservation_time\} reservationInfo=\{buildResvHoverInfo\(reservation\)\}>/,
    );
    // 초진 성함 span 이 그 안에 원형 보존
    expect(dash).toMatch(
      /reservationInfo=\{buildResvHoverInfo\(reservation\)\}>\s*<span className="shrink-0 whitespace-nowrap leading-tight text-gray-900 font-semibold" data-testid="timeline-name"/,
    );
  });

  test('S1-b: 재진 예약(box2) 성함 = CustomerHoverCard 래핑(성함 span 원형)', () => {
    expect(dash).toMatch(
      /reservationInfo=\{buildResvHoverInfo\(reservation\)\}>\s*<span className="shrink-0 whitespace-nowrap leading-tight text-gray-800" data-testid="timeline-name"/,
    );
  });

  test('S1-c: 체크인 카드 성함 = CustomerHoverCard(reservationInfo=사이드맵 조회) 래핑', () => {
    // 체크인 카드는 reservation_id 로 사이드맵 조회한 정보를 넘긴다.
    expect(dash).toMatch(
      /<CustomerHoverCard checkIn=\{checkIn\} reservationTime=\{timelineHoverResvTime\} reservationInfo=\{timelineHoverInfo\}>/,
    );
    expect(dash).toMatch(/timelineResvHoverMap\.get\(checkIn\.reservation_id\)/);
  });

  test('S1-d: reservationInfo 빌더가 예약관리와 동일 필드(예약메모=booking_memo, 간략메모=brief_note)', () => {
    expect(dash).toMatch(/function buildResvHoverInfo\(r: Reservation\): HoverReservationInfo/);
    expect(dash).toMatch(/registrarLabel: r\.registrar_name\?\.trim\(\) \|\| null/);
    expect(dash).toMatch(/reservationDate: r\.reservation_date/);
    expect(dash).toMatch(/visitRoute: r\.visit_route \?\? r\.referral_source \?\? null/);
    expect(dash).toMatch(/bookingMemo: r\.booking_memo \?\? null/);
    expect(dash).toMatch(/briefNote: r\.brief_note \?\? null/);
  });

  test('S1-e: 사이드맵 provider(ResvHoverInfoMapCtx) 정의·주입', () => {
    expect(dash).toMatch(/const ResvHoverInfoMapCtx = createContext<Map<string, HoverReservationInfo>>/);
    expect(dash).toMatch(/<ResvHoverInfoMapCtx\.Provider value=\{resvHoverInfoMap\}>/);
    expect(dash).toMatch(/const resvHoverInfoMap = useMemo/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 정적 — CustomerHoverCard children(트리거) 모드 지원
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 CustomerHoverCard children 트리거 모드', () => {
  const hover = read('src/components/CustomerHoverCard.tsx');

  test('S2-a: children prop + display:contents(레이아웃 박스 미생성)', () => {
    expect(hover).toMatch(/children\?: React\.ReactNode/);
    expect(hover).toMatch(/display: children \? 'contents'/);
    expect(hover).toMatch(/\{children \?\? \(/);
  });

  test('S2-b: reservationInfo 팝업 필드(간략메모·예약메모) 유지', () => {
    expect(hover).toMatch(/간략메모/);
    expect(hover).toMatch(/예약메모/);
    expect(hover).toMatch(/reservationInfo\.briefNote/);
    expect(hover).toMatch(/reservationInfo\.bookingMemo/);
  });

  test('S2-c: HoverReservationInfo export(대시보드 재사용)', () => {
    expect(hover).toMatch(/export interface HoverReservationInfo/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 회귀 가드 — T-20260817 성함 span 원형 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 T-20260817 성함 span 회귀 가드', () => {
  const dash = read('src/pages/Dashboard.tsx');

  test('S3-a: timeline-name span 정확히 3개 + shrink-0/nowrap 유지, 말줄임/축소 잔재 0', () => {
    const nameLines = dash.split('\n').filter((l) => l.includes('data-testid="timeline-name"'));
    expect(nameLines.length).toBe(3);
    for (const l of nameLines) {
      expect(l).not.toMatch(/text-ellipsis/);
      expect(l).not.toMatch(/overflow-hidden/);
      expect(l).not.toMatch(/\bmin-w-0\b/);
      expect(l).not.toMatch(/break-words/);
      expect(l).not.toMatch(/whitespace-normal/);
      expect(l).toMatch(/whitespace-nowrap/);
      expect(l).toMatch(/shrink-0/);
    }
  });

  test('S3-b: box1/box2/checkin 카드 식별 마커 불변', () => {
    expect(dash).toMatch(/data-testid="box1-resv-card"/);
    expect(dash).toMatch(/data-testid="box2-resv-card"/);
    expect(dash).toMatch(/data-testid="timeline-checkin-card"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 브라우저 런타임 — 로그인·데이터 있을 때만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 통합시간표 성함 hover 팝업 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1/2: 성함 hover → 간략정보 팝업 출현(빈 메모여도 정상)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const names = page.locator(NAME_CELLS);
    const count = await names.count();
    if (count === 0) {
      test.skip(true, '오늘 통합시간표 카드 없음 — hover 검증 스킵(데이터 의존)');
      return;
    }
    const target = names.first();
    await target.hover();
    // CustomerHoverCard 는 280ms 지연 후 표시
    const popup = page.locator('[data-testid="customer-hover-card"]');
    await expect(popup).toBeVisible({ timeout: 3000 });
    // 예약관리 동일 팝업 필드 — 예약메모 라벨은 값이 없어도 항상 렌더(빈값 '-'), 간략메모는 값 있을 때만.
    await expect(popup).toContainText('예약메모');
    console.log('[HOVER-MEMO-POPUP] 통합시간표 성함 hover → 간략정보 팝업 출현 OK');
  });
});
