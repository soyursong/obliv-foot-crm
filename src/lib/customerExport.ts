/**
 * T-20260613-foot-CUSTMGMT-LIST-5FIX · AC4
 * 고객관리 리스트 다운로드 유틸리티
 *
 * 규칙:
 *  - '1행 1고객' flat 구조 (병합 셀 없음).
 *  - PHI 가드: 주민번호(rrn) 평문·뒷자리 절대 미포함. 생년월일(서버 파생 YYYY-MM-DD)만 표기.
 *  - export 컬럼 = 고객관리 리스트 화면에 보이는 컬럼과 동일(이름·전화·생년월일·차트번호·방문·최종방문·결제액·고객메모).
 *  - 라이브러리: xlsx (이미 dependencies 포함 — salesExport.ts와 동일 패턴 재사용).
 */

import * as XLSX from 'xlsx';

/** 엑셀 컬럼 헤더 순서 (리스트 화면 컬럼과 동일) */
export const CUSTOMER_EXCEL_HEADERS = [
  '이름',
  '전화번호',
  '생년월일',
  '차트번호',
  '방문횟수',
  '최종방문',
  '결제액',
  '고객메모',
] as const;

export type CustomerExcelHeader = (typeof CUSTOMER_EXCEL_HEADERS)[number];
export type CustomerExcelRow = Record<CustomerExcelHeader, string | number>;

/**
 * 고객 리스트를 xlsx 파일로 다운로드.
 * @param rows CustomerExcelRow[]
 * @param filename 파일명 (확장자 제외, 예: "고객목록_20260613")
 */
export function downloadCustomerExcel(rows: CustomerExcelRow[], filename: string): void {
  const sheetData = [
    CUSTOMER_EXCEL_HEADERS as unknown as string[],
    ...rows.map((r) => CUSTOMER_EXCEL_HEADERS.map((h) => r[h])),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // 결제액(G열, index 6)을 숫자 형식으로
  const numberCols = [6];
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of numberCols) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) {
        ws[addr].t = 'n';
        ws[addr].z = '#,##0';
      }
    }
  }

  // 컬럼 너비 (최소 10, 최대 30)
  ws['!cols'] = CUSTOMER_EXCEL_HEADERS.map((h) => ({
    wch: Math.min(30, Math.max(10, h.length * 2 + 4)),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '고객목록');

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** 오늘 날짜 → 파일명용 문자열 (예: "고객목록_20260613") */
export function customerExportFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `고객목록_${y}${m}${d}`;
}
