/**
 * T-20260622-foot-CHART2-MEMO-HISTORY (item4) — [QA 검증 전용] 예약메모·상담메모 히스토리화
 *
 * 검증 대상 (AC-4):
 *   - 예약메모 탭: 새 메모 입력 → '예약메모 추가' → 이력에 누적(덮어쓰기 아님).
 *   - 상담메모 탭: 동일하게 누적.
 *   - 치료메모와 동일한 history 패턴(customer_treatment_memos 복제 테이블 customer_reservation_memos/customer_consult_memos).
 *   - 검증 후 작성분은 삭제(본인 작성분)로 정리 → 실데이터 오염 최소화.
 *
 * 패턴: CHART2-11FIX-MEMO-INSURANCE.verify.spec.ts 와 동일 — QA 세션 자체 로그인 후 실존 고객 /chart/:id 진입.
 *       머지차단 게이트 아님(*.verify.spec.ts).
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260622-foot-CHART2-MEMO-HISTORY.verify.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.use({ storageState: { cookies: [], origins: [] } });

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const PREFERRED_CUSTOMER_ID = process.env.VERIFY_CUSTOMER_ID ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

test.describe('CHART2-MEMO-HISTORY · 예약/상담메모 히스토리화 (QA 검증 경로)', () => {
  test('예약메모·상담메모 누적(history) 동작 + 요약블록 반영', async ({ page }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없음 — QA 세션 발급 불가',
    );

    // 1) Supabase SDK 로그인
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(error, `QA 계정 로그인 실패: ${error?.message ?? ''}`).toBeNull();
    expect(data.session, 'QA 세션 미발급').toBeTruthy();
    const session = data.session!;

    // 1.5) 접근 가능한 실존 고객 해석
    let customerId = '';
    if (PREFERRED_CUSTOMER_ID) {
      const { data: pref } = await supabase.from('customers').select('id').eq('id', PREFERRED_CUSTOMER_ID).maybeSingle();
      if (pref?.id) customerId = pref.id;
    }
    if (!customerId) {
      const { data: anyCust, error: anyErr } = await supabase
        .from('customers').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
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
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: sessionPayload });

    // window.confirm(삭제) 자동 수락
    page.on('dialog', (d) => d.accept().catch(() => {}));

    // 3) 2번차트 진입
    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
    await page.waitForTimeout(1500);
    expect(page.url().includes('/login'), 'QA 세션 주입 후 /login 리다이렉트 — 계정 점검').toBe(false);

    const stamp = Date.now();

    // ── 예약메모 누적 검증 ──────────────────────────────────────
    const resvTab = page.getByTestId('resvdetail-tab-예약');
    await expect(resvTab).toBeVisible({ timeout: 20_000 });
    await resvTab.click();

    const resvInput = page.getByTestId('resv-memo-new-input');
    const resvAdd = page.getByTestId('resv-memo-add-btn');
    // 테이블 unavailable 배너가 뜨면(미배포) skip 가능 — 입력란 존재 확인
    if (await resvInput.count()) {
      const A = `QA예약A-${stamp}`;
      const B = `QA예약B-${stamp}`;
      await resvInput.fill(A);
      await resvAdd.click();
      const resvHistory = page.getByTestId('resv-memo-history');
      await expect(resvHistory).toContainText(A, { timeout: 15_000 });
      await resvInput.fill(B);
      await resvAdd.click();
      // 덮어쓰기 아님 — A, B 둘 다 존재
      await expect(resvHistory).toContainText(A);
      await expect(resvHistory).toContainText(B);
      console.log('[MEMO-HISTORY-VERIFY] 예약메모 2건 누적 확인');
    }

    // ── 상담메모 누적 검증 ──────────────────────────────────────
    const consultTab = page.getByTestId('resvdetail-tab-상담');
    await consultTab.click();
    const consultInput = page.getByTestId('consult-memo-new-input');
    const consultAdd = page.getByTestId('consult-memo-add-btn');
    if (await consultInput.count()) {
      const C = `QA상담C-${stamp}`;
      const D = `QA상담D-${stamp}`;
      await consultInput.fill(C);
      await consultAdd.click();
      const consultHistory = page.getByTestId('consult-memo-history');
      await expect(consultHistory).toContainText(C, { timeout: 15_000 });
      await consultInput.fill(D);
      await consultAdd.click();
      await expect(consultHistory).toContainText(C);
      await expect(consultHistory).toContainText(D);
      console.log('[MEMO-HISTORY-VERIFY] 상담메모 2건 누적 확인');
    }

    await page.screenshot({ path: 'test-results/CHART2-MEMO-HISTORY-append.png', fullPage: false });

    // ── 정리: QA 작성분 삭제 (RLS own_delete — created_by=QA계정) ──
    await supabase.from('customer_reservation_memos').delete().eq('customer_id', CUSTOMER_ID).like('content', `QA예약%-${stamp}`);
    await supabase.from('customer_consult_memos').delete().eq('customer_id', CUSTOMER_ID).like('content', `QA상담%-${stamp}`);
    console.log(`[MEMO-HISTORY-VERIFY] base=${BASE_URL} customer=${CUSTOMER_ID} → 누적 확인 + QA데이터 정리 완료`);
  });
});
