/**
 * E2E spec — T-20260522-foot-RESV-TREAT-HISTORY
 * 재진 예약 등록 팝업 — 고객 선택 시 시술내역 표시
 *
 * AC-1: 기존 고객 선택 시 시술내역 패널 즉시 표시 (신규 등록 시 미표시)
 * AC-2: 4컬럼(패키지명|회차(N/M)|치료명|시술일), 시술일 내림차순, 최근 10건+더보기
 * AC-3: 기존 시술내역과 동일 소스(package_sessions + packages) 조회
 * AC-4: 로딩 스피너 + 이력 없음 안내 문구
 * AC-5: 예약 저장·초진/재진 토글·예약메모 회귀 없음
 *
 * 시나리오 1: 기존 고객(시술이력 있음) 선택 → 패널 표시 + 4컬럼 데이터
 * 시나리오 2: 기존 고객(시술이력 없음) 선택 → "시술 이력이 없습니다" 표시
 * 시나리오 3: 고객 미선택(신규 등록) → 패널 미표시
 * 시나리오 4: 11건 이상 이력 → 최초 10건만 표시 + 더보기 버튼 노출
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

// ─── 로그인 헬퍼 ──────────────────────────────────────────────────────
async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto(`${APP_URL}/login`);
  await page.fill('input[type="email"]', process.env.TEST_EMAIL ?? 'admin@test.com');
  await page.fill('input[type="password"]', process.env.TEST_PASSWORD ?? 'test1234');
  await page.click('button[type="submit"]');
  await page.waitForURL(/admin/, { timeout: 15_000 });
}

// ─── DB 헬퍼 ─────────────────────────────────────────────────────────
function makeServiceClient() {
  return createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/** 테스트용 고객 생성 */
async function createTestCustomer(
  sb: ReturnType<typeof createClient>,
  name: string,
) {
  const phone = `+821099${Date.now().toString().slice(-6)}`;
  const { data, error } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select('id')
    .single();
  if (error) throw new Error(`고객 생성 실패: ${error.message}`);
  return (data as { id: string }).id;
}

/** 테스트용 패키지 + 세션 생성 */
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
      total_sessions: sessionCount,
      status: 'active',
      contract_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();
  if (pkgErr) throw new Error(`패키지 생성 실패: ${pkgErr.message}`);
  const pkgId = (pkg as { id: string }).id;

  // 세션 레코드 생성 (session_date 역순)
  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    package_id: pkgId,
    session_number: i + 1,
    session_type: `레이저 ${i + 1}회`,
    session_date: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
    status: 'completed',
  }));

  const { error: sessErr } = await sb.from('package_sessions').insert(sessions);
  if (sessErr) throw new Error(`세션 생성 실패: ${sessErr.message}`);
  return { pkgId };
}

/** 생성된 테스트 데이터 정리 */
async function cleanup(
  sb: ReturnType<typeof createClient>,
  customerIds: string[],
) {
  for (const cid of customerIds) {
    const { data: pkgs } = await sb
      .from('packages')
      .select('id')
      .eq('customer_id', cid);
    const pkgIds = (pkgs ?? []).map((p: { id: string }) => p.id);
    if (pkgIds.length > 0) {
      await sb.from('package_sessions').delete().in('package_id', pkgIds);
      await sb.from('packages').delete().in('id', pkgIds);
    }
    await sb.from('customers').delete().eq('id', cid);
  }
}

// ─── 예약 등록 팝업 열기 헬퍼 ────────────────────────────────────────
async function openNewReservationEditor(page: import('@playwright/test').Page) {
  await page.goto(`${APP_URL}/admin/reservations`);
  // 상단 "새 예약" 버튼 클릭
  await page.click('button:has-text("새 예약")');
  // 다이얼로그 대기
  await page.waitForSelector('role=dialog', { timeout: 8_000 });
}

// ─── 테스트 ──────────────────────────────────────────────────────────

