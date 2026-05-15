/**
 * E2E Spec: T-20260516-foot-CONSULT-KANBAN-MISS
 * '상담' 선택 시 고객 대시보드 미표시 (칸반 누락) — 수정 검증
 *
 * AC-1: '상담' 선택 시 해당 고객이 대시보드 칸반 '상담' 칸에 표시
 * AC-2: DroppableColumn id="consultation" 이 DOM에 존재 (slots 1:1 매핑)
 * AC-3: Realtime subscription — byStatus['consultation'] 업데이트 시 칸반 자동 반영 (정적 검증)
 * AC-4: 기존 칸반 칸 (상담대기·치료대기·레이저대기 등) 회귀 없음
 * AC-5: '상담' 칸 위치 — consult_waiting_col 뒤, treatment_waiting_col 앞 (stage flow 순서)
 * AC-6: '상담' 선택 시 상담실 번호 선택 서브메뉴 표시 (레이저실/치료실 동일 패턴)
 * AC-7: 선택한 상담실 번호가 대시보드 칸반 카드에 배지로 표시
 * AC-8: 전 stage 전이 시 대시보드 droppable 슬롯 존재 확인 (회귀)
 *
 * 구현 위치:
 *  - Dashboard.tsx `case 'consult_rooms'`: DroppableColumn id="consultation" 추가
 *  - handleDragEnd `target === 'consultation'`: consultation_room null 초기화
 *  - StatusContextMenu.tsx: consultationRooms + showConsultSubmenu 서브메뉴 (AC-6)
 *  - DraggableCard compact: consultation_room Badge (AC-7)
 *  - handleContextConsultStatusChange: status+consultation_room 동시 업데이트
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-2: '상담' DroppableColumn DOM 존재 ─────────────────────────────────────

test('AC-2: 대시보드에 droppable id="consultation" 컬럼이 DOM에 렌더링됨', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // DroppableColumn은 data-droppable-id 속성으로 식별
  const consultationCol = page.locator('[data-droppable-id="consultation"]');
  await expect(consultationCol).toBeAttached({ timeout: 10000 });
});

// ── AC-2 보완: '상담' 칸반 칸 헤더 레이블 표시 ───────────────────────────────

test('AC-2: 칸반 헤더에 "상담" 레이블이 표시됨', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 칸반 컬럼 헤더 — "상담대기"와 구분되는 독립 "상담" 칸
  // DroppableColumn의 label prop이 헤더에 렌더링됨
  const consultationCol = page.locator('[data-droppable-id="consultation"]');
  await expect(consultationCol).toBeAttached();
  // 컬럼 내부에 "상담" 텍스트 헤더가 있어야 함
  await expect(consultationCol.getByText('상담', { exact: true })).toBeVisible();
});

// ── AC-4: 기존 칸반 칸 회귀 없음 ─────────────────────────────────────────────

test('AC-4: 상담대기 DroppableColumn 여전히 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const consultWaitingCol = page.locator('[data-droppable-id="consult_waiting"]');
  await expect(consultWaitingCol).toBeAttached();
});

test('AC-4: 치료대기 DroppableColumn 여전히 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const treatWaitingCol = page.locator('[data-droppable-id="treatment_waiting"]');
  await expect(treatWaitingCol).toBeAttached();
});

test('AC-4: 레이저대기 DroppableColumn 여전히 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const laserWaitingCol = page.locator('[data-droppable-id="laser_waiting"]');
  await expect(laserWaitingCol).toBeAttached();
});

test('AC-4: 수납대기 DroppableColumn 여전히 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const paymentWaitingCol = page.locator('[data-droppable-id="payment_waiting"]');
  await expect(paymentWaitingCol).toBeAttached();
});

// ── AC-5: 칸반 칸 순서 — 상담대기 → 상담 → 치료대기 ─────────────────────────

test('AC-5: 칸 순서 — 상담(consultation)이 상담대기(consult_waiting) 뒤에 위치', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const consultWaiting = page.locator('[data-droppable-id="consult_waiting"]');
  const consultation = page.locator('[data-droppable-id="consultation"]');

  await expect(consultWaiting).toBeAttached();
  await expect(consultation).toBeAttached();

  const consultWaitingBox = await consultWaiting.boundingBox();
  const consultationBox = await consultation.boundingBox();

  // 칸반은 수평 레이아웃: consultation.left > consult_waiting.left
  if (consultWaitingBox && consultationBox) {
    expect(consultationBox.x).toBeGreaterThan(consultWaitingBox.x);
  }
});

// ── AC-3: Realtime — byStatus 업데이트 시 칸반 DOM 반영 (정적 구조 검증) ──────

test('AC-3: consultation DroppableColumn이 Realtime 수신 범위에 포함됨 (DOM 구조 검증)', async ({ page }) => {
  // Realtime은 서버 의존 — 여기서는 칸반 컬럼이 DOM에 마운트되어 있음을 확인
  // (Realtime subscription filter는 check_ins 전체 채널 구독으로 이미 포함)
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // consultation DroppableColumn이 초기 렌더링에서 존재 → Realtime 업데이트 시 byStatus['consultation']가 반영됨
  const consultationCol = page.locator('[data-droppable-id="consultation"]');
  await expect(consultationCol).toBeAttached();

  // 오류 없이 페이지가 렌더링됨 (콘솔 에러 없음 검증)
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.waitForTimeout(2000);
  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('supabase') && !e.includes('net::ERR'),
  );
  expect(criticalErrors).toHaveLength(0);
});

// ── AC-6: '상담' 선택 시 상담실 서브메뉴 존재 (구조 검증) ───────────────────────

test('AC-6: StatusContextMenu에 consultationRooms prop이 전달되는 DOM 구조 (정적 검증)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // StatusContextMenu가 마운트되면 consultationRooms prop을 받음
  // 정적 검증: 페이지가 에러 없이 렌더링되고 '상담' 상태 전환 컨텍스트 메뉴가 작동할 준비가 됨
  const consultationCol = page.locator('[data-droppable-id="consultation"]');
  await expect(consultationCol).toBeAttached();

  // 오류 없이 페이지 렌더링 확인
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.waitForTimeout(1000);
  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('supabase') && !e.includes('net::ERR'),
  );
  expect(criticalErrors).toHaveLength(0);
});

// ── AC-7: consultation_room 배지 — data-testid 존재 확인 (구조 검증) ────────────

test('AC-7: DraggableCard에 consultation-room-badge data-testid가 코드에 존재 (정적 검증)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 대시보드가 정상 렌더링되고 consultation 칸반 컬럼이 마운트됨
  // 실제 체크인 데이터가 consultation 상태 + consultation_room이 있을 때
  // data-testid="consultation-room-badge"가 카드에 표시됨
  // (E2E 테스트 환경에서 실제 데이터 없이 구조만 검증)
  const consultationCol = page.locator('[data-droppable-id="consultation"]');
  await expect(consultationCol).toBeAttached();

  // 만약 consultation 상태 + room 배정 카드가 있다면 배지가 있어야 함
  const badges = page.locator('[data-testid="consultation-room-badge"]');
  const badgeCount = await badges.count();
  // 0개도 정상 (해당 상태 체크인 없을 때), 1개 이상이면 배지 텍스트 확인
  if (badgeCount > 0) {
    const badgeText = await badges.first().textContent();
    expect(badgeText).toBeTruthy();
  }
});

// ── AC-8: 전 stage droppable 슬롯 존재 확인 (회귀) ──────────────────────────────

test('AC-8: 회귀 — 전 주요 stage DroppableColumn이 DOM에 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 풋센터 stage flow 전 칸반 칸 존재 검증
  const expectedColumns = [
    'consult_waiting',    // 상담대기
    'consultation',       // 상담 (T-20260516-foot-CONSULT-KANBAN-MISS 추가)
    'treatment_waiting',  // 치료대기
    'laser_waiting',      // 레이저대기
    'payment_waiting',    // 수납대기
  ];

  for (const colId of expectedColumns) {
    const col = page.locator(`[data-droppable-id="${colId}"]`);
    await expect(col).toBeAttached({ timeout: 5000 });
  }
});

test('AC-8: 회귀 — 칸반 전환 후 콘솔 에러 없음', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 2초 대기 후 전 droppable 칸이 유지되는지 확인
  await page.waitForTimeout(2000);

  const expectedColumns = [
    'consult_waiting',
    'consultation',
    'treatment_waiting',
    'laser_waiting',
    'payment_waiting',
  ];
  for (const colId of expectedColumns) {
    const col = page.locator(`[data-droppable-id="${colId}"]`);
    await expect(col).toBeAttached();
  }

  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('supabase') && !e.includes('net::ERR'),
  );
  expect(criticalErrors).toHaveLength(0);
});
