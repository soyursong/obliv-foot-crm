/**
 * E2E spec — T-20260522-foot-RESV-PKG-HISTORY
 * 재진 예약 등록 팝업 — 고객 선택 시 구매패키지 시술내역 표시
 *
 * AC-1: 재진 예약 등록 팝업에서 고객 선택 후 패키지명·회차·치료명·시술일 표시
 * AC-2: 데이터 소스 = packages + package_sessions (신규 DB 불필요)
 * AC-3: 시술내역 없는 고객은 "시술내역 없음" 안내 표시
 * AC-4: 태블릿(SM-X400) 해상도(1200×800)에서 팝업 레이아웃 유지
 * AC-R1: 시술내역 표시를 5컬럼으로 — 패키지명/회차/치료명/치료사/시술일 (FIX-20260524)
 *
 * 시나리오 1: 재진 예약 → 시술내역 있는 고객 선택 → 패키지 시술내역 표시 (5컬럼)
 * 시나리오 2: 재진 예약 → 시술내역 없는 고객 선택 → "시술내역 없음" 안내
 * 시나리오 3: 태블릿 해상도에서 팝업 레이아웃 확인
 * 시나리오 4: AC-R1 — 치료사 컬럼 렌더 (performed_by null → "—" fallback)
 *
 * 비고: 구현은 T-20260522-foot-RESV-TREAT-HISTORY(878c79b)와 동일.
 *       본 티켓은 티켓 파일 누락 보정 — 동일 기능을 다른 티켓 ID로 검증.
 *
 * FIX-2026-05-23 (MSG-20260523-222114-3hxo):
 *   - [F1] package_type 'template' 추가 (NOT NULL 제약)
 *   - [F2] APP_URL fallback 포트 5173→8082 (playwright.config baseURL 일치)
 *   - [F3] loginAdmin storageState 직접 이동 (form 재로그인 rate-limit 회피)
 *   - [F4] total_amount/paid_amount 0 추가 (NOT NULL 제약)
 *   - [F5] selectCustomerInEditor 셀렉터 수정 (.z-30 button + dispatchEvent mousedown)
 *   - [F6] 고객명 런타임 suffix — stale DB 데이터 충돌 방지
 *
 * FIX-2026-05-24 (MSG-20260524-125934-exu8):
 *   - [F7] session_type '레이저 N회' → 'heated_laser' (CHECK constraint 준수)
 *   - [F7] 세션 insert 에러 로깅 추가 (묵음 실패 방지)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
// [F2] playwright.config baseURL: 'http://localhost:8082' 와 일치
const APP_URL = process.env.APP_URL ?? 'http://localhost:8082';

// ─── 헬퍼 ────────────────────────────────────────────────────────────
// [F3] desktop-chrome project는 auth.setup.ts storageState로 이미 인증됨.
// UI form 재로그인(rate-limit 위험) 없이 admin 페이지로 직접 이동.
async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto('/admin/reservations');
  await page.waitForURL(/admin/, { timeout: 15_000 });
}

function makeServiceClient() {
  return createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function createTestCustomer(
  sb: ReturnType<typeof createClient>,
  name: string,
) {
  const phone = `+821055${Date.now().toString().slice(-6)}`;
  const { data, error } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select('id')
    .single();
  if (error) throw new Error(`고객 생성 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function createTestPackageWithSessions(
  sb: ReturnType<typeof createClient>,
  customerId: string,
  packageName: string,
  sessionCount: number,
) {
  const { data: pkg, error: pkgErr } = await sb
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customerId,
      package_name: packageName,
      // [F1] package_type NOT NULL
      package_type: 'template',
      total_sessions: sessionCount,
      // [F4] total_amount / paid_amount NOT NULL
      total_amount: 0,
      paid_amount: 0,
      status: 'active',
      contract_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();
  if (pkgErr) throw new Error(`패키지 생성 실패: ${pkgErr.message}`);
  const pkgId = (pkg as { id: string }).id;

  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    package_id: pkgId,
    session_number: i + 1,
    // [F7] session_type CHECK constraint 준수 — 허용값: heated_laser|unheated_laser|iv|preconditioning|podologue|trial
    session_type: 'heated_laser' as const,
    session_date: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
    status: 'completed',
  }));
  const { error: sessErr } = await sb.from('package_sessions').insert(sessions);
  if (sessErr) throw new Error(`세션 생성 실패: ${sessErr.message}`);
  return pkgId;
}

async function cleanup(sb: ReturnType<typeof createClient>, customerIds: string[]) {
  for (const cid of customerIds) {
    const { data: pkgs } = await sb.from('packages').select('id').eq('customer_id', cid);
    const pkgIds = (pkgs ?? []).map((p: { id: string }) => p.id);
    if (pkgIds.length > 0) {
      await sb.from('package_sessions').delete().in('package_id', pkgIds);
      await sb.from('packages').delete().in('id', pkgIds);
    }
    await sb.from('customers').delete().eq('id', cid);
  }
}

async function openNewReservationEditor(page: import('@playwright/test').Page) {
  await page.goto(`${APP_URL}/admin/reservations`);
  await page.click('button:has-text("새 예약")');
  await page.waitForSelector('role=dialog', { timeout: 8_000 });
}

// [F5] InlinePatientSearch 드롭다운 셀렉터 수정
// data-testid="patient-option" 없음 → .z-30 컨테이너 안 버튼 onMouseDown 트리거
async function selectCustomerInEditor(
  page: import('@playwright/test').Page,
  customerName: string,
) {
  const nameInput = page.locator('input[placeholder="홍길동"]');
  await nameInput.fill(customerName);
  // InlinePatientSearch debounce 300ms + DB 검색 대기
  const option = page
    .locator('.z-30 button')
    .filter({ hasText: customerName })
    .first();
  await option.waitFor({ state: 'visible', timeout: 6_000 });
  // onMouseDown handler (e.preventDefault + handleSelect)
  await option.dispatchEvent('mousedown');
  // 고객 선택 후 customer_id state 반영 대기
  // name/phone 양쪽 InlinePatientSearch 배지 → .first() 로 strict mode 회피
  await page.locator('text=기존 고객 선택됨').first().waitFor({ timeout: 5_000 });
}

// ─── 테스트 ──────────────────────────────────────────────────────────
test.describe('T-20260522-foot-RESV-PKG-HISTORY', () => {
  const toCleanup: string[] = [];
  let sb: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    sb = makeServiceClient();
  });

  test.afterAll(async () => {
    if (toCleanup.length > 0) await cleanup(sb, toCleanup);
  });

  // ── S1: 재진 예약 — 시술내역 있는 고객 ────────────────────────────
  test('S1: 고객 선택 시 패키지명·회차·치료명·시술일 4컬럼 표시 (AC-1/2)', async ({ page }) => {
    // [F6] 런타임 suffix — stale DB 충돌 방지
    const suffix = Date.now().toString().slice(-7);
    const customerName = `재진이력_PKG_${suffix}`;
    const cid = await createTestCustomer(sb, customerName);
    toCleanup.push(cid);
    await createTestPackageWithSessions(sb, cid, '풋케어 10회권', 3);

    await loginAdmin(page);
    await openNewReservationEditor(page);
    await selectCustomerInEditor(page, customerName);

    // AC-1: 시술내역 패널 표시
    const panel = page.locator('[data-testid="treat-history-panel"]');
    await panel.waitFor({ timeout: 10_000 });

    // 로딩 완료 대기
    await page
      .locator('[data-testid="treat-history-loading"]')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    // AC-1 + AC-R1: 5컬럼 헤더 (패키지명/회차/치료명/치료사/시술일)
    await expect(panel).toContainText('패키지명');
    await expect(panel).toContainText('회차');
    await expect(panel).toContainText('치료명');
    await expect(panel).toContainText('치료사');
    await expect(panel).toContainText('시술일');

    // AC-2: 데이터 rows — 패키지명 + 회차 형식 N/M
    await expect(panel).toContainText('풋케어 10회권');
    await expect(panel).toContainText('1/3');

    // AC-2: 최소 1건 이상
    const rows = panel.locator('[data-testid^="treat-history-row-"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  // ── S2: 재진 예약 — 시술내역 없는 고객 ────────────────────────────
  test('S2: 시술내역 없는 고객 선택 시 "시술 이력이 없습니다" 안내 (AC-3)', async ({ page }) => {
    // [F6] 런타임 suffix — stale DB 충돌 방지
    const suffix = Date.now().toString().slice(-7);
    const customerName = `재진이력없음_PKG_${suffix}`;
    const cid = await createTestCustomer(sb, customerName);
    toCleanup.push(cid);
    // 패키지/세션 없음 — 고객만 생성

    await loginAdmin(page);
    await openNewReservationEditor(page);
    await selectCustomerInEditor(page, customerName);

    // AC-1: 패널 표시
    const panel = page.locator('[data-testid="treat-history-panel"]');
    await panel.waitFor({ timeout: 10_000 });

    // AC-3: "시술 이력이 없습니다" 안내
    const emptyMsg = page.locator('[data-testid="treat-history-empty"]');
    await emptyMsg.waitFor({ timeout: 10_000 });
    await expect(emptyMsg).toBeVisible();
  });

  // ── S3: 태블릿 해상도(1200×800) 팝업 레이아웃 ──────────────────
  test('S3: 태블릿(SM-X400) 해상도에서 팝업 레이아웃 정상 (AC-4)', async ({ page }) => {
    // AC-4: SM-X400 landscape 해상도
    await page.setViewportSize({ width: 1200, height: 800 });

    // [F6] 런타임 suffix — stale DB 충돌 방지
    const suffix = Date.now().toString().slice(-7);
    const customerName = `태블릿레이아웃_PKG_${suffix}`;
    const cid = await createTestCustomer(sb, customerName);
    toCleanup.push(cid);
    await createTestPackageWithSessions(sb, cid, '체험패키지', 2);

    await loginAdmin(page);
    await openNewReservationEditor(page);
    await selectCustomerInEditor(page, customerName);

    const panel = page.locator('[data-testid="treat-history-panel"]');
    await panel.waitFor({ timeout: 10_000 });
    await page
      .locator('[data-testid="treat-history-loading"]')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    // AC-4: 패널이 viewport 안에 온전히 렌더됨
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // 패널이 viewport 우측을 벗어나지 않음
      expect(box.x + box.width).toBeLessThanOrEqual(1210);
      // 패널 높이가 합리적 범위 내 (0 ~ 600px)
      expect(box.height).toBeGreaterThan(0);
      expect(box.height).toBeLessThan(600);
    }

    // 저장 버튼 접근 가능
    const saveBtn = page.locator('button:has-text("저장")').last();
    await expect(saveBtn).toBeVisible();
    const saveBtnBox = await saveBtn.boundingBox();
    if (saveBtnBox) {
      expect(saveBtnBox.x + saveBtnBox.width).toBeLessThanOrEqual(1210);
    }
  });

  // ── S4: AC-R1 — 치료사 컬럼 렌더 (performed_by null → "—" fallback) ──
  test('S4: AC-R1 — 시술내역 5컬럼, 치료사 헤더 존재 + fallback "—" 렌더', async ({ page }) => {
    const suffix = Date.now().toString().slice(-7);
    const customerName = `치료사컬럼_PKG_${suffix}`;
    const cid = await createTestCustomer(sb, customerName);
    toCleanup.push(cid);
    // performed_by 없는 세션 생성 → therapist_name "—" fallback
    await createTestPackageWithSessions(sb, cid, '치료사테스트패키지', 2);

    await loginAdmin(page);
    await openNewReservationEditor(page);
    await selectCustomerInEditor(page, customerName);

    const panel = page.locator('[data-testid="treat-history-panel"]');
    await panel.waitFor({ timeout: 10_000 });
    await page
      .locator('[data-testid="treat-history-loading"]')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    // AC-R1: 5컬럼 헤더에 "치료사" 존재
    await expect(panel).toContainText('치료사');

    // AC-R1: row에 치료사 fallback "—" 렌더 (performed_by null)
    const firstRow = panel.locator('[data-testid^="treat-history-row-"]').first();
    await firstRow.waitFor({ timeout: 5_000 });
    await expect(firstRow).toContainText('—');
  });
});
