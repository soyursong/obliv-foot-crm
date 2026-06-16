/**
 * E2E Spec — T-20260616-foot-DOCPANEL-PENCHART-INSCLAIM-HIDE
 *
 * 도수치료센터(C0ATE5P6JTH) 김주연 총괄 요청.
 *
 * 결제미니창(PaymentMiniWindow) > 서류발행 탭(DocumentPrintPanel) 목록에 펜차트 양식 4종 +
 * 보험청구서가 노출되어, 임상 작성용/보험청구 전용 양식이 수납 발행 목록에 섞여 현장 혼동 발생.
 * → 이 탭 목록에서만 제거(양식 자체 삭제 아님, 차트탭 등 원경로 보존).
 *
 * 구현(A안 — db_change 없음):
 *   formTemplates.DOC_PANEL_HIDDEN_FORM_KEYS 상수 신설 + DocumentPrintPanel 분류 단계
 *   단일 소스(visibleTemplates)에서 제외 → default/optional/insurance 3개 섹션 일괄 반영.
 *
 * AC-1: 서류발행 탭 목록에서 펜차트 4종 + 보험청구서 미표시.
 * AC-2: 제거 외 양식(진료비계산서·영수증·처방전·소견서 등)은 기존대로 모두 표시.
 * AC-3: 펜차트/보험청구서의 원래 작성·발행 경로(차트탭 등) 무영향 — A안 채택 시 자동 충족
 *       (본 상수는 DocumentPrintPanel 분류 단계 표시 필터일 뿐, PenChartTab 로드 쿼리·발행 로직 미참조).
 * AC-4: 보험 섹션(category==='insurance')에서 보험청구서만 빠지고 나머지 보험 양식 유지.
 *
 * 실행: npx playwright test T-20260616-foot-DOCPANEL-PENCHART-INSCLAIM-HIDE.spec.ts
 * NOTE: 순수 로직 테스트 — 실서버 불필요. DocumentPrintPanel 분류 단계와 동일한 필터를
 *       FALLBACK + INSURANCE_FALLBACK + 운영 펜차트 4종 시드 행으로 재현해 검증한다.
 */

import { test, expect } from '@playwright/test';
import {
  DOC_PANEL_HIDDEN_FORM_KEYS,
  FALLBACK_TEMPLATES,
  INSURANCE_FALLBACK_TEMPLATES,
  FORM_META,
  type FormTemplate,
} from '../../src/lib/formTemplates';

const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 운영 DB form_templates 의 펜차트 4종 실제 행(seed migration 기준, category='foot-service').
//   formTemplates.ts FALLBACK 외부(DB seed)이므로 운영 행을 명시 시뮬레이션한다.
//     - pen_chart                     20260517000060_penchart_template_seed.sql ('[보험차트]')
//     - health_questionnaire_general  20260519000060_health_questionnaire_templates.sql
//     - health_questionnaire_senior   20260519000060_health_questionnaire_templates.sql
//     - refund_consent                20260522060000_form_templates_audit_fix.sql (환불 동의서)
const PROD_PENCHART_ROWS: FormTemplate[] = [
  { id: 'prod-pen-chart',  clinic_id: FOOT_CLINIC_ID, category: 'foot-service', form_key: 'pen_chart',                    name_ko: '[보험차트]',            template_path: '/forms/pen_chart_form.png', template_format: 'png', field_map: [], requires_signature: false, required_role: 'admin|manager|coordinator|director', active: true, sort_order: 90 },
  { id: 'prod-hq-general', clinic_id: FOOT_CLINIC_ID, category: 'foot-service', form_key: 'health_questionnaire_general', name_ko: '발건강 질문지(일반용)',  template_path: '', template_format: 'png', field_map: [], requires_signature: false, required_role: 'admin|manager|coordinator', active: true, sort_order: 91 },
  { id: 'prod-hq-senior',  clinic_id: FOOT_CLINIC_ID, category: 'foot-service', form_key: 'health_questionnaire_senior',  name_ko: '발건강 질문지(어르신용)', template_path: '', template_format: 'png', field_map: [], requires_signature: false, required_role: 'admin|manager|coordinator', active: true, sort_order: 92 },
  { id: 'prod-refund',     clinic_id: FOOT_CLINIC_ID, category: 'foot-service', form_key: 'refund_consent',               name_ko: '환불 동의서',           template_path: '/forms/refund_consent.png', template_format: 'png', field_map: [], requires_signature: true, required_role: 'admin|manager|coordinator', active: true, sort_order: 93 },
];

// DocumentPrintPanel 분류 단계와 동일한 목록 소스 재현:
//   foot-service(FALLBACK + 운영 펜차트 4종) + insurance(INSURANCE_FALLBACK = 보험청구서).
const ALL_TEMPLATES: FormTemplate[] = [
  ...FALLBACK_TEMPLATES,
  ...PROD_PENCHART_ROWS,
  ...INSURANCE_FALLBACK_TEMPLATES,
];

// ── DocumentPrintPanel 과 1:1 동일한 분류 로직 (line 482~497 미러) ───────────
const visibleTemplates = ALL_TEMPLATES.filter(
  (t) => !DOC_PANEL_HIDDEN_FORM_KEYS.includes(t.form_key),
);
const defaultTemplates = visibleTemplates.filter(
  (t) => FORM_META[t.form_key]?.print_preset === 'default',
);
const insuranceTemplates = visibleTemplates.filter((t) => t.category === 'insurance');
const optionalTemplates = visibleTemplates.filter(
  (t) => FORM_META[t.form_key]?.print_preset !== 'default' && t.category !== 'insurance',
);
const allVisibleKeys = new Set(
  [...defaultTemplates, ...insuranceTemplates, ...optionalTemplates].map((t) => t.form_key),
);

