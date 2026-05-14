/**
 * E2E spec — T-20260514-foot-PAYMENT-BLOCKED
 * 풋센터 결제 자체 불가 P0 핫픽스 검증
 *
 * 진단 결과:
 *   - AC-3 (Migration): 20260514000010 적용 완료 — status 컬럼 존재
 *   - AC-2 (RLS): admin 사용자(주연총괄) 권한 정상
 *   - AC-1 (2단계 UX): check_in_services 없는 check-in은 saved=false →
 *       수납 버튼 미표시 + 안내문구 없음 → "결제 안 됨" 체감 → 수정 완료
 *
 * 시나리오 1: 정상 결제 동선 (시술 선택 → 산정 → 수납 → 완료)
 * 시나리오 2: 2단계 UX — 산정 미완료 시 수납 버튼 미표시 + 안내 문구 표시
 * 시나리오 3: check_in_services 있는 check-in은 창 열면 saved=true로 수납 바로 가능
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260514-PAYMENT-BLOCKED — 결제 자체 불가 핫픽스 검증', () => {

  test('시나리오 1: 정상 결제 동선 — 시술 선택 → 산정 → 수납 → done', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `blocked-pay-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 테스트 고객 + payment_waiting 체크인 시드 (check_in_services 없음)
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 970,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

    try {
      await page.goto('/');
      await page.waitForTimeout(1500);

      // 수납대기 슬롯에서 [결제하기] 버튼 클릭
      const settleBtn = page.getByText('결제하기').first();
      await expect(settleBtn).toBeVisible({ timeout: 10000 });
      await settleBtn.click();

      // 결제 미니창 오픈 확인
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 시술 코드 선택 (풋케어 탭 첫 번째 버튼)
      const serviceBtn = page.locator('[data-testid^="svc-btn-"]').first();
      await expect(serviceBtn).toBeVisible({ timeout: 5000 });
      await serviceBtn.click();

      // [시술 저장 및 금액 산정] 클릭
      await page.getByRole('button', { name: '시술 저장 및 금액 산정' }).click();

      // 저장됨 + 수납 버튼 표시 확인
      await expect(page.getByText('저장됨')).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('btn-settle')).toBeVisible({ timeout: 3000 });

      // [수납] 버튼 클릭
      await page.getByTestId('btn-settle').click();

      // 수납 완료 토스트 확인
      await expect(page.getByText('수납 완료')).toBeVisible({ timeout: 8000 });

      // DB: check_in status = done + payment 생성 확인
      await page.waitForTimeout(1500);
      const { data: ci } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkIn!.id)
        .single();
      expect(ci?.status).toBe('done');

      const { data: pay } = await sb
        .from('payments')
        .select('id, amount, status')
        .eq('check_in_id', checkIn!.id)
        .single();
      expect(pay?.status).toBe('active');
      expect(pay?.amount).toBeGreaterThan(0);

    } finally {
      // 테스트 데이터 정리
      await sb.from('payments').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_in_services').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 2: 2단계 UX — 산정 미완료 시 수납 버튼 미표시 + 안내 문구 확인', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `ux-hint-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // payment_waiting check-in (check_in_services 없음)
    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();

    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 971,
      })
      .select()
      .single();

    try {
      await page.goto('/');
      await page.waitForTimeout(1500);

      // 결제 미니창 열기
      const settleBtn = page.getByText('결제하기').first();
      await expect(settleBtn).toBeVisible({ timeout: 10000 });
      await settleBtn.click();

      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 창 오픈 직후: saved=false, check_in_services 없음
      // 수납 버튼 미표시 확인 (AC-2 — 의도적 동작)
      await expect(page.getByTestId('btn-settle')).not.toBeVisible();

      // 시술 코드 선택 (저장 안 한 상태)
      const serviceBtn = page.locator('[data-testid^="svc-btn-"]').first();
      await expect(serviceBtn).toBeVisible({ timeout: 5000 });
      await serviceBtn.click();

      // 안내 문구 표시 확인 — "금액 산정 완료 후 수납 버튼이 나타납니다"
      await expect(page.getByTestId('settle-hint')).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId('settle-hint')).toContainText('금액 산정 완료 후 수납 버튼이 나타납니다');

      // 수납 버튼 여전히 미표시 (저장 전)
      await expect(page.getByTestId('btn-settle')).not.toBeVisible();

    } finally {
      await sb.from('check_in_services').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 3: check_in_services 있는 체크인 — 창 열면 수납 버튼 바로 표시', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `preloaded-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 서비스 ID 조회 (기본 탭 첫 번째)
    const { data: svcs } = await sb
      .from('services')
      .select('id, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .order('sort_order')
      .limit(1);
    const svcId = svcs?.[0]?.id;
    if (!svcId) {
      test.skip(true, '서비스 없음 — 스킵');
      return;
    }

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();

    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 972,
      })
      .select()
      .single();

    // check_in_services 미리 세팅 (기존 시술 저장 상태 시뮬레이션)
    await sb.from('check_in_services').insert({
      check_in_id: checkIn!.id,
      service_id: svcId,
      service_name: svcs![0].name ?? '테스트서비스',
      price: svcs![0].price ?? 10000,
      original_price: svcs![0].price ?? 10000,
      is_package_session: false,
    });

    try {
      await page.goto('/');
      await page.waitForTimeout(1500);

      // 결제 미니창 열기
      const settleBtn = page.getByText('결제하기').first();
      await expect(settleBtn).toBeVisible({ timeout: 10000 });
      await settleBtn.click();

      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 창 열리자마자 saved=true → 수납 버튼 바로 표시 확인 (f9e458b 수정 검증)
      await expect(page.getByTestId('btn-settle')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('저장됨')).toBeVisible();

      // 안내 문구 없어야 함 (saved=true이므로)
      await expect(page.getByTestId('settle-hint')).not.toBeVisible();

    } finally {
      await sb.from('check_in_services').delete().eq('check_in_id', checkIn!.id);
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
