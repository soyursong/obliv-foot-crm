/**
 * QA Round 1 — anon 셀프체크인 풀 동선 (T3 critical flow)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TEST_NAME = `qaR1-${Date.now()}`;
const TEST_PHONE = `010${String(Date.now()).slice(-8)}`;

test.describe('QA-R1 셀프체크인 (anon)', () => {
  test('비로그인 anon 진입 → 페이지 200', async ({ page }) => {
    await page.context().clearCookies();
    const resp = await page.goto('/checkin/jongno-foot');
    expect(resp?.status()).toBeLessThan(400);
  });

  test('이름 + 전화 + visit_type 입력 → 접수 → 접수하기 → DB 검증', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 이름 (id="sc-name")
    await page.locator('#sc-name').fill(TEST_NAME);
    // 전화 (id="sc-phone")
    await page.locator('#sc-phone').fill(TEST_PHONE);
    // visit_type — "신규" 버튼 (label)
    await page.getByRole('button', { name: '신규' }).click();
    // 1단계: "접수" 버튼 → step='confirm' 화면
    await page.getByRole('button', { name: '접수', exact: true }).click();
    // confirm 화면에서 "접수하기" 버튼 대기 후 클릭
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();

    // 완료 화면 또는 DB INSERT 검증
    await page.waitForTimeout(2500);
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data, error } = await sb
      .from('check_ins')
      .select('id, customer_name, customer_phone, visit_type, status')
      .eq('clinic_id', CLINIC_ID)
      .eq('customer_name', TEST_NAME)
      .order('checked_in_at', { ascending: false })
      .limit(1);
    console.log('셀프체크인 INSERT 결과:', data, error);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);

    // cleanup
    if (data && data[0]) {
      await sb.from('check_ins').delete().eq('id', data[0].id);
      await sb.from('customers').delete().eq('phone', TEST_PHONE.replace(/\D/g, ''));
    }
  });
});
