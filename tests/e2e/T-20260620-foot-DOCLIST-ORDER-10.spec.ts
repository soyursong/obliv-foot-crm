/**
 * E2E Spec — T-20260620-foot-DOCLIST-ORDER-10
 *
 * 서류 출력 목록 확정 10종 순서 재진열 + 비목록 제거 (결제미니창 + 1/2번 차트)
 *
 * 확정 순서(두 화면 동일):
 *   1.진료비영수증(bill_receipt) 2.진료비세부내역서(bill_detail) 3.KOH균검사결과지(koh_result)
 *   4.소견서(diag_opinion) 5.진단서(diagnosis) 6.진료확인서(treat_confirm)
 *   7.진료의뢰서(referral_letter) 8.통원확인서(visit_confirm) 9.진료기록사본(medical_record_request)
 *   10.처방전(rx_standard)
 *
 * AC(v2):
 *  - 결제미니창·1/2번 차트 두 화면 모두 §1 10종 순서대로만 표시
 *  - 10종 외 기존 항목 표시 안 됨 (목록 항목 수 = 정확히 10)
 *  - 두 화면 순서·항목 수 동일
 *  - 남은 10종 서류 출력/바인딩 회귀 0 (L-006 보존)
 *  - 제거 서류의 DB 발행 데이터 유실 없음 (FE 비표시 only)
 *
 * 실행: npx playwright test T-20260620-foot-DOCLIST-ORDER-10.spec.ts
 * NOTE: orderDocList(SSOT) 단위 검증 + HTML 템플릿 무결성 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import {
  DOCLIST_ORDER_10,
  DOC_CATEGORY_JEUNGMYEONG_KEYS,
  orderDocList,
  type FormTemplate,
} from '../../src/lib/formTemplates';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 운영 DB form_templates(foot-service) 실측(2026-06-20) 기준 — 두 화면이 받는 templates 입력 시뮬레이션.
// DocumentPrintPanel/PaymentMiniWindow 모두 DB 정렬(sort_order)된 배열을 받는다.
function mockTpl(form_key: string, name_ko: string, category = 'foot-service'): FormTemplate {
  return {
    id: `db-${form_key}`,
    clinic_id: 'foot-clinic',
    category,
    form_key,
    name_ko,
    template_path: '',
    template_format: 'html',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 0,
  };
}

// 운영 DB 활성 foot-service 13종(sort_order 순) + insurance 1종(ins_claim_form).
// pen_chart 등 DOC_PANEL_HIDDEN 양식은 호출부에서 사전 제거되므로 입력에서 제외.
const VISIBLE_DB_TEMPLATES: FormTemplate[] = [
  mockTpl('diag_opinion', '소견서'),
  mockTpl('rx_standard', '처방전(표준처방전)'),
  mockTpl('diagnosis', '진단서'),
  mockTpl('bill_detail', '진료비내역서'),
  mockTpl('bill_receipt', '진료비 계산서·영수증'),
  // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN(reopened→fix): 신양식 additive 등록 → 목록 노출 복원
  mockTpl('bill_receipt_new', '진료비 계산서·영수증(신양식)'),
  // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: treat_confirm 단일 → code/nocode 2폼(DB active=false 로 레거시 제외)
  mockTpl('treat_confirm_code', '진료확인서(코드·진단명 포함)'),
  mockTpl('treat_confirm_nocode', '진료확인서(코드·진단명 불포함)'),
  mockTpl('visit_confirm', '통원확인서'),
  mockTpl('payment_cert', '진료비 납입증명서(소득공제용)'), // 제거 대상
  mockTpl('medical_record_request', '의무기록사본발급신청서'),
  mockTpl('referral_letter', '진료의뢰서'),
  mockTpl('diag_opinion_v2', '소견서(보험청구용)'), // 제거 대상
  mockTpl('koh_result', '검사결과 보고서'),
  mockTpl('opinion_doc', '소견서'), // 제거 대상
];

// T-20260719-foot-DOCLIST-RECEIPT-CONSOLIDATE-REORDER supersede: 구 'bill_receipt' 제거 + 신양식 정본화 +
//   총괄 확정 11종 재정렬. bill_receipt_new 가 1번(정본 '진료비 계산서·영수증'), rx_standard 가 3번으로 이동.
const EXPECTED_ORDER = [
  'bill_receipt_new',       // 1. 진료비 계산서·영수증 (신양식=정본)
  'bill_detail',            // 2. 진료비세부내역서
  'rx_standard',            // 3. 처방전 (표준처방전)
  'koh_result',             // 4. KOH균검사결과지
  'diag_opinion',           // 5. 소견서
  'diagnosis',              // 6. 진단서
  'treat_confirm_code',     // 7. 진료확인서(코드·진단명 포함)
  'treat_confirm_nocode',   // 8. 진료확인서(코드·진단명 불포함)
  'referral_letter',        // 9. 진료의뢰서
  'visit_confirm',          // 10. 통원확인서
  'medical_record_request', // 11. 의무기록사본발급신청서
];

// ── 시나리오 1: 결제미니창 서류 출력 순서 ──────────────────────────────────────

test('시나리오1: SSOT DOCLIST_ORDER_10 — 확정 순서(구양식 제거 후 11종)', () => {
  expect(DOCLIST_ORDER_10).toEqual(EXPECTED_ORDER);
  expect(DOCLIST_ORDER_10.length).toBe(11);
  // 중복 없음
  expect(new Set(DOCLIST_ORDER_10).size).toBe(11);
});

test('시나리오1: 결제미니창 — orderDocList 결과가 확정 순서/항목수(11)', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES.filter((t) => t.category !== 'insurance'));
  expect(result.map((t) => t.form_key)).toEqual(EXPECTED_ORDER);
  expect(result).toHaveLength(11);
});

// T-20260719-foot-DOCLIST-RECEIPT-CONSOLIDATE-REORDER: 신양식(bill_receipt_new)이 유일 정본 '진료비 계산서·영수증'.
//   구 'bill_receipt'(구양식)은 목록에서 제거되어 두 화면 어디에도 노출되지 않는다.
test('AC-1/AC-2: bill_receipt_new 는 1번으로 노출 + 구 bill_receipt 는 목록에서 완전 제거', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES);
  const keys = result.map((t) => t.form_key);
  // 신양식이 유일 정본 → 목록 최상단(1번)
  expect(keys.indexOf('bill_receipt_new')).toBe(0);
  // 구양식은 목록에서 사라짐(going-forward 메뉴 제거)
  expect(keys, '구 bill_receipt 가 아직 노출됨').not.toContain('bill_receipt');
  // 제증명 그룹에도 신양식만 귀속, 구양식 없음
  expect(DOC_CATEGORY_JEUNGMYEONG_KEYS).toContain('bill_receipt_new');
  expect(DOC_CATEGORY_JEUNGMYEONG_KEYS).not.toContain('bill_receipt');
});

test('시나리오1: 결제미니창 — 목록 외 항목 비표시 (제거 4종: 구양식 포함)', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES);
  const keys = result.map((t) => t.form_key);
  for (const removed of ['bill_receipt', 'payment_cert', 'diag_opinion_v2', 'opinion_doc']) {
    expect(keys, `제거 대상이 노출됨: ${removed}`).not.toContain(removed);
  }
});

// ── 시나리오 2: 1/2번 차트 서류 출력 순서 (두 화면 동일) ─────────────────────────

test('시나리오2: 차트 — 결제미니창과 동일 함수(SSOT) → 순서·항목 수 동일', () => {
  // DocumentPrintPanel visibleTemplates = templates - DOC_PANEL_HIDDEN (입력 동일 가정)
  const chartResult = orderDocList(VISIBLE_DB_TEMPLATES);
  const pmwResult = orderDocList(VISIBLE_DB_TEMPLATES.filter((t) => t.category !== 'insurance'));
  expect(chartResult.map((t) => t.form_key)).toEqual(pmwResult.map((t) => t.form_key));
  expect(chartResult).toHaveLength(11);
});

test('시나리오2: 보험서류(ins_claim_form)는 목록에 없음 → 두 화면 모두 비표시', () => {
  const withIns = [...VISIBLE_DB_TEMPLATES, mockTpl('ins_claim_form', '보험청구서', 'insurance')];
  const result = orderDocList(withIns);
  expect(result.map((t) => t.form_key)).not.toContain('ins_claim_form');
  expect(result).toHaveLength(11);
});

// ── 시나리오 3: 회귀 가드 — 출력 내용·발행 데이터 불변 ──────────────────────────

test('시나리오3: orderDocList — 원본 template 객체 불변(필드 보존, 발행/바인딩 무영향)', () => {
  // T-20260621-foot-DOCLABEL-RENAME-11 + T-20260719-DOCLIST-RECEIPT-CONSOLIDATE-REORDER:
  //   bill_detail/koh_result/bill_receipt_new 는 표시 라벨(name_ko) override 대상 →
  //   새 객체로 복제되지만 form_key 및 name_ko 외 모든 필드는 원본 보존(발행/바인딩 무영향).
  //   나머지는 원본 참조 그대로(zero-copy).
  const LABEL_OVERRIDDEN = new Set(['bill_detail', 'koh_result', 'bill_receipt_new']);
  const input = VISIBLE_DB_TEMPLATES.slice();
  const result = orderDocList(input);
  // 원본 배열 미변형
  expect(input.map((t) => t.form_key)).toEqual(VISIBLE_DB_TEMPLATES.map((t) => t.form_key));
  for (const t of result) {
    const origin = VISIBLE_DB_TEMPLATES.find((o) => o.form_key === t.form_key)!;
    if (LABEL_OVERRIDDEN.has(t.form_key)) {
      // 라벨 override: 새 객체, name_ko만 달라지고 그 외 필드는 원본과 동일
      expect(t).not.toBe(origin);
      expect(t.name_ko).not.toBe(origin.name_ko);
      const { name_ko: _n1, ...restNew } = t;
      const { name_ko: _n2, ...restOrigin } = origin;
      expect(restNew).toEqual(restOrigin);
    } else {
      // 비-override 8종: 원본 참조 그대로(필드 손상 없음) → 발행/바인딩 로직 무영향
      expect(t).toBe(origin);
    }
  }
});

test('시나리오3: 남은 10종 중 HTML 템플릿 보유 양식 무결성(바인딩 회귀 0)', () => {
  // koh_result/medical_record_request 포함 — HTML 템플릿 손상 없는지 확인
  // T-20260719-DOCLIST-RECEIPT-CONSOLIDATE-REORDER: 목록 정본 11종 form_key 의 HTML 템플릿 무결성.
  const htmlBacked = [
    'bill_receipt_new',
    'bill_detail',
    'rx_standard',
    'koh_result',
    'diag_opinion',
    'diagnosis',
    'treat_confirm_code',
    'treat_confirm_nocode',
    'referral_letter',
    'visit_confirm',
    'medical_record_request',
  ];
  for (const fk of htmlBacked) {
    const tpl = getHtmlTemplate(fk);
    expect(tpl, `HTML 템플릿 손상/누락: ${fk}`).not.toBeNull();
    expect(tpl!.length, `HTML 템플릿 길이 이상: ${fk}`).toBeGreaterThan(100);
  }
});

test('시나리오3: 제거는 FE 표시 필터일 뿐 — 입력에 없던 form_key는 결과에도 없음(주입/생성 없음)', () => {
  // koh_result가 입력에 없으면 결과에도 없어야 함(임의 주입 금지)
  const noKoh = VISIBLE_DB_TEMPLATES.filter((t) => t.form_key !== 'koh_result');
  const result = orderDocList(noKoh);
  expect(result.map((t) => t.form_key)).not.toContain('koh_result');
  // 나머지 9종은 순서 유지
  expect(result.map((t) => t.form_key)).toEqual(EXPECTED_ORDER.filter((k) => k !== 'koh_result'));
});
