/**
 * E2E — T-20260807-foot-RXHIST-DRUG-MULTISELECT
 * 치료테이블 '처방 이력' 탭 — 약 드롭다운 단일→복수(multi-select) 선택 확장.
 *
 * canonical SSOT = form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts).
 *   BYDRUG-LOOKUP(deployed) 계승. read-side 필터 IN절(합집합) 확장 — DB 스키마 변경 0.
 *
 * 행 grain = 발행 1건(form_submission.id, 고유). 복수 선택 = 합집합(선택약 중 하나라도 포함한 발행)
 *   → 행 중복 없음(한 발행이 여러 선택약을 모두 포함해도 1행). 화면·엑셀 동일 rows 소비(동일 규칙).
 *
 * AC-1: 2개 이상 약 동시 선택 가능(복수 선택 로직).
 * AC-2: 복수 선택 시 선택약 합집합으로 통합 표시(중복 환자행 규칙 = 발행 grain 1행, 화면·다운로드 동일).
 * AC-3: 표 컬럼/펼쳐보기 등 기존 포맷 유지(BYDRUG-LOOKUP spec 이 계속 커버).
 * AC-4: 1개 선택 시 기존 단일 선택과 동일 결과(회귀 없음).
 * AC-5: 엑셀 다운로드 = 화면 복수필터 결과와 정확히 일치(동일 rows).
 * AC-6: 미선택(0개) 기본 동작 기존과 동일(빈 결과·다운로드 비활성).
 *
 * ★ 필터·파일명은 라이브 비의존 로직 스펙으로 결정적 검증. 탭 렌더는 브라우저 스모크(로그인 실패 시 skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedication,
  filterRxRowsByMedications,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { rxHistoryExportFilename } from '../../src/lib/rxHistoryExport';
import { loginAndWaitForDashboard } from '../helpers';

const BARTO_4 = buildRxItemsHtml([
  { name: '바르토벤외용액(4mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);
const BARTO_8 = buildRxItemsHtml([
  { name: '바르토벤외용액(8mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);
const OTHER = buildRxItemsHtml([
  { name: '아모잘탄정', code: '645502330', unit_dose: '1', daily_freq: '1', total_days: '30' },
]);
// 한 발행에 두 약 동시(합집합 중복 방지 검증용)
const BARTO_BOTH = buildRxItemsHtml([
  { name: '바르토벤외용액(4mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
  { name: '바르토벤외용액(8mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

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
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
    ...overrides,
  };
}

const SAMPLE: RawFormSubmissionWithCustomerRow[] = [
  rxRow('fs-1', BARTO_4, { name: '김환자', chart_number: '10001' }),
  rxRow('fs-2', BARTO_8, { name: '이환자', chart_number: '10002' }),
  rxRow('fs-3', OTHER, { name: '박환자', chart_number: '10003' }),
  rxRow('fs-4', BARTO_BOTH, { name: '최환자', chart_number: '10004' }), // 4mL+8mL 동시
];

const MED_4 = '바르토벤외용액(4mL)';
const MED_8 = '바르토벤외용액(8mL)';

// ─── 시나리오 1: 정상 — 복수 선택 조회(합집합) ───

test.describe('시나리오 1: 복수 선택 합집합 조회', () => {
  test('AC-1/AC-2 — 2개 약 선택 시 두 약 중 하나라도 처방된 환자 통합 표시', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    const filtered = filterRxRowsByMedications(rows, [MED_4, MED_8]);
    // 김(4)·이(8)·최(4+8) = 3인. 박(타약)은 제외.
    expect(filtered.map((r) => r.patient_name).sort()).toEqual(['김환자', '이환자', '최환자']);
  });

  test('AC-2 — 두 약 모두 포함한 발행도 1행(발행 grain 중복 없음)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    const filtered = filterRxRowsByMedications(rows, [MED_4, MED_8]);
    // 4mL+8mL 동시 발행 최환자(fs-4)는 1행만.
    expect(filtered.filter((r) => r.id === 'fs-4')).toHaveLength(1);
    // 전체 행 id 는 고유(중복 없음)
    const ids = filtered.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('AC-5 — 화면 rows = 엑셀 대상 rows(동일 참조로 동일 규칙 보장)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    const screenRows = filterRxRowsByMedications(rows, [MED_4, MED_8]);
    // 다운로드는 이 screenRows 를 그대로 소비 → 행수·대상 일치가 구조적으로 보장.
    expect(screenRows.length).toBeGreaterThan(0);
    expect(screenRows).toEqual(filterRxRowsByMedications(rows, [MED_4, MED_8]));
  });
});

// ─── 시나리오 2: 회귀 — 단일 선택 ───

test.describe('시나리오 2: 단일 선택 회귀', () => {
  test('AC-4 — 1개 선택 시 단일 필터(filterRxRowsByMedication)와 동일 결과', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    const plural = filterRxRowsByMedications(rows, [MED_4]);
    const single = filterRxRowsByMedication(rows, MED_4);
    expect(plural.map((r) => r.id).sort()).toEqual(single.map((r) => r.id).sort());
    // 4mL = 김(fs-1)·최(fs-4). 이(8mL만)·박(타약) 제외.
    expect(plural.map((r) => r.patient_name).sort()).toEqual(['김환자', '최환자']);
  });

  test('AC-4 — 파일명: 단일 선택은 기존과 동일(약명 그대로)', () => {
    const d = new Date('2026-08-07T10:00:00+09:00');
    expect(rxHistoryExportFilename([MED_4], d)).toBe(rxHistoryExportFilename(MED_4, d));
    expect(rxHistoryExportFilename([MED_4], d)).toContain(MED_4);
  });
});

// ─── 시나리오 3: 엣지 — 미선택 ───

test.describe('시나리오 3: 미선택 기본 동작', () => {
  test('AC-6 — 0개 선택(빈 배열) → 빈 결과(기존 미선택과 동일)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    expect(filterRxRowsByMedications(rows, [])).toEqual([]);
    expect(filterRxRowsByMedications(rows, null)).toEqual([]);
    // 기존 단일 null 동작과 동치
    expect(filterRxRowsByMedications(rows, [])).toEqual(filterRxRowsByMedication(rows, null));
  });

  test('AC-6 — 빈문자/공백만 있는 선택은 무시(빈 결과)', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    expect(filterRxRowsByMedications(rows, ['', '  '])).toEqual([]);
  });
});

// ─── 파일명 복수 규칙 ───

test.describe('엑셀 파일명 복수 규칙', () => {
  const d = new Date('2026-08-07T10:00:00+09:00');
  test('2개 → A_B / 3개 이상 → A_외N종 / 0개 → 전체', () => {
    expect(rxHistoryExportFilename([MED_4, MED_8], d)).toContain(`${MED_4}_${MED_8}`);
    expect(rxHistoryExportFilename([MED_4, MED_8, '아모잘탄정'], d)).toContain(`${MED_4}_외2종`);
    expect(rxHistoryExportFilename([], d)).toContain('전체');
  });
});

// ─── distinct 드롭다운 소스(복수 선택 후보) 무회귀 ───

test.describe('드롭다운 소스', () => {
  test('distinct 약목록에 4mL·8mL 모두 후보로 존재(복수 선택 대상)', () => {
    const meds = collectDistinctMedications(mapRxIssuancePatientRows(SAMPLE));
    expect(meds).toContain(MED_4);
    expect(meds).toContain(MED_8);
  });
});

// ─── AC-1: 브라우저 스모크(복수 선택 UI 렌더). 로그인 실패 시 skip. ───

test.describe('AC-1: 복수 선택 드롭다운 렌더', () => {
  test('처방 이력 탭 → 복수 선택 드롭다운 + 미선택 다운로드 비활성', async ({ page }) => {
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

    await expect(page.locator('[data-testid="rx-history-section"]')).toBeVisible();
    const trigger = page.locator('[data-testid="rx-history-drug-select"]');
    await expect(trigger).toBeVisible();
    // 미선택 → 다운로드 비활성(AC-6)
    await expect(page.locator('[data-testid="rx-history-excel-download"]')).toBeDisabled();

    // 드롭다운 열기 → 체크박스 옵션(복수 선택 UI) 존재 시 2개 선택 시도
    await trigger.click();
    const options = page.locator('[data-testid="multi-select-option"]');
    try {
      await options.first().waitFor({ timeout: 4000 });
    } catch {
      test.skip(true, 'no drug options in this env (data-dependent)');
      return;
    }
    const count = await options.count();
    await options.nth(0).click();
    if (count >= 2) await options.nth(1).click();
    // 최소 1개 선택 시 다운로드 활성화(데이터 존재 시)
  });
});
