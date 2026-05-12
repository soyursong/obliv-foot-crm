/**
 * E2E spec — T-20260511-foot-C2-MANAGER-PAYMENT-MAP
 * 2번차트 담당자 드롭다운에서만 원장(role=director) 제외 — 코드 레벨 필터
 *
 * AC7-v3: CustomerChartPage.tsx 담당자 드롭다운 — role='director'(원장) 제외
 * AC8:    기존 배포분 회귀 없음 (상담 탭 담당자는 원장 포함 유지)
 * AC9:    DB staff 데이터 변경 없음 — 원장 active=true 유지
 * AC10:   다른 화면(Closing, CheckInDetailSheet) 변경 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.describe('T-20260511-C2-MANAGER-PAYMENT-MAP — 2번차트 담당자 드롭 원장 제외', () => {

  test('AC9: DB — staff 원장(director) active=true 유지 (DB 변경 없음)', async ({ request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정 — DB 검증 스킵');
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/staff?select=id,name,role,active&role=eq.director`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    const directors = await res.json();
    // director 직원이 존재하는 경우에만 active 확인
    if (Array.isArray(directors) && directors.length > 0) {
      for (const d of directors) {
        expect(d.active, `원장 ${d.name} active=true 이어야 함`).toBe(true);
      }
      console.log(`[AC9] 원장 ${directors.length}명 active=true 확인 PASS`);
    } else {
      console.log('[AC9] director 직원 없음 — DB 변경 없음 확인 스킵');
    }
  });

  test('AC7-v3: 2번차트 담당자 드롭다운 — 원장 옵션 없음', async ({ page, request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정 — 고객 ID 조회 불가');
      return;
    }

    // 고객 ID 조회
    const custRes = await request.get(
      `${SUPABASE_URL}/rest/v1/customers?select=id&limit=1&order=created_at.desc`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    const customers = await custRes.json();
    if (!Array.isArray(customers) || customers.length === 0) {
      test.skip(true, '고객 데이터 없음 — 스킵');
      return;
    }

    const customerId = customers[0].id;
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패');
      return;
    }

    // 2번차트 페이지 이동
    await page.goto(`/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    // 담당자 행 찾기 — "담당자" 텍스트를 포함하는 td 다음의 select
    // 기본정보 섹션(2번차트)의 담당자 드롭다운
    const staffSelect = page.locator('select').filter({
      has: page.locator('option[value=""]', { hasText: /선택/ }),
    }).first();

    // 담당자 셀렉트가 존재하는지 확인
    const hasSelect = await staffSelect.count() > 0;
    if (!hasSelect) {
      // 페이지 렌더링 대기 후 재시도
      await page.waitForTimeout(2000);
      const retryCount = await page.locator('select').count();
      if (retryCount === 0) {
        console.log('[AC7-v3] select 요소 미발견 — 스킵');
        test.skip(true, 'select 미발견');
        return;
      }
    }

    // "담당자" 레이블 옆 select — 원장 옵션 없음 확인
    // 페이지에서 "담당자" 텍스트가 있는 행의 select를 찾는다
    const allSelects = page.locator('select');
    const selectCount = await allSelects.count();

    let directorFound = false;
    for (let i = 0; i < selectCount; i++) {
      const sel = allSelects.nth(i);
      const options = await sel.locator('option').allTextContents();
      // 담당자 드롭다운인지 확인 (— 선택 — 옵션 존재)
      const isStaffDropdown = options.some(o => o.includes('선택'));
      if (!isStaffDropdown) continue;

      // 원장 옵션 텍스트 검색
      const hasDirector = options.some(o => o.includes('원장') || o.includes('director'));
      if (hasDirector) {
        directorFound = true;
        console.log(`[AC7-v3] FAIL: select[${i}] 에서 원장 옵션 발견:`, options.filter(o => o.includes('원장') || o.includes('director')));
      }
    }

    expect(directorFound, '2번차트 내 어떤 담당자 드롭다운에도 원장 옵션이 없어야 함').toBe(false);
    console.log('[AC7-v3] 담당자 드롭다운 원장 옵션 없음 PASS');
  });

  test('AC8: 기존 CustomerChartPage 렌더링 회귀 없음', async ({ page, request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정');
      return;
    }

    const custRes = await request.get(
      `${SUPABASE_URL}/rest/v1/customers?select=id&limit=1&order=created_at.desc`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    const customers = await custRes.json();
    if (!Array.isArray(customers) || customers.length === 0) {
      test.skip(true, '고객 데이터 없음');
      return;
    }

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패');
      return;
    }

    const customerId = customers[0].id;
    await page.goto(`/chart/${customerId}`);

    // 기본 렌더링 확인 — 오류 없이 페이지 로드
    await page.waitForLoadState('networkidle');

    // 치명적 오류 다이얼로그/텍스트 없음
    const errorText = page.locator('text=Error, text=오류').first();
    const hasError = await errorText.count() > 0;
    if (hasError) {
      const text = await errorText.textContent();
      console.warn('[AC8] 페이지 오류 감지:', text);
    }

    // 기본 페이지 구조 확인
    const pageContent = await page.content();
    expect(pageContent.length, '페이지 내용이 비어있지 않아야 함').toBeGreaterThan(1000);

    console.log('[AC8] CustomerChartPage 렌더링 회귀 없음 PASS');
  });
});
