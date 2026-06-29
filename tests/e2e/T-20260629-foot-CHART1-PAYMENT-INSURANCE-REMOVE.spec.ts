/**
 * E2E spec — T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE
 * 풋센터 CRM 1번차트(CheckInDetailSheet) — '수납 처리' 카드 + '건보공단 실시간 자격조회' row 제거
 *
 * 김주연 총괄(2026-06-29) 현장 요청: 1번차트의 미사용 섹션 2개 제거.
 *
 * AC-1: 1번차트에서 '수납 처리' 카드(desk-payment-menu, 3개 하위 블록 포함) 미노출
 * AC-2: 1번차트 상단 '건보공단 실시간 자격조회' row + 자격조회 버튼 미노출
 * AC-3(가드): 결제/회차차감/보험청구는 다른 진입점 존재 — 결제 섹션('결제 등록'),
 *             진료차트(2번차트 C2-PKG-TICKET-TABLE), 서류 발행 패널(DocumentPrintPanel). (코드 동선으로 확인 완료)
 * AC-4: 보존 대상 정상 노출 — 고객차트/진료차트 버튼, 금일 동선, 패키지 섹션, 결제 섹션, 서류 발행, 메모 영역
 *
 * 시나리오:
 *   S-1: payment_waiting 재진 슬롯 1번차트 오픈 → '수납 처리' 카드 미노출(AC-1) + 보존 대상 노출(AC-4)
 *   S-2: 1번차트에 '건보공단 실시간 자격조회' row + '자격조회' 버튼 미노출(AC-2)
 *
 * ※ 카드 클릭 시 2번차트(CustomerChartSheet, z-70)가 위에 떠 1번차트를 덮으므로
 *    dismissCustomerChartSheet 로 2번차트를 닫아 1번차트를 드러낸 뒤 검증한다(helpers RC-C 패턴).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function adminSb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

test.describe('T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE — 1번차트 수납 처리 + 건보공단 자격조회 제거', () => {
  test('S-1: payment_waiting 1번차트 → 수납 처리 카드 미노출(AC-1) + 보존 대상 노출(AC-4)', async ({ page }) => {
    if (!SERVICE_KEY) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;
    const qn = 921;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-chart1-rm-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-chart1-rm',
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

      // ── AC-1: '수납 처리' 카드(desk-payment-menu) + 3개 하위 블록 모두 미노출 ──
      await expect(page.locator('[data-testid="desk-payment-menu"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-session-deduct"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-single-payment"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="desk-menu-insurance-doc"]')).toHaveCount(0);

      const sheet = page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')).first();
      // 시트 본문에 '수납 처리' 헤더 텍스트 없음 (DeskPaymentMenu 헤더 제거 확인)
      await expect(page.getByText('수납 처리', { exact: true })).toHaveCount(0);

      // ── AC-4: 보존 대상 노출 ──
      // 고객차트 / 진료차트 버튼
      await expect(page.getByRole('button', { name: '고객차트' }).first()).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole('button', { name: '진료차트' }).first()).toBeVisible({ timeout: 3000 });
      // 금일 동선
      await expect(page.locator('[data-testid="daily-room-log-section"]').first()).toBeVisible({ timeout: 3000 });
      // 패키지 섹션 헤더(시트 범위)
      await expect(sheet.getByText('패키지').first()).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'test-results/screenshots/T-20260629-CHART1-RM-S1.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });

  test('S-2: 1번차트에 건보공단 실시간 자격조회 row + 자격조회 버튼 미노출(AC-2)', async ({ page }) => {
    if (!SERVICE_KEY) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;
    const qn = 922;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-chart1-nhis-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-chart1-nhis',
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

      // ── AC-2: 건보공단 실시간 자격조회 row 미노출 ──
      await expect(page.getByText('건보공단 실시간 자격조회')).toHaveCount(0);
      // 자격조회 버튼 미노출
      await expect(page.getByRole('button', { name: '자격조회' })).toHaveCount(0);

      // 보존 회귀: 예약메모 영역은 정상 노출 (건보 row 제거가 인접 메모 블록을 깨지 않음)
      const sheet = page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')).first();
      await expect(sheet.getByText('예약메모').first()).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'test-results/screenshots/T-20260629-CHART1-RM-S2.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});
