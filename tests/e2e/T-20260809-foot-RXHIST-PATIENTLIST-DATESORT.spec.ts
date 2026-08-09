/**
 * E2E — T-20260809-foot-RXHIST-PATIENTLIST-DATESORT
 * 치료테이블 > 처방이력 > 환자목록 처방일자(교부일) 내림차순(최신순) 정렬.
 *
 * canonical SSOT = form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts).
 *   RXHISTORY-TAB-4IMPROVE / BARTOVEN-QTY2-DEDUP(deployed) 계승. read-side 정렬만 — DB 스키마 변경 0(db_change=false).
 *
 * AC-1(확정): 최종 표시 배열을 처방일자(issued_at 날짜 파트) 내림차순으로 명시 재정렬(sortRxRowsByIssuedDateDesc).
 *   조회 .order 는 printed_at 축·dedup 은 Map 삽입순 → 화면 '일자'(issued_at)와 불일치 가능 → 표시 축으로 재정렬.
 * AC-2: 동일 처방일자 2차 정렬 = 기존 순서 보존(안정 정렬, 새 기준 임의 도입 0).
 * AC-3: 필터/집계/컬럼 무변경, 행 누락·중복 0(정렬 전후 id 집합 동일).
 * AC(엣지): 0건 → 빈 배열 안전 / issued_at 파싱불가 → 맨 뒤.
 *
 * ★ 정렬 로직은 라이브 비의존 결정적 스펙으로 검증. 탭·목록 렌더는 브라우저 스모크(로그인 실패 시 skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  dedupeRxIssuanceRows,
  filterRxRowsByDateRange,
  sortRxRowsByIssuedDateDesc,
  rxIssuedDateKey,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { loginAndWaitForDashboard } from '../helpers';

const MED_A = '바르토벤외용액(4mL)';
const HTML_A = buildRxItemsHtml([
  { name: MED_A, unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

function rxRow(
  id: string,
  customer: { id: string; name: string; chart_number: string },
  issue_date: string | null,
  printed_at?: string,
  issue_no?: string | null,
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    customer_id: customer.id,
    printed_at: printed_at ?? (issue_date ? `${issue_date}T09:00:00+09:00` : null),
    created_at: issue_date ? `${issue_date}T08:59:00+09:00` : null,
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date: issue_date ?? undefined,
      issue_no: issue_no === undefined ? `${issue_date}-${id}` : issue_no,
      prescriber_name: '문지은',
      diag_code_1: 'B35.1',
      diag_name_1: '조갑백선',
      rx_items_html: HTML_A,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
  };
}

const P1 = { id: 'cust-1', name: '류승현', chart_number: 'F-5495' };
const P2 = { id: 'cust-2', name: '남정철', chart_number: 'F-5709' };
const P3 = { id: 'cust-3', name: '오세훈', chart_number: 'F-5810' };

// ─── AC-1: 처방일자 내림차순(최신순) ───
test.describe('AC-1 처방일자 내림차순 정렬', () => {
  test('뒤섞인 입력 → 처방일자(교부일) 최신순으로 재정렬', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('a', P1, '2026-08-03'),
      rxRow('b', P2, '2026-08-09'),
      rxRow('c', P3, '2026-08-01'),
      rxRow('d', P1, '2026-08-07'),
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    expect(sorted.map((r) => rxIssuedDateKey(r.issued_at))).toEqual([
      '2026-08-09',
      '2026-08-07',
      '2026-08-03',
      '2026-08-01',
    ]);
  });

  test('화면 표시 축(issued_at)과 조회 축(printed_at) 불일치해도 표시 축 기준 정렬', () => {
    // printed_at 은 역순으로 들어와도(조회 .order 모사) 화면 일자(issue_date) 기준으로 정렬돼야 함.
    const rows = mapRxIssuancePatientRows([
      rxRow('older-issue', P1, '2026-08-02', '2026-08-09T09:00:00+09:00'), // 늦게 출력, 교부일은 과거
      rxRow('newer-issue', P2, '2026-08-08', '2026-08-03T09:00:00+09:00'), // 먼저 출력, 교부일은 최신
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    expect(sorted.map((r) => r.id)).toEqual(['newer-issue', 'older-issue']);
  });
});

// ─── AC-2: 동일 처방일자 2차 정렬 = 기존 순서 보존(안정 정렬) ───
test.describe('AC-2 동일 일자 기존 순서 보존', () => {
  test('같은 날짜 다건 → 입력 순서 그대로 유지(새 2차 기준 미도입)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('s1', P1, '2026-08-05'),
      rxRow('s2', P2, '2026-08-05'),
      rxRow('s3', P3, '2026-08-05'),
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    // 동일 일자 → comparator 0 → 안정 정렬로 입력 순서(s1,s2,s3) 보존.
    expect(sorted.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
  });

  test('여러 날짜 혼재 — 날짜 그룹은 내림차순, 그룹 내부는 기존 순서', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('d1-b', P2, '2026-08-05'),
      rxRow('d2-a', P1, '2026-08-08'),
      rxRow('d1-a', P1, '2026-08-05'),
      rxRow('d2-b', P2, '2026-08-08'),
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    // 08-08 그룹(입력순 d2-a, d2-b) → 08-05 그룹(입력순 d1-b, d1-a)
    expect(sorted.map((r) => r.id)).toEqual(['d2-a', 'd2-b', 'd1-b', 'd1-a']);
  });
});

// ─── AC-3: 정렬은 read-side 파생만 — 행 누락·중복 0 ───
test.describe('AC-3 무손실(누락·중복 0)', () => {
  test('정렬 전후 id 집합 동일(행 개수·구성 불변)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('x1', P1, '2026-08-03'),
      rxRow('x2', P2, '2026-08-09'),
      rxRow('x3', P3, '2026-08-05'),
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    expect(sorted).toHaveLength(rows.length);
    expect(sorted.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  test('dedup 결과의 dup_count/member_ids 보존(정렬 후에도 유지)', () => {
    const RX_NO = '2026-08-07-000001';
    const rows = mapRxIssuancePatientRows([
      rxRow('p1', P1, '2026-08-07', '2026-08-07T09:00:00+09:00', RX_NO),
      rxRow('p2', P1, '2026-08-07', '2026-08-07T09:05:00+09:00', RX_NO), // 동일 교부번호 재출력
      rxRow('p3', P2, '2026-08-09'),
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    const sorted = sortRxRowsByIssuedDateDesc(deduped);
    expect(sorted.map((r) => r.id)).toEqual(['p3', 'p1']); // 08-09 먼저, 08-07 다음
    const merged = sorted.find((r) => r.id === 'p1');
    expect(merged?.dup_count).toBe(2);
    expect(merged?.member_ids.sort()).toEqual(['p1', 'p2']);
  });
});

// ─── 엣지 케이스 ───
test.describe('엣지 케이스', () => {
  test('0건/빈 입력 → 빈 배열(에러 없음)', () => {
    expect(sortRxRowsByIssuedDateDesc([])).toEqual([]);
    expect(sortRxRowsByIssuedDateDesc(null)).toEqual([]);
    expect(sortRxRowsByIssuedDateDesc(undefined)).toEqual([]);
  });

  test('issued_at 파싱 불가 행은 최신순 목록 맨 뒤로', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('null-date', P1, null, undefined, null), // issue_date/printed_at/created_at 모두 null
      rxRow('has-date', P2, '2026-08-05'),
    ]);
    const sorted = sortRxRowsByIssuedDateDesc(rows);
    expect(sorted[0].id).toBe('has-date');
    expect(sorted[sorted.length - 1].id).toBe('null-date');
  });
});

// ─── 파이프라인 정합(화면 소비 순서와 동일: 기간→dedup→정렬) ───
test.describe('파이프라인: 기간→dedup→정렬', () => {
  test('기간 필터 + dedup 후 처방일자 내림차순으로 최종 표시', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('m1', P1, '2026-08-02'),
      rxRow('m2', P2, '2026-08-09'),
      rxRow('m3', P3, '2026-08-05'),
      rxRow('m4', P1, '2026-07-20'), // 범위 밖(저번달)
    ]);
    const byDate = filterRxRowsByDateRange(rows, '2026-08-01', '2026-08-31');
    const deduped = dedupeRxIssuanceRows(byDate);
    const sorted = sortRxRowsByIssuedDateDesc(deduped);
    expect(sorted.map((r) => r.id)).toEqual(['m2', 'm3', 'm1']); // 09 > 05 > 02, 07-20 제외
  });
});

// ─── 브라우저 스모크: 처방이력 탭 목록이 처방일자 내림차순 렌더. 로그인 실패 시 skip. ───
test.describe('UI 스모크: 환자목록 일자 내림차순 렌더', () => {
  test('처방 이력 탭 → 일자 컬럼이 위→아래 최신순', async ({ page }) => {
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

    // 목록이 비어있으면(해당 기간 처방 0건) 정렬 검증 불가 → 스모크 통과(빈 목록 안전 표시).
    const empty = page.locator('[data-testid="rx-history-empty"]');
    const rowLoc = page.locator('[data-testid="rx-history-row"]');
    await Promise.race([
      empty.waitFor({ timeout: 8_000 }).catch(() => {}),
      rowLoc.first().waitFor({ timeout: 8_000 }).catch(() => {}),
    ]);
    const rowCount = await rowLoc.count();
    if (rowCount < 2) {
      test.skip(true, '정렬 비교에 필요한 최소 2행 미만(라이브 데이터 의존)');
      return;
    }

    // 각 행 첫 셀(일자, formatDateDots = 'YYYY.MM.DD') 텍스트 수집 → 내림차순인지 검증.
    const dateTexts: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const firstCell = rowLoc.nth(i).locator('td').first();
      const raw = (await firstCell.innerText()).trim();
      const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(raw);
      if (m) dateTexts.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    }
    // 수집된 날짜가 비감소가 아닌 '비증가(내림차순)'인지 확인.
    for (let i = 1; i < dateTexts.length; i++) {
      expect(dateTexts[i - 1] >= dateTexts[i]).toBeTruthy();
    }
  });
});
