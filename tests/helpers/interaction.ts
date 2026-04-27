/**
 * Playwright 인터랙션 헬퍼 (T-foot-qa-001, T-20260427-foot-qa-007)
 *
 * 사용:
 *   await dragCard(page, checkInId, 'room:레이저실1');
 *   await openSheet(page, customerName);
 *   await openPaymentDialog(page, customerName);
 *   const ids = await listDroppableIds(page);   // 디버깅용
 */
import type { Page, Locator } from '@playwright/test';

/**
 * 현재 DOM에 존재하는 모든 droppable ID 목록 반환 (디버깅용)
 */
export async function listDroppableIds(page: Page): Promise<string[]> {
  return page.locator('[data-droppable-id]').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).getAttribute('data-droppable-id') ?? ''),
  );
}

/**
 * 특정 droppable ID가 현재 DOM에 visible 상태로 존재하는지 확인
 */
export async function droppableExists(page: Page, droppableId: string): Promise<boolean> {
  const loc = page.locator(`[data-droppable-id="${droppableId}"]`).first();
  return loc.isVisible().catch(() => false);
}

/**
 * @dnd-kit 호환 드래그 — checkInId의 카드를 droppable id로 드롭
 *
 * dnd-kit은 PointerSensor로 mouse down → 일정 거리 이동 → drag 시작 인식.
 * 그래서 단순 dragTo는 안 통하고 mouse.move/down/intermediate moves/up 시퀀스로.
 *
 * 주의: 'checklist' 등 Dashboard에 droppable이 없는 상태는 drag 대상이 아님.
 *       해당 전환은 DB 직접 또는 해당 다이얼로그 UI를 사용할 것.
 */
export async function dragCard(page: Page, checkInId: string, droppableId: string): Promise<void> {
  const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`).first();
  await card.waitFor({ state: 'visible', timeout: 5000 });

  // droppable target 찾기 — data-droppable-id로 정확 매칭
  const targetLocator = resolveDroppableLocator(page, droppableId);

  // 존재 확인 + 명확한 에러 메시지
  const exists = await targetLocator.isVisible().catch(() => false);
  if (!exists) {
    const available = await listDroppableIds(page);
    throw new Error(
      `dragCard: droppable "${droppableId}" not found.\n` +
      `Available droppables: [${available.join(', ')}]\n` +
      `Hint: checklist 전환은 PreChecklist 다이얼로그 (DB) 사용.`,
    );
  }

  await targetLocator.waitFor({ state: 'visible', timeout: 5000 });

  // 핵심: viewport 밖이면 가로 스크롤 필요 (칸반은 가로 스크롤 영역)
  await targetLocator.scrollIntoViewIfNeeded({ timeout: 3000 });
  await page.waitForTimeout(300);

  // scroll 후 카드 위치도 변할 수 있음 — 다시 측정
  await card.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(150);

  const cardBox = await card.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  if (!cardBox || !targetBox) throw new Error('dragCard: bounding box null after scroll');

  // 카드: 좌상단 drag handle 근처 (GripVertical 아이콘)
  const startX = cardBox.x + 20;
  const startY = cardBox.y + cardBox.height / 2;
  // target: 안쪽 30% (인접 droppable 영역 회피)
  const endX = targetBox.x + Math.min(targetBox.width * 0.3, targetBox.width - 20);
  const endY = targetBox.y + Math.min(targetBox.height * 0.5, targetBox.height - 20);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit PointerSensor activation: 4px 이동 후 drag 인식
  await page.mouse.move(startX + 10, startY + 10, { steps: 5 });
  // 중간 좌표 경유 — over event를 명확히 트리거
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.waitForTimeout(200);
  // target 위에서 한 번 더 머무름 (collision detection 안정화)
  await page.mouse.move(endX + 1, endY + 1, { steps: 3 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(1000);
}

/** droppable id → Locator (data-droppable-id 정확 매칭) */
function resolveDroppableLocator(page: Page, droppableId: string): Locator {
  return page.locator(`[data-droppable-id="${droppableId}"]`).first();
}

/** 칸반 카드 클릭 → CheckInDetailSheet 열림 대기 */
export async function openSheet(page: Page, customerName: string): Promise<void> {
  const card = page
    .locator('[data-testid="checkin-card"]')
    .filter({ hasText: customerName })
    .first();
  await card.waitFor({ state: 'visible', timeout: 5000 });
  await card.click();
  // Sheet 열림 표지 — "환자 정보" 또는 customer_name이 sheet 헤더에
  await page.waitForTimeout(700);
}

/** Sheet 안에서 결제 버튼 클릭 → PaymentDialog 열림 */
export async function openPaymentDialog(page: Page, customerName: string): Promise<void> {
  await openSheet(page, customerName);
  const payBtn = page.getByRole('button', { name: /결제/ }).first();
  await payBtn.waitFor({ state: 'visible', timeout: 3000 });
  await payBtn.click();
  await page.waitForTimeout(500);
}

/** PaymentDialog 자동 채우기 (단건 또는 패키지) */
export interface PaymentFillOpts {
  mode: 'single' | 'package';
  amount?: number; // 단건 모드
  packageKey?: string; // 패키지 모드 (PACKAGE_PRESETS의 key)
  method?: 'card' | 'cash' | 'transfer';
  installment?: number;
  split?: { card: number; cash: number };
}

export async function fillPaymentDialog(page: Page, opts: PaymentFillOpts): Promise<void> {
  if (opts.mode === 'package') {
    await page.getByRole('button', { name: /패키지 결제/ }).click();
    if (opts.packageKey) {
      await page.locator(`button:has-text("패키지")`).first().click();
    }
  }
  if (opts.split) {
    await page.getByRole('button', { name: '분할 결제' }).click();
    await page.getByLabel('카드 금액').fill(String(opts.split.card));
    await page.getByLabel('현금 금액').fill(String(opts.split.cash));
  } else if (opts.amount) {
    await page.getByLabel('금액').fill(String(opts.amount));
  }
  if (opts.method && !opts.split) {
    const label = { card: '카드', cash: '현금', transfer: '이체' }[opts.method];
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await page.getByRole('button', { name: /결제 완료|패키지 결제 완료/ }).click();
  await page.waitForTimeout(800);
}
