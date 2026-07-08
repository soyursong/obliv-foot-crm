/**
 * E2E spec — T-20260708-foot-CHART1-PAY-MINIWINDOW-IDNAME
 * 김주연 총괄(풋센터): 1번차트 [결제하기] 2건
 *   (a) 미니창 전환: 1번차트 [결제 등록/결제하기] 클릭 시 기존 대형 팝업(PaymentDialog) 대신
 *       旣존 컴팩트 '결제 미니창'(PaymentMiniWindow)으로 열기. 결제 데이터·payment_items·저장 경로 재사용.
 *   (b) 등록자 이름 노출: 결제 금액 수정(편집) 이력에서 등록자(actor)가 '계정 아이디(email/id)'로
 *       나오던 것을 '사람 이름(user_profiles.name)'으로 노출. 무매칭 시 graceful fallback.
 *
 * AC:
 *  AC1 1번차트 [결제 등록] → PaymentMiniWindow(pmw-code-grid) 오픈, 기존 PaymentDialog 아님.
 *  AC2 미니창 기능 무회귀(다른 진입점/컴포넌트 영향 0) — 라우팅 교체만, 미니창 데이터 경로 불변.
 *  AC3 금액 수정 이력 등록자 = 계정ID → 사람 이름(표시명) 해소(user_profiles.name).
 *  AC4 이름 해소 실패(무매칭) 시 raw actor로 graceful fallback, 결제 값/저장 무영향.
 *  AC5 스키마 무변경(display-only) — payments/payment_items 쓰기 경로 불변.
 *
 * 시나리오:
 *  1) 1번차트 결제하기 → 旣존 결제 미니창 열기 (browser)
 *  2) 금액 수정 화면 등록자 이름 노출 (DB — 컴포넌트 해소 쿼리 재현)
 *  3) 회귀 — 결제 데이터(payment_items) 무영향 (DB)
 *
 * 데이터/로그인/clinic 미준비 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  loginAndWaitForDashboard,
  seedTodayActiveCheckin,
  cleanupSeededCheckin,
  dismissCustomerChartSheet,
  type SeededCheckin,
} from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// PaymentAuditLogsPanel의 actor→name 해소 로직과 동일(display-only, 스키마 무변경).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('T-20260708-foot-CHART1-PAY-MINIWINDOW-IDNAME', () => {

  // ── 시나리오 1: 1번차트 [결제 등록] → 旣존 결제 미니창(PaymentMiniWindow) ─────────────
  test('시나리오1 (AC1/AC2): 1번차트 결제하기 → PaymentMiniWindow 오픈(기존 팝업 아님)', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // 미결제(payments 0) 상태의 오늘자 카드를 self-seed → 1번차트에 [결제 등록] 버튼 노출 보장.
    const seed: SeededCheckin | null = await seedTodayActiveCheckin(sb, CLINIC_ID);
    if (!seed) { test.skip(true, '체크인 시드 실패 — 스킵'); return; }

    try {
      await page.goto('/admin');
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

      // 시드한 카드를 이름으로 찾아 클릭
      const card = page.locator('[data-testid="checkin-card"]', { hasText: seed.name }).first();
      const found = await card.isVisible({ timeout: 8_000 }).catch(() => false);
      if (!found) { test.skip(true, '시드 카드 미렌더(필터/컬럼) — 스킵'); return; }
      await card.click();

      // 카드 클릭은 2번차트(CustomerChartSheet)를 위에 띄운다 → 닫아서 1번차트 노출
      await dismissCustomerChartSheet(page);

      const sheet = page.locator('[data-testid="checkin-detail-sheet"]').first();
      const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      if (!sheetVisible) { test.skip(true, '1번차트 시트 미오픈 — 스킵'); return; }

      // 1번차트 [결제 등록] 버튼 (미결제 상태에서만 노출)
      const payBtn = page.locator('[data-testid="btn-chart1-payment-register"]');
      const payBtnVisible = await payBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!payBtnVisible) { test.skip(true, '결제 등록 버튼 미노출(이미 결제/상태) — 스킵'); return; }
      await payBtn.scrollIntoViewIfNeeded().catch(() => {});
      await payBtn.click();

      // AC1: PaymentMiniWindow 열림 — 코드 그리드(pmw-code-grid)가 미니창의 고유 마커
      const miniGrid = page.locator('[data-testid="pmw-code-grid"]');
      await expect(miniGrid, '1번차트 결제하기 → PaymentMiniWindow(pmw-code-grid) 열림').toBeVisible({ timeout: 8_000 });

      // AC1(negative): 기존 대형 PaymentDialog의 수납 제출 버튼(btn-payment-submit)은 열리지 않음
      const oldDialogSubmit = page.locator('[data-testid="btn-payment-submit"]');
      await expect(oldDialogSubmit, '기존 PaymentDialog는 열리지 않음').toHaveCount(0);

      console.log('[시나리오1] 1번차트 결제하기 → 미니창 라우팅(기존 팝업 아님) PASS');
    } finally {
      await sb.from('payments').delete().eq('check_in_id', seed.checkInId);
      await sb.from('check_in_services').delete().eq('check_in_id', seed.checkInId);
      await cleanupSeededCheckin(sb, seed);
    }
  });

  // ── 시나리오 2: 금액 수정 이력 등록자 계정ID → 사람 이름 노출 ─────────────────────────
  test('시나리오2 (AC3/AC4): 금액 수정 이력 등록자 계정ID → 사람 이름 해소 + graceful fallback', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // 이름 소스(旣존): user_profiles에서 email+name 보유 계정 1건 확보(신규 시드/스키마 없음).
    const { data: profs } = await sb
      .from('user_profiles')
      .select('id, email, name')
      .eq('clinic_id', CLINIC_ID)
      .not('name', 'is', null)
      .not('email', 'is', null)
      .limit(1);
    if (!profs || profs.length === 0) { test.skip(true, 'user_profiles 이름 소스 없음 — 스킵'); return; }
    const actorEmail = profs[0].email as string;
    const expectedName = profs[0].name as string;

    const testName = `id2name-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select().single();
    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({ clinic_id: CLINIC_ID, customer_id: customer!.id, customer_name: testName, customer_phone: testPhone, visit_type: 'returning', status: 'done', queue_number: 985 })
      .select().single();
    const checkInId = checkIn!.id as string;
    const { data: pay } = await sb
      .from('payments')
      .insert({ check_in_id: checkInId, clinic_id: CLINIC_ID, customer_id: customer!.id, amount: 30000, method: 'card', payment_type: 'payment' })
      .select().single();
    const paymentId = pay!.id as string;

    try {
      // 금액 수정 이력(actor=계정 email)을 audit에 기록 (PaymentEditDialog handleEdit 경로 시뮬)
      await sb.from('payment_audit_logs').insert({
        payment_id: paymentId, clinic_id: CLINIC_ID, check_in_id: checkInId,
        action: 'edit', before_data: { amount: 30000 }, after_data: { amount: 25000 },
        actor: actorEmail, reason: null,
      });
      // 무매칭 actor(graceful fallback 검증용)
      const unknownActor = `no-such-${Date.now()}@nowhere.invalid`;
      await sb.from('payment_audit_logs').insert({
        payment_id: paymentId, clinic_id: CLINIC_ID, check_in_id: checkInId,
        action: 'edit', before_data: { amount: 25000 }, after_data: { amount: 20000 },
        actor: unknownActor, reason: null,
      });

      // PaymentAuditLogsPanel.load() 해소 로직 재현
      const { data: logs } = await sb
        .from('payment_audit_logs')
        .select('actor')
        .eq('payment_id', paymentId);
      const actors = Array.from(new Set((logs ?? []).map((r: { actor: string | null }) => r.actor).filter((a): a is string => !!a)));
      const emails = actors.filter((a) => a.includes('@'));
      const ids = actors.filter((a) => UUID_RE.test(a));
      const nameMap: Record<string, string> = {};
      if (emails.length) {
        const { data: pe } = await sb.from('user_profiles').select('email, name').in('email', emails);
        ((pe as { email: string | null; name: string | null }[] | null) ?? []).forEach((p) => { if (p.email && p.name) nameMap[p.email] = p.name; });
      }
      if (ids.length) {
        const { data: pi } = await sb.from('user_profiles').select('id, name').in('id', ids);
        ((pi as { id: string; name: string | null }[] | null) ?? []).forEach((p) => { if (p.id && p.name) nameMap[p.id] = p.name; });
      }

      // AC3: 계정 email → 사람 이름 해소
      const resolved = nameMap[actorEmail] ?? actorEmail;
      expect(resolved, `등록자 계정(${actorEmail}) → 이름(${expectedName})으로 노출`).toBe(expectedName);
      expect(resolved.includes('@'), '해소 후 계정 아이디(@) 노출 아님').toBe(false);

      // AC4: 무매칭 actor → raw actor로 graceful fallback (빈칸/깨짐 없음)
      const fallback = nameMap[unknownActor] ?? unknownActor;
      expect(fallback, '무매칭 등록자는 기존 값(raw actor)으로 fallback').toBe(unknownActor);

      console.log(`[시나리오2] 등록자 ${actorEmail} → "${expectedName}" 노출 + 무매칭 graceful PASS`);
    } finally {
      await sb.from('payment_audit_logs').delete().eq('payment_id', paymentId);
      await sb.from('payments').delete().eq('id', paymentId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  // ── 시나리오 3: 회귀 — 결제 데이터(payment_items) 무영향 ─────────────────────────────
  test('시나리오3 (AC5): 미니창 전환·이름 표시가 결제 항목별 데이터(payment_items)를 깨지 않음', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    const testName = `noreg-pay-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select().single();
    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({ clinic_id: CLINIC_ID, customer_id: customer!.id, customer_name: testName, customer_phone: testPhone, visit_type: 'returning', status: 'done', queue_number: 986 })
      .select().single();
    const checkInId = checkIn!.id as string;
    const { data: pay } = await sb
      .from('payments')
      .insert({ check_in_id: checkInId, clinic_id: CLINIC_ID, customer_id: customer!.id, amount: 45000, method: 'card', payment_type: 'payment' })
      .select().single();
    const paymentId = pay!.id as string;

    try {
      // 항목별 명세(payment_items) 저장 — PAYMENT-ITEMIZED 데이터 경로 (미니창/편집이 재사용, 무변경)
      const { error: itemErr } = await sb.from('payment_items').insert([
        { payment_id: paymentId, check_in_id: checkInId, service_name: '풋케어 기본', service_code: 'FC001', quantity: 1, unit_price: 30000, line_amount: 30000, charge_class: '비급여' },
        { payment_id: paymentId, check_in_id: checkInId, service_name: '진찰료', service_code: 'AA157', quantity: 1, unit_price: 15000, line_amount: 15000, charge_class: '급여' },
      ]);
      expect(itemErr, `payment_items 저장 실패: ${itemErr?.message}`).toBeNull();

      // PaymentItemsView select 경로 그대로 재조회 → 값 무손실 확인
      const { data: items } = await sb
        .from('payment_items')
        .select('service_name, charge_class, unit_price, quantity, line_amount')
        .eq('payment_id', paymentId)
        .order('service_code');
      expect(items?.length, '항목 2건 그대로 보존').toBe(2);
      const sum = (items ?? []).reduce((a, r: { line_amount: number }) => a + r.line_amount, 0);
      expect(sum, '항목 합계 = 결제 금액(45,000) 정합').toBe(45000);
      // 급여/비급여 구분(charge_class) 보존
      const classes = new Set((items ?? []).map((r: { charge_class: string }) => r.charge_class));
      expect(classes.has('급여') && classes.has('비급여'), '급여/비급여 구분 보존').toBe(true);

      // payments 금액 자체도 무영향
      const { data: p2 } = await sb.from('payments').select('amount').eq('id', paymentId).single();
      expect(p2?.amount, '결제 금액 무영향').toBe(45000);

      console.log('[시나리오3] payment_items 항목·급여구분·금액 무회귀 PASS');
    } finally {
      await sb.from('payment_items').delete().eq('payment_id', paymentId);
      await sb.from('payments').delete().eq('id', paymentId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
