/**
 * E2E Spec — T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT
 *
 * pen_chart.required_role(admin|manager|coordinator|director)에 therapist/staff 미포함 →
 * therapist/staff 계정 로그인 시 DocumentPrintPanel 인쇄목록에서 펜차트([보험차트])가
 * 비활성(누락)되는 문제 수정.
 *
 * 수정: formTemplates.canAccessFormTemplate() 단일 판정 함수로 통일.
 *       pen_chart 한정 therapist/staff 추가 허용. DB required_role 변경 없음(표시 조건만).
 *
 * AC-1: therapist/staff role 에서 pen_chart 인쇄목록 노출(접근 허용).
 * AC-2: pen_chart 한정 보강 — billing/insurance 등 타 양식은 영향 없음.
 * AC-3: admin/manager/coordinator/director 기존 노출 회귀 없음.
 *
 * 실행: npx playwright test T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT.spec.ts
 * NOTE: 순수 로직 테스트 — 실서버 불필요(DocumentPrintPanel canAccess 단일 소스 검증).
 */

import { test, expect } from '@playwright/test';
import {
  canAccessFormTemplate,
  PENCHART_EXTRA_PRINT_ROLES,
  type FormTemplate,
} from '../../src/lib/formTemplates';

// 운영 DB 시드와 동일: pen_chart([보험차트]) required_role
const penChart: FormTemplate = {
  id: 'tpl-pen-chart',
  clinic_id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  category: 'foot-service',
  form_key: 'pen_chart',
  name_ko: '[보험차트]',
  template_path: '/forms/pen_chart_form.png',
  template_format: 'png',
  field_map: [],
  requires_signature: false,
  required_role: 'admin|manager|coordinator|director',
  active: true,
  sort_order: 90,
};

// billing 양식(타 양식 회귀 검증용) — therapist/staff는 접근 불가여야 함
const billReceipt: FormTemplate = {
  ...penChart,
  id: 'tpl-bill-receipt',
  form_key: 'bill_receipt',
  name_ko: '진료비 영수증',
  required_role: 'admin|manager|coordinator',
  sort_order: 35,
};

// ── AC-1: therapist/staff 펜차트 인쇄목록 노출 ──────────────────────────────
test('AC-1: therapist 는 pen_chart 인쇄목록 접근 허용', () => {
  expect(canAccessFormTemplate(penChart, 'therapist')).toBe(true);
});

test('AC-1: staff 는 pen_chart 인쇄목록 접근 허용', () => {
  expect(canAccessFormTemplate(penChart, 'staff')).toBe(true);
});

test('AC-1: 보강 role 상수에 therapist/staff 포함', () => {
  expect([...PENCHART_EXTRA_PRINT_ROLES]).toContain('therapist');
  expect([...PENCHART_EXTRA_PRINT_ROLES]).toContain('staff');
});

// ── AC-2: pen_chart 한정 — 타 양식은 영향 없음 ──────────────────────────────
test('AC-2: therapist 는 billing 양식(bill_receipt) 접근 불가(누락 회귀 차단)', () => {
  expect(canAccessFormTemplate(billReceipt, 'therapist')).toBe(false);
});

test('AC-2: staff 는 billing 양식(bill_receipt) 접근 불가', () => {
  expect(canAccessFormTemplate(billReceipt, 'staff')).toBe(false);
});

// ── AC-3: 기존 role 회귀 없음 ──────────────────────────────────────────────
test('AC-3: admin/manager/coordinator/director — pen_chart 노출 유지', () => {
  for (const role of ['admin', 'manager', 'coordinator', 'director']) {
    expect(canAccessFormTemplate(penChart, role), `${role} pen_chart 누락`).toBe(true);
  }
});

test('AC-3: required_role 미포함 일반 role(consultant)은 pen_chart 보강 대상 아님', () => {
  // consultant 는 PENCHART_EXTRA_PRINT_ROLES 미포함 → required_role 정책 그대로 적용
  expect(canAccessFormTemplate(penChart, 'consultant')).toBe(false);
});

test('AC-3: bill_receipt 기존 role(coordinator) 노출 유지', () => {
  expect(canAccessFormTemplate(billReceipt, 'coordinator')).toBe(true);
});
