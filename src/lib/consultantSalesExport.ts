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
 *   객단가 = 매출 ÷ 상담건수 (파생, 반올림). 합계행에 총 매출액·총 상담건수·전체 객단가.
 * 라이브러리: xlsx (devDependencies, Vite 번들 포함 — 신규 의존성 0).
 */

import * as XLSX from 'xlsx';
import type { ConsultantRow } from '@/lib/stats';

/** 실장별 매출액: RPC total_amount 우선, 미반환(구버전) 시 객단가×건수 역산 fallback. */
export function consultantRevenue(r: Pick<ConsultantRow, 'total_amount' | 'avg_amount' | 'ticketing_count'>): number {
  if (typeof r.total_amount === 'number') return r.total_amount;
  return Math.round(r.avg_amount * r.ticketing_count);
}

/** 상담객단가: 매출 ÷ 상담건수 (반올림). 건수 0 이면 0. */
export function consultantUnitPrice(revenue: number, count: number): number {
  return count > 0 ? Math.round(revenue / count) : 0;
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
  const ordered = [...rows]
    .map((r) => {
      const revenue = consultantRevenue(r);
      return { name: r.name, revenue, count: r.ticketing_count, unit: consultantUnitPrice(revenue, r.ticketing_count) };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = ordered.reduce((s, r) => s + r.revenue, 0);
  const totalCount = ordered.reduce((s, r) => s + r.count, 0);
  const overallUnit = consultantUnitPrice(totalRevenue, totalCount);

  const aoa: (string | number)[][] = [
    [REPORT_HEADERS as unknown as string].flat(),
    ...ordered.map((r) => [r.name, r.revenue, r.count, r.unit]),
    ['합계', totalRevenue, totalCount, overallUnit],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 금액·건수 컬럼 숫자 형식 (B=매출, C=상담건수, D=객단가 → col 1,2,3)
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of [1, 2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) {
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
