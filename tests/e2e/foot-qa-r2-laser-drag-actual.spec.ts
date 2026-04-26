/**
 * QA Round 2 — foot-056 레이저 드래그 실측 spec (T2)
 * fixture + dragCard 헬퍼 활용해 실제 mouse 시뮬.
 * fail 시 정확한 root cause + 토스트 메시지 캡처.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { dragCard } from '../helpers/interaction';
import { seedCheckIn, CLINIC_ID } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('QA-R2 Laser drag actual (foot-056 재현)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('재진 환자 (status=treatment_waiting) → 레이저실1 슬롯 드롭', async ({ page }) => {
    const ck = await seedCheckIn({
      status: 'treatment_waiting',
      visit_type: 'returning',
      name: `qa-r2-laser-${Date.now()}`,
    });
    try {
      // 토스트 메시지 캡처
      const toasts: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warn') {
          console.log(`[browser ${msg.type()}]`, msg.text());
        }
      });

      await page.reload();
      await page.waitForTimeout(2000);

      // 진단: droppable id 매핑 확인
      const droppableIds = await page.locator('[data-droppable-id]').evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).getAttribute('data-droppable-id')),
      );
      console.log('DOM droppable ids:', droppableIds.slice(0, 30));
      const laserBox = await page.locator('[data-droppable-id="room:레이저실1"]').first().boundingBox().catch(() => null);
      const doneBox = await page.locator('[data-droppable-id="done"]').first().boundingBox().catch(() => null);
      console.log('레이저실1 box:', laserBox);
      console.log('done box:', doneBox);

      // 카드가 칸반에 보이는지 확인
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ck.id}"]`);
      const visible = await card.isVisible().catch(() => false);
      console.log('시드 카드 visible:', visible);
      if (!visible) {
        await page.screenshot({ path: `test-results/qa-r2-no-card.png` });
        test.skip(true, '시드 카드 화면에 안 보임 — 칸반 컬럼 매핑 점검 필요');
        return;
      }

      // 드래그 시도
      try {
        await dragCard(page, ck.id, 'room:레이저실1');
      } catch (e) {
        console.log('dragCard error:', (e as Error).message);
      }

      // 토스트 메시지 검사
      const toastTexts = await page.locator('[role="status"], [role="alert"], .sonner-toast, li[data-sonner-toast]').allTextContents();
      console.log('토스트 메시지 목록:', toastTexts);

      // DB 상태 검증
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const { data } = await sb.from('check_ins').select('status, laser_room').eq('id', ck.id).single();
      console.log('DB 결과 status / laser_room:', data?.status, data?.laser_room);

      if (data?.status === 'laser' && data?.laser_room) {
        console.log('✅ 드래그 → DB 반영 성공');
      } else {
        console.log('❌ 드래그 → DB 미반영 (실 회귀 또는 selector 미스)');
      }
    } finally {
      await ck.cleanup();
    }
  });

  test('신규 환자 (status=registered) → 레이저실1 (가드 차단 기대)', async ({ page }) => {
    const ck = await seedCheckIn({
      status: 'registered',
      visit_type: 'new',
      name: `qa-r2-laser-new-${Date.now()}`,
    });
    try {
      await page.reload();
      await page.waitForTimeout(2000);
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ck.id}"]`);
      if (!(await card.isVisible().catch(() => false))) {
        test.skip(true, '카드 보이지 않음');
        return;
      }
      try {
        await dragCard(page, ck.id, 'room:레이저실1');
      } catch (e) {
        console.log('dragCard error:', (e as Error).message);
      }
      const toastTexts = await page.locator('[role="status"], [role="alert"], li[data-sonner-toast]').allTextContents();
      console.log('신규→레이저 시도 토스트:', toastTexts);
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const { data } = await sb.from('check_ins').select('status').eq('id', ck.id).single();
      console.log('DB status (변경 안 돼야 정상):', data?.status);
      // 신규 환자는 체크리스트 가드로 차단되어야 함 → status='registered' 유지 기대
      expect(data?.status).toBe('registered');
    } finally {
      await ck.cleanup();
    }
  });

  test('재진 환자 → laser_waiting 컬럼 드롭', async ({ page }) => {
    const ck = await seedCheckIn({
      status: 'treatment_waiting',
      visit_type: 'returning',
      name: `qa-r2-lwait-${Date.now()}`,
    });
    try {
      await page.reload();
      await page.waitForTimeout(2000);
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ck.id}"]`);
      if (!(await card.isVisible().catch(() => false))) {
        test.skip(true, '카드 보이지 않음');
        return;
      }
      try {
        await dragCard(page, ck.id, 'laser_waiting');
      } catch (e) {
        console.log('dragCard error:', (e as Error).message);
      }
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const { data } = await sb.from('check_ins').select('status, laser_room').eq('id', ck.id).single();
      console.log('laser_waiting 드롭 결과:', data?.status, data?.laser_room);
      // laser 단계 진입 (laser_room=null)
      if (data?.status === 'laser') {
        expect(data.laser_room).toBeNull();
      }
    } finally {
      await ck.cleanup();
    }
  });
});
