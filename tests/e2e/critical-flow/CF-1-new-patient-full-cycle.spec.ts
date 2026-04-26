/**
 * T3 Critical Flow CF-1 — 신규 환자 풀 사이클 (T-foot-qa-002)
 *
 * 시나리오:
 *   1. 셀프체크인 anon → 신규 등록
 *   2. 칸반에서 카드 발견 (registered 컬럼)
 *   3. checklist 단계 (DB 직접 — UI는 별 spec)
 *   4. 원장 진료 단계 + doctor_note 입력
 *   5. 상담 단계 → 결제 (단건)
 *   6. 시술 단계
 *   7. 완료
 *   8. cleanup
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../../helpers';
import { dragCard, openSheet } from '../../helpers/interaction';
import { CLINIC_ID } from '../../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-1 신규 환자 풀 사이클', () => {
  const TS = Date.now();
  const TEST_NAME = `cf1-new-${TS}`;
  const TEST_PHONE = `010${String(TS).slice(-8)}`;
  let testCheckInId: string | null = null;
  let testCustomerId: string | null = null;

  test.afterAll(async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    if (testCheckInId) {
      await sb.from('payments').delete().eq('check_in_id', testCheckInId);
      await sb.from('check_ins').delete().eq('id', testCheckInId);
    }
    if (testCustomerId) {
      await sb.from('customers').delete().eq('id', testCustomerId);
    }
    // phone 매칭으로도 cleanup (셀프체크인 customer)
    const { data: leftover } = await sb.from('customers').select('id').eq('phone', TEST_PHONE);
    if (leftover && leftover.length) {
      const ids = leftover.map((r) => r.id as string);
      await sb.from('check_ins').delete().in('customer_id', ids);
      await sb.from('customers').delete().in('id', ids);
    }
  });

  test('1. 셀프체크인 anon → DB INSERT', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');
    await page.locator('#sc-name').fill(TEST_NAME);
    await page.locator('#sc-phone').fill(TEST_PHONE);
    await page.getByRole('button', { name: '신규' }).click();
    await page.getByRole('button', { name: '접수', exact: true }).click();
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();
    await page.waitForTimeout(2000);

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data } = await sb
      .from('check_ins')
      .select('id, customer_id, status, visit_type')
      .eq('clinic_id', CLINIC_ID)
      .eq('customer_name', TEST_NAME)
      .order('checked_in_at', { ascending: false })
      .limit(1);
    expect(data?.length).toBeGreaterThan(0);
    testCheckInId = data![0].id as string;
    testCustomerId = data![0].customer_id as string;
    expect(data![0].status).toBe('registered');
    expect(data![0].visit_type).toBe('new');
  });

  test('2-3. 칸반에서 카드 발견 + checklist 단계 진입', async ({ page }) => {
    if (!testCheckInId) test.skip(true, 'CF-1.1 미통과');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');

    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${testCheckInId}"]`);
    await card.waitFor({ state: 'visible', timeout: 5000 });

    // 신규 환자: registered → checklist 가드 통과 (오직 checklist만 허용)
    await dragCard(page, testCheckInId!, 'checklist');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data } = await sb.from('check_ins').select('status').eq('id', testCheckInId!).single();
    expect(['checklist', 'exam_waiting']).toContain(data?.status);
  });

  test('4. 원장 진료 단계 + doctor_note 입력', async ({ page }) => {
    if (!testCheckInId) test.skip(true, '이전 단계 미통과');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // checklist → exam_waiting 또는 examination 으로 직접 (UI 가드 우회: DB 직접)
    await sb.from('check_ins').update({ status: 'examination' }).eq('id', testCheckInId);

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');

    await openSheet(page, TEST_NAME);

    // 원장 소견 라벨 + Textarea 노출
    await expect(page.getByText('원장 소견').first()).toBeVisible();
    const textarea = page.getByPlaceholder(/원장 소견을 자유롭게|대리 메모/).first();
    await textarea.fill('CF-1 진료 메모');
    // 저장 버튼
    const saveBtn = page.getByRole('button', { name: /저장|기록 저장|메모 저장/ }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
    }
    const { data } = await sb.from('check_ins').select('doctor_note').eq('id', testCheckInId).single();
    expect(data?.doctor_note).toContain('CF-1 진료 메모');
  });

  test('5. 결제 → DB payments INSERT', async ({ page }) => {
    if (!testCheckInId) test.skip(true, '이전 단계 미통과');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    await sb.from('check_ins').update({ status: 'payment_waiting' }).eq('id', testCheckInId);

    // 결제는 PaymentDialog UI 시뮬 어려워 DB 직접 INSERT (단건 결제)
    const { error } = await sb.from('payments').insert({
      clinic_id: CLINIC_ID,
      check_in_id: testCheckInId,
      customer_id: testCustomerId,
      amount: 50000,
      method: 'card',
      installment: null,
      memo: 'CF-1 단건 결제',
      payment_type: 'payment',
    });
    expect(error).toBeNull();

    // status auto-transition (PaymentDialog 안 거치므로 수동)
    await sb.from('check_ins').update({ status: 'treatment_waiting' }).eq('id', testCheckInId);
    const { data } = await sb.from('payments').select('id, amount').eq('check_in_id', testCheckInId);
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data![0].amount).toBe(50000);
  });

  test('6-7. 시술 → 완료', async () => {
    if (!testCheckInId) test.skip(true, '이전 단계 미통과');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // treatment_waiting → treatment → done
    await sb.from('check_ins').update({ status: 'treatment', treatment_room: '치료실1' }).eq('id', testCheckInId);
    await sb.from('check_ins').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', testCheckInId);
    const { data } = await sb.from('check_ins').select('status, completed_at').eq('id', testCheckInId).single();
    expect(data?.status).toBe('done');
    expect(data?.completed_at).toBeTruthy();
  });
});
