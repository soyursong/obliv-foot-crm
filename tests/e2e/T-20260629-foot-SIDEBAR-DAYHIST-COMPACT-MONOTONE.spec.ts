/**
 * T-20260629-foot-SIDEBAR-DAYHIST-COMPACT-MONOTONE
 * 사이드바 "일일 이력"(/admin/history) 화면 — 컴팩트(폰트/패딩/여백 약 50% 축소, px 단계) + 모노톤(그레이스케일) 통일.
 * 현장(김주연 총괄): 정보밀도 약 2배 + 불필요 컬러 전부 제거. DB 무변경(FE presentation only).
 *
 * 확정 AC:
 *   · AC-1 컴팩트: 외곽 p-6→p-3, 섹션 gap-6→gap-3, 카드 헤더 p-4→p-2, 큰 숫자 text-2xl→text-base, 행 px-4→p-2 등 실제 px 단계 축소(scale() 금지).
 *   · AC-2 모노톤: teal/blue/emerald/amber/red 등 유채색 제거 → gray 스케일. 색에만 의존하던 상태구분(상태/방문유형/결제유형 배지)은 텍스트 라벨 + 채움 농도/굵기로 보존(정보손실 0).
 *   · AC-3 무손상: 압축·탈색 후 겹침·깨짐·필수정보 잘림 없음. 클릭(카드 펼침)/필터/정렬/방문유형 토글 정상.
 *
 * 현장 클릭 시나리오 → E2E(2개):
 *   [S1] 컴팩트·모노톤 렌더: 루트 p-3 토큰 + 요약 카드 노출 + 루트 하위 유채색 클래스(teal/blue-6/emerald/amber/red-5) 0건.
 *   [S2] 상호작용 무결: 필터 탭/정렬 버튼/방문유형 토글 클릭 동작 + 접수 카드 클릭 펼침(데이터 있을 때) — 깨짐 없음.
 *
 * 데이터/권한 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoHistory(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/history`);
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/history`);
  // Realtime 웹소켓으로 networkidle 미도달 → domcontentloaded + 루트 가시화 대기로 대체.
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-testid="daily-history-root"]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});
}

test.describe('SIDEBAR-DAYHIST-COMPACT-MONOTONE [S1] 컴팩트·모노톤 렌더', () => {
  test('일일 이력 루트 컴팩트 토큰(p-3) + 요약 카드 노출 + 유채색 클래스 0건', async ({ page }) => {
    await gotoHistory(page);

    const root = page.locator('[data-testid="daily-history-root"]');
    const appeared = await root.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일일 이력 루트 미렌더(로그인/clinic 미할당) — skip');

    // AC-1 컴팩트 핵심: 외곽 컨테이너 p-3 (기존 p-6의 절반 단계).
    const rootCls = (await root.getAttribute('class')) ?? '';
    expect(rootCls).toContain('p-3');
    expect(rootCls).toContain('gap-3');
    // 기존 컴팩트 전 토큰이 남아있지 않은지 회귀 가드.
    expect(rootCls).not.toContain('p-6');
    expect(rootCls).not.toContain('gap-6');

    // 요약 카드(총 접수 등) 표시 유지(표시항목 보존).
    await expect(root.getByText('총 접수')).toBeVisible();
    await expect(root.getByText('평균 소요시간')).toBeVisible();
    await expect(root.getByText('일 매출')).toBeVisible();

    // AC-2 모노톤: 루트 하위에 유채색 클래스가 0건(그레이스케일만).
    for (const hue of ['teal', 'blue-6', 'emerald', 'amber', 'rose', 'red-5']) {
      const count = await root.locator(`[class*="${hue}"]`).count();
      expect(count, `유채색(${hue}) 잔존 0이어야 함`).toBe(0);
    }
  });
});

test.describe('SIDEBAR-DAYHIST-COMPACT-MONOTONE [S2] 상호작용 무결', () => {
  test('필터 탭/정렬/방문유형 토글 동작 + 접수 카드 펼침 — 깨짐 없음', async ({ page }) => {
    await gotoHistory(page);

    const root = page.locator('[data-testid="daily-history-root"]');
    const appeared = await root.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일일 이력 루트 미렌더 — skip');

    // 필터 탭 클릭(완료) — 클릭 가능/무오류.
    const doneTab = root.getByRole('tab', { name: /완료/ });
    if (await doneTab.count() > 0) {
      await doneTab.first().click();
      await page.waitForTimeout(150);
    }

    // 정렬 토글 버튼: 라벨이 대기번호순 ↔ 접수시간순 으로 전환.
    const sortBtn = root.getByRole('button', { name: /대기번호순|접수시간순/ });
    if (await sortBtn.count() > 0) {
      const before = (await sortBtn.first().innerText()).trim();
      await sortBtn.first().click();
      await page.waitForTimeout(150);
      const after = (await sortBtn.first().innerText()).trim();
      expect(after).not.toBe(before);
    }

    // 방문유형 토글(초진) — 클릭 가능.
    const visitBtn = root.getByRole('button', { name: /초진/ });
    if (await visitBtn.count() > 0) {
      await visitBtn.first().click();
      await page.waitForTimeout(150);
      // 다시 전체로 복귀(목록 비지 않도록).
      const allBtn = root.getByRole('button', { name: '전체', exact: true });
      if (await allBtn.count() > 0) await allBtn.first().click();
    }

    // 접수 카드(데이터 있을 때) 클릭 → 펼침. 없으면 빈 상태 안내가 보여야 함.
    const card = root.locator('[data-testid="dayhist-ci-card"]');
    const cardCount = await card.count();
    if (cardCount > 0) {
      // 컴팩트 카드 메인 행 버튼 클릭 → 펼침(상태 전환 이력/결제 내역 영역 노출 시도).
      await card.first().getByRole('button').first().click();
      await page.waitForTimeout(200);
      // 펼침 후에도 카드가 여전히 정상 렌더(깨짐/소실 없음).
      await expect(card.first()).toBeVisible();
    } else {
      await expect(root.getByText('해당 조건의 접수 내역이 없습니다.')).toBeVisible();
    }
  });
});
