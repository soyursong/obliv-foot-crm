/**
 * E2E Spec — T-20260621-foot-DOCLABEL-RENAME-11
 *
 * 서류 표시명(name_ko) 2건 변경 — 결제미니창 + 1/2번 차트 서류 출력 목록 라벨.
 * 김주연 총괄 확정. parent T-20260620-foot-DOCLIST-ORDER-10(순서/집합) 위 비파괴 후속.
 *
 * 변경(2건만):
 *   bill_detail: 진료비내역서   → 진료비세부내역서
 *   koh_result:  검사결과 보고서 → KOH균검사결과지
 *   bill_receipt(진료비 계산서·영수증) = 변경 없음
 *
 * 구현: FE 표시 override(DB form_templates.name_ko 무접촉). 두 화면 공유 함수 orderDocList 한 곳에
 *   DOCLIST_LABEL_OVERRIDE 적용 → 두 화면 자동 동일. form_key·필터/정렬·발행/바인딩·published 불변.
 *   인쇄 출력물 본문 제목(법정 별지 제1호 "진료비 세부산정내역", KOH `<h1>검사결과 보고서</h1>` =
 *   doctor 영역 공유 surface)은 본 티켓 범위 밖 → 미접촉. 목록 라벨에 한정.
 *
 * AC:
 *  - 두 화면 모두 bill_detail 라벨 = "진료비세부내역서"
 *  - 두 화면 모두 koh_result 라벨 = "KOH균검사결과지"
 *  - bill_receipt 라벨 현행 유지(변경 없음)
 *  - 순서·표시 집합(10종) parent §1 그대로 회귀 0
 *  - name_ko 외 필드 보존(발행/바인딩 회귀 0, L-006 보존)
 *
 * 실행: npx playwright test T-20260621-foot-DOCLABEL-RENAME-11.spec.ts
 * NOTE: orderDocList(SSOT) 단위 검증 — 두 화면 모두 이 함수 출력으로 라벨 렌더. 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import {
  DOCLIST_ORDER_10,
  DOCLIST_LABEL_OVERRIDE,
  orderDocList,
  type FormTemplate,
} from '../../src/lib/formTemplates';

// 운영 DB form_templates 가 두 화면에 주는 입력 시뮬레이션(변경 전 name_ko = 구명칭).
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

// 변경 전(구명칭) 운영 DB 입력 — bill_detail/koh_result 구명칭, bill_receipt 현행.
const DB_TEMPLATES_OLD_LABELS: FormTemplate[] = [
  mockTpl('bill_receipt', '진료비 계산서·영수증'),
  mockTpl('bill_detail', '진료비내역서'),
  mockTpl('koh_result', '검사결과 보고서'),
  mockTpl('diag_opinion', '소견서'),
  mockTpl('diagnosis', '진단서'),
  // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: treat_confirm 단일 → code/nocode 2폼(레거시 DB active=false)
  mockTpl('treat_confirm_code', '진료확인서(코드·진단명 포함)'),
  mockTpl('treat_confirm_nocode', '진료확인서(코드·진단명 불포함)'),
  mockTpl('referral_letter', '진료의뢰서'),
  mockTpl('visit_confirm', '통원확인서'),
  mockTpl('medical_record_request', '의무기록사본발급신청서'),
  mockTpl('rx_standard', '처방전(표준처방전)'),
];

function labelOf(result: FormTemplate[], formKey: string): string | undefined {
  return result.find((t) => t.form_key === formKey)?.name_ko;
}

// ── 시나리오 1: 결제미니창 라벨 ────────────────────────────────────────────────

test('시나리오1: 결제미니창 — bill_detail 라벨 = "진료비세부내역서"(구 "진료비내역서" 없음)', () => {
  const result = orderDocList(DB_TEMPLATES_OLD_LABELS.filter((t) => t.category !== 'insurance'));
  expect(labelOf(result, 'bill_detail')).toBe('진료비세부내역서');
  expect(result.map((t) => t.name_ko)).not.toContain('진료비내역서');
});

test('시나리오1: 결제미니창 — koh_result 라벨 = "KOH균검사결과지"(구 "검사결과 보고서" 없음)', () => {
  const result = orderDocList(DB_TEMPLATES_OLD_LABELS.filter((t) => t.category !== 'insurance'));
  expect(labelOf(result, 'koh_result')).toBe('KOH균검사결과지');
  expect(result.map((t) => t.name_ko)).not.toContain('검사결과 보고서');
});

test('시나리오1: 결제미니창 — bill_receipt(진료비 계산서·영수증) 라벨 현행 유지', () => {
  const result = orderDocList(DB_TEMPLATES_OLD_LABELS.filter((t) => t.category !== 'insurance'));
  expect(labelOf(result, 'bill_receipt')).toBe('진료비 계산서·영수증');
});

// ── 시나리오 2: 1/2번 차트 라벨 (두 화면 동일 함수 → 동일 문구) ──────────────────

test('시나리오2: 차트 — 결제미니창과 동일 라벨(SSOT orderDocList 공유)', () => {
  const chart = orderDocList(DB_TEMPLATES_OLD_LABELS);
  const pmw = orderDocList(DB_TEMPLATES_OLD_LABELS.filter((t) => t.category !== 'insurance'));
  expect(chart.map((t) => [t.form_key, t.name_ko])).toEqual(
    pmw.map((t) => [t.form_key, t.name_ko]),
  );
  expect(labelOf(chart, 'bill_detail')).toBe('진료비세부내역서');
  expect(labelOf(chart, 'koh_result')).toBe('KOH균검사결과지');
});

test('시나리오2: override 매핑 SSOT — 정확히 2건(bill_detail/koh_result)만', () => {
  expect(DOCLIST_LABEL_OVERRIDE).toEqual({
    bill_detail: '진료비세부내역서',
    koh_result: 'KOH균검사결과지',
  });
  expect(Object.keys(DOCLIST_LABEL_OVERRIDE)).toHaveLength(2);
  // bill_receipt 는 override 대상 아님(현행 유지)
  expect(DOCLIST_LABEL_OVERRIDE).not.toHaveProperty('bill_receipt');
});

// ── 시나리오 3: 회귀 가드 — 순서·집합·필드 불변 ────────────────────────────────

test('시나리오3: 순서·표시 집합 parent §1 그대로 회귀 0 (SPLIT: 11항목)', () => {
  const result = orderDocList(DB_TEMPLATES_OLD_LABELS);
  expect(result.map((t) => t.form_key)).toEqual([...DOCLIST_ORDER_10]);
  expect(result).toHaveLength(DOCLIST_ORDER_10.length);
});

test('시나리오3: name_ko 외 필드 보존 — form_key 불변, 발행/바인딩 회귀 0', () => {
  const result = orderDocList(DB_TEMPLATES_OLD_LABELS);
  for (const t of result) {
    const origin = DB_TEMPLATES_OLD_LABELS.find((o) => o.form_key === t.form_key)!;
    // form_key·발행 관련 필드 불변
    expect(t.form_key).toBe(origin.form_key);
    expect(t.template_format).toBe(origin.template_format);
    expect(t.requires_signature).toBe(origin.requires_signature);
    expect(t.active).toBe(origin.active);
    // override 2건만 name_ko 변경, 나머지 동일
    if (DOCLIST_LABEL_OVERRIDE[t.form_key]) {
      expect(t.name_ko).toBe(DOCLIST_LABEL_OVERRIDE[t.form_key]);
    } else {
      expect(t.name_ko).toBe(origin.name_ko);
    }
  }
});

test('시나리오3: 원본 배열·객체 미변형(override 는 복제로만 적용)', () => {
  const input = DB_TEMPLATES_OLD_LABELS.slice();
  orderDocList(input);
  // 원본 객체의 name_ko 가 변형되지 않음(in-place mutation 없음)
  expect(input.find((t) => t.form_key === 'bill_detail')!.name_ko).toBe('진료비내역서');
  expect(input.find((t) => t.form_key === 'koh_result')!.name_ko).toBe('검사결과 보고서');
});
