/**
 * E2E — T-20260807-foot-RXHIST-RESULT-COUNT-DISPLAY
 * 치료테이블 '처방 이력' 탭 — 조회 결과 상단에 '총 N건' 건수 표기.
 *
 * 순수 additive read-side 표시. DB 스키마 변경 0. canonical SSOT =
 *   form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts) — 신규 COUNT 쿼리 신설 0.
 *
 * ★ 표시-정합 불변식: '총 N건'의 N = 화면에 실제 렌더되는 행(row) 수.
 *   컴포넌트 rows 파생 = 기간 필터(AC-1) → 실처방 dedup(AC-2) → 약품 합집합 필터(AC-4, 선택 시).
 *   count 는 이 최종 rows.length 이므로 raw 발행이력 건수가 아니라 dedup 후 표시 행 수와 일치(AC-5).
 *
 * AC-1: 처방약 선택 후 조회 시 '총 N건' 표기.
 * AC-2: 선택 약 변경/추가/제거 시 건수 실시간 갱신(rows 재파생 = useMemo).
 * AC-3: 복수선택(multi-select)에서도 합집합 건수 정확.
 * AC-4: 기존 기능(드롭다운·테이블·엑셀) 회귀 없음.
 * AC-5: N = dedup 반영 렌더 행 수와 일치(raw 발행건수 아님).
 *
 * count 로직은 라이브 비의존 순수함수로 결정적 검증(컴포넌트 rows 파이프라인 그대로 재현).
 * 탭 렌더·count 엘리먼트는 브라우저 스모크(로그인 실패 시 skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  filterRxRowsByMedications,
  filterRxRowsByDateRange,
  dedupeRxIssuanceRows,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
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
const BARTO_BOTH = buildRxItemsHtml([
  { name: '바르토벤외용액(4mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
  { name: '바르토벤외용액(8mL)', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

const MED_4 = '바르토벤외용액(4mL)';
const MED_8 = '바르토벤외용액(8mL)';

function rxRow(
  id: string,
  medHtml: string,
  customer: { name: string; chart_number: string },
  issueDate: string,
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    printed_at: `${issueDate}T09:00:00+09:00`,
    created_at: `${issueDate}T08:59:00+09:00`,
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date: issueDate,
      issue_no: `${issueDate.replace(/-/g, '')}-${id}`,
      prescriber_name: '문지은',
      diag_code_1: 'B35.1',
      diag_name_1: '조갑백선',
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
  };
}

// 동일 환자·동일 교부일·동일 약품집합 = dedup 대상(실처방 1건). fs-dup1/dup2 = 같은 환자·날·약 → 1건으로 축약.
const SAMPLE: RawFormSubmissionWithCustomerRow[] = [
  rxRow('fs-1', BARTO_4, { name: '김환자', chart_number: '10001' }, '2026-07-15'),
  rxRow('fs-2', BARTO_8, { name: '이환자', chart_number: '10002' }, '2026-07-15'),
  rxRow('fs-3', OTHER, { name: '박환자', chart_number: '10003' }, '2026-07-15'),
  rxRow('fs-4', BARTO_BOTH, { name: '최환자', chart_number: '10004' }, '2026-07-15'), // 4mL+8mL 동시
  rxRow('fs-dup1', BARTO_4, { name: '정환자', chart_number: '10005' }, '2026-07-16'),
  rxRow('fs-dup2', BARTO_4, { name: '정환자', chart_number: '10005' }, '2026-07-16'), // dup of fs-dup1
  rxRow('fs-old', BARTO_4, { name: '한환자', chart_number: '10006' }, '2026-06-20'), // 다른 달
];

const JULY = { from: '2026-07-01', to: '2026-07-31' };

/** 컴포넌트 rows 파생 파이프라인 그대로 재현: 기간 → dedup → (선택 시) 약품 합집합. */
function deriveRows(
  raw: RawFormSubmissionWithCustomerRow[],
  range: { from: string; to: string },
  selectedMeds: string[],
) {
  const mapped = mapRxIssuancePatientRows(raw);
  const byDate = filterRxRowsByDateRange(mapped, range.from, range.to);
  const deduped = dedupeRxIssuanceRows(byDate);
  return selectedMeds.length > 0 ? filterRxRowsByMedications(deduped, selectedMeds) : deduped;
}

