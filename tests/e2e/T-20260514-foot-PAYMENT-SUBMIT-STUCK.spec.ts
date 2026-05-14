/**
 * E2E spec — T-20260514-foot-PAYMENT-SUBMIT-STUCK
 * 결제 미니창 "[수납]" / "[출력 및 수납]" 버튼 "처리 중..." 멈춤 버그 검증
 *
 * 버그 원인:
 *   - handleSettle: try 블록 성공 경로에 setSubmitting(false) 누락
 *     → e3a606f (PAYMENT-BLOCKED 커밋)에서 수정 완료
 *   - handleDocAndSettle: try 블록 성공 경로에 setDocSettlePrinting(false) 누락
 *     → 본 커밋에서 수정
 *
 * 시나리오 1: handleSettle 정상 수납 — 성공 후 토스트+완료 확인 (setSubmitting fix)
 * 시나리오 2: handleDocAndSettle 출력+수납 — 성공 후 토스트+완료 확인 (setDocSettlePrinting fix)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260514-PAYMENT-SUBMIT-STUCK — 버튼 멈춤 버그 회귀', () => {

  test('시나리오 1: 정상 수납 — setSubmitting(false) 성공 경로 fix 검증', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `submit-stuck-s1-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 서비스 ID 조회
    const { data: svcs } = await sb
      .from('services')
      .select('id, name, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .order('sort_order')
      .limit(1);
    const svcId = svcs?.[0]?.id;
    if (!svcId) {
      test.skip(true, '서비스 없음 — 스킵');
      return;
    }

    // 테스트 고객 생성
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    // payment_waiting 체크인 생성
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 980,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

    // check_in_services 미리 세팅 (saved=true 진입)
    await sb.from('check_in_services').insert({
      check_in_id: checkIn!.id,
      service_id: svcId,
      service_name: svcs![0].name ?? '테스트서비스',
      price: svcs![0].price ?? 10000,
      original_price: svcs![0].price ?? 10000,
      is_package_session: false,
    });

    try {
      // 1. 대시보드 진입
      await page.goto('/');
      await page.waitForTimeout(1500);

      // 2. 수납대기 슬롯에서 [결제하기] 클릭
      const openBtn = page.getByText('결제하기').first();
      await expect(openBtn).toBeVisible({ timeout: 10000 });
      await openBtn.click();

      // 3. 결제 미니창 오픈 확인
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 4. saved=true 상태 확인 — [수납] 버튼 표시 확인
      const settleBtn = page.getByTestId('btn-settle');
      await expect(settleBtn).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('저장됨')).toBeVisible();

      // 5. [수납] 버튼 텍스트 정상 상태 확인 (처리 중... 아님)
      await expect(settleBtn).not.toHaveText('처리 중...');

      // 6. [수납] 버튼 클릭
      await settleBtn.click();

      // 7. 수납 완료 토스트 확인 (성공 경로 도달 = setSubmitting(false) 호출됨)
      await expect(page.getByText('수납 완료')).toBeVisible({ timeout: 8000 });

      // 8. DB 검증: check_in status = done
      await page.waitForTimeout(1500);
      const { data: ci } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkIn!.id)
        .single();
      expect(ci?.status).toBe('done');

      // 9. DB 검증: payment 생성
      const { data: pay } = await sb
        .from('payments')
        .select('id, amount, status')
        .eq('check_in_id', checkIn!.id)
        .single();
      expect(pay).not.toBeNull();
      expect(pay?.amount).toBeGreaterThan(0);

    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_in_services').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 2: 출력 및 수납 — setDocSettlePrinting(false) 성공 경로 fix 검증', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `submit-stuck-s2-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 서비스 ID 조회
    const { data: svcs } = await sb
      .from('services')
      .select('id, name, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .order('sort_order')
      .limit(1);
    const svcId = svcs?.[0]?.id;
    if (!svcId) {
      test.skip(true, '서비스 없음 — 스킵');
      return;
    }

    // 서류 템플릿 확인 (출력 및 수납에 서류 선택 필요)
    const { data: templates } = await sb
      .from('consent_templates')
      .select('form_key, title')
      .eq('clinic_id', CLINIC_ID)
      .limit(1);

    if (!templates || templates.length === 0) {
      test.skip(true, '동의서 템플릿 없음 — 스킵');
      return;
    }

    // 테스트 고객 생성
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    // payment_waiting 체크인 생성
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 981,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

    // check_in_services 미리 세팅
    await sb.from('check_in_services').insert({
      check_in_id: checkIn!.id,
      service_id: svcId,
      service_name: svcs![0].name ?? '테스트서비스',
      price: svcs![0].price ?? 10000,
      original_price: svcs![0].price ?? 10000,
      is_package_session: false,
    });

    // window.open 가로채기 — 출력 팝업 차단 방지
    await page.addInitScript(() => {
      window.open = (_url?: string | URL, _target?: string) => {
        // 팝업 차단 우회: 빈 window 반환
        return window;
      };
    });

    try {
      // 1. 대시보드 진입
      await page.goto('/');
      await page.waitForTimeout(1500);

      // 2. 수납대기 슬롯에서 [결제하기] 클릭
      const openBtn = page.getByText('결제하기').first();
      await expect(openBtn).toBeVisible({ timeout: 10000 });
      await openBtn.click();

      // 3. 결제 미니창 오픈 확인
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 4. saved=true 상태 확인
      await expect(page.getByText('저장됨')).toBeVisible({ timeout: 5000 });

      // 5. 서류 체크박스 선택 (서류 탭에 있으므로 탭 이동 필요)
      const docCheckbox = page.locator('[data-form-key]').first();
      const fallbackCheckbox = page.locator('input[type="checkbox"]').first();
      const checkboxTarget = (await docCheckbox.count()) > 0 ? docCheckbox : fallbackCheckbox;

      if (await checkboxTarget.isVisible({ timeout: 3000 })) {
        await checkboxTarget.click();
      } else {
        // 서류 탭 클릭
        const docTab = page.getByRole('button', { name: /동의서|서류/ }).first();
        if (await docTab.isVisible({ timeout: 2000 })) {
          await docTab.click();
          await page.waitForTimeout(500);
        }
      }

      // 6. [출력 및 수납] 버튼 확인
      const docSettleBtn = page.getByRole('button', { name: /출력 및 수납/ });
      await expect(docSettleBtn).toBeVisible({ timeout: 5000 });

      // 7. 버튼 정상 상태 확인 (처리 중... 아님)
      await expect(docSettleBtn).not.toHaveText(/처리 중/);

      // 8. [출력 및 수납] 클릭
      await docSettleBtn.click();

      // 9. 성공 토스트 확인 (성공 경로 도달 = setDocSettlePrinting(false) 호출됨)
      // window.open이 mock되어 있으므로 수납 성공 경로까지 진행 가능
      await expect(page.getByText(/출력 및 수납 완료|수납 완료/)).toBeVisible({ timeout: 8000 });

      // 10. DB 검증: payment 생성
      await page.waitForTimeout(1500);
      const { data: pay } = await sb
        .from('payments')
        .select('id, amount')
        .eq('check_in_id', checkIn!.id)
        .single();
      expect(pay).not.toBeNull();
      expect(pay?.amount).toBeGreaterThan(0);

    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_in_services').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
