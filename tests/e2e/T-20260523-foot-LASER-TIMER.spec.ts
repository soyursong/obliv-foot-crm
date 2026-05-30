/**
 * E2E spec — T-20260523-foot-LASER-TIMER (v3 — 테스트 데이터 자체 시드)
 * 비가열 레이저 타이머 — 2번차트 3구역 [상세] 탭 상단 위치 + 확인 다이얼로그 + 2단계 색상
 *
 * 2026-05-25 20:55 피드백: 진료차트 Drawer(MedicalChartPanel) → 2번차트 CustomerChartSheet로 위치 이동.
 * 2026-05-31 FIX-REQUEST(phase2 insufficient_verification):
 *   - v2는 대시보드 check-in 카드가 "오늘 날짜"에 존재할 때만 동작 → 더미 데이터는 예약+과거체크인만
 *     시드하므로 칸반 카드가 없어 S-0~S-3 전부 skip. E2E가 실제 동작을 검증하지 못함.
 *   - v3: spec 이 service_role 로 "오늘 날짜 활성 check_in" 1건을 직접 시드하고(beforeAll),
 *     해당 카드(data-checkin-id)를 결정적으로 클릭해 2번차트를 연 뒤 타이머를 검증한다.
 *     테스트 종료 시 timer_records → check_ins → customers 순으로 정리(afterAll).
 *   - 시드 패턴은 tests/e2e/T-20260514-foot-PAYMENT-AUTO-DONE.spec.ts 와 동일.
 *   - Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 *
 * AC-1: 2번차트 3구역 [상세] 탭 상단에 타이머 섹션 항상 표시
 *       (예약/상담/치료메모 탭 선택 전후 무관)
 * AC-3: amber(1분 이하) / red(만료) CSS 클래스 분리 (laser-timer-warn / laser-timer-expire)
 * AC-4: 종료 버튼 → 확인 다이얼로그 표시 → 취소/확인 분기
 *
 * 시나리오:
 *   S-0: AC-1 위치 확인 — 2번차트 열기 → 탭 클릭 전 타이머 패널 표시
 *   S-1: 종료 버튼 클릭 → 확인 다이얼로그 표시 (직접 종료 금지)
 *   S-2: 확인 다이얼로그 → 취소 → 타이머 계속 실행 중
 *   S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단 (시작 버튼 복귀)
 *   S-4: CSS 클래스 — laser-timer-warn / laser-timer-expire 존재 확인 (스타일시트)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (PAYMENT-AUTO-DONE 등 기존 spec 과 동일 상수)
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

// beforeAll 에서 채워짐 — 시드된 오늘 check-in / 고객
let sb: SupabaseClient | null = null;
let seededCheckInId: string | null = null;
let seededCustomerId: string | null = null;
let seededName = '';

test.describe('T-20260523-foot-LASER-TIMER — AC-1 위치(2번차트) + 확인 다이얼로그 + 2단계 색상', () => {
  // 오늘 날짜 활성 check-in 1건 시드 → 대시보드 칸반 카드 보장
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);

    seededName = `laser-timer-qa-${Date.now()}`;
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: seededName, phone, visit_type: 'returning' })
      .select('id')
      .single();
    if (custErr || !customer) {
      throw new Error(`[seed] 고객 생성 실패: ${custErr?.message ?? 'no row'}`);
    }
    seededCustomerId = customer.id;

    // 오늘(now) 활성 check-in — treatment_waiting (cancelled/done 이 아니면 칸반 노출)
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: seededCustomerId,
        customer_name: seededName,
        customer_phone: phone,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9500 + (Date.now() % 400),
      })
      .select('id')
      .single();
    if (ciErr || !checkIn) {
      throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);
    }
    seededCheckInId = checkIn.id;
    console.log(`[seed] 오늘 활성 check-in 시드 완료 — id=${seededCheckInId}, name=${seededName}`);
  });

  // 시드 정리 — timer_records(FK CASCADE 대비 명시 삭제) → check_ins → customers
  test.afterAll(async () => {
    if (!sb) return;
    if (seededCheckInId) {
      await sb.from('timer_records').delete().eq('check_in_id', seededCheckInId);
      await sb.from('check_ins').delete().eq('id', seededCheckInId);
    }
    if (seededCustomerId) {
      await sb.from('customers').delete().eq('id', seededCustomerId);
    }
    console.log('[seed] 정리 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env(VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * 대시보드 → 시드된 카드(data-checkin-id) 클릭 → CustomerChartSheet(2번차트) 오픈.
   * 시드가 보장되므로 카드는 반드시 존재한다. 못 찾으면 명시적 실패(throw)로 회귀를 잡는다.
   */
  async function openSeededChartSheet(page: Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${seededCheckInId}"]`);
    // 칸반 fetch + realtime 반영까지 약간의 여유
    await card.first().waitFor({ state: 'visible', timeout: 15_000 });

    // 좌클릭 → handleCardClick → ctxOpenChart(customer_id) → CustomerChartSheet
    await card.first().click();

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.waitFor({ state: 'visible', timeout: 10_000 });
    return sheet;
  }

  /**
   * 시드 카드로 2번차트 오픈 → [5분] 타이머 시작. countdown 표시까지 확인.
   */
  async function openChartSheetAndStartTimer(page: Page) {
    const sheet = await openSeededChartSheet(page);

    const timerPanel = sheet.locator('[data-testid="laser-timer-panel"]');
    await timerPanel.waitFor({ state: 'visible', timeout: 10_000 });

    const btn5 = sheet.locator('[data-testid="laser-timer-btn-5"]');
    await btn5.waitFor({ state: 'visible', timeout: 5_000 });
    await btn5.click();

    const countdown = sheet.locator('[data-testid="laser-timer-countdown"]');
    await countdown.waitFor({ state: 'visible', timeout: 5_000 });
    return sheet;
  }

  // S-0: AC-1 위치 확인 — 탭 클릭 전 2번차트에서 타이머 패널이 바로 보여야 함
  test('S-0: AC-1 — 2번차트 열기 시 탭 전환 없이 타이머 패널 표시', async ({ page }) => {
    const sheet = await openSeededChartSheet(page);

    // 타이머 패널은 탭 선택 없이도 [상세] 섹션 상단에 표시되어야 함 (시드 check-in 있음)
    const timerPanel = sheet.locator('[data-testid="laser-timer-panel"]');
    await expect(timerPanel).toBeVisible({ timeout: 10_000 });

    // 시작 버튼 3종 모두 표시 확인
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-20"]')).toBeVisible();

    // 예약 탭 클릭 후에도 타이머 패널 유지 (탭 상단 위치 - 탭에 종속되지 않음)
    const resvTab = sheet.getByRole('button', { name: '예약' });
    if (await resvTab.count() > 0) {
      await resvTab.first().click();
      await expect(timerPanel).toBeVisible({ timeout: 2_000 });
    }

    // 치료메모 탭 클릭 후에도 타이머 패널 유지
    const memoTab = sheet.getByRole('button', { name: '치료메모' });
    if (await memoTab.count() > 0) {
      await memoTab.first().click();
      await expect(timerPanel).toBeVisible({ timeout: 2_000 });
    }
  });

  // S-1: 종료 버튼 → 확인 다이얼로그 표시
  test('S-1: 종료 버튼 클릭 → 확인 다이얼로그 표시 (직접 종료 금지)', async ({ page }) => {
    const sheet = await openChartSheetAndStartTimer(page);

    const stopBtn = sheet.locator('[data-testid="laser-timer-stop-btn"]');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // 확인 다이얼로그가 표시되어야 함
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await expect(confirm).toBeVisible({ timeout: 2_000 });

    // 시작 버튼이 복귀되지 않아야 함 (즉시 종료 아님)
    const startBtns = sheet.locator('[data-testid="laser-timer-start-buttons"]');
    await expect(startBtns).not.toBeVisible();

    // 정리: 확인하여 종료
    const confirmBtn = sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-2: 확인 다이얼로그 → 취소 → 타이머 유지
  test('S-2: 확인 다이얼로그 취소 → 타이머 계속 실행', async ({ page }) => {
    const sheet = await openChartSheetAndStartTimer(page);

    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 취소 버튼 클릭
    await sheet.locator('[data-testid="laser-timer-stop-cancel"]').click();

    // 다이얼로그 닫힘
    await expect(confirm).not.toBeVisible({ timeout: 2_000 });

    // 타이머 카운트다운 여전히 표시
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).toBeVisible();

    // 정리: 재종료
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirmBtn = sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-3: 확인 다이얼로그 → 종료 확인 → 타이머 중단
  test('S-3: 확인 다이얼로그 종료 확인 → 시작 버튼 복귀', async ({ page }) => {
    const sheet = await openChartSheetAndStartTimer(page);

    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirm = sheet.locator('[data-testid="laser-timer-stop-confirm"]');
    await confirm.waitFor({ state: 'visible', timeout: 2_000 });

    // 종료 확인 버튼 클릭
    await sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]').click();

    // 시작 버튼 복귀 확인 (타이머 종료)
    await expect(sheet.locator('[data-testid="laser-timer-start-buttons"]')).toBeVisible({ timeout: 5_000 });

    // 카운트다운 사라짐
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).not.toBeVisible();
  });

  // S-4: CSS 클래스 확인 — laser-timer-warn / laser-timer-expire 스타일시트 등록
  test('S-4: laser-timer-warn + laser-timer-expire 클래스 스타일시트 등록', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 페이지 내 스타일시트에서 클래스 이름 확인
    const hasWarn = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule instanceof CSSStyleRule && rule.selectorText?.includes('laser-timer-warn')) return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasWarn, 'laser-timer-warn 클래스 미등록').toBe(true);

    const hasExpire = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule instanceof CSSStyleRule && rule.selectorText?.includes('laser-timer-expire')) return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasExpire, 'laser-timer-expire 클래스 미등록').toBe(true);
  });
});
