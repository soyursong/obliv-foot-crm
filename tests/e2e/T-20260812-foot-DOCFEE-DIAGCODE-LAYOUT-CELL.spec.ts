/**
 * E2E spec — T-20260812-foot-DOCFEE-DIAGCODE-LAYOUT-CELL
 * 진료비 세부내역서(bill_detail) [상병코드] 줄을 표 구조와 어울리는
 *   '테두리 칸(bordered cell) 1개 + 한 줄(single row)'로 시각 정돈.
 *   (김주연 총괄 재요청, C0ATE5P6JTH thread 1786497795.379579 · before 근거 F0BPR1WGZHS)
 *
 * 부모 T-20260812-foot-DOCFEE-DIAGCODE-ADD 의 상병코드 표기가 '성의없다' → 라벨 칸(상병코드) + 내용 칸 1개짜리
 *   단일 행(single row)으로, 복수 상병코드는 내용 칸 안에 inline 나열. 데이터/값/순서 불변(순수 레이아웃 refine).
 *
 * ★★회귀 가드(부모 계승, AC6): 6FIX AC-D(DOCPRINT-DIAGCODE-OVERFLOW-2PAGE: A4 landscape 세로 4행 → 2페이지 오버플로) 가
 *   삭제한 상병 '다행 표(diag-grid)'를 blind 복원하지 않는다. 직전 GRID-LAYOUT(diag-grid 4행) 착지를
 *   '테두리 칸 1개 + 한 줄'로 교정 → 항상 1행 높이(세로 확장 없음, 오버플로 위험 부재).
 *
 * 데이터 소스(신규 write 0): 결제 미니창 선택·저장 상병코드 = service_charges 상병 → check_in_services 폴백.
 *   diag_code_N/diag_name_N 토큰이 이미 전 렌더 경로에서 채워짐(db_change=false, 순수 렌더).
 *
 * AC1: 상병코드가 테두리 칸(table.diag-cell) 안에 한 줄(single row)로 표기.
 * AC2: 상병코드 내용·값·순서 불변.
 * AC3: 금액/계산/항목 테이블·계산서·영수증 로직 무접촉.
 * AC4: 상병 미선택 고객 = 빈 칸 graceful(에러/리터럴 토큰 없음).
 * AC5: 실제 발급(bindHtmlTemplate 렌더)에도 동일 반영.
 * AC6: 다행 표(diag-grid) 재도입 안 함 — class="diag-grid" 테이블 부재.
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 첨부 스크린샷 상병코드 3건 (사마귀피부염 B430 / 체부백선 B354 / 발백선 B353)
const baseBillValues = (): Record<string, string> => ({
  record_no: 'F-6100',
  patient_name: '양성기',
  patient_rrn: 'DUMMY-RRN-MASKED',
  visit_date: '2026-08-12',
  clinic_code: 'X12345678',
  issue_date: '2026-08-12',
  hira_institution_name: '오블리브 풋케어의원 종로점',
  receipt_representative: '박영진',
  institution_seal_html: '(인)',
  items_html:
    '<tr><td>진찰료</td><td>2026-08-12</td><td>AA154</td><td>초진진찰료</td><td class="num-cell">17,610</td><td>1</td><td>1</td><td class="num-cell">17,610</td><td class="num-cell">5,280</td><td class="num-cell">12,330</td><td class="num-cell">0</td><td class="num-cell">0</td></tr>',
  detail_subtotal: '5,280',
  subtotal_copayment: '5,280',
  subtotal_fund: '12,330',
  subtotal_noncovered: '0',
  detail_rounding: '0',
  detail_total: '5,280',
  diag_code_1: 'B430', diag_name_1: '사마귀피부염',
  diag_code_2: 'B354', diag_name_2: '체부백선',
  diag_code_3: 'B353', diag_name_3: '발백선',
  diag_code_4: '', diag_name_4: '',
  diag_row_3_style: '',
  diag_row_4_style: 'display:none',
  diag_extra_codes_html: '',
});

const withNone = (): Record<string, string> => {
  const v = baseBillValues();
  ['1', '2', '3', '4'].forEach((n) => {
    v[`diag_code_${n}`] = '';
    v[`diag_name_${n}`] = '';
  });
  return v;
};

// 상병 4건(복수 상한) — 전부 한 칸/한 줄에 inline 표기 확인용
const with4 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_4: 'K297', diag_name_4: '상세불명의 위염',
  diag_row_4_style: '',
});

/** bill_detail 내 [상병코드] 칸(table.diag-cell) 블록만 추출. */
function extractDiagCell(html: string): string {
  const tblStart = html.indexOf('<table class="diag-cell"');
  expect(tblStart).toBeGreaterThan(-1);
  const tblEnd = html.indexOf('</table>', tblStart);
  expect(tblEnd).toBeGreaterThan(tblStart);
  return html.slice(tblStart, tblEnd + '</table>'.length);
}