// ─── 시나리오 1: AC-1/AC-5 정상 — count = 렌더 행 수(dedup 반영) ───

test.describe('시나리오 1: 총 N건 = dedup 반영 렌더 행 수', () => {
  test('AC-5 — count = rows.length(dedup 후), raw 발행건수 아님', () => {
    // 7월 raw 발행 = fs-1..4 + dup1 + dup2 = 6건. dedup 후 정환자 1건 축약 → 렌더 5행.
    const rows = deriveRows(SAMPLE, JULY, []);
    expect(rows.length).toBe(5); // 김·이·박·최·정(dup 1건)
    // '총 N건'의 N 은 이 rows.length 를 그대로 소비 → 표시-정합 불변식 성립.
  });

  test('AC-1 — 약 선택 후 조회 시 count 산출(선택 결과 행 수)', () => {
    const rows = deriveRows(SAMPLE, JULY, [MED_4]);
    // 4mL: 김(fs-1)·최(fs-4 동시)·정(dedup 1건). 이(8mL만)·박(타약) 제외.
    expect(rows.length).toBe(3);
  });
});

// ─── 시나리오 2: AC-2/AC-3 실시간 갱신 + 복수선택 합집합 ───

test.describe('시나리오 2: 실시간 갱신 + 복수선택 합집합', () => {
  test('AC-3 — 복수선택 합집합 count 정확(발행 grain 중복 없음)', () => {
    const rows = deriveRows(SAMPLE, JULY, [MED_4, MED_8]);
    // 합집합: 김(4)·이(8)·최(4+8, 1행)·정(4, dedup 1건) = 4행. 박(타약) 제외.
    expect(rows.length).toBe(4);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // 중복 0
  });

  test('AC-2 — 약 추가/제거 시 count 재계산(단조 변화)', () => {
    const only4 = deriveRows(SAMPLE, JULY, [MED_4]).length; // 3
    const both = deriveRows(SAMPLE, JULY, [MED_4, MED_8]).length; // 4 (이환자 추가)
    const only8 = deriveRows(SAMPLE, JULY, [MED_8]).length; // 이(fs-2)·최(fs-4) = 2
    expect(only4).toBe(3);
    expect(both).toBe(4);
    expect(only8).toBe(2);
    // 약 추가 시 합집합이므로 개별 이상, 제거 시 감소 방향.
    expect(both).toBeGreaterThanOrEqual(only4);
    expect(both).toBeGreaterThanOrEqual(only8);
  });

  test('AC-2 — 기간 변경 시 count 재계산(6월 제외분 반영)', () => {
    const july = deriveRows(SAMPLE, JULY, [MED_4]).length; // 3 (한환자 6월분 제외)
    const june = deriveRows(SAMPLE, { from: '2026-06-01', to: '2026-06-30' }, [MED_4]).length;
    expect(july).toBe(3);
    expect(june).toBe(1); // 한환자만
  });
});

// ─── 시나리오 3: 엣지 — 결과 0건 ───

test.describe('시나리오 3: 결과 0건', () => {
  test('AC-5 — 매칭 없는 기간/약 → count 0(빈 상태와 정합)', () => {
    expect(deriveRows(SAMPLE, { from: '2026-05-01', to: '2026-05-31' }, []).length).toBe(0);
    expect(deriveRows(SAMPLE, JULY, ['존재하지않는약']).length).toBe(0);
  });
});

// ─── 브라우저 스모크: '총 N건' 엘리먼트 렌더 + 회귀(AC-4) ───

test.describe('AC-1/AC-4: 총 N건 엘리먼트 렌더', () => {
  test('처방 이력 탭 → 결과 count 표기 + 기존 다운로드 회귀 없음', async ({ page }) => {
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
    // '총 N건' 표기 노출(로딩 완료 후) — 데이터 유무 무관하게 카운트 엘리먼트 존재.
    const count = page.locator('[data-testid="rx-history-result-count"]');
    await expect(count).toBeVisible({ timeout: 12_000 });
    await expect(count).toContainText('총');
    await expect(count).toContainText('건');
    // 회귀(AC-4): 엑셀 다운로드 버튼 여전히 존재.
    await expect(page.locator('[data-testid="rx-history-excel-download"]')).toBeVisible();
  });
});
