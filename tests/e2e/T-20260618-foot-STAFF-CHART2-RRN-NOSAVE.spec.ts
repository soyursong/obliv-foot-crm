/**
 * E2E spec — T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B / DA CONSULT-REPLY MSG-20260618-185650-arwz)
 * [2번차트] 주민번호 조회 권한 없는 직원에게 '미입력' 대신 '조회 권한 없음' 안내문 표기
 *
 * 배경: prod rrn_decrypt 게이트1 = is_admin_or_manager(admin/manager/director). 그 외 역할은
 *       주민번호가 저장돼 있어도 복호화 결과가 null → 기존 UI 가 '미입력'으로 표기 →
 *       "저장이 안 됐다"는 오해 발생(현장 보고). Option B = FE 안내문(PHI/DB 무변경).
 *       A1(전직원 복원)·A2(역할 한정 복원)는 대표 PHI 게이트 통과 전까지 HOLD.
 *
 * AC-1(logic): canViewRrn 게이트가 prod rrn_decrypt 게이트(admin/manager/director)와 정확히 일치.
 *              consultant/coordinator/therapist/tm/staff/part_lead 는 false(=값 미조회).
 * AC-2(UI 상호배타): 2번차트 주민번호 행은 'viewer 모드(값/미입력/수정·입력)'와
 *              'non-viewer 안내문(조회 권한 없음)'이 동시에 뜨지 않는다(오해 조합 차단).
 * AC-3(UI 핵심 회귀): non-viewer 안내문('조회 권한 없음')이 뜨면, 같은 행에 '미입력'이 없어야 한다
 *              (= 권한 없는 직원에게 '저장 안 됨'으로 읽히는 빈 표기 금지).
 * AC-4(PHI): 평문 주민번호(YYMMDD-뒷자리7 / 13자리 연속) 화면 미노출 — 어떤 역할이든.
 *
 * UI 테스트는 로그인 계정 역할(고정 시드)에 따라 한쪽 분기만 렌더되므로 데이터/역할 의존은 graceful skip.
 * 게이트 일치(AC-1)는 순수 함수 검증이라 역할·데이터와 무관하게 항상 결정적으로 통과/실패.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { canViewRrn, RRN_VIEW_ROLES } from '../../src/lib/permissions';

// ─────────────────────────────────────────────────────────────────────────
// AC-1: 순수 게이트 일치 (역할·데이터 무관, 항상 실행)
// ─────────────────────────────────────────────────────────────────────────
test.describe('T-20260618 RRN 조회 게이트 일치 (canViewRrn ↔ prod rrn_decrypt)', () => {
  test('AC-1: 조회 가능 역할 = admin/manager/director 뿐', () => {
    expect(canViewRrn('admin')).toBe(true);
    expect(canViewRrn('manager')).toBe(true);
    expect(canViewRrn('director')).toBe(true);
    // prod is_admin_or_manager 에 미포함 → 값 미조회 (안내문 분기)
    expect(canViewRrn('consultant')).toBe(false);
    expect(canViewRrn('coordinator')).toBe(false);
    expect(canViewRrn('therapist')).toBe(false);
    expect(canViewRrn('part_lead')).toBe(false);
    expect(canViewRrn('staff')).toBe(false);
    expect(canViewRrn('tm')).toBe(false);
    expect(canViewRrn('')).toBe(false);
    // 집합 SSOT 가 admin/manager/director 정확히 3개
    expect([...RRN_VIEW_ROLES].sort()).toEqual(['admin', 'director', 'manager']);
    console.log('[AC-1] canViewRrn 게이트 = admin/manager/director 일치 OK');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AC-2 ~ AC-4: 2번차트 주민번호 행 UI 불변식
// ─────────────────────────────────────────────────────────────────────────
test.describe('T-20260618 2번차트 주민번호 표기 불변식', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  async function navigateToFirstCustomerChart(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    const btn = page.locator('[data-testid="open-chart-btn"]').first();
    try {
      await btn.waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    await btn.click();
    try {
      await page.getByText('주민번호', { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1_000); // rrn_decrypt 로드/분기 안정화
      return true;
    } catch {
      return false;
    }
  }

  function rrnRow(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    return page.locator('tr', { has: page.getByText('주민번호', { exact: true }) }).first();
  }

  test('AC-2: viewer 모드와 non-viewer 안내문이 동시에 뜨지 않는다', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    const row = rrnRow(page);
    await expect(row).toBeVisible({ timeout: 5_000 });

    const notice = await row.getByText('조회 권한 없음', { exact: true }).count();
    const editBtn = await row.getByRole('button', { name: /입력|수정/ }).count();

    // non-viewer 안내문이 떴다면, viewer 전용 '미입력' 표기는 같은 행에 없어야 한다.
    if (notice > 0) {
      expect(await row.getByText('미입력', { exact: true }).count()).toBe(0);
      console.log('[AC-2] non-viewer 분기 — 조회 권한 없음 + 미입력 미표기 OK');
    } else {
      // viewer 분기: 입력/수정 버튼이 있어야 정상 (값 또는 미입력 + 버튼)
      expect(editBtn).toBeGreaterThan(0);
      console.log('[AC-2] viewer 분기 — 값/미입력 + 수정·입력 버튼 OK');
    }
  });

  test('AC-3: non-viewer 안내문이 뜨면 같은 행에 "미입력" 표기가 없다', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    const row = rrnRow(page);
    const notice = await row.getByText('조회 권한 없음', { exact: true }).count();
    if (notice === 0) test.skip(true, '로그인 계정이 조회 가능 역할(admin/manager/director) — non-viewer 분기 미렌더');

    // 핵심 회귀: 권한 없는 직원에게 '미입력'(저장 안 됨 오해)을 노출하지 않는다.
    expect(await row.getByText('미입력', { exact: true }).count()).toBe(0);
    console.log('[AC-3] non-viewer — 미입력 미표기(저장 안 됨 오해 차단) OK');
  });

  test('AC-4(PHI): 주민번호 행에 평문 주민번호 미노출 — 어떤 역할이든', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    // PHI 표면 = 주민번호 행(값/마스킹/안내문이 렌더되는 곳). body 전체는 큐번호·epoch 등
    // 무관한 13자리 숫자에 오탐하므로 행으로 스코프(기존 RRN spec 의 dialog 스코프 컨벤션).
    const rowText = (await rrnRow(page).textContent()) ?? '';
    // YYMMDD-1234567 (하이픈 뒤 7자리 전부 숫자) = 평문 RRN. 마스킹(880101-*******)은 별표라 매치 안 됨.
    expect(rowText).not.toMatch(/\d{6}-\d{7}/);
    // 하이픈 없는 13자리 연속 평문도 금지
    expect(rowText).not.toMatch(/(?<!\d)\d{13}(?!\d)/);
    console.log('[AC-4] 주민번호 행 평문 미노출 OK');
  });
});