/** 칸 <tbody> 안 <tr> 개수 (단일 행 = 1 이어야 함). */
function rowCount(cellHtml: string): number {
  const rows = cellHtml.match(/<tr\b[^>]*>/g) ?? [];
  return rows.length;
}

// ── AC1: [상병코드]가 테두리 칸(table.diag-cell) 안에 한 줄로 표기 ─────────────────
test('AC1 세부내역서 [상병코드] = 테두리 칸(table.diag-cell) + 라벨 셀 포함', () => {
  const cell = extractDiagCell(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues()));
  expect(cell).toContain('상병코드'); // 라벨 셀
});

test('AC1 상병코드 줄이 단일 행(single row) — <tr> 정확히 1개', () => {
  const cell = extractDiagCell(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues()));
  expect(rowCount(cell)).toBe(1);
});

test('AC1/AC2 선택 상병코드 3건이 동일 칸 안에 inline 나열 (값·순서 보존)', () => {
  const cell = extractDiagCell(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues()));
  for (const [code, name] of [['B430', '사마귀피부염'], ['B354', '체부백선'], ['B353', '발백선']]) {
    expect(cell).toContain(code);
    expect(cell).toContain(name);
  }
  // 순서 보존: B430 → B354 → B353
  expect(cell.indexOf('B430')).toBeLessThan(cell.indexOf('B354'));
  expect(cell.indexOf('B354')).toBeLessThan(cell.indexOf('B353'));
});

// ── AC6: 다행 표(diag-grid) 재도입 안 함 (회귀 가드) ───────────────────────────────
test('AC6 회귀 가드 — class="diag-grid" 테이블 부재(다행 표 재도입 금지)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).not.toContain('<table class="diag-grid"');
});

// ── AC5: 실 발급 렌더 정합 (미치환 리터럴 토큰 없음) ──────────────────────────────
test('AC5 미치환 리터럴 토큰 없음 (실 발급 렌더 정합)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── AC4: 상병 미선택 → 빈 칸 graceful (에러·리터럴 토큰 없음, 칸/라벨 유지) ──────────
test('AC4 상병 미선택 고객 — 빈 칸 graceful (라벨 유지·리터럴 토큰 미노출·코드 미노출)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, withNone());
  const cell = extractDiagCell(html);
  expect(cell).toContain('상병코드');            // 라벨 유지
  expect(rowCount(cell)).toBe(1);                // 단일 행 유지
  expect(html).not.toContain('{{diag_code_1}}'); // 리터럴 토큰 미노출
  expect(cell).not.toContain('B430');
});

// ── 복수 상병(4건) 전부 한 칸/한 줄에 표기 (누락 없음) ───────────────────────────
test('AC1 복수 상병 4건 — 한 칸/한 줄 inline 전부 표기(누락 없음, 여전히 단일 행)', () => {
  const cell = extractDiagCell(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, with4()));
  expect(rowCount(cell)).toBe(1);
  ['B430', 'B354', 'B353', 'K297'].forEach((c) => expect(cell).toContain(c));
});

// ── AC3: 금액·진료비 산정·합계 영역 무접촉 (읽기만) ───────────────────────────────
test('AC3 금액·진료비 산정·합계·계산서/영수증 로직 무접촉 (종전과 동일)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('5,280');   // detail_subtotal / copayment / total
  expect(html).toContain('12,330');  // subtotal_fund (공단부담금 표시 유지)
});

// ── 단일 소스 정합: 소견서/진단서와 동일 상병 토큰 ────────────────────────────────
test('AC2 상병 토큰 단일 소스 정합 — 소견서/진단서와 동일 값', () => {
  const values = baseBillValues();
  const bill = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  for (const formKey of ['diagnosis', 'diag_opinion']) {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) continue;
    const doc = bindHtmlTemplate(tpl, values);
    for (const token of ['B430', 'B354', 'B353']) {
      expect(bill.includes(token)).toBe(true);
      expect(doc.includes(token)).toBe(true);
    }
  }
});
