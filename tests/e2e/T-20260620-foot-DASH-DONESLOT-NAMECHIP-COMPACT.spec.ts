/**
 * E2E spec — T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT
 * 대시보드 완료 슬롯 컴팩트화 (FE 전용, 표시만 변경).
 *
 * 배경: 현장(김주연 총괄) — 완료 슬롯에 환자가 누적되면 세로 길이 폭증.
 *   → 완료 슬롯은 (1) 성함만 보이는 회색 초소형 칩, (2) 정시(hour) 그룹 + 기본 접힘(collapsible),
 *     (3) 대시보드 우측 단독 컬럼으로 분리, (4) 수납대기 슬롯 높이 확대.
 *
 * 구현(Dashboard.tsx):
 *   - renderDoneColumn(): 완료 슬롯 = 우측 단독 컬럼(data-testid="slot-col-done"), id="done" 드롭타깃 유지.
 *   - doneHourGroups: byStatus['done'] 를 예약시간 hour 버킷("HH")으로 그룹(예약 없으면 checked_in_at hour 폴백).
 *   - 그룹 헤더(done-hour-header-{HH}) 기본 접힘 → 클릭 시 회색 칩(done-name-chip) 가로 wrap 펼침.
 *   - 칩 클릭 → handleCardClick(기존 상세/팝업) → 데이터 접근 유지.
 *   - desk_section(수납대기) wrapper minHeight = PAYMENT_WAITING_COLUMN_HEIGHT scoped override(AC-4).
 *     완료 슬롯은 desk_section 에서 분리.
 *
 * 시드: 정석 fixture seedCheckIn(비-sim·MARKER). status='done' 환자 + 회귀용 treatment_waiting 환자.
 *   ⚠ checked_in_at=now → 완료 칩은 '현재 시(hour)' 폴백 그룹에 묶임(예약 미연결).
 * Supabase service env 미설정 시에만 skip.
 *
 * AC-1: 완료 카드 = 성함만 보이는 초소형 회색 칩(풀카드 요소 없음). 칩 클릭 → 상세 팝업 오픈(데이터 접근 유지).
 * AC-2: 정시 그룹 헤더 + 기본 접힘 + 헤더 클릭 시 펼침(다시 클릭 시 접힘). 헤더에 인원수.
 * AC-3: 다른 슬롯(치료대기) 풀카드 렌더 회귀 없음.
 * AC-4: 수납대기 슬롯 컨테이너 높이가 완료 슬롯보다 확대됨(scoped override).
 * AC-5: 완료 슬롯이 칸반 우측 단독 컬럼으로 분리 렌더.
 *
 * 시나리오:
 *   S-1: 완료 슬롯이 우측 단독 컬럼(slot-col-done)으로 렌더 [AC-5]
 *   S-2: 정시 그룹 헤더 존재 + 기본 접힘(완료 칩 미표시) [AC-2]
 *   S-3: 헤더 클릭 → 완료 칩 펼침, 다시 클릭 → 접힘 [AC-2]
 *   S-4: 펼친 칩은 성함만 표시(풀카드 요소 부재) + 칩 클릭 → 상세 팝업(dialog) 오픈 [AC-1]
 *   S-5: 수납대기 컬럼(slot-col-desk) 높이 > 완료 컬럼(slot-col-done) 높이 [AC-4]
 *   S-6 (회귀): 치료대기 풀카드(checkin-card) 정상 렌더 [AC-3]
 */
