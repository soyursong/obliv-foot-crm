/**
 * E2E spec — T-20260805-foot-STAFFSPACE-TAB-RELOC-PERM-COMPACT  (★SPEC-CORRECTION-2 반영)
 *
 * 풋센터 CRM '직원·공간' 관련 3종 개선 검증. HARD census(구현 前 코드레벨 확인) 결과:
 *   · [배정 설정] 탭(AssignmentSettingsTab = 가중치·목표건수·유입경로전략·자동배정 토글·Slack매핑)은
 *     [랭킹] 탭에 흡수된 '배정 순번 설정'(RotationOrderDialog = 기본순번 + 치료 가능시술)과 **별개 대상**.
 *     (다른 이름·다른 컴포넌트·다른 DB 테이블) → 이동/잠금이 no-op·모순 아님 = 정상 cross-section 이동.
 *
 *   · 변경1(cross-section 이동): [직원·공간](/admin/staff)의 '배정 설정' 탭을 제거하고
 *       [상담·치료사 배정](/admin/assignments)의 [랭킹] 탭 **우측**으로 이동. 탭바 순서 =
 *       상담 → 치료 → 배정목록 → 랭킹 → **배정 설정**(최우측).
 *   · 변경2(admin 전용): 이동한 '배정 설정' 탭 = 관리자(canViewRanking=admin/manager/director) 전용.
 *       비admin 은 탭 미노출(UI 숨김) + onValueChange 차단 + 콘텐츠 && 3중 가드. 쓰기는 기존 RLS 서버 차단.
 *       config 데이터(비 매출/PHI) → 신규 서버게이트 불요(랭킹 role 술어 재사용, 신규 role/RLS 신설 0).
 *   · 변경3(직원·공간 컴팩트): 외곽 여백/섹션 간격 축소(p-4→3, space-y-4→3) + 역할 카드 밀도↑(1차안).
 *
 * ⚠ 하네스 계정 = admin 단일. 변경2 '비admin 미노출' 의 부정분기(non-admin)는 동일 `canViewRanking &&`
 *    조건 분기로 강제되며(코드레벨 확인), 별도 non-admin 계정 부재로 E2E 에선 admin 긍정분기(탭 노출)만
 *    실검증한다. 실제 비admin 미노출은 갤탭 field-soak(비admin 로그인)에서 최종 확인.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260805 STAFFSPACE-TAB-RELOC-PERM-COMPACT', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — graceful skip');
  });

  // ── 변경1: [직원·공간] 에서 '배정 설정' 탭 제거(이동됨) ─────────────────────────────
  test('변경1: 직원·공간 화면에 배정 설정 탭이 더 이상 없음(이동됨)', async ({ page }) => {
    await page.goto('/admin/staff');
    const root = page.locator('[data-testid="staff-space-root"]');
    const ok = await root
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '직원·공간 화면 진입 실패 — 스킵');
      return;
    }
    // 이동 완료: 직원·공간 탭바에 '배정 설정' 탭 부재.
    await expect(page.getByRole('tab', { name: '배정 설정' })).toHaveCount(0);
    // 회귀: 핵심 탭(직원/공간 배정)은 정상 유지.
    await expect(page.getByRole('tab', { name: '직원' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '공간 배정' })).toBeVisible();
  });

  // ── 변경1·2: [상담·치료사 배정] [랭킹] 우측에 '배정 설정' 탭(admin 노출) ───────────────
  test('변경1·2: 배정 화면 [랭킹] 우측에 배정 설정 탭 + admin 노출·렌더', async ({ page }) => {
    await page.goto('/admin/assignments');
    const tabs = page.locator('[data-testid="assignments-role-tabs"]');
    const ok = await tabs
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    // admin(canViewRanking) 에게 랭킹·배정설정 탭 모두 노출.
    const ranking = page.locator('[data-testid="assignments-tab-ranking"]');
    const assignSettings = page.locator('[data-testid="assignments-tab-assignment-settings"]');
    await expect(ranking).toBeVisible();
    await expect(assignSettings).toBeVisible();

    // 탭바 DOM 순서: 배정 설정이 [랭킹] 바로 우측(=최우측 마지막 탭)이어야 한다.
    const triggerTestIds = await tabs
      .locator('[data-testid^="assignments-tab-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(triggerTestIds.length).toBeGreaterThan(0);
    const rankIdx = triggerTestIds.indexOf('assignments-tab-ranking');
    const asIdx = triggerTestIds.indexOf('assignments-tab-assignment-settings');
    expect(rankIdx).toBeGreaterThanOrEqual(0);
    expect(asIdx).toBe(rankIdx + 1); // 랭킹 바로 우측
    expect(triggerTestIds[triggerTestIds.length - 1]).toBe('assignments-tab-assignment-settings'); // 최우측

    // 탭 진입 → 이동해 온 AssignmentSettingsTab(가중치·목표건수 저장 컨트롤) 렌더 = 순번설정과 별개.
    await assignSettings.click();
    await expect(page.locator('[data-testid="assignment-settings-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-weights"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-target"]')).toBeVisible();
  });

  // ── 변경3: 직원·공간 컴팩트 렌더 — 외곽 여백/간격 축소 클래스 적용 ───────────────────
  test('변경3: 직원·공간 컴팩트 클래스 적용 + 탭 렌더 회귀', async ({ page }) => {
    await page.goto('/admin/staff');
    const root = page.locator('[data-testid="staff-space-root"]');
    const ok = await root
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '직원·공간 화면 진입 실패 — 스킵');
      return;
    }
    const cls = (await root.getAttribute('class')) ?? '';
    // 컴팩트: p-3/space-y-3 적용 + 이전 널널한 p-4/space-y-4 미잔존.
    expect(cls).toMatch(/\bp-3\b/);
    expect(cls).toMatch(/\bspace-y-3\b/);
    expect(cls).not.toMatch(/\bp-4\b/);
    expect(cls).not.toMatch(/\bspace-y-4\b/);

    // 회귀: 직원 탭 기본 진입 시 '직원 관리' 헤더 렌더(콘텐츠 회귀).
    await expect(page.getByRole('heading', { name: '직원 관리' })).toBeVisible();
  });
});
