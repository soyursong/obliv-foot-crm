/**
 * E2E spec — T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step1 (a)(b))
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §2.2/§3.1/§3.2
 *
 * 검증 대상(Step1):
 *   (a) refresh-401 blip 중 무한로딩·사일런트 실패 대신 비차단 상단 배너 표시
 *       "일시적 서버 지연 — 자동 재시도 중, 입력은 보관됩니다".
 *   (b) 인시던트 (부분)해소 시 자동 재시도가 건강 shard 에 착지 → 배너 자동 소멸 + 데이터 로드.
 *
 * 테스트 훅(프로덕션 동작 불변, resilientFetch.ts):
 *   window.__forceRefresh401       — data-plane 401 강제 주입 on/off
 *   window.__refresh401MaxRetries  — bound(재시도 상한) — 테스트 결정성
 *   window.__refresh401BaseMs/CapMs — backoff 결정성
 *
 * ── 시나리오 1(정상 동선): 401 주입 → 배너 → 해소 → 자동 flush → 배너 소멸 ──
 * ── 시나리오 2(비차단·카피): 배너가 차단 모달이 아님 + 정직 카피 노출 ──
 *
 * (c) write-buffer / signOut 큐폐기 = Step2 (Q2 DA CONSULT 게이트 통과 후) — 본 spec 범위 밖.
 * 로그인 시크릿 부재 환경(supervisor QA 워크트리 등)은 helper 가 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const BANNER = '[data-testid="refresh401-banner"]';

test.describe('T-20260818 REFRESH401-RESILIENCE-PILOT — Step1 (a)(b) data-plane resilience', () => {
  test.beforeEach(async ({ page }) => {
    // 재시도 상한을 크게, backoff 를 짧게 → 주입 동안 배너가 유지되고 해소 즉시 착지(결정성).
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, number>;
      w.__refresh401MaxRetries = 400;
      w.__refresh401BaseMs = 20;
      w.__refresh401CapMs = 60;
    });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 실검증=macstudio 풀 E2E');
  });

  test('AC (a)(b): refresh-401 주입 시 비차단 배너 표시 → 해소 시 자동 소멸', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 배너는 평상시 미표시(회귀 0).
    await expect(page.locator(BANNER)).toHaveCount(0);

    // ── 401 주입 후 데이터 읽기 트리거(페이지 이동 → react-query fetch) ──
    await page.evaluate(() => {
      (window as unknown as { __forceRefresh401?: boolean }).__forceRefresh401 = true;
    });
    // 예약관리로 이동 → 목록 조회(GET) 가 interceptor 를 타고 refresh-401 판정 → backoff 재시도.
    await page.getByText('예약', { exact: true }).first().click().catch(async () => {
      await page.goto('/admin/reservations');
    });

    // (a) 비차단 배너가 나타난다(무한로딩·사일런트 실패 대신 정직 신호).
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('자동 재시도');
    await expect(banner).toContainText('보관');
    console.log('[AC-a] refresh-401 비차단 배너 표시 PASS');

    // (a) 차단 모달 아님 — 배너 뒤 화면이 여전히 상호작용 가능(사이드바 등 렌더 유지).
    // role="status" 이지 role="dialog" 아님 → 오버레이/포커스 트랩 없음.
    await expect(banner).toHaveAttribute('role', 'status');

    // ── 인시던트 해소 주입 → (b) 진행 중 재시도가 건강 응답에 착지 → 배너 자동 소멸 ──
    await page.evaluate(() => {
      (window as unknown as { __forceRefresh401?: boolean }).__forceRefresh401 = false;
    });
    await expect(banner).toBeHidden({ timeout: 10_000 });
    console.log('[AC-b] 해소 후 배너 자동 소멸(자동 재시도 착지) PASS');
  });

  test('AC (a): 배너 카피 정직성 + 비차단(모달 아님)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    await page.evaluate(() => {
      (window as unknown as { __forceRefresh401?: boolean }).__forceRefresh401 = true;
    });
    // 대시보드 자체 주기 refetch 로도 GET 이 발생 → 배너 유도. 없으면 예약 이동으로 보강.
    const banner = page.locator(BANNER);
    const shown = await banner.isVisible().catch(() => false);
    if (!shown) {
      await page.goto('/admin/reservations').catch(() => {});
    }
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // 정직 카피: "일시적 서버 지연" + "자동 재시도" + "보관".
    await expect(banner).toContainText('일시적 서버 지연');
    // 비차단: dialog/모달 오버레이가 아님 → 배경 클릭 차단 없음.
    await expect(page.locator(`${BANNER}[role="dialog"]`)).toHaveCount(0);
    console.log('[AC-a] 정직 카피 + 비차단 PASS');

    // 정리: 주입 해제(다음 테스트 오염 방지).
    await page.evaluate(() => {
      (window as unknown as { __forceRefresh401?: boolean }).__forceRefresh401 = false;
    });
    await expect(banner).toBeHidden({ timeout: 10_000 });
  });
});
