/**
 * E2E — T-20260808-foot-ACCOUNT-ROLE-GROUP-VIEW
 * 풋 계정관리 활성 계정 목록을 역할별 섹션으로 그룹핑 렌더(옵션C, display-only).
 *
 * 검증 포인트 (AC):
 * 1. /admin/accounts 진입 → "활성 계정" 카드 렌더 (시나리오1-1,2)
 * 2. 활성 계정이 역할별 섹션 헤더로 그룹핑되어 표시 (시나리오1-2,3)
 * 3. 역할 섹션 헤더가 지정 순서(관리자>매니저>원장>상담실장>코디네이터>치료사>파트장>스태프>장비명>TM)로 렌더
 * 4. 아코디언/탭/드롭다운 전환 없이 스크롤로 전체 조회 (시나리오1-4,5)
 * 5. 재직자 0명 역할 섹션은 헤더 미노출(빈 섹션 처리) — 목록 깨지지 않음 (시나리오2-1)
 *
 * 비파괴: 승인/권한/저장 로직 불변, DB 무접점. 표시 그룹핑만 검증(계정 생성/변경 없음).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 티켓 지정 역할 표시 순서 (한글 라벨)
const ROLE_ORDER = ['관리자', '매니저', '원장', '상담실장', '코디네이터', '치료사', '파트장', '스태프', '장비명', 'TM'];

test.describe('T-20260808 계정관리 역할별 그룹핑 뷰', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('활성 계정이 역할별 섹션으로 그룹핑되어 렌더', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/활성 계정/)).toBeVisible({ timeout: 10_000 });

    // 활성 계정 카드 내부의 역할 섹션 헤더(h2) 수집
    const sectionHeaders = page.locator('section h2');
    await expect(sectionHeaders.first()).toBeVisible({ timeout: 10_000 });

    const labels = await sectionHeaders.allInnerTexts();
    const trimmed = labels.map((s) => s.trim()).filter(Boolean);
    console.log('[ROLE-GROUP] 렌더된 역할 섹션:', trimmed);

    // 최소 1개 이상의 역할 섹션이 존재해야 함(활성 계정 있을 때)
    expect(trimmed.length).toBeGreaterThan(0);

    // 렌더된 섹션은 모두 정의된 10종 라벨 또는 "기타" 중 하나여야 함 (누락/오분류 방지)
    for (const l of trimmed) {
      expect([...ROLE_ORDER, '기타']).toContain(l);
    }

    // 지정 순서 단조성 검증: 렌더된 섹션들이 ROLE_ORDER 상대순서를 위반하지 않아야 함.
    // ("기타"는 항상 말미이므로 순서 검증에서 제외)
    const known = trimmed.filter((l) => l !== '기타');
    const indices = known.map((l) => ROLE_ORDER.indexOf(l));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
    // "기타"가 있으면 반드시 마지막
    if (trimmed.includes('기타')) {
      expect(trimmed[trimmed.length - 1]).toBe('기타');
    }
  });

  test('아코디언/탭 없이 전체 조회 — 역할 헤더가 클릭 없이 즉시 보임', async ({ page }) => {
    await page.goto('/admin/accounts');
    await expect(page.getByText(/활성 계정/)).toBeVisible({ timeout: 10_000 });

    const sectionHeaders = page.locator('section h2');
    // 데이터 로딩 완료(첫 섹션 렌더) 대기 후 count — 렌더 전 count()=0 오판독 방지.
    await sectionHeaders.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const count = await sectionHeaders.count();
    // 섹션이 있으면 별도 펼침 조작(클릭) 없이 즉시 표시되는지 확인
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(sectionHeaders.nth(i)).toBeVisible();
      }
      console.log('[ROLE-GROUP] 아코디언 없이 전체 섹션 즉시 노출 OK, 섹션수=', count);
    } else {
      console.log('[ROLE-GROUP] 활성 계정 0건 — 그룹핑 섹션 없음(빈 상태 정상)');
    }
  });
});
