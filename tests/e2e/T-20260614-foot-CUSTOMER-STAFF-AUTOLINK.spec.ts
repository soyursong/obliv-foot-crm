import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260614-foot-CUSTOMER-STAFF-AUTOLINK (기능1)
 *
 * 고객 '담당자' 자동연동 — 기존 customers.assigned_staff_id(차트2/CustomerChartPage Zone1 담당자 드롭다운,
 * C2-STAFF-DROPDOWN)를 목록/상세에 노출. '2번 차트' = 고객 차트(차트2 폼)로 확정(superseded CHART2-LINK Q1=A).
 *   - 재진 고객: 차트의 assigned_staff_id(담당자)를 자동 연동 표시.
 *   - 첫 방문 고객: assigned_staff_id NULL → 담당자 공란.
 *   - 표시 위치: 고객 목록 + 예약 목록(카드) + 상세(고객차트·예약상세 旣구현).
 *
 * AC1: 재진 고객 → assigned_staff_id 가 가리키는 직원 이름 자동 표시.
 * AC2: 첫 방문 고객(assigned_staff_id NULL) → 공란.
 * AC3: 목록 + 상세 두 화면 적용 (상세=CustomerChartPage 담당자 드롭다운 / ReservationDetailPopup 旣구현).
 * AC4: 담당자 미지정/차트 없음 등 결손 시 빈 값 안전 표시(에러 없음).
 *
 * db_change=false — 기존 컬럼 read만. 신규 컬럼/테이블/enum 없음.
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak.
 */

const CUST_PAGE = fs.readFileSync(path.resolve('src/pages/Customers.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const CHART_PAGE = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 고객 목록 담당자 컬럼 (결정론적 헤더/셀 렌더)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260614 CUSTOMER-STAFF-AUTOLINK — 고객 목록 담당자 컬럼 (라이브)', () => {
  test('AC3: 고객관리 목록에 담당자 컬럼 헤더 + 셀 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.goto('/admin/customers');
    // 담당자 필터 셀렉트로 고객관리 화면 진입 확인
    const ready = await page.getByTestId('cust-staff-filter').isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    // 담당자 컬럼 헤더 존재
    await expect(page.getByRole('columnheader', { name: '담당자' })).toBeVisible({ timeout: 5_000 });

    // 결과 행이 있으면 담당자 셀은 항상 렌더(이름 또는 '-'), 에러 없음(AC4)
    const cells = page.getByTestId('cust-assigned-staff');
    const count = await cells.count();
    if (count > 0) {
      // 첫 셀은 빈 문자열이 아니라 이름 또는 '-' (안전 표시)
      const txt = (await cells.first().textContent())?.trim() ?? '';
      expect(txt.length).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — 담당자 결선 (고객 목록 / 예약 카드 / 상세)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260614 CUSTOMER-STAFF-AUTOLINK — 결선 (소스 무결성)', () => {
  test('AC1/AC3: 고객 목록 담당자 컬럼 = assigned_staff_id → staffNameMap 이름', () => {
    expect(CUST_PAGE).toContain('staffNameMap');
    expect(CUST_PAGE).toMatch(/<th[^>]*>담당자<\/th>/);
    expect(CUST_PAGE).toMatch(/c\.assigned_staff_id\s*&&\s*staffNameMap\.get\(c\.assigned_staff_id\)/);
  });

  test('AC2/AC4: 첫방문(NULL)·결손 시 공란 안전표시 (|| "-")', () => {
    expect(CUST_PAGE).toMatch(/\(c\.assigned_staff_id\s*&&\s*staffNameMap\.get\(c\.assigned_staff_id\)\)\s*\|\|\s*'-'/);
  });

  test('가드: staffNameMap 은 role/active 필터 없이 clinic 전체 로드 (비활성·director 담당자도 이름 resolve)', () => {
    // 전체 staff 이름 맵 로드 — .in('role', ...) / active 필터가 이 맵 로드에 없어야 함
    // T-20260618-foot-STAFF-DISPLAYNAME-SELECT-400 정합: display_name 컬럼 DB 미존재 → select 는 'id, name' 만(회귀 정합).
    expect(CUST_PAGE).toMatch(/from\('staff'\)[\s\S]{0,160}select\('id, name'\)[\s\S]{0,80}eq\('clinic_id', clinic\.id\)/);
  });

  // ⚠ SUPERSEDED by T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI:
  //   예약 카드(예약관리 surface)의 '담당자' 표시 기준이 차트 담당자(customers.assigned_staff_id)에서
  //   '예약 잡은 계정'(COALESCE(updated_by, created_by) → user_profiles.name)으로 재정의됨(reporter=김주연 총괄 policy_superseded).
  //   따라서 예약 카드에서 resvAssignedStaffMap·customers.assigned_staff_id 사용은 제거됨. 신규 동작은 BOOKER spec에서 검증.
  test('SUPERSEDED: 예약 카드 담당자는 더이상 resvAssignedStaffMap(차트 담당자)을 쓰지 않음', () => {
    expect(RESV_PAGE).not.toContain('resvAssignedStaffMap');
    // assigned-staff-tag testid 는 BOOKER UI 가 승계(연락처 옆 @담당자명) — 존재는 하되 booker 소스 기반
    expect(RESV_PAGE).toMatch(/data-testid=\{`assigned-staff-tag-\$\{r\.id\}`\}/);
  });

  test('SCOPE 가드: 예약 fetchWeek 가 customers.assigned_staff_id 를 더이상 로드하지 않음(예약관리 한정 재정의)', () => {
    // 차트번호(chart_number)만 로드 — assigned_staff_id 는 제거(예약 surface 한정). 고객 목록/차트2 surface 의 의미는 불변.
    expect(RESV_PAGE).toMatch(/select\('id, chart_number'\)/);
    expect(RESV_PAGE).not.toMatch(/select\('id, chart_number, assigned_staff_id'\)/);
  });

  test('AC3: 고객 상세(차트2) 담당자 드롭다운 旣구현 (assigned_staff_id 바인딩)', () => {
    // C2-STAFF-DROPDOWN — 차트2 Zone1 담당자 select 가 customer.assigned_staff_id 표시
    expect(CHART_PAGE).toMatch(/value=\{customer\.assigned_staff_id\s*\?\?\s*''\}/);
  });
});
