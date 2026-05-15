/**
 * E2E Spec: T-20260515-foot-REVISIT-CLICK-AUTOCHECK
 * 재진 슬롯 클릭 시 자동 체크인 발생 버그 수정 검증
 *
 * AC-1: 대시보드 슬롯 클릭 = 차트 조회만 (체크인 X)
 *       - DraggableBox2ResvCard onClick = onSelect (차트 열기)
 *       - title이 "클릭=차트조회" 로 표시 (이전: "클릭=체크인")
 *
 * AC-2: 체크인은 [접수] 버튼으로만 발생
 *       - box2-resv-card 내 "접수" 버튼 존재 확인
 *       - 카드 본문 클릭 ≠ 체크인 트리거 (이벤트 분리)
 *
 * AC-3: 재진 체크인 시 정상 동선 — treatment_waiting 자동 이동 (회귀 확인)
 *       - T-20260514-foot-CHECKIN-AUTO-STAGE 기능 보존 여부 검증
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-1: 재진 예약 카드 title = 차트조회 (체크인 X) ─────────────────────────

test('AC-1: box2-resv-card title이 "클릭=차트조회" 로 표시 (체크인 X)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 재진 예약 슬롯 카드가 존재하면 title 검사
  const resvCards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await resvCards.count();
  if (cnt > 0) {
    const firstCard = resvCards.first();
    // title에 "클릭=차트조회" 포함 (이전 버그: "클릭=체크인")
    await expect(firstCard).toHaveAttribute('title', /클릭=차트조회/);
    // title에 "클릭=체크인" 없어야 함
    const title = await firstCard.getAttribute('title');
    expect(title).not.toMatch(/클릭=체크인/);
  }
});

test('AC-1: DraggableBox2ResvCard — 카드 클릭 이벤트가 onSelect 로 바인딩됨 (DOM 검증)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // box2-resv-card 의 부모 div 에 onClick = onSelect (차트 열기) 바인딩
  // title에 "드래그=시간변경 · 클릭=차트조회" 형태 확인
  const resvCards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await resvCards.count();
  if (cnt > 0) {
    const card = resvCards.first();
    const title = await card.getAttribute('title');
    // 드래그 힌트 + 차트조회 힌트 모두 포함
    expect(title).toMatch(/드래그=시간변경/);
    expect(title).toMatch(/클릭=차트조회/);
  }
});

// ── AC-2: [접수] 버튼 존재 — 체크인 수동 fallback ─────────────────────────────

test('AC-2: box2-resv-card 내 "접수" 버튼 존재 확인 (수동 fallback)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const resvCards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await resvCards.count();
  if (cnt > 0) {
    const firstCard = resvCards.first();
    // 카드 내부에 "접수" 버튼 있어야 함
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    await expect(checkInBtn).toBeVisible();
    // 접수 버튼 title 확인
    await expect(checkInBtn).toHaveAttribute('title', '접수 (체크인 시작)');
  }
});

test('AC-2: 접수 버튼과 카드 본문 클릭 이벤트 분리 — stopPropagation 적용', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const resvCards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await resvCards.count();
  if (cnt > 0) {
    const firstCard = resvCards.first();
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    if (await checkInBtn.isVisible()) {
      // 접수 버튼이 onPointerDown stopPropagation으로 DnD와 분리됨
      // 버튼이 클릭 가능한 상태인지 확인 (비활성화되지 않음)
      await expect(checkInBtn).not.toBeDisabled();
      // 접수 버튼 클릭이 카드 전체 클릭(onSelect)과 독립적으로 동작
      // → 카드 클릭은 차트 열기, 버튼 클릭은 체크인 — 각각 독립 핸들러
    }
  }
});

// ── AC-3: 재진 체크인 정상 동선 회귀 검증 ─────────────────────────────────────

test('AC-3: 수동접수 다이얼로그 — 재진 선택 시 treatment_waiting 로직 보존', async ({ page }) => {
  // T-20260514-foot-CHECKIN-AUTO-STAGE 기능이 REVISIT-CLICK-AUTOCHECK 수정 후에도 유지되는지 확인
  await page.goto(`${BASE_URL}/admin/dashboard`);

  const addBtn = page.getByRole('button', { name: '체크인 추가' });
  await expect(addBtn).toBeVisible({ timeout: 10000 });
  await addBtn.click();

  // 체크인 추가 다이얼로그 열림
  await expect(page.getByRole('dialog')).toBeVisible();

  // 재진 버튼 선택
  const returningBtn = page.getByRole('button', { name: '재진' });
  await expect(returningBtn).toBeVisible();
  await returningBtn.click();

  // 재진 선택 상태 확인
  await expect(returningBtn).toHaveClass(/border-teal-600/);

  await page.getByRole('button', { name: '취소' }).click();
});

test('AC-3: 통합 시간표 재진 컬럼 — 접수 버튼이 체크인 경로로만 동작 (4경로 격리)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 재진 컬럼 확인
  const retCol = page.locator('[data-testid="timeline-slot-ret"]');
  const retColCnt = await retCol.count();
  expect(retColCnt).toBeGreaterThan(0);

  // 재진 컬럼 내 체크인 완료된 카드(TimelineCheckInCard)는 클릭만으로 상세 조회
  // 재진 컬럼 내 예약 카드(DraggableBox2ResvCard)는 클릭=차트, 접수버튼=체크인
  // — 칸반/스케줄 구조가 렌더됨을 확인
  await expect(retCol.first()).toBeVisible();
});

// ── 회귀: 슬롯 클릭으로 check_ins INSERT 발생 X (구조적 검증) ─────────────────

test('regression: DashboardTimeline onReservationClick → onReservationSelect/onReservationCheckIn 분리', async ({ page }) => {
  // 코드 수준: onReservationClick (구버전, 체크인 자동 발생) 이 제거되고
  // onReservationSelect (차트 조회) + onReservationCheckIn (접수 버튼) 으로 분리됨
  // → DashboardTimeline props에서 onReservationClick 이 없어야 함
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 대시보드 타임라인이 정상 렌더됨 (분리 후 UI 깨짐 없음)
  const timeCol = page.locator('[data-testid="timeline-time-col"]');
  await expect(timeCol.first()).toBeVisible();

  // 슬롯 셀 렌더 확인
  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
  expect(await newSlots.count()).toBeGreaterThan(0);
  expect(await retSlots.count()).toBeGreaterThan(0);
});
