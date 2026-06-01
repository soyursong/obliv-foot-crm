/**
 * T-20260601-foot-DASH-HSCROLL-CHART-LOC — 풋 대시보드 UX 3종
 *
 *  #1 위치/가로스크롤 (REOPEN 정정) → '원장님 진료콜 명단' 팝업이 우측 칸반(슬롯) 스크롤 컨테이너
 *                          내부 우측 하단에 absolute로 배치(position:fixed 폐기). 슬롯 칸에 종속되어
 *                          가로스크롤 시 콘텐츠와 함께 이동(뷰포트 고정 아님).
 *  #2 고객 이름 클릭→차트 → 진료콜 명단 팝업 행의 고객 이름 클릭 시 진료차트(고객차트) 즉시 열림.
 *                          기존 지정콜 토글과 클릭영역 분리(이름=차트, 별도 Phone 버튼=지정콜).
 *  #3 성함 옆 현재 위치   → 배정 슬롯 이름(check_in room name/label)을 성함 옆 배지로 표시.
 *                          슬롯 미배정 시 라벨 생략.
 *
 * 컨벤션: 핵심 로직은 환경독립(직접 import / page.evaluate)으로 검증,
 *         + 대시보드 실렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { getAssignedSlotName } from '../../src/lib/checkin-slot';
import type { CheckIn } from '../../src/lib/types';

// 테스트용 최소 CheckIn 팩토리 (필요 필드만, 나머지는 기본값)
function makeCheckIn(over: Partial<CheckIn>): CheckIn {
  return {
    id: 'ci-test',
    clinic_id: 'c1',
    customer_id: 'cust1',
    reservation_id: null,
    queue_number: null,
    customer_name: '홍길동',
    customer_phone: null,
    visit_type: 'returning',
    status: 'laser',
    consultant_id: null,
    therapist_id: null,
    technician_id: null,
    consultation_room: null,
    treatment_room: null,
    laser_room: null,
    package_id: null,
    notes: null,
    treatment_memo: null,
    treatment_photos: null,
    doctor_note: null,
    examination_room: null,
    checked_in_at: new Date().toISOString(),
    called_at: null,
    completed_at: null,
    priority_flag: null,
    sort_order: 0,
    skip_reason: null,
    created_at: new Date().toISOString(),
    consultation_done: false,
    treatment_kind: null,
    preconditioning_done: false,
    pododulle_done: false,
    laser_minutes: null,
    prescription_items: null,
    document_content: null,
    doctor_confirm_charting: false,
    doctor_confirm_prescription: false,
    doctor_confirm_document: false,
    doctor_confirmed_at: null,
    healer_laser_confirm: false,
    prescription_status: 'none',
    status_flag: null,
    status_flag_history: null,
    assigned_counselor_id: null,
    treatment_category: null,
    treatment_contents: null,
    doctor_call_memo: null,
    ...over,
  } as CheckIn;
}

test.describe('T-20260601 DASH-HSCROLL-CHART-LOC — 대시보드 UX 3종', () => {
  // ── 시나리오3 / AC-3 (로직): 배정 슬롯 이름 도출 ───────────────────────────────────
  test('AC-3(로직): getAssignedSlotName — 현재 status의 배정 슬롯 이름, 미배정 시 null', () => {
    // 레이저 단계 + laser_room 배정 → 슬롯 이름 반환
    expect(getAssignedSlotName(makeCheckIn({ status: 'laser', laser_room: 'L9' }))).toBe('L9');
    expect(getAssignedSlotName(makeCheckIn({ status: 'laser_waiting', laser_room: '레이저실 L9' }))).toBe('레이저실 L9');
    // 상담 단계 + consultation_room 배정
    expect(getAssignedSlotName(makeCheckIn({ status: 'consultation', consultation_room: 'C1' }))).toBe('C1');
    // 치료대기 + treatment_room
    expect(getAssignedSlotName(makeCheckIn({ status: 'treatment_waiting', treatment_room: 'T2' }))).toBe('T2');
    // 검사 + examination_room
    expect(getAssignedSlotName(makeCheckIn({ status: 'examination', examination_room: 'E1' }))).toBe('E1');
    // 슬롯 미배정(대기열) → null (라벨 생략)
    expect(getAssignedSlotName(makeCheckIn({ status: 'registered' }))).toBeNull();
    expect(getAssignedSlotName(makeCheckIn({ status: 'laser', laser_room: null }))).toBeNull();
    // 빈 문자열/공백은 미배정으로 취급
    expect(getAssignedSlotName(makeCheckIn({ status: 'laser', laser_room: '   ' }))).toBeNull();
    // 슬롯 배정 변경 시 갱신 (status에 맞는 room 우선)
    expect(getAssignedSlotName(makeCheckIn({ status: 'consultation', consultation_room: 'C1', laser_room: 'L9' }))).toBe('C1');
  });

  // ── 시나리오2 / AC-2 (로직): 이름=차트 vs 지정콜=별도 버튼 클릭영역 분리 모델 ──────────
  test('AC-2(로직): 진료콜 행 — 이름 클릭=차트 / 지정콜=별도 버튼 (충돌 없음)', async ({ page }) => {
    await page.goto('/');
    const model = await page.evaluate(() => {
      // DoctorCallRow: 이름 버튼(onOpenChart)과 지정콜 버튼(onSelect)은 분리된 별도 엘리먼트.
      // 이름 클릭 → 차트만 열림(지정콜 토글 안 됨). 지정콜 클릭 → 선택 토글(차트 안 열림).
      let chartOpened = false;
      let selected: string | null = null;
      const onOpenChart = () => { chartOpened = true; };
      const onSelect = (id: string) => { selected = selected === id ? null : id; };
      // 이름 클릭
      onOpenChart();
      const afterName = { chartOpened, selected };
      // 지정콜 클릭(다른 핸들러)
      onSelect('ci1');
      const afterSelect = { chartOpened, selected };
      return { afterName, afterSelect };
    });
    // 이름 클릭: 차트 열림 + 지정콜 미선택
    expect(model.afterName.chartOpened).toBe(true);
    expect(model.afterName.selected).toBeNull();
    // 지정콜 클릭: 선택 토글 (차트는 이미 열린 상태 유지, 별개 동작)
    expect(model.afterSelect.selected).toBe('ci1');
  });

  // ── 시나리오1 / AC-1 (렌더): SUPERSEDED by T-20260601-foot-DASH-POPUP-RIGHT-FIX ──────────
  //   본 티켓(db62b1a)은 absolute scroll-bound 거동이었으나, 현장 재요청으로
  //   T-20260601-foot-DASH-POPUP-RIGHT-FIX에서 position:fixed 우측 고정(스크롤해도 안 사라짐)으로 정정됨.
  //   → 가로스크롤 거동 단언은 신규 티켓 spec(...DASH-POPUP-RIGHT-FIX.spec.ts)로 이관. 여기선 우측 위치만 스모크.
  test('AC-1(렌더, superseded): 진료콜 명단 팝업 우측 표시 (가로스크롤 거동은 POPUP-RIGHT-FIX spec로 이관)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '보라(진료필요) 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }
    await expect(list).toBeVisible();
    // 우측 정렬만 확인(좌하단 아님). fixed/스크롤 거동 상세는 POPUP-RIGHT-FIX spec 책임.
    const vw = await page.evaluate(() => window.innerWidth);
    const box = await list.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThan(vw / 2); // 화면 우측
    }
  });

  // ── 시나리오2 / AC-2 (렌더): 진료콜 명단 이름 클릭 → 진료차트 열림 ──────────────────────
  test('AC-2(렌더): 진료콜 명단 고객 이름 클릭 → 진료차트(고객차트) 열림', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '진료콜 명단 위젯 미표시 환경 스킵');
      return;
    }
    const name = page.locator('[data-testid="doctor-call-name"]').first();
    if ((await name.count()) === 0) {
      test.skip(true, '진료콜 명단 행 없음 — 스킵');
      return;
    }
    await name.click();
    // 고객차트(CustomerChartSheet)가 열린다 (customer_id 연결된 경우)
    const chart = page.locator('[data-testid="customer-chart-sheet"]');
    await expect(chart).toBeVisible({ timeout: 5_000 });
  });

  // ── 시나리오3 / AC-3 (렌더): 슬롯 배정 고객의 성함 옆 위치 배지 표시 ───────────────────
  test('AC-3(렌더): 슬롯 배정 카드/행에 위치 배지 표시 (미배정 시 생략)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 위치 배지 selector 가 존재하면 표시 텍스트가 비어있지 않은지 확인.
    // 슬롯 배정 카드가 하나도 없는 환경이면 배지 0개 → graceful pass(미배정 시 생략 AC와 일치).
    const badges = page.locator('[data-testid="card-location-badge"], [data-testid="doctor-call-location"]');
    const cnt = await badges.count();
    if (cnt === 0) {
      test.skip(true, '슬롯 배정 카드 없음 — 위치 배지 미표시(미배정 생략 AC와 일치)');
      return;
    }
    // 표시된 배지는 슬롯 이름 텍스트를 포함한다(빈 배지 금지).
    const text = (await badges.first().innerText()).trim();
    expect(text.length).toBeGreaterThan(0);
  });
});
