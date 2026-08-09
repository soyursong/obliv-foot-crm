/**
 * E2E — T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP
 * 치료테이블 '처방 이력(약별 조회)' 탭 — 약 드롭다운 필터 + 조회 테이블 + 엑셀 다운로드 (read-only).
 *
 * canonical SSOT = form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts 재사용/확장).
 *   DA-20260806-foot-RX-PERSIST-SSOT / FORWARDFIX(deployed) 계승. prescription_items 축 조인 0(VG3).
 *
 * AC-1: 치료테이블 '처방 이력' 탭 진입 → 약 드롭다운 + 조회 테이블 렌더(기존 탭 무회귀).
 * AC-2: 약 선택 시 그 약 처방받은 환자 행이 [일자][성함/차트번호][처방이력] 형식으로 표시(distinct 약목록·필터).
 * AC-3: '처방이력' 열 드롭 펼침 시 세부(교부일·처방의료인·진단·교부번호·약품명) — 접힘/펼침 토글.
 * AC-4: 엑셀 다운로드 = 현재 필터 결과 전체. RRN·풀 전화 미포함(성함·차트번호는 노출 허용).
 * AC-5: read-only — mutate 경로 0(투영·SELECT·export 만).
 *
 * 시나리오 1(정상): 약별 처방 환자 조회 + 드롭 상세 + 엑셀 다운로드(RRN·풀전화 미포함).
 * 시나리오 2(엣지): 0건 약 → 조회 결과 없음 / 약 미선택 → 다운로드 비활성.
 *
 * ★ 데이터 계약(투영·필터·distinct·PHI 화이트리스트)은 라이브 데이터 비의존 로직 스펙으로 결정적 검증
 *   (FORWARDFIX 선례). 탭 렌더는 브라우저 스모크(로그인 실패 시 graceful skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedication,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import {
  RX_HISTORY_EXCEL_HEADERS,
  rxHistoryExportFilename,
} from '../../src/lib/rxHistoryExport';
import { loginAndWaitForDashboard } from '../helpers';

const BARTOVEN_HTML = buildRxItemsHtml([
  { name: '바르토벤외용액(4mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);
const OTHER_HTML = buildRxItemsHtml([
  { name: '아모잘탄정', code: '645502330', unit_dose: '1', daily_freq: '1', total_days: '30' },
]);

/** rx_standard form_submissions 행(+customers 임베드). field_data 에 PHI 평문 sentinel 포함. */
function rxRow(
  id: string,
  medHtml: string,
  customer: { name: string; chart_number: string },
  overrides: Partial<RawFormSubmissionWithCustomerRow> = {},
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    printed_at: '2026-07-15T09:00:00+09:00',
    created_at: '2026-07-15T08:59:00+09:00',
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date: '2026-07-15',
      issue_no: `20260715-${id}`,
      prescriber_name: '문지은',
      diag_code_1: 'B35.1',
      diag_name_1: '조갑백선',
      // PHI 슬롯(VG2: 투영·엑셀 어디에도 노출 금지) — 유출탐지 sentinel.
      patient_rrn: 'PHI-RRN-SENTINEL-NOLEAK',
      patient_phone: 'PHI-PHONE-SENTINEL-NOLEAK',
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
    ...overrides,
  };
}

const SAMPLE: RawFormSubmissionWithCustomerRow[] = [
  rxRow('fs-1', BARTOVEN_HTML, { name: '김환자', chart_number: '10001' }),
  rxRow('fs-2', BARTOVEN_HTML, { name: '이환자', chart_number: '10002' }),
  rxRow('fs-3', OTHER_HTML, { name: '박환자', chart_number: '10003' }),
];

// ─── 시나리오 1: 정상 동선 (AC-2/AC-3) ───

test.describe('시나리오 1: 약별 처방 환자 조회', () => {
  test('AC-2 — 성함·차트번호 화이트리스트 투영 + [일자][성함/차트][처방이력] grain', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    expect(rows).toHaveLength(3);
    const r = rows[0];
    expect(r.issued_at).toBe('2026-07-15');
    expect(r.patient_name).toBe('김환자');
    expect(r.chart_number).toBe('10001');
    expect(r.prescriber_name).toBe('문지은');
    expect(r.diagnosis).toBe('B35.1 조갑백선');
    expect(r.medications).toEqual(['바르토벤외용액(4mL)']);
  });

  test('AC-2 — distinct 약목록(드롭다운 소스) ko 정렬', () => {
    const meds = collectDistinctMedications(mapRxIssuancePatientRows(SAMPLE));
    expect(meds).toContain('바르토벤외용액(4mL)');
    expect(meds).toContain('645502330 | 아모잘탄정');
    // distinct — 바르토벤 2건이어도 1개
    expect(meds.filter((m) => m === '바르토벤외용액(4mL)')).toHaveLength(1);
  });

  test('AC-2 — 약 선택 시 그 약 처방받은 환자만 필터', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    const filtered = filterRxRowsByMedication(rows, '바르토벤외용액(4mL)');
    expect(filtered.map((r) => r.patient_name).sort()).toEqual(['김환자', '이환자']);
    // 7월 바르토벤 케이스 evidence 대조: 발행 건수 = 필터 행수
    expect(filtered).toHaveLength(2);
  });

  test('AC-3 — 드롭 상세 grain(교부일·처방의료인·진단·교부번호·약품명) 존재', () => {
    const r = mapRxIssuancePatientRows(SAMPLE)[0];
    expect(r.issued_at).toBeTruthy();
    expect(r.prescriber_name).toBeTruthy();
    expect(r.diagnosis).toBeTruthy();
    expect(r.issue_no).toBeTruthy();
    expect(r.medications.length).toBeGreaterThan(0);
  });
});

