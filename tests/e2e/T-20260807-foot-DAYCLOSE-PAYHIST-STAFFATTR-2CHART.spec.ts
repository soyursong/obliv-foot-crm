/**
 * T-20260807-foot-DAYCLOSE-PAYHIST-STAFFATTR-2CHART (P2)
 *   (dedup canonical of T-20260807-foot-STAFFDAILY-REVENUE-2NDCHART-ATTR-MATCH — 동일 요청 fold)
 *   통계 > 실장별 일별 매출(02b, lib/mtmSales.ts fetchStaffDailyBreakdown) 매출 귀속 정합.
 *   원문: "통계 > 실장별 일별 매출 > 일마감 결제내역에서 2번차트 담당자 기준 총매출 안맞음".
 *   '일마감 결제내역' = 총매출 소스(단건 payments + 패키지 package_payments), 별도 탭 아님.
 *   부모 T-20260805-DAILYTREND-STAFF-BREAKDOWN-CLARIFY(as-built d9190d6b) 의 데이터 불일치 픽스.
 *
 * ── RC(데이터 안맞음) ──────────────────────────────────────────────────────────
 *   부모 as-built 는 총매출 소스를 payments.tax_type IN('선수금','급여') 로 좁히고
 *   패키지를 payments '선수금' proxy 로 셌다. 그러나 라이브 매출집계>담당실장별(SalesDoctorTab,
 *   T-20260806 gross-redefine) 의 총매출 = 단건 payments(전체 tax_type) net + 패키지
 *   package_payments **테이블** net. → 비급여/과세/면세/NULL 단건 누락 + 패키지 소스 상이
 *   = 두 화면 숫자 불일치.
 *
 * ── FIX(신규 산식 창작 금지 · canon 일관) ──────────────────────────────────────
 *   fetchStaffDailyBreakdown 을 SalesDoctorTab 과 동일 2-소스 net 집계로 교체:
 *     · 소스① 단건 payments (전체 tax_type, status≠'deleted') net.
 *     · 소스② 패키지 package_payments 테이블 (status 필터 없음) net.
 *     · 귀속축(WHO) = customers.assigned_staff_id ('2번차트 담당 실장', 8/6 총괄 canon) — 불변.
 *     · accounting_date 일자 grain · '미지정' 버킷 · sim 방어필터 · 미래일 '-' — 전부 불변.
 *   read-only. db_change=false(신규 컬럼/테이블/enum 0, §S2.4 게이트 비유발).
 *
 * 검증: 정적 소스 불변식(토큰/DB 무관 견고 가드).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test.describe('정적 소스 불변식 (T-20260807-foot-DAYCLOSE-PAYHIST-STAFFATTR-2CHART)', () => {
  const lib = read('src/lib/mtmSales.ts');
  const doctorTab = read('src/components/sales/SalesDoctorTab.tsx');

  test('RC 해소: 구 tax_type IN(선수금,급여) 협소 필터 제거', () => {
    // 부모 as-built 의 협소 필터가 fetchStaffDailyBreakdown 소스에서 사라졌는지 확인.
    expect(lib).not.toMatch(/\.in\('tax_type',\s*\['선수금',\s*'급여'\]\)/);
  });

  test('FIX(소스 정합): 단건 payments + 패키지 package_payments 2-소스 — SalesDoctorTab 과 동일', () => {
    // fetchStaffDailyBreakdown 이 두 테이블을 모두 조회.
    expect(lib).toMatch(/\.from\('payments'\)/);
    expect(lib).toMatch(/\.from\('package_payments'\)/);
    // 라이브 SSOT(SalesDoctorTab)도 동일 2-소스 → canon 일치(신규 산식 창작 아님).
    expect(doctorTab).toMatch(/\.from\('payments'\)/);
    expect(doctorTab).toMatch(/\.from\('package_payments'\)/);
  });

  test('FIX(단건 필터 정합): status≠deleted 유지, tax_type 무관(전체 단건 포함)', () => {
    // 단건 삭제 제외는 유지(SalesDoctorTab 동일).
    expect(lib).toMatch(/\.not\('status',\s*'eq',\s*'deleted'\)/);
    // net = refund → 음수(환불 1회 차감).
    expect(lib).toMatch(/payment_type === 'refund'/);
  });

  test('AC(귀속축 불변): customers.assigned_staff_id + 미지정 버킷 유지', () => {
    expect(lib).toMatch(/assigned_staff_id/);
    expect(lib).toMatch(/STAFF_BREAKDOWN_UNASSIGNED/);
    expect(lib).toMatch(/'미지정'/);
    // sim(테스트) 고객 방어필터 유지(매출집계 탭과 동일 집합).
    expect(lib).toMatch(/excludeSimulationPaymentRows/);
    // accounting_date 일자 grain 유지.
    expect(lib).toMatch(/accounting_date/);
  });

  test('AC(READ-ONLY): write/rpc-write 부재(db_change=false)', () => {
    expect(lib).toMatch(/fetchStaffDailyBreakdown/);
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
