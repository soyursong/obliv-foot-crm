/**
 * T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — CARVE-A: service_charges soft-void(voided_at) E2E spec
 *
 * 배경 (DA REPLY MSG-20260814-000358-6osg Q1 · dispatch MSG-20260814-001939-vc7k):
 *   service_charges = Tier-0 매출/insurance-split ledger. 물리삭제(hard-DELETE) 차단 → 라인그레인
 *   soft-void(voided_at) 로 전환. 앱 유일 removal 콜사이트 = DocumentPrintPanel.handleDeleteItem.
 *   G2 parity: 전 급여/명세 집계·서류 read-site 에 `voided_at IS NULL` 필터 원자배포(byte-identical).
 *
 * ★storage 술어 = B-2 sibling `voided_at` verbatim(check_in_services/closing_manual_payments mirror).
 *   envelope Q3(is_deleted vs deleted_at) 잔여 HOLD 와 독립축.
 *
 * ★reversal-offset 불요: foot 급여매출은 frozen snapshot 없는 live-recompute(daily_closings 는 payment-grain
 *   totals 만 동결). softvoid + voided_at IS NULL parity 만으로 전 집계 완전제거 — offset 병행 시 이중차감.
 *
 * 검증지문 (PostgREST 는 .is('voided_at', null) 을 쿼리스트링 `voided_at=is.null` 로 인코딩):
 *   급여/명세 집계 read 요청에 이 필터가 붙어야 G2 parity 가 연결된 것.
 *   임베드(payments→service_charges)는 select 절에 `voided_at` 컬럼 포함으로 확인.
 *
 * 현장 클릭 시나리오:
 *   1) 매출집계(일별) 진입 → service_charges 발생기준 조회에 voided_at=is.null + 배포직후 회귀 0(net-zero)
 *   2) 매출집계(환자별) 진입 → payments 임베드 select 에 service_charges(...,voided_at) 포함
 *
 * ⚠ apply-gated: voided_at 컬럼 신설(20260814000000) + closing_insurance_split parity(20260814000100) 는
 *   supervisor DDL-diff + 물리 GO-token 선행 apply 후 유효. 본 spec 의 write-path(softvoid UPDATE) 검증은
 *   컬럼 apply 후에만 동작하므로 gated(test.skip). 네트워크-필터 parity 지문은 배포 정합 검증으로 선행 가능.
 *
 * READ-ONLY parity 검증(무효행 생성 없음).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

test.describe('CARVE-A service_charges soft-void — G2 parity 필터 연결', () => {
  test('시나리오1: 매출집계(일별) 급여 명세 조회에 voided_at=is.null 필터', async ({ page }) => {
    let anyServiceChargeQuery = false;
    let filteredQuery = false;
    page.on('request', (req) => {
      const u = req.url();
      // 직접 service_charges 발생기준 조회(SalesDailyTab)
      if (/\/service_charges\?/.test(u)) {
        anyServiceChargeQuery = true;
        if (/voided_at=is\.null/.test(u)) filteredQuery = true;
      }
    });

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // 급여 명세(service_charges) 조회가 발생하면 반드시 voided_at=is.null 필터가 붙어야 한다.
    if (anyServiceChargeQuery) {
      expect(filteredQuery, 'service_charges 발생기준 조회에 voided_at=is.null G2 parity 필터 필요').toBe(true);
    }
  });

  test('시나리오2: 매출집계(환자별) payments 임베드 select 에 service_charges(...,voided_at) 포함', async ({ page }) => {
    let anyEmbedQuery = false;
    let embedHasVoided = false;
    page.on('request', (req) => {
      const u = decodeURIComponent(req.url());
      // payments 조회의 임베드 select 에 service_charges 가 포함될 때 voided_at 컬럼도 함께 요청되어야 함
      if (/\/payments\?/.test(u) && /service_charges\(/.test(u)) {
        anyEmbedQuery = true;
        if (/service_charges\([^)]*voided_at/.test(u)) embedHasVoided = true;
      }
    });

    await page.goto(`${SALES_URL}?tab=patient`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    if (anyEmbedQuery) {
      expect(embedHasVoided, 'payments→service_charges 임베드에 voided_at 포함(합산 제외 판정) 필요').toBe(true);
    }
  });

  // apply-gated: voided_at 컬럼 apply 후에만 softvoid write-path 검증 가능.
  test.skip('시나리오3(gated): 세부내역 삭제 = hard-DELETE 아닌 voided_at UPDATE(soft-void)', async () => {
    // GO-token apply(20260814000000) 후 스킵 해제:
    //  - DocumentPrintPanel 세부내역 편집 '항목 삭제' 클릭
    //  - 네트워크: service_charges 에 DELETE 요청 0건, PATCH(voided_at=now) 1건
    //  - post-recognition 행이면 window.confirm 게이트 노출
    //  - 삭제 후 목록에서 사라지되 DB 행은 보존(voided_at NOT NULL)
    //  - G1: is_cancelled 무접촉(restore≠cancel firewall)
  });
});
