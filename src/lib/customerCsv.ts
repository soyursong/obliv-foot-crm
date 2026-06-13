/**
 * T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT
 * 고객관리 리스트 CSV 내보내기 유틸리티 (무의존 — 외부 라이브러리 없음)
 *
 * 규칙:
 *  - '1행 1고객' flat 구조.
 *  - PHI 가드: 주민번호(rrn) 평문·뒷자리 절대 미포함. 생년월일은 서버 파생 YYYY-MM-DD만 표기.
 *  - 전화/생년월일 등 PII 컬럼 포함 → 내보내기 자체를 admin/manager 권한으로 게이팅(호출부 책임).
 *  - 무의존: 브라우저 Blob + URL.createObjectURL 로 다운로드. xlsx 등 의존성 사용 안 함.
 *  - UTF-8 BOM 선두 부착 → Excel(한글) 깨짐 방지.
 *  - 엑셀(.xlsx) 내보내기는 후속(customerExport.ts) — 본 모듈은 1차 CSV 전용.
 */

/** CSV 컬럼 헤더 순서 (고객관리 리스트 화면 컬럼과 동일, rrn 제외) */
export const CUSTOMER_CSV_HEADERS = [
  '이름',
  '전화번호',
  '생년월일',
  '차트번호',
  '방문횟수',
  '최종방문',
  '결제액',
  '고객메모',
] as const;

export type CustomerCsvHeader = (typeof CUSTOMER_CSV_HEADERS)[number];
export type CustomerCsvRow = Record<CustomerCsvHeader, string | number>;

/** 단일 CSV 셀 이스케이프 — 콤마/따옴표/개행 포함 시 따옴표로 감싸고 내부 따옴표는 2배로. */
function escapeCsvCell(value: string | number): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** rows → CSV 문자열 (헤더 포함, CRLF 줄바꿈 — Excel 호환). */
export function buildCustomerCsv(rows: CustomerCsvRow[]): string {
  const lines: string[] = [];
  lines.push(CUSTOMER_CSV_HEADERS.map(escapeCsvCell).join(','));
  for (const r of rows) {
    lines.push(CUSTOMER_CSV_HEADERS.map((h) => escapeCsvCell(r[h])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * 고객 리스트를 CSV 파일로 다운로드 (무의존).
 * @param rows CustomerCsvRow[]
 * @param filename 파일명 (확장자 제외, 예: "고객목록_20260613")
 */
export function downloadCustomerCsv(rows: CustomerCsvRow[], filename: string): void {
  const csv = buildCustomerCsv(rows);
  // UTF-8 BOM(﻿) → Excel 한글 인코딩 자동 인식.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 비동기 revoke로 다운로드 트리거 보장
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 오늘 날짜 → 파일명용 문자열 (예: "고객목록_20260613") */
export function customerCsvFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `고객목록_${y}${m}${d}`;
}
