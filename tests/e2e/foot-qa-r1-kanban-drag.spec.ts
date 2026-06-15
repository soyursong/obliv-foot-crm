/**
 * QA Round 1 — 칸반 카드 드래그 인터랙션 검증 (T2)
 * 사용자가 발견한 회귀 (foot-056 레이저 드래그) 직접 시뮬.
 *
 * T-20260615-foot-REGRESSION-SUITE-DEROT RC-C (시드 표류 derot):
 *   (1) 과거엔 "데모 시드(4/26)"의 오늘자 카드에 의존 → created_date 표류로 오늘자
 *       카드 0건이 되면 `count > 0` 단언이 false-fail. 이제 beforeAll 에서 오늘자
 *       active 카드 1장을 self-seed 하고 afterAll 에서 회수 → 결정적.
 *   (2) "레이저 슬롯" 단언이 방 이름 `레이저실1` 텍스트를 매칭했으나, 방 명명이
 *       `L1`~`L12` 로 바뀌어(rooms 테이블) 영구 false-fail. 텍스트가 아니라 앱이
 *       실제로 emit 하는 droppable 속성(`data-room-type="laser"`)으로 의도(레이저
 *       droppable 등록)를 검증하도록 rebase → 방 이름 변경에 강건.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  loginAndWaitForDashboard,
  seedTodayActiveCheckin,
  cleanupSeededCheckin,
  type SeededCheckin,
} from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('QA-R1 Kanban drag (foot-056 회귀 검증)', () => {
  // RC-C: 오늘자 active 카드 1장 self-seed (시드 표류 무관 결정성 확보)
  let seeded: SeededCheckin | null = null;

  test.beforeAll(async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    seeded = await seedTodayActiveCheckin(sb, CLINIC_ID);
  });

  test.afterAll(async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    await cleanupSeededCheckin(sb, seeded);
  });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('칸반 페이지 진입 + 영역 렌더', async ({ page }) => {
    await expect(page.getByText('대기').first()).toBeVisible();
    await expect(page.getByText('상담').first()).toBeVisible();
    await expect(page.getByText('레이저').first()).toBeVisible();
  });

  test('카드 한 장이라도 칸반에 보이는가 (data-testid)', async ({ page }) => {
    await page.waitForTimeout(2000);
    const cards = page.locator('[data-testid="checkin-card"]');
    const count = await cards.count();
    console.log('보이는 카드 수:', count);
    expect(count).toBeGreaterThan(0);
    // 각 카드에 status/visit_type 데이터 부착 확인
    const first = cards.first();
    const status = await first.getAttribute('data-checkin-status');
    const visitType = await first.getAttribute('data-checkin-visit-type');
    console.log('첫 카드 status / visit_type:', status, visitType);
    expect(status).toBeTruthy();
    expect(visitType).toBeTruthy();
  });

  test('레이저 슬롯 droppable이 DOM에 등록됨', async ({ page }) => {
    // RC-C rebase: RoomSlot 은 useDroppable id="room:{roomName}" 로 등록되며 DOM 에
    // data-room-type="laser" + data-droppable-id="room:{roomName}" 속성을 emit 한다.
    // 과거엔 방 이름 텍스트 `레이저실1` 을 매칭했으나 방 명명이 L1~L12 로 바뀌어
    // 영구 false-fail 이 났다. 텍스트가 아니라 앱이 실제 emit 하는 droppable 속성으로
    // "레이저 슬롯이 droppable 로 등록됨" 의 본래 의도를 방 이름과 무관하게 검증한다.
    await page.waitForTimeout(1500);
    const laserSlots = page.locator('[data-room-type="laser"][data-droppable-id^="room:"]');
    const count = await laserSlots.count();
    console.log('레이저 droppable 슬롯 수:', count);
    expect(count).toBeGreaterThan(0);
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
    //
    // RC-C 결정성: 과거엔 `.limit(1)` 로 공유 dev-DB 의 임의 active 카드를 집어 비결정적이었고
    // (어떤 카드가 잡히느냐에 따라 false-fail), laser_room 을 '레이저실1' 로 하드코딩했는데
    // 방 명명이 L1~L12 로 바뀌어 존재하지 않는 방이 돼 카드가 어느 슬롯에도 안 붙었다.
    // → beforeAll 이 self-seed 한 본 테스트 전용 카드를 대상으로, 실제 등록된 laser 방
    //   이름을 DB 에서 동적으로 가져와 검증한다(공유 DB 상태와 무관).
    if (!seeded) {
      test.skip(true, 'self-seed 실패 — DB 권한/스키마 확인 필요');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data: laserRooms } = await sb
      .from('rooms')
      .select('name')
      .eq('clinic_id', CLINIC_ID)
      .eq('room_type', 'laser')
      .order('name')
      .limit(1);
    const laserRoomName = laserRooms?.[0]?.name;
    if (!laserRoomName) {
      test.skip(true, 'laser 방 미등록 — rooms 설정 필요');
      return;
    }
    await sb
      .from('check_ins')
      .update({ status: 'laser', laser_room: laserRoomName })
      .eq('id', seeded.checkInId);
    try {
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      // 칸반은 가로 스크롤 보드라 laser 섹션(L1~L12)은 기본 뷰포트 오른쪽 밖에 있다.
      // 카드는 해당 laser 방 슬롯 DOM 에 정상 배치되지만 뷰포트 밖이면 toBeVisible 이 false →
      // 과거 isVisible 스냅샷이 false-fail 의 원인이었다. foot-056 의 본래 의도는
      // "카드가 laser 컬럼(해당 방 슬롯)에 반영되는가" 이므로, 해당 방 슬롯 안에 카드가
      // 렌더(attached)됨을 먼저 단언하고, 슬롯을 뷰포트로 스크롤해 실제 가시성까지 확인한다.
      const card = page
        .locator(`[data-room-name="${laserRoomName}"][data-room-type="laser"]`)
        .getByText(seeded.name)
        .first();
      await expect(card).toBeAttached({ timeout: 12_000 });
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      console.log(`DB로 laser(${laserRoomName}) 이동 후 슬롯 반영 + 가시 확인: true`);
    } finally {
      // afterAll 이 카드를 회수하므로 status 복원은 불필요하나, 다른 테스트 영향 방지 위해 원복.
      await sb
        .from('check_ins')
        .update({ status: 'consult_waiting', laser_room: null })
        .eq('id', seeded.checkInId);
    }
  });
});