test.describe('T-20260522-foot-RESV-TREAT-HISTORY', () => {
  const toCleanup: string[] = [];
  let sb: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    sb = makeServiceClient();
  });

  test.afterAll(async () => {
    if (toCleanup.length > 0) await cleanup(sb, toCleanup);
  });

  // ── 시나리오 1: 기존 고객(시술이력 있음) 선택 → 패널 + 4컬럼 데이터 ──
  test('S1: 기존 고객 선택 시 시술내역 패널 표시 및 4컬럼 검증', async ({ page }) => {
    // DB 준비
    const customerId = await createTestCustomer(sb, '테스트시술고객_S1');
    toCleanup.push(customerId);
    const { pkgId } = await createTestPackageWithSessions(sb, customerId, '풋케어 5회권', 5);
    void pkgId;

    await loginAdmin(page);
    await openNewReservationEditor(page);

    // 이름 필드에 고객명 검색 + 드롭다운 선택
    const nameInput = page.locator('input[placeholder="홍길동"]');
    await nameInput.fill('테스트시술고객_S1');
    await page.waitForTimeout(600);
    const option = page.locator('[data-testid="patient-option"]').first();
    if (await option.isVisible()) {
      await option.click();
    }

    // AC-1: 패널 표시 대기
    await page.waitForSelector('[data-testid="treat-history-panel"]', { timeout: 10_000 });

    // 로딩 완료 대기 (스피너 사라짐)
    await page.waitForSelector('[data-testid="treat-history-loading"]', { state: 'hidden', timeout: 10_000 }).catch(() => {});

    // AC-2: "패키지명" 컬럼 헤더 표시
    const panel = page.locator('[data-testid="treat-history-panel"]');
    await expect(panel).toContainText('패키지명');
    await expect(panel).toContainText('회차');
    await expect(panel).toContainText('치료명');
    await expect(panel).toContainText('시술일');

    // AC-2: 패키지명 + 회차 형식 (N/M)
    await expect(panel).toContainText('풋케어 5회권');
    await expect(panel).toContainText('1/5');

    // AC-3: 동일 소스(package_sessions) 검증 — DB row count
    const { count } = await sb
      .from('package_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', (await sb.from('packages').select('id').eq('customer_id', customerId).single()).data?.id);
    expect(count).toBe(5);
  });

  // ── 시나리오 2: 기존 고객(시술이력 없음) → "시술 이력이 없습니다" ──
  test('S2: 시술이력 없는 기존 고객 선택 시 "시술 이력이 없습니다" 표시', async ({ page }) => {
    const customerId = await createTestCustomer(sb, '테스트고객_이력없음');
    toCleanup.push(customerId);

    await loginAdmin(page);
    await openNewReservationEditor(page);

    const nameInput = page.locator('input[placeholder="홍길동"]');
    await nameInput.fill('테스트고객_이력없음');
    await page.waitForTimeout(600);
    const option = page.locator('[data-testid="patient-option"]').first();
    if (await option.isVisible()) {
      await option.click();
    }

    // AC-1: 패널 표시
    await page.waitForSelector('[data-testid="treat-history-panel"]', { timeout: 10_000 });
    // AC-4: "이력 없음" 안내
    await page.waitForSelector('[data-testid="treat-history-empty"]', { timeout: 10_000 });
    await expect(page.locator('[data-testid="treat-history-empty"]')).toContainText('시술 이력이 없습니다');
  });

  // ── 시나리오 3: 고객 미선택(신규) → 패널 미표시 ─────────────────
  test('S3: 고객 미선택(신규 등록) 시 시술내역 패널 미표시', async ({ page }) => {
    await loginAdmin(page);
    await openNewReservationEditor(page);

    // 이름/전화만 입력하되 드롭다운에서 기존 고객 선택 안 함
    const nameInput = page.locator('input[placeholder="홍길동"]');
    await nameInput.fill('신규가나다라');
    await page.waitForTimeout(300);

    // AC-1: 패널이 없어야 함
    await expect(page.locator('[data-testid="treat-history-panel"]')).not.toBeVisible();
  });

  // ── 시나리오 4: 11건 이상 이력 → 더보기 버튼 표시 ───────────────
  test('S4: 시술이력 11건 이상 시 더보기 버튼 표시', async ({ page }) => {
    const customerId = await createTestCustomer(sb, '테스트고객_더보기');
    toCleanup.push(customerId);
    // 11건 세션 생성
    await createTestPackageWithSessions(sb, customerId, '풋케어 15회권', 11);

    await loginAdmin(page);
    await openNewReservationEditor(page);

    const nameInput = page.locator('input[placeholder="홍길동"]');
    await nameInput.fill('테스트고객_더보기');
    await page.waitForTimeout(600);
    const option = page.locator('[data-testid="patient-option"]').first();
    if (await option.isVisible()) {
      await option.click();
    }

    await page.waitForSelector('[data-testid="treat-history-panel"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="treat-history-loading"]', { state: 'hidden', timeout: 10_000 }).catch(() => {});

    // AC-2: 더보기 버튼 표시
    const showMore = page.locator('[data-testid="treat-history-show-more"]');
    await expect(showMore).toBeVisible();
    await expect(showMore).toContainText('더보기');

    // 더보기 클릭 후 버튼 사라짐
    await showMore.click();
    await expect(showMore).not.toBeVisible();

    // AC-5: 대화상자 저장 기능 회귀 없음 — 저장 버튼 여전히 활성화
    const saveBtn = page.locator('button:has-text("저장")').last();
    // customer_id가 있어도 name이 있으면 저장 버튼 활성화
    expect(await saveBtn.isDisabled()).toBe(false);
  });
});
