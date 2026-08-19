/**
 * T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD
 * 일마감 '총 매출' / '총 매출(치료)' 화면 표시값 그대로 .xlsx 내보내기 유틸.
 *
 * 규칙(salesExport.ts · Closing.exportExcel · rxHistoryExport.ts 패턴 재사용 — 신규 npm 0, 기존 xlsx 의존):
 *  - 집계/산식/순서 재구성 금지: 각 표를 렌더하는 컴포넌트가 이미 만든 데이터 객체를
 *    그대로 AOA(행렬)로 옮긴다. 여기서는 표시 규칙(‘-’ · 천단위 콤마 · 합계행)만 재현한다.
 *  - 금액은 숫자 셀(#,##0) — 화면의 천단위 콤마 표기와 동일하게 보이고 엑셀 재집계도 가능.
 *    화면은 formatAmount(=Math.round)로 반올림 표기하므로 숫자 셀도 Math.round 로 동일화한다.
 *  - db_change=false. client-side 내보내기 전용(DA/대표 게이트 무대상).
 */
import * as XLSX from 'xlsx';
import type { MonthlyComparison, StaffDailyBreakdown } from '@/lib/mtmSales';

export type Cell = string | number | null;

/** 화면에서 값이 없을 때 표기하는 대시(‘-’). */
const DASH = '-';

export interface RevenueSheetSpec {
  /** 시트명 (엑셀 31자 제한 — 초과 시 절단). */
  name: string;
  /** 헤더행 + 본문행 + 합계행을 화면 순서 그대로 담은 AOA. */
  aoa: Cell[][];
  /** #,##0 숫자서식을 적용할 컬럼 인덱스(0-base). 문자셀은 자동으로 건너뛴다. */
  numberCols?: number[];
  /** 컬럼 너비(wch). 미지정 시 헤더 길이에서 자동 산정. */
  colWidths?: number[];
}

/** 시트명 안전화: 엑셀 금칙문자 제거 + 31자 절단. */
function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
}

/** YYYY-MM-DD → YYYYMMDD (파일명용). */
export function compactDate(iso: string): string {
  return (iso ?? '').replace(/-/g, '');
}

/**
 * 시트 스펙 배열을 하나의 .xlsx 로 다운로드.
 * @param sheets 시트 1개 이상(한 파일 다중 시트 = AC-2 "한 파일 2시트" 옵션).
 * @param filename 확장자 유무 무관(.xlsx 자동 부착).
 */
export function downloadRevenueWorkbook(sheets: RevenueSheetSpec[], filename: string): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);

    // 숫자 컬럼 #,##0 서식 — 실제 number 셀만(‘-’/‘—’ 문자셀은 건너뜀).
    if (s.numberCols?.length) {
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let R = 1; R <= range.e.r; R++) {
        for (const C of s.numberCols) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (cell && typeof cell.v === 'number') {
            cell.t = 'n';
            cell.z = '#,##0';
          }
        }
      }
    }

    const header = s.aoa[0] ?? [];
    ws['!cols'] = (
      s.colWidths ??
      header.map((h) => Math.min(28, Math.max(10, String(h ?? '').length * 2 + 4)))
    ).map((wch) => ({ wch }));

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/**
 * '총 매출' 탭 — 일자별 매출 비교(당월 vs 전월) 표.
 * MonthlyComparisonSection 의 반쪽표(1~15/16~말일)를 1개 연속 표로 합치고 하단 합계행을 붙인다.
 * 컬럼·값·증감 산식은 화면과 동일(당월 → 전월 → 증감), db_change=false.
 */
export function buildMonthlyCompareSheet(data: MonthlyComparison): RevenueSheetSpec {
  const header: Cell[] = ['일자', '당월 매출(원)', '전월 매출(원)', '증감(당월−전월, 원)'];
  const body: Cell[][] = data.points.map((p) => {
    const diff =
      p.current !== null && p.previous !== null ? p.current - p.previous : null;
    return [
      `${p.day}일`,
      p.current === null ? DASH : Math.round(p.current),
      p.previous === null ? DASH : Math.round(p.previous),
      diff === null ? DASH : Math.round(diff),
    ];
  });
  const totalDiff = data.prevHasData ? data.curMonthTotal - data.prevMonthTotal : null;
  const totalRow: Cell[] = [
    '합계',
    Math.round(data.curMonthTotal),
    data.prevHasData ? Math.round(data.prevMonthTotal) : DASH,
    totalDiff === null ? DASH : Math.round(totalDiff),
  ];
  return {
    name: '일자별매출비교(당월vs전월)',
    aoa: [header, ...body, totalRow],
    numberCols: [1, 2, 3],
  };
}

/**
 * '총 매출' 탭 — 실장별 일별 매출 표(StaffDailyBreakdown).
 * 미래일은 화면과 동일하게 ‘-’, 그 외 0원도 0으로 그대로 표기. 하단 합계행 + 일 합계 컬럼 포함.
 */
export function buildStaffDailySheet(data: StaffDailyBreakdown): RevenueSheetSpec {
  const header: Cell[] = [
    '일자',
    ...data.staff.map((s) => `${s.name}(원)`),
    '일 합계(원)',
  ];
  const body: Cell[][] = data.rows.map((row) => [
    `${row.day}일`,
    ...data.staff.map((s) => (row.isFuture ? DASH : Math.round(row.byStaff[s.id] ?? 0))),
    row.isFuture ? DASH : Math.round(row.total),
  ]);
  const totalRow: Cell[] = [
    '합계',
    ...data.staff.map((s) => Math.round(s.total)),
    Math.round(data.grandTotal),
  ];
  // 일자(0) 제외한 전 금액 컬럼 = 1 .. staff.length+1
  const numberCols = Array.from({ length: data.staff.length + 1 }, (_, i) => i + 1);
  return {
    name: '실장별일별매출',
    aoa: [header, ...body, totalRow],
    numberCols,
  };
}
