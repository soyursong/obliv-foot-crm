/**
 * E2E spec — T-20260812-foot-DOCFEE-DIAGCODE-ADD
 *   (responder triage alias: T-20260812-foot-SUSU-DETAIL-SANGBYEONG-CODE-INSERT)
 * 진료비 세부내역서(bill_detail) 서류에 [상병코드]를 **별도 한 줄**로 삽입 (김주연 총괄 요청, 첨부 20260812_102243.png).
 *
 * ★★ planner 명시 제약(policy_superseded): T-20260731 AC-D 가 삭제한 상병 '표(diag-grid table)' 를 blind 복원 금지.
 *    요청 형태 = '결제 미니창 선택 상병코드 별도 줄' → .diag-line 한 줄(코드+상병명 inline)로만 착지. 표 구조 재도입 금지.
 *
 * 데이터 소스(신규 write 0): 결제 미니창 ② 차트 코드 zone 선택·저장 상병코드 = service_charges 상병 → check_in_services
 *   폴백(PATH-4). diag_code_N/diag_name_N 토큰이 이미 전 렌더 경로에서 채워짐 → 순수 서류 렌더 변경(금액/계산 무접촉).
 *
 * 첨부 스크린샷(20260812_102243.png) ② 차트 코드 zone 실측 상병 3건: 사마귀피부염 B430 / 체부백선 B354 / 발백선 B353.
 *
 * AC1: 세부내역서에 결제 미니창 선택 상병코드가 별도 줄로 표기.
 * AC2: 상병코드 미선택 시 빈 줄 graceful(에러/리터럴 토큰 없음).
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
  return v;
};

// 상병 4건(복수 상한) — 전부 표기·잘림 없음 확인용
const with4 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_4: 'K297', diag_name_4: '상세불명의 위염',
});

/** bill_detail 내 [상병코드] 별도 줄(.diag-line) 블록만 추출. */
function extractDiagLine(html: string): string {
  const start = html.indexOf('class="diag-line"');
  expect(start).toBeGreaterThan(-1);
  const divStart = html.lastIndexOf('<div', start);
  const divEnd = html.indexOf('</div>', start);
  expect(divEnd).toBeGreaterThan(divStart);
  return html.slice(divStart, divEnd + '</div>'.length);
}

// ── AC1: [상병코드]가 별도 '한 줄'로 표기 (표 아님) ────────────────────────────
test('AC1 세부내역서에 [상병코드] 별도 줄(.diag-line) — 라벨 "상병코드" 포함', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  const line = extractDiagLine(html);
  expect(line).toContain('상병코드');
});

// ── planner 제약 회귀가드: 삭제된 상병 '표(diag-grid)' blind 복원 금지 ───────────
test('AC1(제약) 상병 표(diag-grid) 재도입 안 함 — 별도 줄 형태만 (blind 복원 금지)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  // 삭제된 2열 그리드 표의 실제 렌더 지문(table.diag-grid·'연번' 헤더 셀)이 재등장하지 않아야 함
  // (주석 문자열은 무시하고 실 마크업 요소만 검사 — blind 복원 방지)
  expect(html).not.toContain('class="diag-grid"');
  expect(html).not.toContain('<th>연번</th>');
});

test('AC1/AC3 선택된 상병코드 값(첨부 ② 차트 코드 zone)이 별도 줄에 그대로 삽입', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  const line = extractDiagLine(html);
  // 코드 + 상병명 모두 같은 줄에 일치 (결제 미니창 선택값 == 세부내역서 표기값)
  for (const [code, name] of [['B430', '사마귀피부염'], ['B354', '체부백선'], ['B353', '발백선']]) {
    expect(line).toContain(code);
    expect(line).toContain(name);
  }
  // 미치환 리터럴 토큰 없음
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── AC4: 금액·진료비 산정·합계 영역 무접촉 (읽기만) ───────────────────────────
test('AC4 금액·진료비 산정·합계 영역 종전과 동일 (무접촉)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('끝처리 조정금액');
  expect(html).toContain('5,280');   // detail_subtotal / copayment / total
  expect(html).toContain('12,330');  // subtotal_fund (공단부담금 표시 유지)
});

// ── AC2: 상병 미선택 → 빈 줄 graceful (에러·리터럴 토큰 없음) ───────────────────
test('AC2 상병 미선택 고객 — 빈 줄 graceful (라벨 유지·에러 없음·리터럴 토큰 미노출)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, withNone());
  const line = extractDiagLine(html);
  expect(line).toContain('상병코드'); // 라벨 유지
  expect(html).not.toContain('{{diag_code_1}}'); // 리터럴 토큰 미노출
  expect(line).not.toContain('B430');
  // 금액/합계 회귀 0
  expect(html).toContain('진료비 세부산정내역');
});

// ── 복수 상병(4건) 전부 표기 (잘림·누락 없음, 한 줄 inline) ──────────────────────
test('AC1 복수 상병 4건 — 전부 한 줄에 표기(잘림·누락 없음)', () => {
  const line = extractDiagLine(bindHtmlTemplate(getHtmlTemplate('bill_detail')!, with4()));
  ['B430', 'B354', 'B353', 'K297'].forEach((c) => expect(line).toContain(c));
});

// ── 단일 소스 정합: 소견서/진단서와 동일 상병 토큰 ────────────────────────────
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
