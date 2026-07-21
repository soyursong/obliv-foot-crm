/**
 * E2E spec — T-20260721-foot-PAYDETAIL-DIAGCODE-SHOW
 * 진료비 세부산정내역(bill_detail) 서류에 상병코드(ICD)·상병명(진단명) 항목 추가 노출.
 * reporter=김주연 총괄.
 *
 * 데이터 원천(게이트 통과): diag_code_N/diag_name_N 은 소견서/진단서와 동일 단일 소스로 이미
 *   print 경로가 채운다 —
 *   · DocumentPrintPanel(배치): batchDiagItems = service_charges(상병) → check_in_services 폴백 → autoValues
 *   · PaymentMiniWindow(결제미니창 PATH-4): buildCodeEnrichedValues 가 선택 상병(codeItems)을 무조건 주입
 *   본 티켓은 bill_detail 템플릿이 그 토큰을 '표시'만 하도록 추가한 순수 additive 변경(no-DDL).
 *
 * AC-1: 서류 출력 시 상병코드·상병명 노출 (2건/3건/4건)
 * AC-2: 데이터 없으면 빈칸 (잠정 소견서와 동일 방식 — 미매칭 토큰='' )
 * AC-3: 기존 항목·레이아웃 회귀 0 (계/끝처리/합계·요양기관기호·환자정보 유지)
 * AC-4: 소견서(diagnosis/diag_opinion) 표시값과 일치 — 동일 토큰·동일 값 → 단일 원천 정합
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// bill_detail 은 landscape 빌링서식 — 상병 토큰 외 계/합계·요양기관 토큰이 필요.
const baseBillValues = (): Record<string, string> => ({
  record_no: 'C-0001',
  patient_name: '테스트환자',
  patient_rrn: 'DUMMY-RRN-MASKED',
  visit_date: '2026-07-21',
  clinic_code: 'X12345678',
  issue_date: '2026-07-21',
  hira_institution_name: '오블리브 풋케어의원 종로점',
  receipt_representative: '박영진',
  institution_seal_html: '(인)',
  items_html: '<tr><td>진찰료</td><td>2026-07-21</td><td>AA154</td><td>초진진찰료</td><td class="num-cell">17,610</td><td>1</td><td>1</td><td class="num-cell">17,610</td><td class="num-cell">5,280</td><td class="num-cell">12,330</td><td class="num-cell">0</td><td class="num-cell">0</td></tr>',
  detail_subtotal: '5,280',
  subtotal_copayment: '5,280',
  subtotal_fund: '12,330',
  subtotal_noncovered: '0',
  detail_rounding: '0',
  detail_total: '5,280',
  // 상병 3건 (service_charges 상병항목 = 소견서와 동일 소스)
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  diag_code_2: 'B35.1',
  diag_name_2: '족부 백선',
  diag_code_3: 'K29.7',
  diag_name_3: '위염',
  diag_row_3_style: '',
  diag_row_4_style: 'display:none',
  diag_extra_codes_html: '',
});

const with4 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_4: 'B35.3',
  diag_name_4: '족부 백선(기타)',
  diag_row_4_style: '',
});

const with2 = (): Record<string, string> => ({
  ...baseBillValues(),
  diag_code_3: '',
  diag_name_3: '',
  diag_row_3_style: 'display:none',
});

const withNone = (): Record<string, string> => {
  const v = baseBillValues();
  delete v.diag_code_1; delete v.diag_name_1;
  delete v.diag_code_2; delete v.diag_name_2;
  delete v.diag_code_3; delete v.diag_name_3;
  v.diag_row_3_style = 'display:none';
  v.diag_row_4_style = 'display:none';
  return v;
};

// ── AC-1: 상병코드·상병명 노출 ──────────────────────────────────────────────
test('AC-1 세부산정내역 상병코드·상병명 3건 노출', () => {
  const tpl = getHtmlTemplate('bill_detail');
  expect(tpl).toBeTruthy();
  const html = bindHtmlTemplate(tpl!, baseBillValues());
  // 상병 헤더 존재
  expect(html).toContain('상병코드');
  expect(html).toContain('상병명');
  // 코드/명 3건 노출
  expect(html).toContain('L60.0');
  expect(html).toContain('내향성 발톱');
  expect(html).toContain('B35.1');
  expect(html).toContain('족부 백선');
  expect(html).toContain('K29.7');
  expect(html).toContain('위염');
});

test('AC-1 세부산정내역 상병코드·상병명 4건 노출', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, with4());
  expect(html).toContain('L60.0');
  expect(html).toContain('B35.3');
  expect(html).toContain('족부 백선(기타)');
});

// ── AC-2: 데이터 없으면 빈칸 (literal 토큰 잔존 금지) ────────────────────────
test('AC-2 상병 데이터 없으면 빈칸 — 미매칭 토큰 미노출', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, withNone());
  // 헤더는 유지되나 값은 공란 — 토큰 리터럴이 그대로 남지 않음
  expect(html).toContain('상병코드');
  expect(html).not.toContain('{{diag_code_1}}');
  expect(html).not.toContain('{{diag_name_1}}');
  expect(html).not.toContain('{{diag_code_2}}');
  // 실제 상병값 없음
  expect(html).not.toContain('L60.0');
});

// ── AC-3: 기존 항목·레이아웃 회귀 0 ─────────────────────────────────────────
test('AC-3 기존 세부산정내역 항목·합계 유지 (회귀 0)', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, baseBillValues());
  // 서식 타이틀·요양기관기호·환자정보 유지
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('X12345678');
  expect(html).toContain('테스트환자');
  // 항목/계/끝처리/합계 유지
  expect(html).toContain('초진진찰료');
  expect(html).toContain('5,280');
  expect(html).toContain('12,330');
  expect(html).toContain('끝처리 조정금액');
  // 어떤 미치환 토큰도 남지 않음
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── AC-4: 소견서 표시값과 일치 (단일 원천 정합) ─────────────────────────────
test('AC-4 세부산정내역 상병값 = 소견서(diagnosis/diag_opinion) 표시값 일치', () => {
  const values = baseBillValues();
  const bill = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);

  for (const formKey of ['diagnosis', 'diag_opinion']) {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) continue;
    const doc = bindHtmlTemplate(tpl, values);
    // 동일 토큰(diag_code_N/diag_name_N) → 동일 값이 양 서류에 함께 등장
    for (const token of ['L60.0', '내향성 발톱', 'B35.1', '족부 백선', 'K29.7', '위염']) {
      expect(bill.includes(token)).toBe(true);
      expect(doc.includes(token)).toBe(true);
    }
  }
});

// ── 회귀: 2건 이하 시 추가 행 숨김 ───────────────────────────────────────────
test('회귀 2건 이하 시 3·4행 display:none', () => {
  const tpl = getHtmlTemplate('bill_detail')!;
  const html = bindHtmlTemplate(tpl, with2());
  expect(html).toContain('L60.0');
  expect(html).toContain('B35.1');
  expect(html).toContain('display:none');
  expect(html).not.toContain('K29.7');
});
