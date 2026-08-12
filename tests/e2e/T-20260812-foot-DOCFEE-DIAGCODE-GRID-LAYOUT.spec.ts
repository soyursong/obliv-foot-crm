/**
 * E2E spec — T-20260812-foot-DOCFEE-DIAGCODE-GRID-LAYOUT
 * 진료비 세부내역서(bill_detail) [상병코드] 표기를 .diag-line(텍스트 한 줄 나열) → 칸(그리드/테이블) 레이아웃으로 재작업.
 *   (김주연 총괄 재요청, C0ATE5P6JTH thread 1786497795.379579 · before 근거 F0BPR1WGZHS)
 *
 * 부모 T-20260812-foot-DOCFEE-DIAGCODE-ADD 의 텍스트 한 줄 표기가 '성의없다' → 각 상병코드를 한 행씩 분리, 코드/명칭 칼럼 정렬.
 * policy_superseded: 부모가 금지했던 상병 '표(diag-grid)' 를 reporter 명시 재요청으로 복원(동일 인물·동일 축 3차 재정의).
 *
 * ★6FIX AC-D 표 삭제 원인(DOCPRINT-DIAGCODE-OVERFLOW-2PAGE: A4 landscape 세로 4행 → 2페이지 오버플로) 재발 방지:
 *   compact CSS(.diag-grid 8pt) + 빈 코드 행 diag_row_3/4_style=display:none 숨김 + @media print overflow:hidden 클립.
 *
 * 데이터 소스(신규 write 0): 결제 미니창 ② 차트 코드 zone 선택·저장 상병코드 = service_charges 상병 → check_in_services
 *   폴백(PATH-4). diag_code_N/diag_name_N/diag_row_N_style 토큰이 이미 전 렌더 경로에서 채워짐(db_change=false).
 *
 * AC1: 상병코드가 칸(그리드/테이블)으로 표기 — 각 상병코드 한 행 분리, 코드/명칭 칼럼 정렬.
 * AC2: 상병 미선택 시 빈 표 graceful(에러/리터럴 토큰 없음).
 * AC3: 실제 발급(bindHtmlTemplate 렌더)에도 동일 반영.
 * AC4: 계산서·영수증·금액/계산 로직 무접촉.
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 첨부 스크린샷 ② 차트 코드 zone 상병코드 3건 (사마귀피부염 B430 / 체부백선 B354 / 발백선 B353)
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
  v.diag_row_3_style = 'display:none';
  v.diag_row_4_style = 'display:none';
  return v;
};

// 상병 4건(복수 상한) — 전부 표기·잘림 없음 확인용
const with4 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_4: 'K297', diag_name_4: '상세불명의 위염',
  diag_row_4_style: '',
});

/** bill_detail 내 [상병코드] 그리드(table.diag-grid) 블록만 추출. */
function extractDiagGrid(html: string): string {
  const anchor = html.indexOf('class="diag-grid"');
  expect(anchor).toBeGreaterThan(-1);
  const tblStart = html.lastIndexOf('<table', anchor);
  const tblEnd = html.indexOf('</table>', anchor);
  expect(tblEnd).toBeGreaterThan(tblStart);
  return html.slice(tblStart, tblEnd + '</table>'.length);
}

/** 그리드 <tbody> 안 렌더되는(=display:none 아닌) <tr> 개수. */
function visibleRowCount(gridHtml: string): number {
  const tbody = gridHtml.slice(gridHtml.indexOf('<tbody'), gridHtml.indexOf('</tbody>'));
  const rows = tbody.match(/<tr\b[^>]*>/g) ?? [];
  return rows.filter((tr) => !/display\s*:\s*none/.test(tr)).length;
}

// ── AC1: [상병코드]가 칸(그리드/테이블)으로 표기 ─────────────────────────────────
test('AC1 세부내역서 [상병코드] = 칸(table.diag-grid) — 코드/명칭 칼럼 헤더 포함', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  const grid = extractDiagGrid(html);
  expect(grid).toContain('상병코드'); // 코드 칼럼 헤더
  expect(grid).toContain('상병명');   // 명칭 칼럼 헤더
});

test('AC1 각 상병코드가 한 행씩 분리 — 코드/명칭 칼럼 정렬 (선택 3건 → 3행 렌더)', () => {
  const grid = extractDiagGrid(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues()));
  // 선택 3건 → 렌더 행 3(빈 4행은 display:none 숨김)
  expect(visibleRowCount(grid)).toBe(3);
  // 각 코드·명칭이 동일 그리드 안에 존재
  for (const [code, name] of [['B430', '사마귀피부염'], ['B354', '체부백선'], ['B353', '발백선']]) {
    expect(grid).toContain(code);
    expect(grid).toContain(name);
  }
});

test('AC1/AC3 미치환 리터럴 토큰 없음 (실 발급 렌더 정합)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── AC2: 상병 미선택 → 빈 표 graceful (에러·리터럴 토큰·행 노출 없음) ──────────────
test('AC2 상병 미선택 고객 — 빈 표 graceful (헤더 유지·리터럴 토큰 미노출·코드행 미노출)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, withNone());
  const grid = extractDiagGrid(html);
  expect(grid).toContain('상병코드');            // 칼럼 헤더 유지
  expect(html).not.toContain('{{diag_code_1}}'); // 리터럴 토큰 미노출
  expect(grid).not.toContain('B430');
});

// ── 6FIX AC-D 오버플로 재발 방지: 빈 행 숨김 (상병 1~2건 시 실제 행만 렌더) ──────────
test('AC3(오버플로 가드) 빈 코드 행은 display:none 로 숨김 — 상병 3건 시 4번째 행 미렌더', () => {
  const grid = extractDiagGrid(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues()));
  expect(grid).toContain('display:none'); // 4번째 빈 행 숨김
  expect(visibleRowCount(grid)).toBe(3);
});

// ── 복수 상병(4건) 전부 표기 (각 행 분리, 잘림·누락 없음) ─────────────────────────
test('AC1 복수 상병 4건 — 4행 전부 표기(각 행 분리, 잘림·누락 없음)', () => {
  const grid = extractDiagGrid(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, with4()));
  expect(visibleRowCount(grid)).toBe(4);
  ['B430', 'B354', 'B353', 'K297'].forEach((c) => expect(grid).toContain(c));
});

// ── AC4: 금액·진료비 산정·합계 영역 무접촉 (읽기만) ───────────────────────────────
test('AC4 금액·진료비 산정·합계·계산서/영수증 로직 무접촉 (종전과 동일)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('끝처리 조정금액');
  expect(html).toContain('5,280');   // detail_subtotal / copayment / total
  expect(html).toContain('12,330');  // subtotal_fund (공단부담금 표시 유지)
});

// ── 단일 소스 정합: 소견서/진단서와 동일 상병 토큰 ────────────────────────────────
test('AC1 상병 토큰 단일 소스 정합 — 소견서/진단서와 동일 값', () => {
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
