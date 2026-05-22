/**
 * E2E spec — T-20260522-foot-PKG-EDIT-DEL
 * 2번차트 구매 패키지(티켓) 수정/삭제 버튼 추가
 *
 * AC-1: 패키지 각 항목에 [수정] 버튼 → 편집 폼(상품명·수가·횟수)
 * AC-2: 수정 저장 시 DB UPDATE + 목록 즉시 갱신
 * AC-3: [삭제] 버튼 + 확인 다이얼로그
 * AC-4: 차감 이력(사용 회차>0) 패키지 삭제 불가 — 안내 메시지 표시
 * AC-5: soft delete 처리(status='cancelled', 물리 삭제 금지)
 * AC-6: 에러 토스트 표시, 성공 토스트 불필요
 *
 * 시나리오 1: 패키지 수정 정상 동선
 * 시나리오 2: 미사용 패키지 삭제
 * 시나리오 3: 사용 이력 패키지 삭제 차단
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

function sb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

/** 테스트용 고객 + 패키지 생성 */
async function seedCustomerWithPackage(suffix: string) {
  const client = sb();
  const name = `pkg-edit-test-${suffix}-${Date.now()}`;
  const phone = `010${String(Date.now()).slice(-8)}`;

  const { data: customer, error: custErr } = await client
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new' })
    .select()
    .single();
  if (custErr) throw new Error(`고객 생성 실패: ${custErr.message}`);

  const { data: pkg, error: pkgErr } = await client
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer!.id,
      package_name: `테스트패키지-${suffix}`,
      package_type: 'custom',
      total_sessions: 5,
      heated_sessions: 5,
      heated_unit_price: 30000,
      unheated_sessions: 0,
      iv_sessions: 0,
      preconditioning_sessions: 0,
      shot_upgrade: false,
      af_upgrade: false,
      upgrade_surcharge: 0,
      total_amount: 150000,
      paid_amount: 150000,
      status: 'active',
      contract_date: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (pkgErr) throw new Error(`패키지 생성 실패: ${pkgErr.message}`);

  return { customer: customer!, pkg: pkg! };
}

/** 패키지에 사용 이력(package_sessions) 추가 */
async function seedUsedSession(packageId: string) {
  const client = sb();
  const { error } = await client.from('package_sessions').insert({
    package_id: packageId,
    session_number: 1,
    session_type: 'heated_laser',
    session_date: new Date().toISOString().slice(0, 10),
    status: 'used',
  });
  if (error) throw new Error(`세션 생성 실패: ${error.message}`);
}

async function cleanupByName(namePrefix: string) {
  const client = sb();
  const { data: customers } = await client
    .from('customers')
    .select('id')
    .like('name', `${namePrefix}%`);
  if (!customers?.length) return;
  const ids = customers.map((c) => c.id);
  const { data: pkgs } = await client.from('packages').select('id').in('customer_id', ids);
  if (pkgs?.length) {
    await client.from('package_sessions').delete().in('package_id', pkgs.map((p) => p.id));
    await client.from('packages').delete().in('id', pkgs.map((p) => p.id));
  }
  await client.from('check_ins').delete().in('customer_id', ids);
  await client.from('customers').delete().in('id', ids);
}

