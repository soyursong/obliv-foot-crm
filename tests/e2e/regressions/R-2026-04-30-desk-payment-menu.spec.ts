/**
 * 회귀 보호 스펙 — T-20260430-foot-DESK-PAYMENT-MENU (OBSOLETE / REMOVAL GUARD)
 *
 * ⚠️ 2026-06-29 T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE 로 DeskPaymentMenu('수납 처리' 카드)는
 *    1번차트(CheckInDetailSheet)에서 의도적으로 제거됨(김주연 총괄 현장 요청).
 *    기존 T1~T8(메뉴 + 3버튼 렌더/동작) 검증은 폐기되고, 본 파일은 "다시 살아나지 않음"을 지키는
 *    제거 회귀 가드로 전환한다. 3개 하위 기능의 대체 진입점:
 *      · 진료비 결제   → 1번차트 결제 섹션 '결제 등록' 버튼
 *      · 회차 차감     → 진료차트(2번차트) C2-PKG-TICKET-TABLE
 *      · 보험청구 서류 → 1번차트 하단 '서류 발행'(DocumentPrintPanel)
 *    상세 제거/보존 검증은 T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE.spec.ts 가 담당.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function adminSb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

test.describe('REMOVAL GUARD: payment_waiting 1번차트 → desk-payment-menu 미노출', () => {
  test('payment_waiting 시트 오픈 → desk-payment-menu + 하위 버튼 모두 미노출', async ({ page }) => {
    if (!SERVICE_KEY) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;
    const qn = 920;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-rm-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-rm',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: qn,
      })
      .select()
      .single();

    try {
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) { test.skip(true, '로그인 실패'); return; }

      const card = page.getByText(`#${qn}`).first();
      const visible = await card.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: `큐번호 ${qn} 카드 미표시` });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      // 제거 회귀 가드: DeskPaymentMenu 와 모든 하위 버튼이 더 이상 렌더되지 않아야 함
      await expect(page.locator('[data-testid="desk-payment-menu"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-session-deduct"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-single-payment"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-insurance-doc"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-new-package"]')).toHaveCount(0);

      // 대체 진입점 보존: 결제 섹션 '결제 등록' 버튼은 노출(미결제 상태)
      await expect(page.getByRole('button', { name: '결제 등록' }).first()).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-REMOVED.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});
