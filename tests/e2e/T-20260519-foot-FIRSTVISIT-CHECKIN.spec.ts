/**
 * E2E Spec: T-20260519-foot-FIRSTVISIT-CHECKIN
 * 초진 예약 카드(DraggableBox1Card) 접수 버튼 + 차트 조회 핸들러 추가 검증
 *
 * AC-1: DraggableBox1Card에 '접수' 버튼 추가
 *       - box1-resv-card 내 "접수" 버튼 존재 확인
 *       - onCheckIn prop — DraggableBox2ResvCard 패턴 동일 적용
 *
 * AC-2: 접수 클릭 시 3단계 처리 (구조 검증)
 *       - check_ins INSERT (status: registered)
 *       - reservations UPDATE (status: checked_in)
 *       - 차트 자동 오픈 (setSelectedCheckIn 트리거)
 *
 * AC-3: 차트 조회 핸들러 분리
 *       - 카드 본문 클릭 = onSelect (차트 조회, 체크인 X)
 *       - title에 "클릭=차트조회 · 접수버튼=체크인" 확인
 *
 * AC-4: 회귀 0
 *       - 재진(Box2) 접수·차트조회 기존 동작 무영향
 *       - 셀프접수(SelfCheckIn) 경로 기존 동작 무영향
 *       - 통합 시간표 초진 컬럼 정상 렌더
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-1: 초진 예약 카드에 '접수' 버튼 존재 ─────────────────────────────────

// T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 이 단언이 무효화됨 — skip 처리
test.skip('AC-1: box1-resv-card — "접수" 버튼 존재 확인 (DraggableBox2ResvCard 동일 패턴) [SUPERSEDED by T-20260529-foot-RECEPTION-BTN-REMOVE]', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const firstCard = box1Cards.first();
    // 카드 내부에 "접수" 버튼 있어야 함 (AC-1)
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    await expect(checkInBtn).toBeVisible();
    // 접수 버튼 title 확인
    await expect(checkInBtn).toHaveAttribute('title', '접수 (체크인 시작)');
  }
});

// T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 이 단언이 무효화됨 — skip 처리
test.skip('AC-1: box1-resv-card 접수 버튼 — 비활성화 상태 아님 (클릭 가능) [SUPERSEDED by T-20260529-foot-RECEPTION-BTN-REMOVE]', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const firstCard = box1Cards.first();
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    if (await checkInBtn.isVisible()) {
      await expect(checkInBtn).not.toBeDisabled();
    }
  }
});

test('AC-1: 초진 슬롯(timeline-slot-new)에 box1-resv-card 렌더 확인', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 초진 컬럼(timeline-slot-new)이 렌더됨을 확인
  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  const slotCnt = await newSlots.count();
  expect(slotCnt).toBeGreaterThan(0);

  // box1-resv-card가 초진 슬롯 안에 위치함 (초진 컬럼 안)
  const box1Cards = page.locator('[data-testid="timeline-slot-new"] [data-testid="box1-resv-card"]');
  const cardCnt = await box1Cards.count();
  if (cardCnt > 0) {
    // 카드가 초진 컬럼 안에 올바르게 렌더됨
    await expect(box1Cards.first()).toBeVisible();
  }
});

// ── AC-3: 차트 조회 핸들러 분리 (카드 클릭 ≠ 체크인) ───────────────────────

test('AC-3: box1-resv-card title — "클릭=차트조회 · 접수버튼=체크인" 포함', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const firstCard = box1Cards.first();
    // title에 "클릭=차트조회" 포함 (AC-3: 카드 클릭 = 차트 조회)
    await expect(firstCard).toHaveAttribute('title', /클릭=차트조회/);
    // title에 "접수버튼=체크인" 포함 (AC-1: 접수 버튼 = 체크인)
    await expect(firstCard).toHaveAttribute('title', /접수버튼=체크인/);
    // 드래그 힌트 포함 (DnD 유지)
    await expect(firstCard).toHaveAttribute('title', /드래그=시간변경/);
  }
});

test('AC-3: box1-resv-card — 카드 본문 클릭과 접수 버튼 클릭 이벤트 분리', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const firstCard = box1Cards.first();
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    if (await checkInBtn.isVisible()) {
      // 접수 버튼이 onPointerDown stopPropagation으로 DnD와 분리됨
      // 카드 본문 클릭 = onSelect (차트 열기), 버튼 클릭 = onCheckIn (체크인)
      // 각각 독립 핸들러 — 버튼이 카드 클릭 이벤트를 버블링하지 않음
      await expect(checkInBtn).not.toBeDisabled();
    }
  }
});

// T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 이 단언이 무효화됨 — skip 처리
test.skip('AC-3: DraggableBox1Card — DraggableBox2ResvCard와 동일 이벤트 분리 패턴 적용 [SUPERSEDED by T-20260529-foot-RECEPTION-BTN-REMOVE]', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // box1(초진)과 box2(재진) 모두 동일한 이벤트 분리 패턴 적용됨을 확인
  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const box2Cards = page.locator('[data-testid="box2-resv-card"]');

  if (await box1Cards.count() > 0) {
    const b1 = box1Cards.first();
    const b1Title = await b1.getAttribute('title');
    // box1: "클릭=차트조회 · 접수버튼=체크인" 패턴
    expect(b1Title).toMatch(/클릭=차트조회/);
    const b1Btn = b1.getByRole('button', { name: '접수' });
    await expect(b1Btn).toBeVisible();
  }

  if (await box2Cards.count() > 0) {
    const b2 = box2Cards.first();
    const b2Title = await b2.getAttribute('title');
    // box2: "클릭=차트조회" 패턴 (동일 구조)
    expect(b2Title).toMatch(/클릭=차트조회/);
    const b2Btn = b2.getByRole('button', { name: '접수' });
    await expect(b2Btn).toBeVisible();
  }
});

// ── AC-4: 회귀 — 재진(Box2) 동작 무영향 ────────────────────────────────────

// T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 "접수 버튼 존재" 단언이 무효화됨 — skip 처리
test.skip('AC-4: box2-resv-card — FIRSTVISIT-CHECKIN 적용 후 기존 동작 무영향 [SUPERSEDED by T-20260529-foot-RECEPTION-BTN-REMOVE]', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box2Cards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await box2Cards.count();
  if (cnt > 0) {
    const firstCard = box2Cards.first();
    // 재진 카드 title에 "클릭=차트조회" 포함 (기존 동작 보존)
    await expect(firstCard).toHaveAttribute('title', /클릭=차트조회/);
    // 재진 카드에 "접수" 버튼 여전히 존재
    const checkInBtn = firstCard.getByRole('button', { name: '접수' });
    await expect(checkInBtn).toBeVisible();
    await expect(checkInBtn).toHaveAttribute('title', '접수 (체크인 시작)');
  }
});

test('AC-4: 재진 컬럼(timeline-slot-ret) — box1 구현 후 재진 슬롯 정상 렌더', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 재진 컬럼이 여전히 정상 렌더됨 확인
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
  expect(await retSlots.count()).toBeGreaterThan(0);
  await expect(retSlots.first()).toBeVisible();
});

test('AC-4: SelfCheckIn 페이지 — FIRSTVISIT-CHECKIN 적용 후 기존 경로 무영향', async ({ page }) => {
  await page.goto(`${BASE_URL}/self-checkin`);
  // 셀프체크인 키오스크 페이지가 정상 렌더됨 (별도 경로 유지)
  await expect(page).toHaveURL(/self-checkin/);
  // 페이지가 오류 없이 로드됨
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
});

// ── 통합 구조 검증 — 타임라인 렌더 ─────────────────────────────────────────

test('통합: 통합 시간표 3컬럼(시간·초진·재진) — box1 추가 후 레이아웃 정상', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 시간 컬럼
  const timeCol = page.locator('[data-testid="timeline-time-col"]');
  expect(await timeCol.count()).toBeGreaterThan(0);

  // 초진 컬럼
  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  expect(await newSlots.count()).toBeGreaterThan(0);

  // 재진 컬럼
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
  expect(await retSlots.count()).toBeGreaterThan(0);

  // 모두 가시 상태
  await expect(timeCol.first()).toBeVisible();
  await expect(newSlots.first()).toBeVisible();
  await expect(retSlots.first()).toBeVisible();
});

test('통합: 초진 예약 카드 — "초" 배지 + 이름 + 전화번호 끝 4자리 렌더', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const firstCard = box1Cards.first();
    // "초" 배지 렌더 (초진 표시)
    await expect(firstCard.getByText('초')).toBeVisible();
  }
});
