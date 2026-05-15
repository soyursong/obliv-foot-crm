/**
 * T-20260515-foot-SALES-COMMON-DB
 * 매출집계 엑셀 다운로드 유틸리티
 *
 * 규칙: 병합 셀 없이 '1행 1오더' flat 구조. 피벗 테이블 가공 가능.
 * 라이브러리: xlsx (이미 devDependencies 포함 — Vite 번들 포함)
 */

import * as XLSX from 'xlsx';

/** 엑셀 컬럼 헤더 순서 (스펙 A~Y 25컬럼 완전 준수) */
export const SALES_EXCEL_HEADERS = [
  '고유전표ID',         // A: receipt_id / tx_id
  '회계귀속일자',        // B: accounting_date
  '원거래일자',         // C: origin_tx_date
  '차트번호',           // D: chart_no
  '환자명',             // E: patient_name
  '주민등록번호',        // F: jumin_no (마스킹 적용 — Vault 참조, 미조회 시 공란)
  '진료구분',           // G: visit_type (초진/재진/체험)
  '상병코드',           // H: disease_code
  '시술코드',           // I: procedure_code (서비스 카테고리)
  '시술/상품명',         // J: procedure_name
  '담당의사',           // K: doctor_name
  '담당직원',           // L: staff_name
  '세금속성',           // M: tax_type
  '총발생금액',         // N: total_amount
  '급여 본부금',        // O: copay_amount
  '공단청구액',         // P: claim_amount
  '과세 공급가',        // Q: supply_amount
  '부가세',             // R: vat_amount
  '비과세액',           // S: taxfree_amount
  '할인금액',           // T: discount_amount
  '실수납액',           // U: actual_paid_amount
  '결제수단',           // V: payment_method
  '승인정보',           // W: appr_info
  '연말정산제외',        // X: exclude_tax_report
  '전표상태',           // Y: status
] as const;

export type SalesExcelHeader = (typeof SALES_EXCEL_HEADERS)[number];

/** 집계 탭에서 넘겨주는 행 타입 (스펙 A~Y 25컬럼) */
export interface SalesExcelRow {
  '고유전표ID': string;
  '회계귀속일자': string;         // YYYY-MM-DD
  '원거래일자': string;
  '차트번호': string;
  '환자명': string;
  '주민등록번호': string;          // 마스킹 적용 (Vault 참조 — 미조회 시 공란)
  '진료구분': string;             // 초진 | 재진 | 체험
  '상병코드': string;             // 쉼표 구분 복수코드 허용
  '시술코드': string;
  '시술/상품명': string;
  '담당의사': string;
  '담당직원': string;
  '세금속성': string;             // 과세_비급여 | 면세_비급여 | 급여 | 선수금
  '총발생금액': number;
  '급여 본부금': number;
  '공단청구액': number;
  '과세 공급가': number;
  '부가세': number;
  '비과세액': number;
  '할인금액': number;
  '실수납액': number;
  '결제수단': string;             // 카드 | 현금 | 이체 | 선수금차감
  '승인정보': string;
  '연말정산제외': string;          // Y | N
  '전표상태': string;             // 정상수납 | 결제취소 | 부분환불
}

/** VISIT_TYPE → 한국어 표기 */
export function visitTypeLabel(t: string | null | undefined): string {
  if (t === 'new') return '초진';
  if (t === 'returning') return '재진';
  if (t === 'experience') return '체험';
  return t ?? '';
}

/** payment_type → 전표상태 */
export function paymentStatusLabel(type: string | null | undefined, status: string | null | undefined): string {
  if (status === 'cancelled') return '결제취소';
  if (type === 'refund') return '부분환불';
  return '정상수납';
}

/** method → 결제수단 한국어 */
export function payMethodLabel(method: string | null | undefined): string {
  if (method === 'card') return '카드';
  if (method === 'cash') return '현금';
  if (method === 'transfer') return '이체';
  if (method === 'membership') return '선수금차감';
  return method ?? '';
}

/**
 * 매출 raw 데이터를 xlsx 파일로 다운로드.
 * @param rows SalesExcelRow[]
 * @param filename 파일명 (확장자 제외, 예: "매출집계_20260515")
 */
export function downloadSalesExcel(rows: SalesExcelRow[], filename: string): void {
  // 헤더 순서 고정
  const sheetData = [
    SALES_EXCEL_HEADERS as unknown as string[],
    ...rows.map((r) => SALES_EXCEL_HEADERS.map((h) => r[h as SalesExcelHeader])),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // 금액 컬럼(N~U, index 13~20, 주민등록번호 F열 추가로 1 shift)을 숫자 형식으로
  const numberCols = [13, 14, 15, 16, 17, 18, 19, 20];
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

  // 컬럼 너비 자동 설정 (최소 10, 최대 30)
  ws['!cols'] = SALES_EXCEL_HEADERS.map((h) => ({
    wch: Math.min(30, Math.max(10, h.length * 2 + 4)),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '매출집계');

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** 날짜 범위 → 파일명용 문자열 (예: "20260501_20260515") */
export function dateRangeFilename(from: string, to: string): string {
  return `매출집계_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}`;
}
