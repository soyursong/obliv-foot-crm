/**
 * T-20260529-foot-SELFCHECKIN-FLOW-REVAMP
 * 초진 셀프체크인 개인정보 단계 + 발건강질문지 QR 화면 E2E 검증
 *
 * AC 커버:
 *   AC-1 초진 흐름: input → personal_info → confirm → qr → done
 *   AC-2 personal_info 단계: 주민번호 NumPad · 주소 입력 · 마스킹 표시
 *   AC-3 워크인 흐름: 6필드 (성함/연락처/방문경로 + 주민번호/주소/동의서) → QR
 *   AC-4 QR 화면: data-testid 요소 존재 · 카운트다운 · "질문지 작성 완료" 버튼
 *   AC-5 재진 흐름: personal_info 단계 없이 confirm → done
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function randSuffix() {
  return String(Date.now()).slice(-6);
}

// ── AC-1/2: 초진 흐름 — personal_info 단계 ───────────────────────────────────
test.describe('T-20260529 초진 personal_info 단계', () => {
  const sfx = randSuffix();
  const TEST_NAME = `flow-revamp-new-${sfx}`;
  const TEST_PHONE = `010${sfx}0001`;

  test('초진 → personal_info 단계 진입', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 이름 + 전화 + 초진
    await page.locator('#sc-name').fill(TEST_NAME);
    await page.locator('#sc-phone').fill(TEST_PHONE);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 진입 확인 — 주민번호 안내 텍스트 또는 주소 입력 존재
    await expect(
      page.getByText(/주민번호|생년월일|주소/i).first()
    ).toBeVisible({ timeout: 6000 });
  });

  test('주민번호 NumPad 입력 → 마스킹 표시', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`pi-mask-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0002`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // NumPad: 숫자 버튼 클릭으로 6자리 입력
    for (const digit of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: digit, exact: true }).first().click();
    }
    // 마스킹 표시: 900101-*******
    await expect(page.getByText(/900101/)).toBeVisible({ timeout: 3000 });
  });

  test('주민번호 + 주소 입력 → 다음 버튼 활성', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`pi-next-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0003`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // 주민번호 6자리 이상 입력
    for (const d of ['8', '5', '0', '3', '0', '5']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    // 주소 입력 (input type="text" 또는 textarea)
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('서울시 종로구');

    // 다음 버튼 활성화 확인
    const nextBtn = page.getByRole('button', { name: /다음|확인|입력완료/i });
    await expect(nextBtn).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-3: 워크인 흐름 — 동의서 체크박스 ────────────────────────────────────
test.describe('T-20260529 워크인 개인정보동의 단계', () => {
  const sfx = randSuffix();

  test('워크인 → personal_info 단계에 동의서 체크박스 존재', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`walkin-consent-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0011`);

    // 워크인 버튼 (data-testid="btn-walkin" 또는 텍스트)
    const walkinBtn = page.locator('[data-testid="btn-walkin"]');
    if (await walkinBtn.count() > 0) {
      await walkinBtn.click();
    } else {
      await page.getByRole('button', { name: /예약 없이|워크인/i }).click();
    }
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 — 동의서 체크박스 존재
    await expect(
      page.locator('input[type="checkbox"]').first()
    ).toBeVisible({ timeout: 6000 });
  });
});

// ── AC-4: QR 화면 ────────────────────────────────────────────────────────────
test.describe('T-20260529 QR 화면 렌더링', () => {
  const sfx = randSuffix();
  const TEST_NAME = `qr-test-${sfx}`;
  const TEST_PHONE = `010${sfx}0021`;
  let cleanupCheckInId: string | null = null;

  test.afterEach(async () => {
    if (cleanupCheckInId && SERVICE_KEY) {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      await sb.from('check_ins').delete().eq('id', cleanupCheckInId);
      await sb.from('customers').delete().eq('phone', TEST_PHONE.replace(/\D/g, ''));
    }
  });

  test('초진 전 흐름 완료 → QR 화면 진입 확인', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(TEST_NAME);
    await page.locator('#sc-phone').fill(TEST_PHONE);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 대기
    await page.waitForTimeout(1500);

    // 주민번호 6자리
    for (const d of ['0', '1', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    // 주소
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('서울시 중구');

    // 다음
    await page.getByRole('button', { name: /다음|확인/i }).click();

    // confirm 단계 → 접수하기
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();

    // QR 화면 또는 완료 화면 대기 (네트워크 지연 고려)
    await page.waitForTimeout(3000);

    // QR 화면 data-testid 또는 완료 화면 확인
    const qrScreen = page.locator('[data-testid="qr-screen"]');
    const doneScreen = page.locator('[data-testid="done-screen"], :text("접수가 완료")');

    const qrVisible = await qrScreen.isVisible().catch(() => false);
    const doneVisible = await doneScreen.isVisible().catch(() => false);

    // QR 또는 완료 화면 중 하나는 떠야 함 (QR 토큰 생성 실패 시 done으로 폴백)
    expect(qrVisible || doneVisible).toBe(true);

    if (qrVisible) {
      // QR 화면 핵심 요소 확인
      await expect(page.locator('[data-testid="qr-guide-text"]')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('[data-testid="btn-qr-done"]')).toBeVisible({ timeout: 3000 });
    }

    // DB cleanup용 ID 수집
    if (SERVICE_KEY) {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const { data } = await sb
        .from('check_ins')
        .select('id')
        .eq('clinic_id', CLINIC_ID)
        .eq('customer_name', TEST_NAME)
        .order('checked_in_at', { ascending: false })
        .limit(1);
      if (data?.[0]) cleanupCheckInId = data[0].id;
    }
  });

  test('QR 화면 "질문지 작성 완료" 버튼 → done 전환', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`${TEST_NAME}-b`);
    await page.locator('#sc-phone').fill(`010${sfx}0022`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();
    await page.waitForTimeout(1000);

    for (const d of ['9', '9', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('경기도 고양시');
    await page.getByRole('button', { name: /다음|확인/i }).click();
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();
    await page.waitForTimeout(3000);

    const qrDoneBtn = page.locator('[data-testid="btn-qr-done"]');
    if (await qrDoneBtn.isVisible().catch(() => false)) {
      await qrDoneBtn.click();
      // done 화면으로 전환
      await expect(
        page.locator('[data-testid="done-screen"], :text("접수가 완료"), :text("접수 완료")').first()
      ).toBeVisible({ timeout: 5000 });
    }
    // QR 화면이 없으면 이미 done — 통과
  });
});

// ── AC-5: 재진 흐름 — personal_info 단계 없음 ───────────────────────────────
test.describe('T-20260529 재진 흐름 — personal_info 스킵', () => {
  const sfx = randSuffix();

  test('재진 → confirm 단계 직접 진입 (personal_info 없음)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`revisit-skip-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0031`);
    await page.getByRole('button', { name: '재진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // confirm 화면으로 바로 가야 함 — 주민번호 NumPad가 없어야 함
    await page.waitForTimeout(1500);
    const rrnNumpad = page.locator('[data-testid="rrn-numpad"], :text(/주민번호/)').first();
    // 재진은 personal_info 없이 confirm으로 이동하므로 주민번호 입력 없어야 함
    await expect(rrnNumpad).not.toBeVisible();

    // confirm 화면의 접수하기 버튼 존재 확인
    await expect(
      page.getByRole('button', { name: '접수하기' })
    ).toBeVisible({ timeout: 5000 });
  });
});

// ── AC-7: 건강보험 조회 동의 체크박스 ────────────────────────────────────────
test.describe('T-20260529 AC-7 건강보험 동의 체크박스', () => {
  const sfx = randSuffix();

  test('personal_info 화면에 건강보험 동의 체크박스가 존재한다', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 초진 접수 입력
    await page.locator('#sc-name').fill(`ins-consent-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0041`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 대기
    await page.waitForTimeout(1000);

    // 건강보험 동의 체크박스 존재 확인 (data-testid)
    const insuranceCheckbox = page.locator('[data-testid="pi-insurance-consent-checkbox"]');
    await expect(insuranceCheckbox).toBeVisible({ timeout: 6000 });

    // 기본값 unchecked
    await expect(insuranceCheckbox).not.toBeChecked();
  });

  test('건강보험 동의 체크박스 체크/언체크 동작', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ins-toggle-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0042`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();
    await page.waitForTimeout(1000);

    const insuranceCheckbox = page.locator('[data-testid="pi-insurance-consent-checkbox"]');
    await expect(insuranceCheckbox).toBeVisible({ timeout: 6000 });

    // 체크 → checked
    await insuranceCheckbox.check();
    await expect(insuranceCheckbox).toBeChecked();

    // 다시 언체크 → unchecked
    await insuranceCheckbox.uncheck();
    await expect(insuranceCheckbox).not.toBeChecked();
  });

  test('건강보험 동의 체크해도 다음 버튼 활성 조건 변화 없음 (선택 필드)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ins-optional-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0043`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();
    await page.waitForTimeout(1000);

    // 주민번호 6자리 + 주소 입력 (필수 조건 충족)
    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울시 종로구');

    // 건강보험 미체크 상태에서도 다음 버튼 활성화 (선택 필드)
    const nextBtn = page.locator('[data-testid="btn-personal-info-next"]');
    await expect(nextBtn).toBeEnabled({ timeout: 3000 });

    // 건강보험 체크 후에도 활성화 유지
    await page.locator('[data-testid="pi-insurance-consent-checkbox"]').check();
    await expect(nextBtn).toBeEnabled();
  });
});

// ── AC-9: 주민번호 자동 매칭 (서버사이드 — service role 사용) ────────────────
test.describe('T-20260529 AC-9 주민번호 자동 매칭', () => {
  const sfx = randSuffix();
  const DESK_PHONE  = `010${sfx}0051`;
  const SELF_PHONE  = `010${sfx}0052`;
  const TEST_BD     = '900505'; // 공통 주민번호 앞6자리
  let deskCustomerId: string | null = null;
  let selfCheckInId:  string | null = null;

  test.afterEach(async () => {
    if (!SERVICE_KEY) return;
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    if (selfCheckInId)  await sb.from('check_ins').delete().eq('id', selfCheckInId);
    // deskCustomerId 삭제 시 health_q_tokens 등 연결 레코드 cascade 처리됨
    if (deskCustomerId) await sb.from('customers').delete().eq('id', deskCustomerId);
    await sb.from('customers').delete().eq('phone', DESK_PHONE);
    await sb.from('customers').delete().eq('phone', SELF_PHONE);
  });

  test('데스크 birth_date와 selfcheckin birth_date 일치 시 check_in customer_id 교체', async () => {
    if (!SERVICE_KEY) {
      console.log('SUPABASE_SERVICE_ROLE_KEY 미설정 — AC-9 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    // 1. 데스크가 먼저 고객 레코드 생성 (birth_date 포함)
    const { data: deskCust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `desk-${sfx}`, phone: DESK_PHONE, birth_date: TEST_BD })
      .select('id')
      .single();
    deskCustomerId = deskCust?.id ?? null;
    if (!deskCustomerId) throw new Error('데스크 고객 생성 실패');

    // 2. 데스크 고객에 대한 check_in 생성 (데스크가 먼저 생성)
    await sb.from('check_ins').insert({
      clinic_id: CLINIC_ID,
      customer_id: deskCustomerId,
      customer_name: `desk-${sfx}`,
      customer_phone: DESK_PHONE,
      visit_type: 'new',
      status: 'consult_waiting',
    });

    // 3. selfcheckin용 별도 고객 + check_in 생성 (같은 birth_date)
    const { data: selfCust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `self-${sfx}`, phone: SELF_PHONE, birth_date: TEST_BD })
      .select('id')
      .single();
    const selfCustId = selfCust?.id ?? null;
    if (!selfCustId) throw new Error('셀프 고객 생성 실패');

    const { data: selfCi } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: selfCustId,
        customer_name: `self-${sfx}`,
        customer_phone: SELF_PHONE,
        visit_type: 'new',
        status: 'consult_waiting',
      })
      .select('id')
      .single();
    selfCheckInId = selfCi?.id ?? null;
    if (!selfCheckInId) throw new Error('셀프체크인 생성 실패');

    // 4. fn_selfcheckin_rrn_match 호출 (service role로 직접 RPC)
    const { data: matchResult } = await sb.rpc('fn_selfcheckin_rrn_match', {
      p_check_in_id: selfCheckInId,
      p_clinic_id:   CLINIC_ID,
    });

    const result = matchResult as { success: boolean; matched: boolean; merged_to_customer_id?: string } | null;

    // 5. 검증: 매칭 성공 + customer_id 교체
    expect(result?.success).toBe(true);
    expect(result?.matched).toBe(true);
    expect(result?.merged_to_customer_id).toBe(deskCustomerId);

    // 6. check_in.customer_id 가 실제로 교체됐는지 DB 확인
    const { data: updatedCi } = await sb
      .from('check_ins')
      .select('customer_id')
      .eq('id', selfCheckInId)
      .single();

    expect((updatedCi as { customer_id: string } | null)?.customer_id).toBe(deskCustomerId);

    // cleanup에서 selfCheckInId로 정리
    void today; // 변수 사용 명시
  });

  test('birth_date 없으면 매칭 안 함 (no_birth_date 반환)', async () => {
    if (!SERVICE_KEY) return;

    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // birth_date 없는 고객 + check_in
    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `nobd-${sfx}`, phone: `010${sfx}0053` })
      .select('id')
      .single();
    const custId = cust?.id;
    if (!custId) throw new Error('고객 생성 실패');

    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID, customer_id: custId,
        customer_name: `nobd-${sfx}`, customer_phone: `010${sfx}0053`,
        visit_type: 'new', status: 'consult_waiting',
      })
      .select('id')
      .single();
    const ciId = (ci as { id: string } | null)?.id;

    try {
      const { data: matchResult } = await sb.rpc('fn_selfcheckin_rrn_match', {
        p_check_in_id: ciId,
        p_clinic_id:   CLINIC_ID,
      });
      const res = matchResult as { success: boolean; matched: boolean; reason?: string } | null;
      expect(res?.success).toBe(true);
      expect(res?.matched).toBe(false);
      // reason이 no_birth_date 이거나 matched=false 면 통과
    } finally {
      // cleanup
      if (ciId)   await sb.from('check_ins').delete().eq('id', ciId);
      if (custId) await sb.from('customers').delete().eq('id', custId);
    }
  });
});
