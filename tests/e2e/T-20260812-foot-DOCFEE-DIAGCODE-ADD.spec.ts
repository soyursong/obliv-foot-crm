/**
 * E2E spec — T-20260812-foot-DOCFEE-DIAGCODE-ADD  ★SUPERSEDED★
 *   (responder triage alias: T-20260812-foot-SUSU-DETAIL-SANGBYEONG-CODE-INSERT)
 *
 * ⚠ policy_superseded by T-20260812-foot-DOCFEE-DIAGCODE-GRID-LAYOUT (동일 인물 김주연 총괄·동일 축 3차 재정의).
 *   본 티켓이 삽입한 [상병코드] '.diag-line 텍스트 한 줄' 표기가 '성의없다' → 후속 티켓이 칸(그리드/테이블) 레이아웃으로 재작업.
 *   따라서 이 spec 의 원래 회귀가드(".diag-line 이어야 하고 diag-grid 표는 blind 복원 금지")는 정책 반전으로 폐기됨.
 *   상병코드 표기의 실 회귀가드는 후속 spec(T-20260812-foot-DOCFEE-DIAGCODE-GRID-LAYOUT.spec.ts)이 소유.
 *
 * 본 파일은 부모 티켓 계보 보존용으로 유지하되, 폐기된 .diag-line 단정을 제거하고
 * 정책 불변 항목(상병 값 정합 + 금액/계산 무접촉)만 남긴다 — 그리드/한줄 형태와 무관하게 항상 참.
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

// ── 정책 불변: 선택된 상병코드 값이 세부내역서에 표기 (그리드/한줄 형태 무관) ──────────
test('선택된 상병코드 값(첨부 ② 차트 코드 zone)이 세부내역서에 표기됨', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  for (const [code, name] of [['B430', '사마귀피부염'], ['B354', '체부백선'], ['B353', '발백선']]) {
    expect(html).toContain(code);
    expect(html).toContain(name);
  }
  // 미치환 리터럴 토큰 없음
  expect(html).not.toMatch(/\{\{[a-z_0-9]+\}\}/);
});

// ── 정책 불변: 금액·진료비 산정·합계 영역 무접촉 (읽기만) ──────────────────────────
test('금액·진료비 산정·합계 영역 종전과 동일 (무접촉)', () => {
  const html = bindHtmlTemplate(getHtmlTemplate('bill_detail')!, baseBillValues());
  expect(html).toContain('진료비 세부산정내역');
  expect(html).toContain('요양기관기호');
  expect(html).toContain('초진진찰료');
  expect(html).toContain('끝처리 조정금액');
  expect(html).toContain('5,280');   // detail_subtotal / copayment / total
  expect(html).toContain('12,330');  // subtotal_fund (공단부담금 표시 유지)
});