const PENCHART_4 = ['pen_chart', 'health_questionnaire_general', 'health_questionnaire_senior', 'refund_consent'];
const INS_CLAIM = 'ins_claim_form';

// ── AC-1: 펜차트 4종 + 보험청구서 미표시 ────────────────────────────────────
test('AC-1: 서류발행 탭 어느 섹션에도 펜차트 4종이 표시되지 않는다', () => {
  for (const k of PENCHART_4) {
    expect(allVisibleKeys.has(k), `펜차트 "${k}" 가 서류발행 탭 목록에 잔존`).toBe(false);
  }
});

test('AC-1: 서류발행 탭 어느 섹션에도 보험청구서(ins_claim_form)가 표시되지 않는다', () => {
  expect(allVisibleKeys.has(INS_CLAIM), '보험청구서가 서류발행 탭 목록에 잔존').toBe(false);
  // 보험 섹션 자체에서도 사라져야 함
  expect(insuranceTemplates.some((t) => t.form_key === INS_CLAIM)).toBe(false);
});

test('AC-1: 숨김 상수 DOC_PANEL_HIDDEN_FORM_KEYS 구성 = 펜차트 4종 + 보험청구서(정확히 5종)', () => {
  expect([...DOC_PANEL_HIDDEN_FORM_KEYS].sort()).toEqual(
    [...PENCHART_4, INS_CLAIM].sort(),
  );
});

// ── AC-2: 제거 외 양식은 기존대로 모두 표시 + 인쇄 가능 ──────────────────────
test('AC-2: 잔존 핵심 양식(진료비계산서·영수증·처방전·소견서·진단서 등)은 그대로 표시', () => {
  // bill_receipt(진료비 계산서·영수증), rx_standard(처방전), diag_opinion(소견서),
  // diagnosis(진단서), bill_detail(진료비내역서) 등 — 제거 대상 아님.
  for (const k of ['bill_detail', 'bill_receipt', 'rx_standard', 'diag_opinion', 'diagnosis', 'payment_cert', 'referral_letter']) {
    expect(allVisibleKeys.has(k), `잔존 양식 "${k}" 누락 — 과잉 필터 회귀`).toBe(true);
  }
});

test('AC-2: 숨김 5종 외에는 단 한 건도 추가로 사라지지 않는다(필터 범위 정확성)', () => {
  const before = new Set(ALL_TEMPLATES.map((t) => t.form_key));
  const after = allVisibleKeys;
  const removed = [...before].filter((k) => !after.has(k)).sort();
  expect(removed).toEqual([...PENCHART_4, INS_CLAIM].sort());
});

// ── AC-3: 원경로(차트탭) 무영향 — A안 자동 충족 ─────────────────────────────
test('AC-3: 숨김 상수는 표시 필터일 뿐 — 펜차트 4종 form_key 정의/데이터 자체는 보존', () => {
  // 양식 행 자체는 ALL_TEMPLATES(=DB+fallback)에 그대로 존재. 숨김은 "목록 노출"만 차단.
  for (const k of PENCHART_4) {
    expect(ALL_TEMPLATES.some((t) => t.form_key === k), `펜차트 "${k}" 행이 소스에서 삭제됨 — A안 위반(원경로 파괴 위험)`).toBe(true);
  }
  // 보험청구서 양식 데이터도 보존(다른 보험 경로용).
  expect(INSURANCE_FALLBACK_TEMPLATES.some((t) => t.form_key === INS_CLAIM)).toBe(true);
});

// ── AC-4: 보험 섹션은 보험청구서만 제외, 나머지 보험 양식 유지 ───────────────
test('AC-4: diag_opinion_v2(소견서-보험청구용)는 제거 대상이 아니며 그대로 표시', () => {
  // 명시 요청은 "보험청구서"(ins_claim_form)뿐 — diag_opinion_v2 는 숨김 목록에 없어야 함.
  expect([...DOC_PANEL_HIDDEN_FORM_KEYS]).not.toContain('diag_opinion_v2');
  expect(allVisibleKeys.has('diag_opinion_v2'), 'diag_opinion_v2 가 잘못 제거됨').toBe(true);
});

test('AC-4: 보험 섹션에 ins_claim_form 외 다른 insurance 양식이 있으면 유지된다', () => {
  // 운영 DB 에 추가 insurance 양식이 존재하는 경우의 회귀 가드(시뮬레이션 행 1건 주입).
  const extraIns: FormTemplate = {
    ...INSURANCE_FALLBACK_TEMPLATES[0],
    id: 'prod-ins-extra',
    form_key: 'ins_extra_form',
    name_ko: '보험 부속서류(예시)',
  };
  const src = [...ALL_TEMPLATES, extraIns];
  const visIns = src
    .filter((t) => !DOC_PANEL_HIDDEN_FORM_KEYS.includes(t.form_key))
    .filter((t) => t.category === 'insurance');
  expect(visIns.some((t) => t.form_key === 'ins_extra_form'), '보험청구서 외 보험 양식이 함께 사라짐 — 과잉 필터').toBe(true);
  expect(visIns.some((t) => t.form_key === INS_CLAIM), '보험청구서가 잔존 — 필터 미동작').toBe(false);
});
