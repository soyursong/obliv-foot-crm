/**
 * T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP · 기능3(엑셀 다운로드)
 * 치료테이블 '처방 이력(약별 조회)' 결과 → xlsx 다운로드 유틸.
 *
 * 규칙(customerExport.ts 패턴 재사용 — 신규 npm 0, 기존 xlsx 의존):
 *  - '1행 1발행이력' flat 구조(병합 셀 없음).
 *  - PHI 가드: 주민번호(rrn)·풀 전화번호 절대 미포함. 성함·차트번호는 스태프 대상(role-gated
 *    치료테이블) 노출 허용(고객목록 export 동일 기준, 티켓 risk_reason WARN(a)).
 *  - export 컬럼 = 조회 테이블 화이트리스트 grain(일자·성함·차트번호·처방의료인·진단·교부번호·약품명).
 */

import * as XLSX from 'xlsx';
import { formatDateDots, chartNoDisplay } from '@/lib/format';
import type { RxIssuancePatientRow } from '@/lib/rxIssuanceHistory';

/** 엑셀 컬럼 헤더(조회 테이블 + 드롭 상세 화이트리스트 grain). */
export const RX_HISTORY_EXCEL_HEADERS = [
  '일자',
  '성함',
  '차트번호',
  '처방의료인',
  '진단',
  '교부번호',
  '처방약품',
] as const;

export type RxHistoryExcelHeader = (typeof RX_HISTORY_EXCEL_HEADERS)[number];

/** 발행 이력 1건 → 엑셀 1행(화이트리스트 grain). */
function toExcelRow(r: RxIssuancePatientRow): (string | number)[] {
  return [
    r.issued_at ? formatDateDots(r.issued_at) : '',
    r.patient_name ?? '',
    chartNoDisplay(r.chart_number),
    r.prescriber_name ?? '',
    r.diagnosis ?? '',
    r.issue_no ?? '',
    r.medications.join(', '),
  ];
}

/**
 * 처방 이력(약별 조회) 결과를 xlsx 파일로 다운로드.
 * @param rows     현재 필터(선택 약) 적용된 조회 결과 전체
 * @param filename 파일명(확장자 제외)
 */
export function downloadRxHistoryExcel(rows: RxIssuancePatientRow[], filename: string): void {
  const sheetData: (string | number)[][] = [
    RX_HISTORY_EXCEL_HEADERS as unknown as string[],
    ...rows.map(toExcelRow),
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = RX_HISTORY_EXCEL_HEADERS.map((h) => ({
    wch: Math.min(40, Math.max(10, h.length * 2 + 6)),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '처방이력');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * 파일명(예: "처방이력_바르토벤외용액_20260807"). 약명 미선택 시 '전체'.
 * 복수 선택 시: 1개면 약명, 2개면 "A_B", 3개 이상이면 "A_외N종"(파일명 과다 방지).
 *   T-20260807-foot-RXHIST-DRUG-MULTISELECT.
 */
export function rxHistoryExportFilename(
  medication: string | string[] | null,
  date = new Date(),
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const meds = (Array.isArray(medication) ? medication : medication ? [medication] : [])
    .map((s) => s.trim())
    .filter(Boolean);
  let med: string;
  if (meds.length === 0) med = '전체';
  else if (meds.length === 1) med = meds[0];
  else if (meds.length === 2) med = `${meds[0]}_${meds[1]}`;
  else med = `${meds[0]}_외${meds.length - 1}종`;
  return `처방이력_${med}_${y}${m}${d}`;
}
