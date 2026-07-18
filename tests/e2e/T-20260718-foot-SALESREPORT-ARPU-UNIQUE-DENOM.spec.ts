/**
 * T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM
 * 통계 > 매출통계 탭 '일간매출보고' 다운로드 xlsx 의 상담객단가(ARPU) 분모 통일.
 *
 * 변경점(스코프): 상담객단가 분모 = 상담'건수'(ticketing_count, 방문횟수)
 *   → distinct 상담(내원)고객수(consulted_customer_count) 로 통일. 화면 배포본(실장별 실적,
 *   T-20260717-foot-CONSULTANT-ARPU-STATS)의 객단가와 1-byte 동일 기준.
 *   재집계 금지 — foot_stats_consultant RPC canonical 을 그대로 소비:
 *     · 실장별 객단가 = RPC avg_amount(= ROUND(total_amount / NULLIF(consulted_customer_count,0)))
 *       직접 소비(FE 재계산 X). 분모=0 → RPC NULL → 엑셀 빈칸.
 *     · 합계 객단가 = Σ매출 / Σconsulted_customer_count(반올림). 분모=0 → 빈칸.
 *   불변: 분자(매출)=RPC total_amount, '상담건수' 컬럼=ticketing_count, 헤더/컬럼구조/기간선택.
 *
 * 순수 로직 불변식(auth·server 불요, unit project). 실 다운로드 UX 는 기존
 * T-20260622 스펙(stats-revenue-export 버튼 가시·오류토스트 미발생) 가 회귀 커버.
 *
 * 실기기(갤탭) 다운로드 열람 체감 = supervisor field-soak(김주연 총괄 확인).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  consultantOverallUnitPrice,
  consultantRevenue,
  downloadConsultantSalesReport,
} from '../../src/lib/consultantSalesExport';
import type { ConsultantRow } from '../../src/lib/stats';

const HEADERS = ['실장명', '매출', '상담건수', '상담객단가'];

// 고정 픽스처: A(상담고객 5) / B(상담고객 0 = 분모0) / C(상담고객 4)
// avg_amount 는 RPC 가 이미 ROUND(total/상담고객) 로 계산해 반환하는 canonical 값.
const ROWS: ConsultantRow[] = [
  {
    consultant_id: 'a',
    name: '실장A',
    ticketing_count: 8,          // 방문횟수(상담건수 컬럼, 불변)
    package_count: 3,
    avg_amount: 200_000,          // = 1,000,000 / 5 (÷상담고객수, canonical)
    total_amount: 1_000_000,
    consulted_customer_count: 5,
  },
  {
    consultant_id: 'b',
    name: '실장B',
    ticketing_count: 3,
    package_count: 0,
    avg_amount: null,             // 분모(상담고객)=0 → RPC NULL → 빈칸
    total_amount: 300_000,
    consulted_customer_count: 0,
  },
  {
    consultant_id: 'c',
    name: '실장C',
    ticketing_count: 10,
    package_count: 2,
    avg_amount: 150_000,          // = 600,000 / 4
    total_amount: 600_000,
    consulted_customer_count: 4,
  },
];

/** downloadConsultantSalesReport 를 임시 cwd 에서 실행하고 생성 xlsx 를 aoa 로 파싱. */
function runExportAndParse(rows: ConsultantRow[]): (string | number)[][] {
  const prevCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foot-arpu-denom-'));
  process.chdir(tmp);
  try {
    downloadConsultantSalesReport(rows, '2026-07-01', '2026-07-18');
    const file = fs.readdirSync(tmp).find((f) => f.endsWith('.xlsx'));
    expect(file, '엑셀 파일 생성 실패').toBeTruthy();
    const wb = XLSX.read(fs.readFileSync(path.join(tmp, file!)), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as (string | number)[][];
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test.describe('일간매출보고 객단가 분모 = distinct 상담고객수 통일', () => {
  test('helper: 합계 객단가 = Σ매출 ÷ Σ상담고객수, 분모0 → null', () => {
    // Σ매출 1,900,000 / Σ상담고객 9 = ROUND(211,111.1) = 211,111
    expect(consultantOverallUnitPrice(1_900_000, 9)).toBe(211_111);
    // 분모(상담고객)=0 → null(빈칸). ÷상담건수 로의 폴백 절대 금지.
    expect(consultantOverallUnitPrice(300_000, 0)).toBeNull();
    expect(consultantOverallUnitPrice(0, 0)).toBeNull();
  });

  test('helper: 매출 분자는 RPC total_amount 그대로(net·accounting_date)', () => {
    expect(consultantRevenue({ total_amount: 1_000_000, avg_amount: 200_000, ticketing_count: 8 })).toBe(1_000_000);
    // total_amount 미반환(구버전 RPC) dead-path fallback 만 역산.
    expect(consultantRevenue({ total_amount: undefined as unknown as number, avg_amount: 200_000, ticketing_count: 8 })).toBe(1_600_000);
  });

  test('xlsx: 헤더/컬럼구조 불변 + 상담건수 컬럼 = ticketing_count(불변)', () => {
    const aoa = runExportAndParse(ROWS);
    expect(aoa[0]).toEqual(HEADERS);

    const rowA = aoa.find((r) => r[0] === '실장A')!;
    expect(rowA[1]).toBe(1_000_000);       // 매출(분자) 불변
    expect(rowA[2]).toBe(8);               // 상담건수 컬럼 = ticketing_count(방문횟수) 불변
  });

  test('xlsx: 실장별 객단가 = RPC avg_amount(÷상담고객수) 직접 소비 — ÷상담건수 아님', () => {
    const aoa = runExportAndParse(ROWS);

    const rowA = aoa.find((r) => r[0] === '실장A')!;
    // 신 기준: avg_amount 200,000 (=1,000,000/5). 구 기준(÷상담건수 8 = 125,000) 이면 실패.
    expect(rowA[3]).toBe(200_000);
    expect(rowA[3]).not.toBe(125_000);

    const rowC = aoa.find((r) => r[0] === '실장C')!;
    expect(rowC[3]).toBe(150_000);         // 600,000 / 4 (÷상담건수 10 = 60,000 아님)
    expect(rowC[3]).not.toBe(60_000);
  });

  test('xlsx: 분모(상담고객)=0 → 객단가 빈칸(구 코드처럼 0 표기 금지)', () => {
    const aoa = runExportAndParse(ROWS);
    const rowB = aoa.find((r) => r[0] === '실장B')!;
    // 빈칸: 숫자 셀 아님(빈 문자열/undefined). 0 이나 NaN 이면 실패.
    expect(typeof rowB[3] === 'number').toBe(false);
    expect(rowB[3] === '' || rowB[3] === undefined).toBe(true);
  });

  test('xlsx: 합계행 객단가 = Σ매출 ÷ Σ상담고객수(통일) — ÷상담건수 아님', () => {
    const aoa = runExportAndParse(ROWS);
    const total = aoa.find((r) => r[0] === '합계')!;

    // Σ매출 = 1,900,000 / Σ상담건수(합계 컬럼) = 21(8+3+10)
    expect(total[1]).toBe(1_900_000);
    expect(total[2]).toBe(21);             // 상담건수 합계 = Σticketing_count 불변

    // 합계 객단가 = 1,900,000 / Σ상담고객(9) = 211,111.
    expect(total[3]).toBe(211_111);
    // 구 기준(÷Σ상담건수 21 = 90,476) 이면 통일 실패.
    expect(total[3]).not.toBe(90_476);
  });
});