/** 로그인 여부 확인 — 로그인 필요 시 skip */
async function skipIfNotLoggedIn(page: import('@playwright/test').Page) {
  const loginBtn = page.getByRole('button', { name: /로그인/i });
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip();
  }
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 1: 패키지 수정 정상 동선 (AC-1, AC-2)
// ─────────────────────────────────────────────────────────────────
test('AC-1/AC-2: 패키지 수정 폼이 열리고 저장 시 목록이 갱신된다', async ({ page }) => {
  const { customer } = await seedCustomerWithPackage('edit-normal');
  try {
    await page.goto(`${BASE_URL}/login`);
    await skipIfNotLoggedIn(page);

    // 2번차트 직접 이동
    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle');

    // 이력 탭 → 패키지 탭 이동
    const historyTabGroup = page.getByRole('tab', { name: /이력/i }).first();
    if (await historyTabGroup.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyTabGroup.click();
    }
    const pkgTab = page.getByRole('tab', { name: /패키지/i }).first();
    if (await pkgTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pkgTab.click();
    }

    // [수정] 버튼(Pencil icon) 확인
    const editBtn = page.locator('button[title="패키지 수정"]').first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // 수정 다이얼로그 열림 확인
    await expect(page.getByText('패키지 수정')).toBeVisible({ timeout: 3000 });

    // 상품명 변경
    const nameInput = page.getByLabel('상품명');
    await nameInput.fill('테스트 패키지 수정완료');

    // 저장
    await page.getByRole('button', { name: '수정 저장' }).click();

    // 다이얼로그 닫힘 + 목록에 변경된 이름 표시
    await expect(page.getByText('패키지 수정')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('테스트 패키지 수정완료')).toBeVisible({ timeout: 5000 });
  } finally {
    await cleanupByName('pkg-edit-test-edit-normal');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2: 미사용 패키지 삭제 (AC-3, AC-5)
// ─────────────────────────────────────────────────────────────────
test('AC-3/AC-5: 미사용 패키지 삭제 확인 다이얼로그 후 목록에서 비노출', async ({ page }) => {
  const { customer, pkg } = await seedCustomerWithPackage('delete-unused');
  try {
    await page.goto(`${BASE_URL}/login`);
    await skipIfNotLoggedIn(page);

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle');

    // 패키지 탭 이동
    const historyTabGroup = page.getByRole('tab', { name: /이력/i }).first();
    if (await historyTabGroup.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyTabGroup.click();
    }
    const pkgTab = page.getByRole('tab', { name: /패키지/i }).first();
    if (await pkgTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pkgTab.click();
    }

    // [삭제] 버튼(Trash2 icon) 클릭
    const deleteBtn = page.locator('button[title="패키지 삭제"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // 확인 다이얼로그 표시 확인
    await expect(page.getByText('정말 삭제하시겠습니까?').or(page.getByText('패키지를 삭제하시겠습니까?'))).toBeVisible({ timeout: 3000 });

    // [삭제] 버튼 클릭 (confirm)
    await page.getByRole('button', { name: '삭제' }).click();

    // 패키지 비노출 확인
    await expect(page.getByText(`테스트패키지-delete-unused`)).not.toBeVisible({ timeout: 5000 });

    // DB soft delete 확인 (status='cancelled')
    const { data } = await sb().from('packages').select('status').eq('id', pkg.id).single();
    expect(data?.status).toBe('cancelled');
  } finally {
    await cleanupByName('pkg-edit-test-delete-unused');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 3: 사용 이력 패키지 삭제 차단 (AC-4)
// ─────────────────────────────────────────────────────────────────
test('AC-4: 사용 이력 있는 패키지 삭제 시도 시 안내 메시지가 표시된다', async ({ page }) => {
  const { customer, pkg } = await seedCustomerWithPackage('delete-blocked');
  await seedUsedSession(pkg.id); // 1회 사용 이력 추가

  try {
    await page.goto(`${BASE_URL}/login`);
    await skipIfNotLoggedIn(page);

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle');

    // 패키지 탭 이동
    const historyTabGroup = page.getByRole('tab', { name: /이력/i }).first();
    if (await historyTabGroup.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyTabGroup.click();
    }
    const pkgTab = page.getByRole('tab', { name: /패키지/i }).first();
    if (await pkgTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pkgTab.click();
    }

    // [삭제] 버튼 클릭 → 차단 메시지
    const deleteBtn = page.locator('button[title="패키지 삭제"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // "사용 이력이 있어 삭제할 수 없습니다" 메시지 확인 (toast)
    await expect(page.getByText('사용 이력이 있어 삭제할 수 없습니다')).toBeVisible({ timeout: 3000 });

    // 패키지 목록 변경 없음 확인
    await expect(page.getByText(`테스트패키지-delete-blocked`)).toBeVisible({ timeout: 3000 });

    // DB 상태 변경 없음 (여전히 active)
    const { data } = await sb().from('packages').select('status').eq('id', pkg.id).single();
    expect(data?.status).toBe('active');
  } finally {
    await cleanupByName('pkg-edit-test-delete-blocked');
  }
});
