/**
 * E2E spec — T-20260724-foot-DOCPRINT-DIAGCODE-OVERFLOW-2PAGE
 * 진료비 세부산정내역(bill_detail) 서류: 상병코드 다건 시 세로 4행 나열이 A4 landscape 1페이지 박스(175mm)를
 * 넘겨 진료비 내역표·서명란을 2페이지로 밀던 오버플로우를 해소.
 * reporter=이은상 팀장(풋센터). 순수 인쇄 레이아웃(print CSS/렌더 구조) 한정 — 데이터/토큰 무접점.
 *
 * 수정: 상병 표시를 4행 세로 → 2열(2 entries/row) 컴팩트 그리드로 재배치.
 *   가로(272mm) 폭 여유를 활용해 상병 4건도 최대 2 물리행으로 수용 → 세로 높이 절반 → 1페이지 내 완결.
 *   diag_code_N/diag_name_N 토큰·소스·개수(≤4)·행 가시성(diag_row_3_style) 규칙 불변.
 *
 * AC-1/1′: 상병 2/3/4건 각각에서 상병 섹션이 최대 2 물리행으로 렌더(세로높이 축소) → 오버플로우 트리거 제거.
 * AC-2′  : 2열 배치(택1 옵션 채택) — 헤더 '연번' 2회·상병 1·2가 동일 물리행에 공존.
 * AC-3/3′: 상병 1건·0건(공란) 케이스 회귀 0 (기존 빈칸 패턴·항목/합계 유지).
 * AC-4   : 인접 티켓(PAYDETAIL-DIAGCODE-SHOW)이 출력하는 상병 토큰 내용 회귀 0 (레이아웃만 변경).
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const baseBillValues = (): Record<string, string> => ({
  record_no: 'C-0001',
  patient_name: '테스트환자',
  patient_rrn: 'DUMMY-RRN-MASKED',
  visit_date: '2026-07-24',
  clinic_code: 'X12345678',
  issue_date: '2026-07-24',
  hira_institution_name: '오블리브 풋케어의원 종로점',
  receipt_representative: '박영진',
  institution_seal_html: '(인)',
  items_html: '<tr><td>진찰료</td><td>2026-07-24</td><td>AA154</td><td>초진진찰료</td><td class="num-cell">17,610</td><td>1</td><td>1</td><td class="num-cell">17,610</td><td class="num-cell">5,280</td><td class="num-cell">12,330</td><td class="num-cell">0</td><td class="num-cell">0</td></tr>',
  detail_subtotal: '5,280',
  subtotal_copayment: '5,280',
  subtotal_fund: '12,330',
  subtotal_noncovered: '0',
  detail_rounding: '0',
  detail_total: '5,280',
  // 현장 재현 상병 5건 중 템플릿 수용치(≤4) — 소스/개수 불변
  diag_code_1: 'F47.90',
  diag_name_1: '상세불명의 발 질환',
  diag_code_2: 'K29.7',
  diag_name_2: '위염',
  diag_code_3: 'B35.3',
  diag_name_3: '족부 백선',
  diag_code_4: 'B35.1',
  diag_name_4: '수부 백선',
  diag_row_3_style: '',
  diag_row_4_style: '',
  diag_extra_codes_html: '',
});

const with3 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_4: '',
  diag_name_4: '',
  diag_row_4_style: 'display:none',
});

const with2 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_3: '', diag_name_3: '',
  diag_code_4: '', diag_name_4: '',
  diag_row_3_style: 'display:none',
  diag_row_4_style: 'display:none',
});

const with1 = (): Record<string, string> => {
  const v = with2();
  v.diag_code_2 = ''; v.diag_name_2 = '';
  return v;
};

const withNone = (): Record<string, string> => {
  const v = baseBillValues();
  ['1', '2', '3', '4'].forEach((n) => {
    delete v[`diag_code_${n}`];
    delete v[`diag_name_${n}`];
  });
  v.diag_row_3_style = 'display:none';
  v.diag_row_4_style = 'display:none';
  return v;
};

/** bill_detail 내 상병 2열 그리드(table.diag-grid) 블록만 추출. */
function extractDiagGrid(html: string): string {
  const start = html.indexOf('class="diag-grid"');
  expect(start).toBeGreaterThan(-1);
  const tableStart = html.lastIndexOf('<table', start);
  const tableEnd = html.indexOf('</table>', start);
  expect(tableEnd).toBeGreaterThan(tableStart);
  return html.slice(tableStart, tableEnd + '</table>'.length);
}

