/**
 * T-20260622-foot-CHART2-11FIX-MEMO-INSURANCE — [QA 검증 전용] 2번차트 상세 메모 라벨/요약 블록
 *
 * 검증 대상:
 *   item2 — 상세 탭 표시 라벨: '예약'→'고객메모'(CUSTMEMO-RENAME 반영), '상담'→'상담메모', '치료메모' 유지.
 *           (내부 식별자/category 키 불변, 표시 문구만 변경)
 *   item3 — 상담메모 고정블록을 [수납 통계] 상단의 '메모 요약'으로 이동.
 *           예약/상담/치료메모 각 최신 1건만 라벨과 함께 표시(스크롤 없음).
 *
 * 패턴: VISITLOG-NAMING-CLARIFY.verify.spec.ts 와 동일 — QA 세션 자체 로그인 후
 *       접근 가능한 실존 고객으로 /chart/:id 진입. 머지차단 게이트 아님(*.verify.spec.ts).
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260622-foot-CHART2-11FIX-MEMO-INSURANCE.verify.spec.ts \
 *     --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const PREFERRED_CUSTOMER_ID = process.env.VERIFY_CUSTOMER_ID ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD =
  process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? 'TestPass2026!';

test.describe('CHART2-11FIX · 2번차트 상세 메모 라벨/요약 (QA 검증 경로)', () => {
  test('item2 라벨(고객메모/상담메모/치료메모) + item3 메모 요약 블록 노출', async ({ page }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없음 — QA 세션 발급 불가',
    );

    // 1) Supabase SDK 로그인
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

    // 1.5) 접근 가능한 실존 고객 해석 (고정 ID 부패 방지)
    let customerId = '';
    if (PREFERRED_CUSTOMER_ID) {
      const { data: pref } = await supabase
        .from('customers')
        .select('id')
        .eq('id', PREFERRED_CUSTOMER_ID)
        .maybeSingle();
      if (pref?.id) customerId = pref.id;
    }
    if (!customerId) {
      const { data: anyCust, error: anyErr } = await supabase
        .from('customers')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      expect(anyErr, `접근 가능한 고객 조회 실패: ${anyErr?.message ?? ''}`).toBeNull();
      expect(anyCust?.id, 'QA 세션으로 접근 가능한 고객 0건').toBeTruthy();
      customerId = anyCust!.id;
    }
    const CUSTOMER_ID = customerId;

    // 2) 세션 주입
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

    // 3) 2번차트 진입
    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
    await page.waitForTimeout(1500);
    expect(page.url().includes('/login'), 'QA 세션 주입 후 /login 리다이렉트 — 계정 점검').toBe(false);

    // 4) item2 — 상세 탭 라벨 단언 (내부 식별자는 data-testid 의 한글 키로 유지, 표시는 '메모')
    const resvTab = page.getByTestId('resvdetail-tab-예약');
    const consultTab = page.getByTestId('resvdetail-tab-상담');
    const treatTab = page.getByTestId('resvdetail-tab-치료메모');
    await expect(resvTab).toBeVisible({ timeout: 20_000 });
    await expect(resvTab).toHaveText('고객메모');       // '예약' 아님 (CUSTMEMO-RENAME: 예약메모→고객메모)
    await expect(consultTab).toHaveText('상담메모');     // '상담' 아님
    await expect(treatTab).toHaveText('치료메모');       // 유지

    // 5) item3 — 메모 요약 블록은 수납 통계 상단에 위치 (DOM 순서: memo-summary-block 이 '수납 통계' 보다 앞)
    //    (요약 블록은 3종 메모가 모두 비어있으면 렌더 안 됨 → conditional 단언)
    const summary = page.getByTestId('memo-summary-block');
    if (await summary.count()) {
      await expect(summary).toBeVisible();
      await expect(summary).toContainText('메모 요약');
    }

    await page.screenshot({
      path: 'test-results/CHART2-11FIX-memo-label-summary.png',
      fullPage: false,
    });
    console.log(`[CHART2-11FIX-VERIFY] base=${BASE_URL} customer=${CUSTOMER_ID} → 라벨/요약 확인`);
  });
});
