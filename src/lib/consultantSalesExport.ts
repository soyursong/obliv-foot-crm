/**
 * T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
 * 통계 > 매출통계 탭 "일간매출보고" 다운로드 유틸리티.
 *
 * 배경: 매출집계(Sales.tsx) 의 raw 25컬럼 다운로드(salesExport.downloadSalesExcel)와
 *       양식이 다르다(실장별 요약). 또한 AGG 다운로드 경로(fetchSalesRawRows)의
 *       버그 전파를 막기 위해 데이터 소스(foot_stats_consultant RPC)·코드 경로를
 *       완전히 분리한다. (의존 티켓: T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR)
 *
 * 양식(리포터 김주연 운영총괄 확정): 실장별 {매출, 상담건수, 상담객단가} + 총 일간 매출액.
 *   합계행에 총 매출액·총 상담건수·전체 객단가.
 *
 * T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM: 상담객단가 분모를 상담'건수'(ticketing_count)
 *   → distinct 상담(내원)고객수(consulted_customer_count) 로 통일. 화면 배포본(실장별 실적) 객단가와
 *   1-byte 동일 기준. 재집계 금지 — RPC(foot_stats_consultant) canonical 을 그대로 소비:
 *     · 실장별 객단가 = RPC avg_amount (= ROUND(total_amount / NULLIF(consulted_customer_count,0)))
 *       를 그대로 표시(FE 재계산 X). 화면이 표시하는 값과 완전 동일. 분모=0 → RPC NULL → 빈칸.
 *     · 합계 객단가 = Σ매출 / Σconsulted_customer_count (전체 상담고객 분모, 반올림). 분모=0 → 빈칸.
 *   ※ '상담건수' 컬럼은 기존대로 ticketing_count(방문횟수) 표시 — 컬럼구조·헤더 불변, 객단가 값만 재정의.
 *   ※ 분자(매출)=RPC total_amount(net·accounting_date), 화면 canonical 과 동일소스(무변경).
 * 라이브러리: xlsx (devDependencies, Vite 번들 포함 — 신규 의존성 0).
 */

import * as XLSX from 'xlsx';
import type { ConsultantRow } from '@/lib/stats';

/**
 * 실장별 매출액: RPC total_amount 우선, 미반환(구버전) 시 객단가×건수 역산 fallback.
 * ⚠ T-20260717-foot-CONSULTANT-ARPU-STATS (AC6): avg_amount 분모가 상담'건수'→상담'고객수'로
 *   재정의되어 `avg_amount × ticketing_count ≠ total_amount` 가 되었다(역산식 무효). 단 현 RPC 는
 *   total_amount 를 항상 반환하므로 이 fallback 은 dead-path(미발화). avg_amount NULL 이어도
 *   상단 total_amount 분기에서 종료되어 안전. 구버전 RPC 하위호환 목적으로만 잔존.
 */
export function consultantRevenue(r: Pick<ConsultantRow, 'total_amount' | 'avg_amount' | 'ticketing_count'>): number {
  if (typeof r.total_amount === 'number') return r.total_amount;
  return Math.round((r.avg_amount ?? 0) * r.ticketing_count);
}

/**
 * 합계행 전체 객단가: Σ매출 ÷ Σ상담고객수 (반올림). 상담고객 0 → null(빈칸).
 * T-20260718: 화면 객단가와 동일하게 분모=상담(내원)고객수(consulted_customer_count) 로 통일.
 *   실장별 행은 RPC avg_amount 를 직접 소비(재계산 X)하므로, 이 함수는 합계행 전용.
 */
export function consultantOverallUnitPrice(totalRevenue: number, totalCustomers: number): number | null {
  return totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : null;
}

const REPORT_HEADERS = ['실장명', '매출', '상담건수', '상담객단가'] as const;

/**
 * 매출통계 탭 일간매출보고 xlsx 다운로드.
 * @param rows ConsultantRow[] (통계 화면이 이미 로드한 실장별 실적)
 * @param from 기간 시작 (YYYY-MM-DD)
 * @param to   기간 종료 (YYYY-MM-DD)
 */
export function downloadConsultantSalesReport(
  rows: ConsultantRow[],
  from: string,
  to: string,
): void {
  // 매출 내림차순 (보고서 가독성)
  // T-20260718: unit(객단가) = RPC avg_amount 직접 소비(÷상담고객수 canonical). NULL 은 빈칸 유지.
  //   count(상담건수 컬럼)=ticketing_count 불변 · customers(합계 분모용)=consulted_customer_count.
  const ordered = [...rows]
    .map((r) => ({
      name: r.name,
      revenue: consultantRevenue(r),
      count: r.ticketing_count,
      customers: r.consulted_customer_count ?? 0,
      unit: r.avg_amount, // number | null (분모 0 → NULL)
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = ordered.reduce((s, r) => s + r.revenue, 0);
  const totalCount = ordered.reduce((s, r) => s + r.count, 0);
  const totalCustomers = ordered.reduce((s, r) => s + r.customers, 0);
  const overallUnit = consultantOverallUnitPrice(totalRevenue, totalCustomers);

  // 객단가 NULL(상담고객 0) → 빈 문자열 셀(빈칸). 화면 '-' 와 동일 의미.
  const cell = (v: number | null): string | number => (v == null ? '' : v);

  const aoa: (string | number)[][] = [
    [REPORT_HEADERS as unknown as string].flat(),
    ...ordered.map((r) => [r.name, r.revenue, r.count, cell(r.unit)]),
    ['합계', totalRevenue, totalCount, cell(overallUnit)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 금액·건수 컬럼 숫자 형식 (B=매출, C=상담건수, D=객단가 → col 1,2,3).
  // 객단가 빈칸('')은 숫자 셀이 아니므로 서식 미적용(typeof number 가드).
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of [1, 2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr] && typeof ws[addr].v === 'number') {
        ws[addr].t = 'n';
        ws[addr].z = '#,##0';
      }
    }
  }

  ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일간매출보고');

  const fname = `일간매출보고_실장별_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}`;
  XLSX.writeFile(wb, `${fname}.xlsx`);
}