import { test, expect, type Page } from '@playwright/test';
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
  const name = `qa-done-${tag}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const h = await seedCheckIn({ visit_type: 'returning', status, name });
  return { id: h.id, name, cleanup: h.cleanup };
}

test.describe('T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT — 완료 슬롯 컴팩트화', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    for (let i = 0; i < 3; i++) {
      doneCards.push(await seedNamed('done', `c${i}`));
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

  test('S-1: AC-5 — 완료 슬롯이 우측 단독 컬럼(slot-col-done)으로 렌더', async ({ page }) => {
    await gotoDashboard(page);
    const doneCol = page.locator('[data-testid="slot-col-done"]').first();
    await expect(doneCol).toBeVisible();
    // 완료 컬럼 안에 드롭 타깃 id="done" 유지 (드래그 이동 정상)
    await expect(doneCol.locator('[data-droppable-id="done"]').first()).toBeVisible();
    // 완료 라벨 노출
    await expect(doneCol.getByText('완료', { exact: true }).first()).toBeVisible();
  });

  test('S-2: AC-2 — 정시 그룹 헤더 존재 + 기본 접힘(완료 칩 미표시)', async ({ page }) => {
    await gotoDashboard(page);
    // 시드된 완료 환자 ≥1 → 정시 그룹 헤더 최소 1개
    const headers = page.locator('[data-testid^="done-hour-header-"]');
    await expect(headers.first()).toBeVisible({ timeout: 10_000 });
    // 기본 접힘 → 칩은 아직 렌더되지 않음(0건)
    await expect(page.locator('[data-testid="done-name-chip"]')).toHaveCount(0);
  });

  test('S-3: AC-2 — 헤더 클릭 시 완료 칩 펼침, 다시 클릭 시 접힘', async ({ page }) => {
    await gotoDashboard(page);
    const myName = doneCards[0].name;
    const myChip = page.locator('[data-testid="done-name-chip"]', { hasText: myName });

    // 펼치기 전: 미표시
    await expect(myChip).toHaveCount(0);
    // 모든 그룹 펼치기 → 내 칩 노출
    await expandAllDoneGroups(page);
    await expect(myChip.first()).toBeVisible({ timeout: 10_000 });
    // 다시 접기 → 미표시
    await expandAllDoneGroups(page);
    await expect(myChip).toHaveCount(0);
  });

  test('S-4: AC-1 — 칩은 성함만 표시(풀카드 요소 부재) + 클릭 시 상세 팝업 오픈', async ({ page }) => {
    await gotoDashboard(page);
    await expandAllDoneGroups(page);
    const myName = doneCards[0].name;
    const myChip = page.locator('[data-testid="done-name-chip"]', { hasText: myName }).first();
    await expect(myChip).toBeVisible({ timeout: 10_000 });

    // 칩 텍스트 = 성함만 (풀카드 요소인 "결제하기"/"체크리스트" 등 부재)
    const chipText = (await myChip.textContent())?.trim() ?? '';
    expect(chipText).toBe(myName);
    // 완료 칩은 DraggableCard 풀카드(checkin-card)가 아님 — 동일 컬럼 내 풀카드 0건
    const doneCol = page.locator('[data-testid="slot-col-done"]').first();
    await expect(doneCol.locator('[data-testid="checkin-card"]')).toHaveCount(0);

    // 칩 클릭 → 기존 상세/팝업 정상 오픈(데이터 접근 유지)
    await myChip.click();
    await expect(page.getByRole('dialog').filter({ hasText: myName }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('S-5: AC-4 — 수납대기 컬럼 높이가 완료 컬럼보다 확대됨', async ({ page }) => {
    await gotoDashboard(page);
    const desk = page.locator('[data-testid="slot-col-desk"]').first();
    const done = page.locator('[data-testid="slot-col-done"]').first();
    await expect(desk).toBeVisible();
    await expect(done).toBeVisible();
    const deskBox = await desk.boundingBox();
    const doneBox = await done.boundingBox();
    expect(deskBox).not.toBeNull();
    expect(doneBox).not.toBeNull();
    // 완료 슬롯은 접힘 상태(짧음) + 수납대기는 scoped 높이 확대 → 명확히 더 큼
    expect(deskBox!.height).toBeGreaterThan(doneBox!.height + 80);
  });

  test('S-6: AC-3 회귀 — 치료대기 풀카드(checkin-card) 정상 렌더', async ({ page }) => {
    await gotoDashboard(page);
    const card = page
      .locator(`[data-testid="checkin-card"][data-checkin-id="${twCard!.id}"]`)
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });
  });
});
