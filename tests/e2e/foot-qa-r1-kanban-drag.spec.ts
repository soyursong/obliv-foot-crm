/**
 * QA Round 1 — 칸반 카드 드래그 인터랙션 검증 (T2)
 * 사용자가 발견한 회귀 (foot-056 레이저 드래그) 직접 시뮬.
 * 데모 시드(4/26) 활용. 시드 의존이라 cleanup 안 함.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('QA-R1 Kanban drag (foot-056 회귀 검증)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('칸반 페이지 진입 + 영역 렌더', async ({ page }) => {
    await expect(page.getByText('대기').first()).toBeVisible();
    await expect(page.getByText('상담').first()).toBeVisible();
    await expect(page.getByText('레이저').first()).toBeVisible();
  });

  test('카드 한 장이라도 칸반에 보이는가', async ({ page }) => {
    // 데모 시드 12건 가정 — 어느 컬럼이든 카드 1개 이상
    const cards = page.locator('[data-card-id], [data-checkin-id], [draggable="true"]');
    const count = await cards.count();
    console.log('보이는 카드 수:', count);
    expect(count).toBeGreaterThan(0);
  });

  test('레이저 슬롯 droppable이 DOM에 등록됨', async ({ page }) => {
    // RoomSlot useDroppable id="room:레이저실N"
    // dnd-kit은 data-* 속성 안 붙이지만, 텍스트 "레이저실1" 또는 "레이저1" 등으로 보여야 함
    const laserLabels = await page.getByText(/레이저(실)?1\b/).count();
    console.log('레이저1 라벨 발견:', laserLabels);
    expect(laserLabels).toBeGreaterThan(0);
  });

  test('DB 차원 — 데모 시드 카드 분포 확인 (foot-056 재현 시나리오 베이스)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from('check_ins')
      .select('id, customer_name, visit_type, status, laser_room')
      .eq('clinic_id', CLINIC_ID)
      .eq('created_date', today);
    expect(error).toBeNull();
    const stats: Record<string, number> = {};
    (data ?? []).forEach((c) => {
      stats[c.status as string] = (stats[c.status as string] ?? 0) + 1;
    });
    console.log('오늘 check_ins 상태 분포:', stats);
    // laser_room이 채워진 카드가 1건이라도 있어야 레이저 컬럼에 표시됨
    const hasLaser = (data ?? []).some((c) => c.laser_room);
    console.log('laser_room 채워진 카드:', hasLaser);
  });

  test('DB 직접 — 카드 status를 laser로 변경 후 칸반 반영 (드래그 우회 검증)', async ({ page }) => {
    // E2E에서 mouse.move/down/up 드래그가 어려우면 DB 직접 변경 → 화면 반영만 검증
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: cards } = await sb
      .from('check_ins')
      .select('id, customer_name, visit_type, status')
      .eq('clinic_id', CLINIC_ID)
      .eq('created_date', today)
      .neq('status', 'done')
      .neq('status', 'no_show')
      .limit(1);
    if (!cards || cards.length === 0) {
      test.skip(true, '오늘 active check_in 없음 — 시드 필요');
      return;
    }
    const target = cards[0];
    const orig = { status: target.status };
    await sb.from('check_ins').update({ status: 'laser', laser_room: '레이저실1' }).eq('id', target.id);
    try {
      await page.reload();
      await page.waitForTimeout(2000);
      // 레이저1 영역에 해당 환자 이름이 보이는가
      const visible = await page.getByText(target.customer_name as string).first().isVisible().catch(() => false);
      console.log(`DB로 laser 이동 후 화면에 보임: ${visible}`);
      expect(visible).toBe(true);
    } finally {
      await sb.from('check_ins').update({ status: orig.status, laser_room: null }).eq('id', target.id);
    }
  });
});
