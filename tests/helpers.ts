/**
 * 테스트 공용 헬퍼
 *
 * 변경 (T-foot-PW04 unblock, 2026-04-25):
 * - storageState 가 정상 주입되면 /admin 직접 진입으로 충분 → UI 로그인 불필요
 * - storageState 없거나 만료 시 UI 로그인 폴백 (rate-limit 위험)
 */
import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

/**
 * RC-C self-seed (T-20260615-foot-REGRESSION-SUITE-DEROT)
 *
 * 회귀 스펙들이 "데모 시드(4/26)"의 오늘자(created_date=today) 카드 존재에 의존했다.
 * 데모 시드는 created_date 가 4/26 로 고정돼 시간이 흐르며 오늘자 카드가 0건이 되고,
 * `expect(count).toBeGreaterThan(0)` 류 단언이 false-fail 을 냈다(시드 표류).
 *
 * 이 헬퍼는 스펙이 자기 전제(오늘자 active 카드 1장)를 결정적으로 self-seed 하고
 * 끝나면 회수하게 한다 → 공유 dev-DB 상태와 무관하게 항상 통과/명확실패.
 * 마커 이름으로 격리하므로 다른 데이터·다른 테스트와 충돌하지 않는다.
 */
export const RC_C_SEED_MARKER = 'RCCSEED';

export interface SeededCheckin {
  checkInId: string;
  customerId: string | null;
  name: string;
}

/**
 * 오늘자 active check_in 카드 1장을 결정적으로 생성한다.
 * - created_date 는 DB default(KST today)에 위임(payment-package 스펙 검증된 패턴).
 * - status='consult_waiting' → 칸반 상담대기 컬럼에 카드로 렌더(data-testid=checkin-card).
 * - 마커 이름으로 격리 → afterAll 에서 회수.
 */
export async function seedTodayActiveCheckin(
  sb: SupabaseClient,
  clinicId: string,
): Promise<SeededCheckin | null> {
  const ts = Date.now();
  const name = `${RC_C_SEED_MARKER}-${ts}`;
  const phone = `010${String(ts).slice(-8)}`;

  let customerId: string | null = null;
  const { data: cust } = await sb
    .from('customers')
    .insert({ clinic_id: clinicId, name, phone, visit_type: 'new' })
    .select('id')
    .single();
  customerId = cust?.id ?? null;

  const { data: ci, error } = await sb
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'new',
      status: 'consult_waiting',
      queue_number: 900000 + (ts % 90000),
    })
    .select('id')
    .single();

  if (error || !ci) {
    if (customerId) await sb.from('customers').delete().eq('id', customerId);
    return null;
  }
  return { checkInId: ci.id, customerId, name };
}

export async function cleanupSeededCheckin(
  sb: SupabaseClient,
  seed: SeededCheckin | null,
): Promise<void> {
  if (!seed) return;
  await sb.from('check_ins').delete().eq('id', seed.checkInId);
  if (seed.customerId) await sb.from('customers').delete().eq('id', seed.customerId);
}

/**
 * 칸반 카드 클릭 후 위에 열리는 2번차트(CustomerChartSheet) 닫기
 * (T-20260615-foot-REGRESSION-SUITE-DEROT RC-C / 플로우 드리프트)
 *
 * 배경: T-20260516-foot-CHART2-STATE-UNIFY + openChartFor 단일화 이후, 칸반 카드 클릭은
 *   CheckInDetailSheet(z-50)를 setSelectedCheckIn 으로 열면서 **동시에** customer_id 로
 *   CustomerChartSheet(2번차트, z-70, 95vw, AdminLayout 단일 마운트)를 위에 띄운다.
 *   04-29/04-30 구 회귀 스펙들은 "카드 클릭 → CheckInDetailSheet 단독" 시절에 작성돼,
 *   이제는 2번차트가 CheckInDetailSheet/DeskPaymentMenu 를 덮는다.
 *   - toBeVisible/toBeDisabled 단언은 occlusion 을 검사하지 않아 우연히 통과(false-pass),
 *   - 하지만 덮인 버튼을 click 하는 케이스(desk-menu-session-deduct 등)는
 *     `<customer-chart-sheet> subtree intercepts pointer events` 로 클릭이 가로막혀 false-fail.
 *
 * 본 헬퍼는 카드 클릭 직후 2번차트를 닫아 본래 검증 대상(CheckInDetailSheet/DeskPaymentMenu)을
 * 드러낸다. 차트 진입 전 사용자 입력이 없어 dirtyRef=false → 닫기 버튼이 확인창 없이 즉시 닫는다.
 * 닫기 버튼은 Suspense 바깥 헤더(flex-shrink-0)에 있어 "차트 불러오는 중…" 중에도 항상 존재한다.
 * 차트가 안 떴으면 no-op(구·신 플로우 양쪽 안전).
 */
export async function dismissCustomerChartSheet(page: Page): Promise<void> {
  const sheet = page.locator('[data-testid="customer-chart-sheet"]');
  if (await sheet.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // 헤더 닫기 버튼(aria-label="닫기") — 입력 전이라 확인창 없이 즉시 onClose(ctxCloseChart)
    await sheet.getByRole('button', { name: '닫기' }).first().click().catch(() => {});
    await expect(sheet).toBeHidden({ timeout: 5_000 }).catch(async () => {
      // 폴백: 버튼 클릭이 안 먹으면 Escape(dirty=false 라 즉시 닫힘)
      await page.keyboard.press('Escape').catch(() => {});
      await expect(sheet).toBeHidden({ timeout: 5_000 }).catch(() => {});
    });
  }
}

