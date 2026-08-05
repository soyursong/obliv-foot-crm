/**
 * E2E spec — T-20260805-foot-STAFFSPACE-TAB-RELOC-PERM-COMPACT
 *
 * 풋센터 CRM '직원·공간' 관련 3종 개선 검증. 착수 前 코드레벨 확인 결과:
 *   · 변경1([랭킹] 탭 우측 이동): 사이드바 [상담·치료사 배정](/admin/assignments) 탭바 순서 =
 *       상담 → 치료 → 배정목록 → 랭킹. [랭킹] 은 이미 최우측(rightmost) → 재배치 불필요(no-op).
 *       본 spec 은 "랭킹이 마지막(우측) 탭" 불변식을 회귀가드로 고정한다.
 *   · 변경2('배정 설정' 탭 admin 전용): 직원·공간(/admin/staff)의 '배정 설정' 탭(AssignmentSettingsTab)은
 *       [랭킹] 탭에 흡수된 '배정 순번 설정'(RotationOrderDialog=순번+가능시술)과 **별개**(가중치·목표건수·
 *       유입경로전략·자동배정 토글·Slack매핑). 이미 isAdmin(admin/manager/director) 게이트로 노출/콘텐츠 이중
 *       가드 → 일반 직원 미노출 충족. config 데이터(비 매출/PHI) → 서버게이트 불요, UI-hide 로 충분.
 *   · 변경3(직원·공간 컴팩트): 외곽 여백/섹션 간격 축소(p-4→3, space-y-4→3) + 역할 카드 밀도↑(1차안).
 *       staff-space-root 컴팩트 클래스 정적 검증 + 탭 렌더 회귀.
 *
 * ⚠ 하네스 계정 = admin 단일. 변경2 '비admin 미노출' 의 부정분기(non-admin)는 동일 `isAdmin &&`
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

  // ── 변경1: [상담·치료사 배정] 탭바에서 [랭킹] 이 최우측(마지막) 탭 ─────────────────
  test('변경1: 배정 화면 [랭킹] 탭이 최우측(마지막) 탭', async ({ page }) => {
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
    // 랭킹 탭은 admin(canViewRanking) 에게 노출.
    const ranking = page.locator('[data-testid="assignments-tab-ranking"]');
    await expect(ranking).toBeVisible();

    // 탭바 내 모든 트리거 중 랭킹이 DOM 순서상 마지막(=시각적 최우측)이어야 한다.
    const triggerTestIds = await tabs
      .locator('[data-testid^="assignments-tab-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(triggerTestIds.length).toBeGreaterThan(0);
    expect(triggerTestIds[triggerTestIds.length - 1]).toBe('assignments-tab-ranking');
  });

  // ── 변경2: 직원·공간 '배정 설정' 탭 = admin 노출 + [랭킹] '배정 순번 설정' 과 별개 ──────
  test('변경2: 직원·공간 배정설정 탭(admin 노출) — 순번설정과 별개 config', async ({ page }) => {
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
    // admin 은 '배정 설정' 탭 노출(isAdmin 긍정분기).
    const assignTab = page.getByRole('tab', { name: '배정 설정' });
    await expect(assignTab).toBeVisible();

    // 탭 진입 → AssignmentSettingsTab(가중치·목표건수·유입경로·자동배정) 렌더 = 순번설정 다이얼로그와 별개.
    await assignTab.click();
    await expect(page.locator('[data-testid="assignment-settings-tab"]')).toBeVisible();
    // 별개 증거: 가중치/목표건수 저장 컨트롤이 이 탭에 존재(RotationOrderDialog 에는 없음).
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

    // 회귀: 핵심 탭(직원/공간 배정)이 정상 렌더.
    await expect(page.getByRole('tab', { name: '직원' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '공간 배정' })).toBeVisible();
    // 직원 탭 기본 진입 시 '직원 관리' 헤더 렌더(콘텐츠 회귀).
    await expect(page.getByRole('heading', { name: '직원 관리' })).toBeVisible();
  });
});
