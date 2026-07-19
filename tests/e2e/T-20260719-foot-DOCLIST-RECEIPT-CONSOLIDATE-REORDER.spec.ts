/**
 * E2E Spec — T-20260719-foot-DOCLIST-RECEIPT-CONSOLIDATE-REORDER
 *
 * [풋 모든 서류출력 경로] 서류 목록 정리 (김주연 총괄, 풋센터 채널)
 *   ① 구 '진료비 계산서·영수증'(bill_receipt, 구양식)을 목록에서 제거
 *   ② '진료비 계산서·영수증(신양식)'(bill_receipt_new)의 '(신양식)' 접미어 제거 → 정본 '진료비 계산서·영수증'
 *   ③ 서류 항목 순서 재정렬(11종, 총괄 요청 순서)
 *
 * AC:
 *  - AC-1: 모든 서류출력 경로의 서류 타입 목록에서 구 bill_receipt 미노출(going-forward 메뉴 변경).
 *  - AC-2: 신양식(bill_receipt_new) 표시명 = '진료비 계산서·영수증'(접미어 제거). form_key 불변. 목록에 정확히 1개.
 *  - AC-3: 아래 11종 순서 그대로.
 *      1.진료비 계산서·영수증(bill_receipt_new) 2.진료비세부내역서(bill_detail) 3.처방전(rx_standard)
 *      4.KOH균검사결과지(koh_result) 5.소견서(diag_opinion) 6.진단서(diagnosis)
 *      7.진료확인서(코드포함, treat_confirm_code) 8.진료확인서(코드불포함, treat_confirm_nocode)
 *      9.진료의뢰서(referral_letter) 10.통원확인서(visit_confirm) 11.의무기록사본발급신청서(medical_record_request)
 *  - AC-4: 단일 소스 수정 — 두 화면(결제미니창·서류출력) 공유 함수 orderDocList/groupDocList 한 곳에서 파생.
 *
 * NOTE: orderDocList/groupDocList(SSOT) 단위 검증 + DocumentPrintPanel 소스 이관 검증 — 실서버 불필요.
 * 실행: npx playwright test T-20260719-foot-DOCLIST-RECEIPT-CONSOLIDATE-REORDER.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCLIST_ORDER_10,
  DOCLIST_LABEL_OVERRIDE,
  DOC_CATEGORY_JEUNGMYEONG_KEYS,
  FALLBACK_TEMPLATES,
  orderDocList,
  groupDocList,
  type FormTemplate,
} from '../../src/lib/formTemplates';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

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

// 운영 DB 활성 foot-service 시뮬레이션 — 구양식(bill_receipt)·신양식(bill_receipt_new) DB row 는 둘 다 실재하나,
// 목록 필터(DOCLIST_ORDER_10)가 going-forward 로 구양식만 제외한다(row·발행이력 보존).
const VISIBLE_DB_TEMPLATES: FormTemplate[] = [
  mockTpl('bill_receipt', '진료비 계산서·영수증'),           // 구양식 — 목록 제거 대상
  mockTpl('bill_receipt_new', '진료비 계산서·영수증(신양식)'), // 신양식 — 정본 승격 대상
  mockTpl('bill_detail', '진료비내역서'),
  mockTpl('koh_result', '검사결과 보고서'),
  mockTpl('diag_opinion', '소견서'),
  mockTpl('diagnosis', '진단서'),
  mockTpl('treat_confirm_code', '진료확인서(코드·진단명 포함)'),
  mockTpl('treat_confirm_nocode', '진료확인서(코드·진단명 불포함)'),
  mockTpl('referral_letter', '진료의뢰서'),
  mockTpl('visit_confirm', '통원확인서'),
  mockTpl('medical_record_request', '의무기록사본발급신청서'),
  mockTpl('rx_standard', '처방전(표준처방전)'),
];

// AC-3 확정 순서(11종)
const EXPECTED_ORDER = [
  'bill_receipt_new',       // 1. 진료비 계산서·영수증(정본)
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

const _dir = dirname(fileURLToPath(import.meta.url));
const dppSrc = () =>
  readFileSync(join(_dir, '../../src/components/DocumentPrintPanel.tsx'), 'utf-8');

// ── AC-1: 구양식 목록 제거 ─────────────────────────────────────────────────────

test('AC-1: DOCLIST_ORDER_10 에서 구 bill_receipt 제거', () => {
  expect(DOCLIST_ORDER_10).not.toContain('bill_receipt');
  expect(DOC_CATEGORY_JEUNGMYEONG_KEYS).not.toContain('bill_receipt');
});

test('AC-1: 모든 서류출력 경로(orderDocList) 결과에 구 bill_receipt 미노출', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES);
  expect(result.map((t) => t.form_key)).not.toContain('bill_receipt');
});

test('AC-1: 구양식 제거는 FE 목록 필터일 뿐 — 템플릿/DB row·과거 재출력 경로 보존(무접점)', () => {
  // bill_receipt 폴백 row 는 그대로 존재(과거 발행분 재출력용)
  expect(FALLBACK_TEMPLATES.find((t) => t.form_key === 'bill_receipt')).toBeTruthy();
  // bill_receipt HTML 템플릿도 보존(재출력 렌더 무손상)
  const html = getHtmlTemplate('bill_receipt');
  expect(html).not.toBeNull();
  expect(html!.length).toBeGreaterThan(100);
});

// ── AC-2: 신양식 정본화 ────────────────────────────────────────────────────────

test('AC-2: bill_receipt_new 라벨 override = "진료비 계산서·영수증"(접미어 제거)', () => {
  expect(DOCLIST_LABEL_OVERRIDE.bill_receipt_new).toBe('진료비 계산서·영수증');
});

test('AC-2: 목록 표시명에서 "(신양식)" 소멸 + "진료비 계산서·영수증" 정확히 1개', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES);
  const names = result.map((t) => t.name_ko);
  expect(names).not.toContain('진료비 계산서·영수증(신양식)');
  expect(names.filter((n) => n === '진료비 계산서·영수증')).toHaveLength(1);
  // 그 1개는 신양식 form_key(내부 식별자 불변)
  const receiptRow = result.find((t) => t.name_ko === '진료비 계산서·영수증');
  expect(receiptRow?.form_key).toBe('bill_receipt_new');
});

// ── AC-3: 11종 재정렬 ──────────────────────────────────────────────────────────

test('AC-3: SSOT DOCLIST_ORDER_10 = 확정 11종 순서(중복 0)', () => {
  expect(DOCLIST_ORDER_10).toEqual(EXPECTED_ORDER);
  expect(DOCLIST_ORDER_10.length).toBe(11);
  expect(new Set(DOCLIST_ORDER_10).size).toBe(11);
});

test('AC-3: orderDocList 결과 순서·항목수(11)가 확정 순서와 일치', () => {
  const result = orderDocList(VISIBLE_DB_TEMPLATES);
  expect(result.map((t) => t.form_key)).toEqual(EXPECTED_ORDER);
  expect(result).toHaveLength(11);
});

// ── AC-4: 단일 소스 — 전 경로 일관 ─────────────────────────────────────────────

test('AC-4: 결제미니창·서류출력 두 화면이 동일 SSOT(orderDocList) → 순서·항목 동일', () => {
  // PaymentMiniWindow: orderDocList(foot-service only) / DocumentPrintPanel: groupDocList(=orderDocList 기반)
  const pmw = orderDocList(VISIBLE_DB_TEMPLATES.filter((t) => t.category !== 'insurance'));
  const chartGroups = groupDocList(VISIBLE_DB_TEMPLATES);
  const chartKeys = chartGroups.flatMap((g) => g.templates.map((t) => t.form_key));
  expect(chartKeys).toEqual(pmw.map((t) => t.form_key));
  expect(chartKeys).toEqual(EXPECTED_ORDER);
});

test('AC-4: 서류출력 패널 "영수증 관리" 펼침 = 정본 행(bill_receipt_new)으로 이관(기능손실 0)', () => {
  const src = dppSrc();
  expect(src).toContain(
    "renderRowExtra={(formKey) => (formKey === 'bill_receipt_new' ? receiptManagePanel : null)}",
  );
  // 구 bill_receipt 행 바인딩은 더 이상 없음
  expect(src).not.toContain(
    "renderRowExtra={(formKey) => (formKey === 'bill_receipt' ? receiptManagePanel : null)}",
  );
});

// ── 회귀: orderDocList 순수성(원본 불변, name_ko 외 필드 보존) ──────────────────

test('회귀: orderDocList — 라벨 override 는 복제로만 적용(원본 배열·객체 미변형)', () => {
  const input = VISIBLE_DB_TEMPLATES.slice();
  const result = orderDocList(input);
  // 원본 배열 순서 미변형
  expect(input.map((t) => t.form_key)).toEqual(VISIBLE_DB_TEMPLATES.map((t) => t.form_key));
  // 원본 신양식 객체 name_ko 미변형(in-place mutation 없음)
  expect(input.find((t) => t.form_key === 'bill_receipt_new')!.name_ko).toBe(
    '진료비 계산서·영수증(신양식)',
  );
  // override 대상은 새 객체, name_ko 외 모든 필드 원본 보존
  const receipt = result.find((t) => t.form_key === 'bill_receipt_new')!;
  const origin = VISIBLE_DB_TEMPLATES.find((t) => t.form_key === 'bill_receipt_new')!;
  const { name_ko: _n1, ...restNew } = receipt;
  const { name_ko: _n2, ...restOrigin } = origin;
  expect(restNew).toEqual(restOrigin);
});