/**
 * jongno-foot 셀프접수 canonical 이전 (T-20260615-foot-REGRESSION-SUITE-DEROT RC-A)
 *
 * 6/2 CF-CUTOVER + 6/3 OLDURL-DEPRECATE 로 /checkin/jongno-foot 의 네이티브
 * SelfCheckIn 은 폐기되고 canonical 이 foot-checkin.pages.dev(별도 레포)로 단일
 * 이전됨. obliv-foot-crm 의 CheckinRoute(App.tsx)는 deprecated slug 진입 시
 * window.location.replace(canonical) 로 강제 리다이렉트한다.
 *
 * 회귀 스펙이 네이티브 폼(#sc-name 등)을 직타 검증하던 부분은 dead-code 검증이
 * 되어 false-fail 을 낸다. 이 헬퍼는 "현재 prod-true 동작 = deprecated slug → canonical
 * 리다이렉트"를 결정적(offline-safe)으로 검증한다.
 *
 * ⚠️ 결정성 핵심(RC-A 2차): CheckinRoute 는 useEffect 에서 window.location.replace(canonical)
 * 로 실제 외부 네비게이션을 일으킨다. (1) route.abort() 만 쓰면 메인프레임 네비게이션이
 * "pending" 으로 남아 Playwright 가 "waiting for navigation to finish" 에 걸려 false-fail,
 * (2) Object.defineProperty(window.location,'replace') 스텁은 Chromium 에서 재정의 불가로
 * throw. 따라서 canonical 외부 요청을 **abort 가 아니라 stub HTML 로 fulfill** 해 네비게이션이
 * 정상 완료되게 한다. → 외부망 의존 0(오프라인 안전) + 리다이렉트가 실제로 canonical 로
 * 착지함을 URL·스텁마커로 결정적 검증. 이것이 본 레포 책임(deprecated→canonical 리다이렉트)의
 * 직접 계약 검증이다.
 */
export const DEPRECATED_CHECKIN_PATH = '/checkin/jongno-foot';
export const CANONICAL_CHECKIN_URL = 'https://foot-checkin.pages.dev/jongno-foot';
export const CANONICAL_STUB_MARKER = 'rc-a-canonical-stub';

/**
 * canonical(foot-checkin.pages.dev) 외부 요청을 오프라인 stub HTML 로 가로챈다.
 * deprecated slug 진입 시 window.location.replace 가 일으키는 외부 네비게이션을 abort 하면
 * 메인프레임이 pending/ERR_ABORTED 로 남아 false-fail 이 난다. stub fulfill 로 네비게이션을
 * 정상 완료시켜 결정성을 확보한다. 외부망 의존 0(오프라인 안전).
 */
export async function stubCanonicalCheckin(page: Page): Promise<void> {
  await page.route('https://foot-checkin.pages.dev/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body><h1 id="${CANONICAL_STUB_MARKER}">CANONICAL CHECKIN</h1></body></html>`,
    }),
  );
}

export async function expectDeprecatedCheckinRedirect(page: Page): Promise<void> {
  // 외부 canonical 요청을 오프라인 stub 으로 가로채 네비게이션을 정상 완료시킨다(pending 방지).
  await stubCanonicalCheckin(page);
  await page.context().clearCookies();
  // 진입 직후 useEffect 가 즉시 외부 리다이렉트 → 초기 문서 로드가 ERR_ABORTED 로 끊길 수 있어
  // goto 실패는 무시한다(정상 동작). 착지 검증은 stub 마커 가시성으로 결정적 수행.
  await page.goto(DEPRECATED_CHECKIN_PATH).catch(() => {});

  // CheckinRoute useEffect 의 window.location.replace → canonical stub 으로 착지(auto-wait)
  await expect(page.locator(`#${CANONICAL_STUB_MARKER}`)).toBeVisible({ timeout: 8_000 });

  // 리다이렉트 타깃 = canonical (실제 착지 URL 확인)
  expect(page.url()).toContain(CANONICAL_CHECKIN_URL);

  // 폐기된 네이티브 셀프체크인 폼은 더 이상 렌더되지 않아야 함 (dead-code 회수 확인)
  await expect(page.locator('#sc-name')).toHaveCount(0);

  // 로그인으로 튕기지 않음 (anon 라우트 보존 — 기존 B2 의도 유지)
  expect(page.url()).not.toContain('/login');
}

/**
 * /admin 진입 시 이미 storageState 로 인증된 상태가 정상.
 * Dashboard 텍스트가 보이면 true. /login 으로 튕기면 UI 로그인 폴백.
 */
export async function loginAndWaitForDashboard(page: Page): Promise<boolean> {
  await page.goto('/admin');

  // storageState 로 인증된 케이스 — /admin 그대로 유지
  if (!page.url().includes('/login')) {
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      return true;
    } catch {
      // 인증은 됐는데 화면 못 그림 — 폴백 시도
    }
  }

  return uiLogin(page);
}

async function uiLogin(page: Page): Promise<boolean> {
  await page.goto('/login');

  if (!page.url().includes('/login')) {
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  await page.getByLabel('이메일').fill(TEST_EMAIL);
  await page.getByLabel('비밀번호').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();

  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dashboard 접근 후 로딩 대기 (이미 로그인된 상태 가정).
 */
export async function navigateToDashboard(page: Page): Promise<boolean> {
  await page.goto('/admin');

  if (page.url().includes('/login')) {
    return loginAndWaitForDashboard(page);
  }

  try {
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}
