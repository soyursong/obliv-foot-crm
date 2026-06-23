/**
 * E2E spec — T-20260623-foot-DASH-DONESLOT-BATCHEDIT-MOVE-REGRESSION
 * 대시보드 완료 슬롯 배치편집(드래그) 이동 불가 회귀 수정 (FE 인터랙션 전용).
 *
 * 배경: 현장(김주연 총괄) — 완료 슬롯에서 환자를 다른 슬롯으로 드래그 이동이 안 되는 버그.
 *   회귀 출처 = T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT(commit 78167b2b)에서 완료 카드를
 *   성함칩 plain <button>으로 바꾸며 useDraggable 이 빠짐 → 완료 환자가 더 이상 드래그 이동 불가.
 *
 * 수정(Dashboard.tsx):
 *   - DraggableDoneChip: 완료 칩에 useDraggable(data:{checkIn}) 재부착(성함칩 비주얼·정시그룹·우측단독 컬럼 유지).
 *   - 클릭(상세) vs 드래그 구분은 상위 DndContext sensors distance(mouse 3 / touch 5px) constraint 가 담당.
 *   - 기존 handleDragEnd 가 그대로 status 이동 처리(완료→치료대기 등). MEDLAW22-B-GATE 는 완료로 들어갈 때만 발화 → 불간섭.
 *
 * 시드: 정석 fixture seedCheckIn(비-sim·MARKER). status='done' 환자 2명 + 회귀 검증용 treatment_waiting 1명.
 * Supabase service env 미설정 시에만 skip.
 *
 * AC-1: 완료 슬롯에서 환자를 다른 슬롯(치료대기)으로 드래그 이동 가능(현 broken 해소).
 * AC-2: 이동 결과가 DB 반영 → 새로고침 후에도 유지.
 * AC-3: 완료 슬롯 우측 단독 컬럼 + 성함칩 + 정시그룹 레이아웃(78167b2b) 디자인 회귀 없음.
 * AC-4: 다른 슬롯(치료대기) 풀카드 드래그 회귀 없음(완료 fix 가 타 슬롯에 영향 X).
 *
 * 시나리오:
 *   S-1: 완료 칩이 draggable 로 복구(data-checkin-id 보유) + 우측 단독 컬럼/정시그룹 레이아웃 유지 [AC-3]
 *   S-2: 완료 칩을 치료대기로 드래그 → 치료대기에 풀카드 등장 + 완료 칩 소멸 [AC-1]
 *   S-3: 이동 후 새로고침 → 치료대기에 유지, 완료에서 사라진 채 유지 [AC-2]
 *   S-4 (회귀): 치료대기 풀카드(checkin-card)가 draggable(grip+touch-none) 정상 [AC-4]
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;

interface SeededCard {
  id: string;
  name: string;
  cleanup: () => Promise<void>;
}
const doneCards: SeededCard[] = [];
let twCard: SeededCard | null = null; // 회귀용 치료대기 풀카드

async function seedNamed(status: string, tag: string): Promise<SeededCard> {
  const name = `qa-donemv-${tag}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const h = await seedCheckIn({ visit_type: 'returning', status, name });
  return { id: h.id, name, cleanup: h.cleanup };
}

test.describe('T-20260623-foot-DASH-DONESLOT-BATCHEDIT-MOVE-REGRESSION — 완료 칩 드래그 이동 회귀', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    for (let i = 0; i < 2; i++) {
      doneCards.push(await seedNamed('done', `d${i}`));
    }
    twCard = await seedNamed('treatment_waiting', 'tw');
    console.log(`[seed] done=${doneCards.map((d) => d.id).join(',')} tw=${twCard.id}`);
  });

  test.afterAll(async () => {
    for (const c of [...doneCards, twCard]) {
      if (c) await c.cleanup();
    }
    console.log('[seed] 정리 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  async function gotoDashboard(page: Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="slot-col-done"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  // 접힌 모든 정시 그룹을 펼친다(기본 접힘 → 클릭 토글). 시드 칩이 보이도록.
  async function expandAllDoneGroups(page: Page) {
    const headers = page.locator('[data-testid^="done-hour-header-"]');
    const n = await headers.count();
    for (let i = 0; i < n; i++) await headers.nth(i).click();
  }

  // dnd-kit MouseSensor(distance:3) 활성화 → 타깃 드롭존 중앙으로 드래그 → 드롭.
  async function dragTo(page: Page, source: Locator, targetSelector: string) {
    const sBox = await source.boundingBox();
    const target = page.locator(targetSelector).first();
    const tBox = await target.boundingBox();
    if (!sBox || !tBox) throw new Error('drag bounding box 측정 실패');
    await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
    await page.mouse.down();
    // distance:3 활성화 — 작은 이동 먼저
    await page.mouse.move(sBox.x + sBox.width / 2 + 8, sBox.y + sBox.height / 2 + 8, { steps: 3 });
    await page.waitForTimeout(120);
    await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(600);
  }

  test('S-1: AC-3 — 완료 칩이 draggable 로 복구 + 우측 단독 컬럼/정시그룹 레이아웃 유지', async ({ page }) => {
    await gotoDashboard(page);
    // 우측 단독 완료 컬럼 + 드롭타깃 id="done" 유지
    const doneCol = page.locator('[data-testid="slot-col-done"]').first();
    await expect(doneCol).toBeVisible();
    await expect(doneCol.locator('[data-droppable-id="done"]').first()).toBeVisible();
    // 정시 그룹 헤더 존재(기본 접힘)
    await expect(page.locator('[data-testid^="done-hour-header-"]').first()).toBeVisible({ timeout: 10_000 });
    // 펼친 뒤 칩 = 성함만, data-checkin-id 보유(=draggable 노드)
    await expandAllDoneGroups(page);
    const myChip = page.locator(`[data-testid="done-name-chip"][data-checkin-id="${doneCards[0].id}"]`).first();
    await expect(myChip).toBeVisible({ timeout: 10_000 });
    expect((await myChip.textContent())?.trim()).toBe(doneCards[0].name);
  });

  test('S-2: AC-1 — 완료 칩을 치료대기로 드래그 → 치료대기 풀카드 등장 + 완료 칩 소멸', async ({ page }) => {
    await gotoDashboard(page);
    await expandAllDoneGroups(page);
    const movingId = doneCards[1].id;
    const chip = page.locator(`[data-testid="done-name-chip"][data-checkin-id="${movingId}"]`).first();
    await expect(chip).toBeVisible({ timeout: 10_000 });

    await dragTo(page, chip, '[data-droppable-id="treatment_waiting"]');

    // 이동 후: 치료대기에 풀카드(checkin-card) 등장
    const movedCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${movingId}"]`).first();
    await expect(movedCard).toBeVisible({ timeout: 10_000 });
    // 완료 칩에서는 사라짐
    await expect(page.locator(`[data-testid="done-name-chip"][data-checkin-id="${movingId}"]`)).toHaveCount(0);
  });

  test('S-3: AC-2 — 이동 결과가 새로고침 후에도 유지(DB 반영)', async ({ page }) => {
    // S-2 에서 doneCards[1] 을 치료대기로 옮긴 상태가 DB에 반영되어야 함.
    // (테스트 간 격리: 같은 시드 row 를 사용하므로 본 테스트는 S-2 이후 상태를 재검증)
    await gotoDashboard(page);
    const movingId = doneCards[1].id;
    // 새로고침 직후에도 치료대기에 풀카드로 유지
    const movedCard = page.locator(`[data-testid="checkin-card"][data-checkin-id="${movingId}"]`).first();
    await expect(movedCard).toBeVisible({ timeout: 15_000 });
    // DB 직접 확인 — status='treatment_waiting'
    if (sb) {
      const { data } = await sb.from('check_ins').select('status').eq('id', movingId).single();
      expect(data?.status).toBe('treatment_waiting');
    }
  });

  test('S-4: AC-4 회귀 — 치료대기 풀카드가 draggable(touch-none) 정상', async ({ page }) => {
    await gotoDashboard(page);
    const card = page
      .locator(`[data-testid="checkin-card"][data-checkin-id="${twCard!.id}"]`)
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // DraggableCard 는 touch-action:none(드래그 가능) — 인라인 스타일 확인
    await expect(card).toHaveCSS('touch-action', 'none');
  });
});