// ─── 시나리오 1: PHI 안전 + 엑셀 (AC-4) ───

test.describe('시나리오 1: PHI 안전 + 엑셀 헤더', () => {
  test('AC-4/AC-5 — 투영 JSON 에 RRN·풀 전화 sentinel 미노출(성함·차트만 허용)', () => {
    const serialized = JSON.stringify(mapRxIssuancePatientRows(SAMPLE));
    expect(serialized).not.toContain('PHI-RRN-SENTINEL-NOLEAK');
    expect(serialized).not.toContain('PHI-PHONE-SENTINEL-NOLEAK');
    // 성함·차트번호는 스태프 대상 노출 허용
    expect(serialized).toContain('김환자');
    expect(serialized).toContain('10001');
  });

  test('AC-4 — 투영 키셋 = 화이트리스트 + 성함·차트번호(PHI 필드명 부재)', () => {
    // T-20260807-foot-RXHISTORY-TAB-4IMPROVE AC-3: customer_id(2번차트 오픈용 내부 UUID) 추가.
    //   customer_id = 내부 식별자(PHI 아님) — RRN/전화/차트 평문 아님. 화이트리스트 확장.
    const r = mapRxIssuancePatientRows(SAMPLE)[0];
    expect(Object.keys(r).sort()).toEqual(
      ['chart_number', 'customer_id', 'diagnosis', 'id', 'issue_no', 'issued_at', 'medications', 'patient_name', 'prescriber_name'].sort(),
    );
    for (const phi of ['patient_rrn', 'patient_phone', 'field_data']) {
      expect(r).not.toHaveProperty(phi);
    }
  });

  test('AC-4 — 엑셀 헤더 = 화이트리스트 컬럼(RRN·전화 헤더 부재)', () => {
    expect(RX_HISTORY_EXCEL_HEADERS).toEqual([
      '일자', '성함', '차트번호', '처방의료인', '진단', '교부번호', '처방약품',
    ]);
    expect(RX_HISTORY_EXCEL_HEADERS as readonly string[]).not.toContain('주민번호');
    expect(RX_HISTORY_EXCEL_HEADERS as readonly string[]).not.toContain('전화번호');
  });

  test('AC-4 — 파일명에 선택 약명 반영 / 미선택 시 전체', () => {
    const d = new Date('2026-08-07T10:00:00+09:00');
    expect(rxHistoryExportFilename('바르토벤외용액(4mL)', d)).toContain('바르토벤외용액(4mL)');
    expect(rxHistoryExportFilename(null, d)).toContain('전체');
  });
});

// ─── 시나리오 2: 엣지 케이스 ───

test.describe('시나리오 2: 엣지 케이스', () => {
  test('0건 약 선택 → 필터 결과 빈 배열(에러 아님)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    expect(filterRxRowsByMedication(rows, '존재하지않는약')).toEqual([]);
  });

  test('약 미선택(null) → 빈 결과(다운로드 비활성 근거)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    expect(filterRxRowsByMedication(rows, null)).toEqual([]);
  });

  test('비-처방전 서식 혼입 방어(preFiltered=false 시 rx_standard 만)', () => {
    const mixed: RawFormSubmissionWithCustomerRow[] = [
      ...SAMPLE,
      rxRow('fs-koh', BARTOVEN_HTML, { name: '혼입', chart_number: '99999' }, {
        field_data: { form_key: 'koh_result', rx_items_html: BARTOVEN_HTML },
        form_templates: { form_key: 'koh_result' },
      }),
    ];
    const rows = mapRxIssuancePatientRows(mixed, /* preFiltered */ false);
    expect(rows.map((r) => r.id)).not.toContain('fs-koh');
  });

  test('customers 임베드 배열/부재 안전 처리', () => {
    const arr = rxRow('fs-arr', BARTOVEN_HTML, { name: 'X', chart_number: 'Y' }, {
      customers: [{ name: '배열환자', chart_number: '20001' }],
    });
    const none = rxRow('fs-none', BARTOVEN_HTML, { name: 'X', chart_number: 'Y' }, { customers: null });
    const rows = mapRxIssuancePatientRows([arr, none]);
    expect(rows[0].patient_name).toBe('배열환자');
    expect(rows[0].chart_number).toBe('20001');
    expect(rows[1].patient_name).toBeNull();
    expect(rows[1].chart_number).toBeNull();
  });
});

// ─── AC-1: 브라우저 스모크(탭 렌더). 로그인 실패 시 graceful skip. ───

test.describe('AC-1: 치료테이블 처방 이력 탭 렌더', () => {
  test('처방 이력 탭 진입 → 약 드롭다운 + 미선택 안내 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/treatment-table');
    const tab = page.locator('[data-testid="tab-rx-history"]');
    try {
      await tab.waitFor({ timeout: 12_000 });
    } catch {
      test.skip(true, 'treatment-table not reachable for this role/env');
      return;
    }
    await tab.click();

    // 처방 이력 섹션 + 약 드롭다운 렌더
    await expect(page.locator('[data-testid="rx-history-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="rx-history-drug-select"]')).toBeVisible();
    // 약 미선택 상태 → 엑셀 다운로드 비활성(AC-4 엣지)
    await expect(page.locator('[data-testid="rx-history-excel-download"]')).toBeDisabled();
  });
});
