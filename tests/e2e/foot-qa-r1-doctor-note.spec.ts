/**
 * QA Round 1 — CheckInDetailSheet 원장 소견 발견성 + 입력 (T4 + T2)
 * foot-059 검증.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('QA-R1 원장 소견 (foot-059)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('카드 클릭 → CheckInDetailSheet 오픈 → "원장 소견" 라벨 노출', async ({ page }) => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: cards } = await sb
      .from('check_ins')
      .select('id, customer_name')
      .eq('clinic_id', CLINIC_ID)
      .eq('created_date', today)
      .neq('status', 'no_show')
      .limit(1);
    if (!cards || cards.length === 0) {
      test.skip(true, '오늘 카드 없음');
      return;
    }
    const target = cards[0];
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 카드 텍스트 클릭 (이름으로 식별)
    const cardLocator = page.getByText(target.customer_name as string).first();
    if (!(await cardLocator.isVisible().catch(() => false))) {
      test.skip(true, `카드 ${target.customer_name} 화면에 안 보임`);
      return;
    }
    await cardLocator.click();
    await page.waitForTimeout(800);

    // Sheet 안에 "원장 소견" 라벨 가시
    const labelVisible = await page.getByText('원장 소견').first().isVisible().catch(() => false);
    console.log('"원장 소견" 라벨 노출:', labelVisible);
    expect(labelVisible).toBe(true);

    // placeholder 안내 텍스트 (대리 메모 가능)
    const placeholderVisible = await page
      .getByPlaceholder(/원장 소견을 자유롭게|대리 메모/)
      .first()
      .isVisible()
      .catch(() => false);
    console.log('placeholder 노출:', placeholderVisible);
    expect(placeholderVisible).toBe(true);
  });

  test('Textarea 입력 → 저장 → DB doctor_note 반영', async ({ page }) => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: cards } = await sb
      .from('check_ins')
      .select('id, customer_name, doctor_note')
      .eq('clinic_id', CLINIC_ID)
      .eq('created_date', today)
      .neq('status', 'no_show')
      .limit(1);
    if (!cards || cards.length === 0) {
      test.skip(true, '오늘 카드 없음');
      return;
    }
    const target = cards[0];
    const origNote = target.doctor_note;
    const testNote = `qa-r1 원장소견 ${Date.now()}`;

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const cardLocator = page.getByText(target.customer_name as string).first();
    if (!(await cardLocator.isVisible().catch(() => false))) {
      test.skip(true, '카드 안 보임');
      return;
    }
    await cardLocator.click();
    await page.waitForTimeout(800);

    const textarea = page
      .getByPlaceholder(/원장 소견을 자유롭게|대리 메모/)
      .first();
    if (!(await textarea.isVisible().catch(() => false))) {
      test.skip(true, 'Textarea 안 보임');
      return;
    }
    await textarea.fill(testNote);

    // 저장 버튼 (카운터파트 동작)
    const saveBtn = page.getByRole('button', { name: /저장|기록 저장|메모 저장/ }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
    }

    // DB 검증
    const { data } = await sb.from('check_ins').select('doctor_note').eq('id', target.id).single();
    console.log('DB doctor_note:', data?.doctor_note);
    expect(data?.doctor_note).toBe(testNote);

    // 정리
    await sb.from('check_ins').update({ doctor_note: origNote }).eq('id', target.id);
  });
});
