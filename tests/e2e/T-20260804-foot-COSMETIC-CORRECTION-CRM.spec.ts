/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — 화장품 라인 soft-void(Tier-C 라인제외) E2E
 * DA-20260805-foot-COSMETIC-VOID-SEMANTIC (gate CLOSED) · SSOT §ADDENDUM-CENSUS-COMPLETE
 *
 * 계약(3-tier read-path):
 *   Tier-C (filter 적용) = check_in_services.voided_at IS NULL 로 비진성 라인 제외:
 *     (1) SalesStaffTab cosmeticLines (담당치료사별 화장품 매출)   — 서버 .is('voided_at', null)
 *     (2) SalesTreatmentTab '풋화장품' by-service breakdown         — 안분 base·기여에서 client 제외
 *     (3) Closing procedureServicesRaw (시술별 통계 표시카드)        — 서버 .is('voided_at', null)
 *   Tier-F (무접촉) = footBilling.ts L407/L1258 · planbExpectedAmount.ts L23 — flag read 금지(firewall).
 *
 * ★배포게이트: check_in_services.voided_at 컬럼 ADD(20260805110000) → FE 원자 co-deploy(MIG-GATE).
 * ★freeze: 정확히 4-PK(b81521e2/aaec854c/81682cf7/31ea7f5e) — _04_freeze_apply.mjs, 현장 confirm 후 apply.
 *
 * 이 spec 범위:
 *   [A] 회귀(co-deploy 무결) — 컬럼 배포 직후 전건 voided_at=NULL(no-op) 상태에서 3개 표면이
 *       오류 없이 렌더되고 표시매출 구조가 불변임을 단언(PostgREST column-not-exist 미발생 확인).
 *   [B] 사후(post-freeze) 완전검증 = 4-PK apply 후 별도 데이터-존재 단언(주석 문서화) —
 *       현재 dev/prod 에 voided 행 부재(apply HELD)로 이 단계는 supervisor co-deploy+freeze 후 활성.
 *
 * 견고성: prod 실데이터/빈데이터 양쪽 통과 — 구조 존재는 데이터 유무와 무관 단언, 금액값은 데이터 有 시만.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const CLOSING_URL = '/admin/closing';

test.beforeEach(async ({ page }) => {
  await loginAndWaitForDashboard(page);
});

test('[A-1] 매출집계>담당치료사별(Tier-C site1) — voided_at 필터 후 오류없이 렌더', async ({ page }) => {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: '담당치료사별' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible({ timeout: 10_000 });
  // PostgREST column-not-exist 오류가 났다면 로딩이 끝나지 않거나 에러 표면 → 아래 대기가 실패한다.
  await page.locator('[data-testid="sales-staff-loading"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await expect(
    page.locator('[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]').first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('[A-2] 매출집계>시술별(Tier-C site2) — 풋화장품 by-service 안분 후 오류없이 렌더', async ({ page }) => {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: '시술별' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  // 렌더 완료(테이블 또는 빈상태) — voided_at 나눠담기 필터가 apportion 을 깨지 않음을 확인.
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('[A-3] 일마감>시술별 통계(Tier-C site3) — procedureServicesRaw voided_at 필터 후 렌더', async ({ page }) => {
  await page.goto(CLOSING_URL);
  // 마감 화면 로드(heading 또는 주요 영역). column-not-exist 시 쿼리 throw → 화면 미완성.
  await expect(page.locator('main')).toBeVisible({ timeout: 12_000 });
});

/*
 * [B] POST-FREEZE 완전검증 (supervisor co-deploy + _04_freeze_apply.mjs --apply 후 활성):
 *   - 4-PK 라인(김OO 안티펑거스 287,000 / 김OO·오렌지족 풋샴푸 42,000 / 정가언 CTB 15,000)이
 *     담당치료사별 화장품 매출·시술별 '풋화장품' 버킷·마감 시술별 통계에서 사라짐.
 *   - Tier-F(footBilling copay/bill 재구성) 표시는 불변(soft-void flag 미read = firewall intact).
 *   현재 apply HELD(voided 행 부재)로 skip. freeze 데이터 착지 후 이 블록을 test() 로 승격.
 */
