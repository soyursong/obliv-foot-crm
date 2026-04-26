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

  test('이름 + 전화 + visit_type 입력 → 접수 완료 → DB 검증', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 이름 입력 (label "이름" 또는 placeholder)
    const nameInput = page.getByLabel(/이름/).first();
    await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await nameInput.fill(TEST_NAME);

    const phoneInput = page.getByLabel(/연락처|전화/).first();
    await phoneInput.fill(TEST_PHONE);

    // visit_type — 신규/재진/체험 중 신규 선택 (text 또는 button)
    const newBtn = page.getByRole('button', { name: /신규/ }).first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
    }

    // 제출 버튼 (접수, 완료, 등록 등)
    const submitBtn = page.getByRole('button', { name: /접수|완료|등록|체크인|확인/ }).last();
    await submitBtn.click();

    // 완료 화면 또는 DB INSERT 검증
    await page.waitForTimeout(2000);
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
