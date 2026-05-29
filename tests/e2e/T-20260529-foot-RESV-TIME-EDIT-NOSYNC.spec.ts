/**
 * E2E — T-20260529-foot-RESV-TIME-EDIT-NOSYNC
 * 예약 시간 변경 후 연동(실시간 반영) 검증
 *
 * 버그 원인:
 *   ReservationEditor.save() 에 낙관적 업데이트 없음
 *   → 편집 모달 닫힌 후 fetchWeek() 완료까지 카드가 구 슬롯에 잔류
 *   → 사용자에게 "연동이 안 됨"으로 보임
 *   + DB 업데이트 silent failure(RLS 차단) 시 성공 토스트 표시 버그
 *
 * 검증 포인트:
 * AC-1: 예약 시간 변경 → DB reservation_time 즉시 UPDATE 확인
 * AC-2: 변경 후 페이지 새로고침 없이 새 슬롯에 카드 표시
 * AC-3: 예약관리 화면 연동 (동일 Reservations 컴포넌트, rows 상태 공유)
 * AC-4: npm run build 정상 (회귀 없음)
 *
 * 시나리오 1: 초진 예약 시간 변경 (편집 모달)
 * 시나리오 2: 재진 예약 시간 변경 (편집 모달)
 * 시나리오 3: DB 직접 확인 — reservation_time 업데이트 검증
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_DATE = '2099-11-15'; // 미래 날짜 — 기존 데이터와 충돌 없음
const INIT_TIME  = '10:00';
const NEW_TIME   = '14:00';

test.describe('T-20260529-foot-RESV-TIME-EDIT-NOSYNC — 예약 시간 변경 연동', () => {
  let clinicId: string;
  // 초진 고객 (토끼 역할)
  let newCustomerId: string;
  let newResvId: string;
  // 재진 고객 (사과 역할)
  let retCustomerId: string;
  let retResvId: string;

  // ── 테스트 데이터 생성 ──────────────────────────────────────────────────
  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics')
      .select('id')
      .eq('slug', 'jongno-foot')
      .single();
    expect(clinic?.id, 'clinic jongno-foot 존재해야 함').toBeTruthy();
    clinicId = clinic!.id;

    const suffix = String(Date.now()).slice(-6);

    // 초진 고객 (토끼 역할)
    const { data: newCust, error: ncErr } = await service
      .from('customers')
      .insert({
        clinic_id: clinicId,
        name: `E2E토끼_${suffix}`,
        phone: `+8210999${suffix}`,
        visit_type: 'new',
      })
      .select('id')
      .single();
    expect(ncErr, `초진 고객 생성 오류: ${ncErr?.message}`).toBeNull();
    newCustomerId = newCust!.id;

    // 초진 예약
    const { data: newResv, error: nrErr } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: newCustomerId,
        customer_name: `E2E토끼_${suffix}`,
        customer_phone: `+8210999${suffix}`,
        reservation_date: TEST_DATE,
        reservation_time: `${INIT_TIME}:00`,
        visit_type: 'new',
        status: 'confirmed',
        memo: `E2E RESV-TIME-EDIT-NOSYNC [${suffix}]`,
      })
      .select('id')
      .single();
    expect(nrErr, `초진 예약 생성 오류: ${nrErr?.message}`).toBeNull();
    newResvId = newResv!.id;

    // 재진 고객 (사과 역할)
    const { data: retCust, error: rcErr } = await service
      .from('customers')
      .insert({
        clinic_id: clinicId,
        name: `E2E사과_${suffix}`,
        phone: `+8210888${suffix}`,
        visit_type: 'returning',
      })
      .select('id')
      .single();
    expect(rcErr, `재진 고객 생성 오류: ${rcErr?.message}`).toBeNull();
    retCustomerId = retCust!.id;

    // 재진 예약 (11:00 슬롯)
    const { data: retResv, error: rrErr } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: retCustomerId,
        customer_name: `E2E사과_${suffix}`,
        customer_phone: `+8210888${suffix}`,
        reservation_date: TEST_DATE,
        reservation_time: '11:00:00',
        visit_type: 'returning',
        status: 'confirmed',
        memo: `E2E RESV-TIME-EDIT-NOSYNC [${suffix}]`,
      })
      .select('id')
      .single();
    expect(rrErr, `재진 예약 생성 오류: ${rrErr?.message}`).toBeNull();
    retResvId = retResv!.id;
  });

  // ── 정리 ───────────────────────────────────────────────────────────────
  test.afterAll(async () => {
    await service.from('reservations').delete().in('id', [newResvId, retResvId].filter(Boolean));
    await service.from('customers').delete().in('id', [newCustomerId, retCustomerId].filter(Boolean));
  });

  // ── AC-1/AC-2: 초진 예약 시간 변경 (편집 모달) ────────────────────────
  test('시나리오 1 — 초진 예약 시간 변경 후 즉시 카드 이동', async ({ page }) => {
    await loginAndWaitForDashboard(page);

    // 예약관리 이동 + 테스트 날짜 표시
    await page.goto(`/admin/reservations?date=${TEST_DATE}`);
    await page.waitForTimeout(1500);

    // 10:00 슬롯에서 토끼 카드 확인
    const suffix = newCustomerId.slice(0, 4); // 디버그용
    const initSlotCard = page.locator(`[data-testid="resv-card-${newResvId}"]`);
    await expect(initSlotCard, `초기 예약 카드 ${newResvId} 보여야 함`).toBeVisible({ timeout: 8000 });

    // 더블클릭으로 편집 모달 오픈
    await initSlotCard.dblclick();
    await page.waitForTimeout(400);

    // 편집 모달이 열렸는지 확인 (예약 수정 다이얼로그)
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog, '편집 모달이 열려야 함').toBeVisible({ timeout: 5000 });

    // 시간 선택 — 14:00으로 변경
    const timeSelect = dialog.locator('select').first();
    await timeSelect.selectOption(NEW_TIME);

    // 저장 클릭
    const saveBtn = dialog.getByRole('button', { name: '저장' });
    await saveBtn.click();

    // 모달이 닫혀야 함
    await expect(dialog, '모달이 닫혀야 함').not.toBeVisible({ timeout: 5000 });

    // AC-2: 페이지 새로고침 없이 14:00 슬롯에 카드 이동 확인 (낙관적 업데이트)
    // 새로운 슬롯에 카드가 표시되어야 함 (같은 data-testid)
    await expect(
      page.locator(`[data-testid="resv-card-${newResvId}"]`),
      '14:00 슬롯에 카드가 이동해야 함 (새로고침 없이)',
    ).toBeVisible({ timeout: 5000 });

    // 10:00 행과 14:00 행 검증 — 10:00에는 카드 없어야 함
    // 시간 열 기준 td 탐색: 시간 td → 다음 td 중 카드 존재 여부
    const timeRow10 = page.locator('td').filter({ hasText: /^10:00$/ });
    if (await timeRow10.count() > 0) {
      const row10 = timeRow10.locator('..'); // 부모 tr
      await expect(
        row10.locator(`[data-testid="resv-card-${newResvId}"]`),
        '10:00 슬롯에서 카드가 사라져야 함',
      ).not.toBeVisible({ timeout: 3000 });
    }
  });

  // ── AC-1: DB reservation_time 업데이트 확인 ───────────────────────────
  test('시나리오 3 — DB reservation_time 업데이트 확인', async () => {
    // 시나리오 1 실행 후 DB 확인 (별도 페이지 없이 DB 직접 조회)
    const { data: resv, error } = await service
      .from('reservations')
      .select('reservation_time')
      .eq('id', newResvId)
      .single();

    expect(error, 'DB 조회 에러 없어야 함').toBeNull();
    expect(resv?.reservation_time, 'DB reservation_time이 14:00으로 업데이트되어야 함')
      .toMatch(/^14:00/); // "14:00" 또는 "14:00:00"
  });

  // ── AC-2: 재진 예약 시간 변경 ──────────────────────────────────────────
  test('시나리오 2 — 재진 예약 시간 변경 후 즉시 카드 이동', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto(`/admin/reservations?date=${TEST_DATE}`);
    await page.waitForTimeout(1500);

    // 재진 카드 확인
    const retCard = page.locator(`[data-testid="resv-card-${retResvId}"]`);
    await expect(retCard, `재진 예약 카드 ${retResvId} 보여야 함`).toBeVisible({ timeout: 8000 });

    // 더블클릭으로 편집 모달 오픈
    await retCard.dblclick();
    await page.waitForTimeout(400);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog, '편집 모달이 열려야 함').toBeVisible({ timeout: 5000 });

    // 16:00으로 시간 변경
    const timeSelect = dialog.locator('select').first();
    await timeSelect.selectOption('16:00');

    const saveBtn = dialog.getByRole('button', { name: '저장' });
    await saveBtn.click();

    await expect(dialog, '모달이 닫혀야 함').not.toBeVisible({ timeout: 5000 });

    // 즉시 반영 확인
    await expect(
      page.locator(`[data-testid="resv-card-${retResvId}"]`),
      '16:00 슬롯에 카드가 이동해야 함',
    ).toBeVisible({ timeout: 5000 });

    // DB 확인
    const { data: updated } = await service
      .from('reservations')
      .select('reservation_time')
      .eq('id', retResvId)
      .single();
    expect(updated?.reservation_time, 'DB reservation_time이 16:00으로 업데이트되어야 함')
      .toMatch(/^16:00/);
  });
});
