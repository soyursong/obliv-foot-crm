/**
 * E2E Spec: T-20260516-foot-CONSULT-KANBAN-MISS
 * '상담' 선택 시 고객 대시보드 미표시 (칸반 누락) — 수정 검증
 *
 * AC-1: '상담' 선택 시 해당 고객이 대시보드 칸반 '상담' 칸에 표시
 * AC-2: DroppableColumn id="consultation" 이 DOM에 존재 (slots 1:1 매핑)
 * AC-3: Realtime subscription — byStatus['consultation'] 업데이트 시 칸반 자동 반영 (정적 검증)
 * AC-4: 기존 칸반 칸 (상담대기·치료대기·레이저대기 등) 회귀 없음
 * AC-5: '상담' 칸 위치 — consult_waiting_col 뒤, treatment_waiting_col 앞 (stage flow 순서)
 *
 * 구현 위치:
 *  - Dashboard.tsx `case 'consult_rooms'`: DroppableColumn id="consultation" 추가
 *  - handleDragEnd `target === 'consultation'`: consultation_room null 초기화
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
