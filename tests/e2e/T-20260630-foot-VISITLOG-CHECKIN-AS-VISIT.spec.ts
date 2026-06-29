/**
 * T-20260630-foot-VISITLOG-CHECKIN-AS-VISIT — "접수 = 방문" 방문이력 표시 검증
 *
 * 요구(문지은 대표원장 direct confirm, ts:1782772863.276119):
 *   방문이력 탭에서 접수(check_ins) 기록이 있으면 치료 내용(진료종류/치료메모/진료메모)이
 *   없어도 방문이력에 1행으로 표시한다. 구 정책 T-20260609-foot-VISITLOG-EMPTYROW-HIDE
 *   (빈-내용 행 숨김)의 empty-content 필터를 완화(policy_superseded).
 *
 * 검증 전략(데이터 의존 최소화 + 라이브 prod 진입):
 *   NAMING-CLARIFY.verify 패턴 재사용 — Supabase SDK QA 로그인 → 세션 localStorage 주입 →
 *   deep-link(?medchart=visit_hist) 자동 오픈. 런타임에 "check_ins 레코드가 있는 고객"을
 *   선택해 진입하고, 방문이력 패널이 empty state가 아니라 1행 이상 표시됨을 단언한다(AC-1).
 *   접수-only(치료 내용 전무) 고객이 잡히면 "접수" 표기까지 단언(AC-2), 없으면 그 단언은 skip.
 *   AC-3(전체 0건 empty state)은 check_ins 0건 고객으로 별도 단언.
 *   머지차단 게이트 아님(*.spec.ts지만 자체 로그인하므로 storageState 불요).
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260630-foot-VISITLOG-CHECKIN-AS-VISIT.spec.ts \
 *     --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD =
  process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

/** QA 세션 발급 + 대상 origin localStorage 주입까지 수행하는 공통 헬퍼 */
async function injectQaSession(page: import('@playwright/test').Page) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  expect(error, `QA 계정 로그인 실패: ${error?.message ?? ''}`).toBeNull();
  expect(data.session, 'QA 세션 미발급').toBeTruthy();
  const session = data.session!;

  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: sessionPayload },
  );
  return supabase;
}

test.describe('VISITLOG-CHECKIN-AS-VISIT · "접수 = 방문" 방문이력 표시', () => {
  test('AC-1/AC-2: 접수(check_ins) 기록이 있는 고객 → 방문이력 행 표시(빈 패널 아님)', async ({ page }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없음 — QA 세션 발급 불가',
    );

    const supabase = await injectQaSession(page);

    // check_ins 레코드가 있는 고객을 런타임 선택. 가능하면 치료 내용 전무(접수-only)를 우선.
    const { data: checkins, error: ciErr } = await supabase
      .from('check_ins')
      .select('customer_id, treatment_kind, treatment_memo, doctor_note')
      .not('customer_id', 'is', null)
      .order('checked_in_at', { ascending: false })
      .limit(200);
    expect(ciErr, `check_ins 조회 실패: ${ciErr?.message ?? ''}`).toBeNull();
    test.skip(!checkins || checkins.length === 0, 'check_ins 레코드 0건 — 표시 검증 불가');

    const isEmptyContent = (ci: { treatment_kind: unknown; treatment_memo: { details?: string } | null; doctor_note: string | null }) => {
      const td = (ci.treatment_memo?.details ?? '').trim();
      return !ci.treatment_kind && !td && !(ci.doctor_note ?? '').trim();
    };
    // 접수-only(치료 내용 전무) 고객 우선, 없으면 아무 check_ins 고객
    const checkinOnly = (checkins ?? []).find(isEmptyContent);
    const target = checkinOnly ?? checkins![0];
    const CUSTOMER_ID = (target as { customer_id: string }).customer_id;
    const expectCheckinLabel = !!checkinOnly;
    console.log(
      `[CHECKIN-AS-VISIT] customer=${CUSTOMER_ID} checkin_only=${expectCheckinLabel}`,
    );

    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}?medchart=visit_hist`);
    await page.waitForTimeout(1500);
    expect(
      page.url().includes('/login'),
      'QA 세션 주입 후에도 /login 리다이렉트 — 계정 미승인/만료 의심',
    ).toBe(false);

    await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 20_000 });
    const visitTab = page.getByTestId('right-panel-tab-visit_hist');
    await expect(visitTab).toBeVisible({ timeout: 10_000 });
    await visitTab.click();

    // AC-1: 접수 기록이 있으므로 빈 패널("이전 방문 기록이 없어요")이 아니어야 한다.
    await expect(page.getByTestId('visit-hist-empty')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('visit-hist-item').first()).toBeVisible({ timeout: 10_000 });

    // AC-2: 접수-only 고객이면 "접수" 표기가 방문이력 안에 보여야 한다.
    if (expectCheckinLabel) {
      await expect(page.getByTestId('visit-hist-item').filter({ hasText: '접수' }).first())
        .toBeVisible({ timeout: 10_000 });
    }

    await page.screenshot({
      path: 'test-results/VISITLOG-CHECKIN-AS-VISIT-row-visible.png',
      fullPage: false,
    });
  });

  test('AC-3: 접수도 치료도 0건 고객 → 빈 패널 empty state 1회 유지', async ({ page }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없음 — QA 세션 발급 불가',
    );

    const supabase = await injectQaSession(page);

    // check_ins 가 전혀 없는 고객을 런타임 선택
    const { data: cids } = await supabase
      .from('check_ins')
      .select('customer_id')
      .not('customer_id', 'is', null)
      .limit(1000);
    const withCheckin = new Set((cids ?? []).map((r) => (r as { customer_id: string }).customer_id));
    const { data: custs } = await supabase
      .from('customers')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(500);
    const noCheckin = (custs ?? []).find((c) => !withCheckin.has((c as { id: string }).id));
    test.skip(!noCheckin, 'check_ins 0건 고객을 찾지 못함 — empty state 검증 skip');
    const CUSTOMER_ID = (noCheckin as { id: string }).id;
    console.log(`[CHECKIN-AS-VISIT] empty-state customer=${CUSTOMER_ID}`);

    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}?medchart=visit_hist`);
    await page.waitForTimeout(1500);
    expect(page.url().includes('/login'), 'QA 세션 주입 후 /login 리다이렉트').toBe(false);

    await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 20_000 });
    const visitTab = page.getByTestId('right-panel-tab-visit_hist');
    await expect(visitTab).toBeVisible({ timeout: 10_000 });
    await visitTab.click();

    // empty state 정확히 1회, 방문 행 0건
    await expect(page.getByTestId('visit-hist-empty')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId('visit-hist-item')).toHaveCount(0);
  });
});
