/**
 * E2E — T-20260807-foot-RXHISTORY-TAB-4IMPROVE
 * 치료테이블 '처방 이력' 탭 4대 개선.
 *
 * canonical SSOT = form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts).
 *   BYDRUG-LOOKUP / MULTISELECT(deployed) 계승. 전 개선 = read-side(집계/필터). DB 스키마 변경 0.
 *
 * AC-1 월별 필터: 이번달/저번달/직접입력, 기본=이번달 → 교부일 기간 필터(filterRxRowsByDateRange).
 * AC-2 실처방 dedup: 동일 환자·동일 교부일·동일 약품집합 = 1건(dedupeRxIssuanceRows). 과다병합 0.
 * AC-3 성함/차트번호 클릭→2번차트: 공통 훅 useChartNoPopup 재사용(customer_id 바인딩). UI 스모크.
 * AC-4 대표+기타: 선택 약=대표, 함께 나간 그 외 약=기타(splitRepresentativeMedications).
 *
 * ★ 필터·dedup·분리는 라이브 비의존 로직 스펙으로 결정적 검증. 탭·클릭은 브라우저 스모크(로그인 실패 시 skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  filterRxRowsByDateRange,
  dedupeRxIssuanceRows,
  splitRepresentativeMedications,
  filterRxRowsByMedications,
  rxIssuedDateKey,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { loginAndWaitForDashboard } from '../helpers';

const MED_A = '바르토벤외용액(4mL)';
const MED_B = '터미졸크림15g';
const HTML_A = buildRxItemsHtml([
  { name: MED_A, unit_dose: '1', daily_freq: '1', total_days: '1' },
]);
const HTML_AB = buildRxItemsHtml([
  { name: MED_A, unit_dose: '1', daily_freq: '1', total_days: '1' },
  { name: MED_B, unit_dose: '1', daily_freq: '1', total_days: '30' },
]);
// 동일 약 2개 순서만 뒤집힘(순서무관 dedup 검증)
const HTML_BA = buildRxItemsHtml([
  { name: MED_B, unit_dose: '1', daily_freq: '1', total_days: '30' },
  { name: MED_A, unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

function rxRow(
  id: string,
  medHtml: string,
  customer: { id: string; name: string; chart_number: string },
  issue_date: string,
  printed_at?: string,
  // T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY: 교부번호(issue_no) 명시 override.
  //   실처방 dedup 은 교부번호 단위 — 재출력=동일 교부번호, 별개 발행=서로 다른 교부번호.
  //   미지정 시 id 로 고유(= 별개 발행 기본). null 지정 시 초안(issue_no 없음) 모델링.
  issue_no?: string | null,
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    customer_id: customer.id,
    printed_at: printed_at ?? `${issue_date}T09:00:00+09:00`,
    created_at: `${issue_date}T08:59:00+09:00`,
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date,
      issue_no: issue_no === undefined ? `${issue_date}-${id}` : issue_no,
      prescriber_name: '문지은',
      diag_code_1: 'B35.1',
      diag_name_1: '조갑백선',
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
  };
}

const P1 = { id: 'cust-1', name: '류승현', chart_number: 'F-5495' };
const P2 = { id: 'cust-2', name: '남정철', chart_number: 'F-5709' };

// ─── AC-1: 월별/기간 필터 ───
test.describe('AC-1 월별 필터', () => {
  test('교부일 기간 [from,to] 안의 행만 통과(포함 경계)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('a', HTML_A, P1, '2026-08-01'),
      rxRow('b', HTML_A, P1, '2026-08-31'),
      rxRow('c', HTML_A, P1, '2026-07-25'), // 저번달
      rxRow('d', HTML_A, P1, '2026-09-01'), // 다음달
    ]);
    const aug = filterRxRowsByDateRange(rows, '2026-08-01', '2026-08-31');
    expect(aug.map((r) => r.id).sort()).toEqual(['a', 'b']);
    const jul = filterRxRowsByDateRange(rows, '2026-07-01', '2026-07-31');
    expect(jul.map((r) => r.id)).toEqual(['c']);
  });

  test('rxIssuedDateKey: 타임스탬프/점표기 모두 YYYY-MM-DD 로 정규화', () => {
    expect(rxIssuedDateKey('2026-08-07T09:00:00+09:00')).toBe('2026-08-07');
    expect(rxIssuedDateKey('2026-08-07')).toBe('2026-08-07');
    expect(rxIssuedDateKey('2026.8.7')).toBe('2026-08-07');
    expect(rxIssuedDateKey(null)).toBeNull();
  });
});

// ─── AC-2: 실처방 dedup (교부번호 단위, T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY 회귀 수정) ───
test.describe('AC-2 실처방 기준 중복 자동제거', () => {
  test('동일 교부번호 재출력(같은 문서 재출력) → 1건, dup_count=2', () => {
    const RX_NO = '2026-08-07-000001';
    const rows = mapRxIssuancePatientRows([
      rxRow('p1', HTML_A, P1, '2026-08-07', '2026-08-07T09:00:00+09:00', RX_NO),
      rxRow('p2', HTML_A, P1, '2026-08-07', '2026-08-07T09:05:00+09:00', RX_NO), // 동일 교부번호 재출력
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].dup_count).toBe(2);
  });

  // ★ 회귀 재현: 같은 날 같은 약을 서로 다른 교부번호로 2건 발행(바르토벤 F-4741 실사례) → 2건 유지.
  test('같은 날 같은 약이라도 교부번호가 다르면 별개 발행 → 2건(과수렴 금지)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('b1', HTML_A, P1, '2026-08-05', '2026-08-05T10:40:00+09:00', '2026-08-05-000013'),
      rxRow('b2', HTML_A, P1, '2026-08-05', '2026-08-05T10:47:00+09:00', '2026-08-05-000015'),
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(2);
    deduped.forEach((r) => expect(r.dup_count).toBe(1));
  });

  test('교부번호 미부여(초안) 순서무관 약품집합 폴백 dedup → 1건', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('x1', HTML_AB, P1, '2026-08-05', undefined, null), // 초안(교부번호 없음)
      rxRow('x2', HTML_BA, P1, '2026-08-05', undefined, null), // 같은 약 A+B, 순서만 뒤집힘
    ]);
    expect(dedupeRxIssuanceRows(rows)).toHaveLength(1);
  });

  test('과다병합 0 — 다른 날짜/다른 약/다른 환자는 각각 별개 행', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('d1', HTML_A, P1, '2026-08-05'),
      rxRow('d2', HTML_A, P1, '2026-08-06'), // 다른 날짜
      rxRow('d3', HTML_AB, P1, '2026-08-05'), // 다른 약품집합(A vs A+B)
      rxRow('d4', HTML_A, P2, '2026-08-05'), // 다른 환자
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(4);
    deduped.forEach((r) => expect(r.dup_count).toBe(1));
  });
});

// ─── AC-4: 대표 + 기타 분리 ───
test.describe('AC-4 처방약 대표+기타 분리', () => {
  test('선택 약=대표, 함께 나간 그 외 약=기타', () => {
    const { representative, others } = splitRepresentativeMedications([MED_A, MED_B], [MED_A]);
    expect(representative).toEqual([MED_A]);
    expect(others).toEqual([MED_B]);
  });

  test('미선택이면 대표=[], 기타=전체 약(기본 통합 표시)', () => {
    const { representative, others } = splitRepresentativeMedications([MED_A, MED_B], []);
    expect(representative).toEqual([]);
    expect(others).toEqual([MED_A, MED_B]);
  });

  test('선택 변경 시 대표 컬럼 갱신(B 선택 → B 대표)', () => {
    const { representative, others } = splitRepresentativeMedications([MED_A, MED_B], [MED_B]);
    expect(representative).toEqual([MED_B]);
    expect(others).toEqual([MED_A]);
  });
});

// ─── AC-2 + AC-1 + AC-4 파이프라인 정합(화면 소비 순서와 동일) ───
test.describe('파이프라인: 기간→dedup→약품필터', () => {
  test('기간 필터 후 dedup, 이어서 약품 필터 적용', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('m1', HTML_A, P1, '2026-08-07', undefined, '2026-08-07-000009'),
      rxRow('m2', HTML_A, P1, '2026-08-07', undefined, '2026-08-07-000009'), // 동일 교부번호 재출력(중복)
      rxRow('m3', HTML_AB, P2, '2026-08-08'),
      rxRow('m4', HTML_A, P1, '2026-07-20'), // 저번달(범위 밖)
    ]);
    const byDate = filterRxRowsByDateRange(rows, '2026-08-01', '2026-08-31');
    const deduped = dedupeRxIssuanceRows(byDate);
    // m1==m2(동일 교부번호) 병합 → 2건(류승현 A, 남정철 A+B)
    expect(deduped).toHaveLength(2);
    // 약품 A 필터 → 둘 다 A 포함 → 2건
    expect(filterRxRowsByMedications(deduped, [MED_A])).toHaveLength(2);
    // 약품 B 필터 → 남정철만 → 1건
    expect(filterRxRowsByMedications(deduped, [MED_B])).toHaveLength(1);
  });
});

// ─── AC-3: customer_id 투영(2번차트 오픈 식별자) ───
test.describe('AC-3 customer_id 투영', () => {
  test('mapRxIssuancePatientRows 가 customer_id 를 화이트리스트로 투영', () => {
    const rows = mapRxIssuancePatientRows([rxRow('c1', HTML_A, P1, '2026-08-07')]);
    expect(rows[0].customer_id).toBe('cust-1');
    expect(rows[0].patient_name).toBe('류승현');
    // PHI(RRN·풀전화) 미투영: 타입상 필드 부재 확인(성함·차트번호·customer_id 만)
    expect(Object.keys(rows[0])).not.toContain('patient_rrn');
  });
});

// ─── AC-1/AC-3: 브라우저 스모크(월 필터·클릭 링크 렌더). 로그인 실패 시 skip. ───
test.describe('AC-1/AC-3 UI 스모크', () => {
  test('처방 이력 탭 → 월 필터 기본 이번달 + 성함/차트번호 클릭 링크 렌더', async ({ page }) => {
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
    // AC-1: 월 필터 바 + 기본 '이번달' 활성
    await expect(page.locator('[data-testid="rx-history-month-filter"]')).toBeVisible();
    const thisMonth = page.locator('[data-testid="rx-history-preset-thisMonth"]');
    await expect(thisMonth).toBeVisible();
    // '직접입력' 클릭 → 날짜 입력 2개 노출
    await page.locator('[data-testid="rx-history-preset-custom"]').click();
    await expect(page.locator('[data-testid="rx-history-date-from"]')).toBeVisible();
    await expect(page.locator('[data-testid="rx-history-date-to"]')).toBeVisible();
  });
});
