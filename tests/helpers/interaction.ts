/**
 * Playwright 인터랙션 헬퍼 (T-foot-qa-001)
 *
 * 사용:
 *   await dragCard(page, checkInId, 'room:레이저실1');
 *   await openSheet(page, customerName);
 *   await openPaymentDialog(page, customerName);
 */
import type { Page, Locator } from '@playwright/test';

/**
 * @dnd-kit 호환 드래그 — checkInId의 카드를 droppable id로 드롭
 *
 * dnd-kit은 PointerSensor로 mouse down → 일정 거리 이동 → drag 시작 인식.
 * 그래서 단순 dragTo는 안 통하고 mouse.move/down/intermediate moves/up 시퀀스로.
 */
export async function dragCard(page: Page, checkInId: string, droppableId: string): Promise<void> {
  const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`).first();
  await card.waitFor({ state: 'visible', timeout: 5000 });

  // droppable target 찾기 — DroppableColumn / RoomSlot은 dnd-kit이 자체 등록.
  // data-testid 없으므로 컴포넌트가 props로 받은 id를 prop으로 가지지만 DOM엔 직접 노출 안 됨.
  // 우회: droppableId 텍스트 기반 추정 매핑.
  const targetLocator = await resolveDroppableLocator(page, droppableId);
  await targetLocator.waitFor({ state: 'visible', timeout: 5000 });

  const cardBox = await card.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  if (!cardBox || !targetBox) throw new Error('dragCard: bounding box null');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit PointerSensor activation: 4px 이동 후 drag 인식
  await page.mouse.move(startX + 8, startY + 8, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(800);
}

/** droppable id → Locator 휴리스틱 */
async function resolveDroppableLocator(page: Page, droppableId: string): Promise<Locator> {
  // room:레이저실N → "레이저실N" 텍스트 포함 div (RoomSlot)
  if (droppableId.startsWith('room:')) {
    const roomName = droppableId.slice(5);
    return page.locator(`div:has(> div:has-text("${roomName}"))`).first();
  }
  // laser_waiting / consult_waiting / treatment_waiting / done / registered 등 → 컬럼 헤더 텍스트
  const labelMap: Record<string, string> = {
    registered: '대기',
    consult_waiting: '상담대기',
    consultation: '상담',
    exam_waiting: '진료대기',
    examination: '원장 진료',
    treatment_waiting: '관리대기',
    treatment: '관리',
    laser_waiting: '레이저대기',
    laser: '레이저',
    payment_waiting: '수납대기',
    done: '완료',
    cancelled: '취소',
  };
  const label = labelMap[droppableId];
  if (label) {
    return page.locator(`div:has(> div:has-text("${label}"))`).first();
  }
  // fallback
  return page.getByText(droppableId).first();
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