/** tbody 안의 물리 데이터행 <tr> 개수. */
function bodyRowCount(gridHtml: string): number {
  const body = gridHtml.slice(gridHtml.indexOf('<tbody>'), gridHtml.indexOf('</tbody>'));
  return (body.match(/<tr/g) || []).length;
}

// ── AC-2′: 2열 배치 채택 (오버플로우 해소의 핵심 레이아웃 불변식) ──────────────
test('AC-2′ 상병 섹션이 2열 그리드 — 헤더 연번 2회·상병1·2가 동일 물리행', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, baseBillValues());
  const grid = extractDiagGrid(html);
  // 2열 헤더: '연번' 헤더가 두 번(좌/우 컬럼)
  expect((grid.match(/연번/g) || []).length).toBe(2);
  // 상병 1·2가 같은 물리행(첫 tbody <tr>)에 공존 → 세로 소비 절반
  const body = grid.slice(grid.indexOf('<tbody>'), grid.indexOf('</tbody>'));
  const firstRow = body.slice(body.indexOf('<tr'), body.indexOf('</tr>'));
  expect(firstRow).toContain('F47.90');
  expect(firstRow).toContain('K29.7');
});

// ── AC-1/1′: 상병 다건이어도 최대 2 물리행 (세로높이 축소 → 1페이지 유지) ──────
test('AC-1′ 상병 4건 — tbody 물리행 2개 이하(세로 높이 절반)', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const grid = extractDiagGrid(bindHtmlTemplate(tpl, baseBillValues()));
  expect(bodyRowCount(grid)).toBeLessThanOrEqual(2);
  // 4건 모두 노출
  ['F47.90', 'K29.7', 'B35.3', 'B35.1'].forEach((c) =>
    expect(grid).toContain(c),
  );
});

test('AC-1 상병 3건 — 2번째 물리행 노출(diag_row_3_style) + 3건 노출', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const grid = extractDiagGrid(bindHtmlTemplate(tpl, with3()));
  expect(bodyRowCount(grid)).toBeLessThanOrEqual(2);
  ['F47.90', 'K29.7', 'B35.3'].forEach((c) => expect(grid).toContain(c));
});

test('AC-1 상병 2건 — 2번째 물리행 숨김(display:none) + 2건 노출', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const grid = extractDiagGrid(bindHtmlTemplate(tpl, with2()));
  expect(grid).toContain('display:none'); // 2번째 물리행(연번 3·4) 숨김
  expect(grid).toContain('F47.90');
  expect(grid).toContain('K29.7');
  expect(grid).not.toContain('B35.3');
});

// ── AC-3/3′: 소수/공란 회귀 0 ────────────────────────────────────────────────
test('AC-3 상병 1건 — 기존 빈칸 패턴 유지, 미치환 토큰 없음', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, with1());
  expect(html).toContain('F47.90');
  expect(html).not.toContain('K29.7');
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

test('AC-3′ 상병 0건 — 공란 안전, 헤더 유지·리터럴 토큰 미노출', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, withNone());
  expect(html).toContain('상병코드');
  expect(html).toContain('상병명');
  expect(html).not.toContain('{{diag_code_1}}');
  expect(html).not.toContain('F47.90');
});

// ── AC-3: 다른 표·합계 회귀 0 (레이아웃 변경이 인접 섹션 무영향) ────────────────
test('AC-3 기존 세부산정내역 항목·합계·요양기관 유지 (회귀 0)', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, baseBillValues());
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('X12345678');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('끝처리 조정금액');
  expect(html).toContain('5,280');
  expect(html).toContain('12,330');
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── AC-4: 인접 티켓 상병 토큰 내용 회귀 0 (동일 소스·동일 값) ──────────────────
test('AC-4 상병 토큰 내용 = PAYDETAIL-DIAGCODE-SHOW 소스 유지 (레이아웃만 변경)', () => {
  const values = baseBillValues();
  const bill = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  // 소견서/진단서와 동일 토큰 → 동일 값이 함께 등장(단일 원천 정합 불변)
  for (const formKey of ['diagnosis', 'diag_opinion']) {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) continue;
    const doc = bindHtmlTemplate(tpl, values);
    for (const token of ['F47.90', 'K29.7', 'B35.3']) {
      expect(bill.includes(token)).toBe(true);
      expect(doc.includes(token)).toBe(true);
    }
  }
});
