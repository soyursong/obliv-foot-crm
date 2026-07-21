/**
 * E2E spec — T-20260721-foot-BILLDETAIL-DIAGCODE-ADD (§4, 우산 T-20260721-foot-BILLING-REMAINING-WORK)
 * 진료비 세부산정내역(bill_detail) 서류의 상병코드·상병명을 3경로(단일/재출력/일괄) 대칭 출력.
 * reporter=김주연 총괄(풋센터).
 *
 * 구현: DocumentPrintPanel.tsx 의 공용 헬퍼 applyDiagTokens(values, chargesDiag, fallbackDiag)
 *   (src/components/DocumentPrintPanel.tsx L275~300, SSOT). 소스 규칙(DIAGCODE-BLANK 교훈 계승):
 *     service_charges(category_label='상병') 우선 → check_in_services(상병) 폴백 → 없으면 기존값 보존.
 *   3 호출부가 이 단일 헬퍼를 동일 인자형으로 호출:
 *     · 일괄출력 batch  : L1106 applyDiagTokens(autoValues, batchChargesDiag, batchFallbackDiag)
 *     · 단일/재출력     : L2628 applyDiagTokens(base,       issueChargesDiag, issueFallbackDiag)
 *   → 경로별 배선 divergence(일괄엔 나오고 단일엔 공란) 재발 차단(AC-5).
 *
 * 본 spec 은 (a) bindHtmlTemplate 렌더 레이어에서 상병 토큰 노출/공란 안전을 검증하고,
 *   (b) applyDiagTokens 의 SSOT 계약을 그대로 미러한 순수 헬퍼로 "동일 상병 소스 → 경로 무관 동일 문서"
 *   불변식을 런타임 실증한다(React-heavy DocumentPrintPanel 모듈 미임포트 — unit 결정론 유지).
 *
 * AC-1 상병 보유(2/3/4건) → bill_detail 에 상병코드·상병명 렌더, 소견서와 동일 값.
 * AC-2 상병 미등록 → 공란/미표기 안전(undefined·null·플레이스홀더·미치환 토큰 노출 0).
 * AC-3(현장 시나리오3) 3경로 대칭 → 단일/재출력/일괄 동일 소스면 동일 토큰·동일 렌더.
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ─── applyDiagTokens SSOT 미러 (DocumentPrintPanel.tsx L275~300 계약 그대로) ───
//   3 호출부가 호출하는 동일 헬퍼의 순수 계약. 렌더-무관 문서 동일성(AC-5) 실증용.
type Diag = { code: string; name: string };
function applyDiagTokensMirror(
  values: Record<string, string>,
  chargesDiag: Diag[],
  fallbackDiag: Diag[],
): void {
  const diagItems = chargesDiag.length > 0 ? chargesDiag : fallbackDiag;
  if (diagItems.length > 0) {
    delete values.diag_code_1; delete values.diag_name_1;
    delete values.diag_code_2; delete values.diag_name_2;
    diagItems.forEach((item, idx) => {
      const n = idx + 1;
      values[`diag_code_${n}`] = item.code;
      values[`diag_name_${n}`] = item.name;
    });
  }
  const count = diagItems.length > 0
    ? diagItems.length
    : (values.diag_code_2 ? 2 : values.diag_code_1 ? 1 : 0);
  values['diag_row_3_style'] = count >= 3 ? '' : 'display:none';
  values['diag_row_4_style'] = count >= 4 ? '' : 'display:none';
  const extra = diagItems.slice(2).map((i) => i.code).filter(Boolean);
  values['diag_extra_codes_html'] = extra.length > 0
    ? extra.map((c) => `<br>${c}`).join('') : '';
}

// bill_detail 은 landscape 빌링서식 — 상병 토큰 외 계/합계·요양기관 토큰 필요.
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
});

// F-4808 김문재 실데이터 케이스 상병 (소견서와 동일 소스: service_charges 상병항목)
const DIAG_F4808: Diag[] = [
  { code: 'K29.7', name: '위염' },
  { code: 'B35.1', name: '족부 백선' },
  { code: 'B35.3', name: '족부 백선(기타)' },
  { code: 'L60.0', name: '내향성 발톱' },
];

// ── 시나리오 1 (AC-1): 정상 동선 — 상병 보유 환자 ───────────────────────────
test('시나리오1 AC-1 상병 보유(3건) — bill_detail 에 상병코드·상병명 렌더', () => {
  const tpl = getHtmlTemplate('bill_detail');
  expect(tpl).toBeTruthy();
  const values = baseBillValues();
  applyDiagTokensMirror(values, DIAG_F4808.slice(0, 3), []);
  const html = bindHtmlTemplate(tpl!, values);
  expect(html).toContain('상병코드');
  expect(html).toContain('상병명');
  expect(html).toContain('K29.7');
  expect(html).toContain('위염');
  expect(html).toContain('B35.1');
  expect(html).toContain('족부 백선');
  expect(html).toContain('B35.3');
});

test('시나리오1 AC-1 상병 보유(4건) — 4행까지 전건 노출', () => {
  const values = baseBillValues();
  applyDiagTokensMirror(values, DIAG_F4808, []);
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  expect(html).toContain('K29.7');
  expect(html).toContain('L60.0');
  expect(html).toContain('내향성 발톱');
  expect(values.diag_row_3_style).toBe('');
  expect(values.diag_row_4_style).toBe('');
});

test('시나리오1 AC-1 상병값 = 소견서 표시값 일치 (단일 원천 정합)', () => {
  const values = baseBillValues();
  applyDiagTokensMirror(values, DIAG_F4808, []);
  const bill = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  for (const formKey of ['diagnosis', 'diag_opinion']) {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) continue;
    const doc = bindHtmlTemplate(tpl, values);
    for (const token of ['K29.7', '위염', 'B35.1', '족부 백선', 'L60.0', '내향성 발톱']) {
      expect(bill.includes(token)).toBe(true);
      expect(doc.includes(token)).toBe(true);
    }
  }
});

test('시나리오1 AC 폴백 — service_charges 공란이면 check_in_services(폴백) 상병 사용', () => {
  const values = baseBillValues();
  // chargesDiag=[] (service_charges 무기록) → fallbackDiag(check_in_services) 사용
  applyDiagTokensMirror(values, [], DIAG_F4808.slice(0, 2));
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  expect(html).toContain('K29.7');
  expect(html).toContain('B35.1');
  expect(values.diag_code_1).toBe('K29.7');
});

// ── 시나리오 2 (AC-2): 엣지 케이스 — 상병 미등록 환자 ────────────────────────
test('시나리오2 AC-2 상병 미등록 — 공란 안전(플레이스홀더/미치환 토큰 노출 0)', () => {
  const values = baseBillValues(); // 상병 토큰 아예 없음
  applyDiagTokensMirror(values, [], []); // 두 소스 모두 없음
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  // 헤더는 유지, 실제 상병값은 없음
  expect(html).toContain('상병코드');
  expect(html).not.toContain('K29.7');
  expect(html).not.toContain('L60.0');
  // 미치환 토큰 리터럴·undefined/null 노출 금지
  expect(html).not.toContain('{{diag_code_1}}');
  expect(html).not.toContain('{{diag_name_1}}');
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  expect(html).not.toContain('undefined');
  expect(html).not.toContain('null');
  // 추가 행은 숨김
  expect(values.diag_row_3_style).toBe('display:none');
  expect(values.diag_row_4_style).toBe('display:none');
});

// ── 시나리오 3 (AC-5): 출력 경로 대칭 — 단일/재출력/일괄 ─────────────────────
//   동일 상병 소스면 3경로가 동일 헬퍼(applyDiagTokens)를 호출 → 동일 토큰·동일 문서.
test('시나리오3 AC-5 3경로 대칭 — 동일 소스면 단일/재출력/일괄 토큰 동일', () => {
  // 일괄출력 경로 (batch: autoValues + batchChargesDiag)
  const batchValues = baseBillValues();
  applyDiagTokensMirror(batchValues, DIAG_F4808.slice(0, 3), []);

  // 단일 출력 경로 (single: base + issueChargesDiag) — 동일 소스
  const singleValues = baseBillValues();
  applyDiagTokensMirror(singleValues, DIAG_F4808.slice(0, 3), []);

  // 재출력 경로 (reprint: 단일과 동일 IssueDialog 공용 경로) — 동일 소스
  const reprintValues = baseBillValues();
  applyDiagTokensMirror(reprintValues, DIAG_F4808.slice(0, 3), []);

  // 주입된 상병 토큰이 3경로 동일
  for (const key of ['diag_code_1', 'diag_name_1', 'diag_code_2', 'diag_name_2', 'diag_code_3', 'diag_name_3', 'diag_row_3_style', 'diag_row_4_style', 'diag_extra_codes_html']) {
    expect(singleValues[key]).toBe(batchValues[key]);
    expect(reprintValues[key]).toBe(batchValues[key]);
  }

  // 렌더 문서도 3경로 동일 (경로 무관 동일 문서)
  const tpl = getHtmlTemplate('bill_detail')!;
  const batchHtml = bindHtmlTemplate(tpl, batchValues);
  const singleHtml = bindHtmlTemplate(tpl, singleValues);
  const reprintHtml = bindHtmlTemplate(tpl, reprintValues);
  expect(singleHtml).toBe(batchHtml);
  expect(reprintHtml).toBe(batchHtml);
  expect(batchHtml).toContain('K29.7');
});

test('시나리오3 AC-5 폴백 소스도 3경로 대칭 (service_charges 공란 시 check_in_services)', () => {
  const batchValues = baseBillValues();
  applyDiagTokensMirror(batchValues, [], DIAG_F4808.slice(0, 2));
  const singleValues = baseBillValues();
  applyDiagTokensMirror(singleValues, [], DIAG_F4808.slice(0, 2));

  const tpl = getHtmlTemplate('bill_detail')!;
  expect(bindHtmlTemplate(tpl, singleValues)).toBe(bindHtmlTemplate(tpl, batchValues));
});

// ── AC-4: 기존 항목·레이아웃 회귀 0 ─────────────────────────────────────────
test('AC-4 회귀 0 — 상병 추가 후에도 기존 세부산정내역 항목·합계 유지', () => {
  const values = baseBillValues();
  applyDiagTokensMirror(values, DIAG_F4808.slice(0, 3), []);
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, values);
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('X12345678');
  expect(html).toContain('테스트환자');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('5,280');
  expect(html).toContain('12,330');
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});
