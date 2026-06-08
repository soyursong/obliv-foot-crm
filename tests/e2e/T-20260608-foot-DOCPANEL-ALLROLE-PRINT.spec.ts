/**
 * E2E Spec — T-20260608-foot-DOCPANEL-ALLROLE-PRINT
 *
 * 현장 P1 — 직원(데스크/코디=coordinator) 계정으로 1번차트(CheckInDetailSheet)·
 * 2번차트(CustomerChartPage) 진입 시, 아래 5종 서류가 form_templates.required_role
 * (admin|manager 등)에 미포함되어 서류 발행 패널(DocumentPrintPanel)에서 누락되던 문제.
 *
 * 정책 확정(김주연 총괄): 아래 5종은 모든 역할에서 인쇄 가능.
 *   소견서 diag_opinion · 처방전 prescription · 진단서 diagnosis ·
 *   진료비납입증명서 payment_cert · 진료의뢰서 referral_letter
 *
 * 수정: formTemplates.canAccessFormTemplate() 단일 판정 함수에 ALL_ROLE_PRINT_FORM_KEYS
 *       전체 허용 분기 추가. DB required_role 변경 없음(db_changed=false).
 *       1번/2번 차트 모두 DocumentPrintPanel.canAccess 단일 소스를 공유 → 양쪽 동시 적용.
 *
 * AC-1: coordinator role 에서 5종 서류 인쇄목록 노출(접근 허용) — 1번/2번 차트 공통 소스.
 * AC-2: 모든 비-admin role(staff/therapist/consultant/director)에서도 5종 노출.
 * AC-3: 5종 한정 보강 — required_role 정책 양식(med_record 등)은 회귀 없음.
 * AC-4: admin/manager 기존 인쇄 경로 회귀 없음.
 *
 * 실행: npx playwright test T-20260608-foot-DOCPANEL-ALLROLE-PRINT.spec.ts
 * NOTE: 순수 로직 테스트 — 실서버 불필요(DocumentPrintPanel canAccess 단일 소스 검증).
 */

import { test, expect } from '@playwright/test';
import {
  canAccessFormTemplate,
  ALL_ROLE_PRINT_FORM_KEYS,
  FALLBACK_TEMPLATES,
  type FormTemplate,
} from '../../src/lib/formTemplates';

const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 대상 5종 — fallback 시드(운영 DB required_role 과 동일 정책)에서 직접 추출
const TARGET_KEYS = ['diag_opinion', 'prescription', 'diagnosis', 'payment_cert', 'referral_letter'] as const;
const targetTemplates = TARGET_KEYS.map((k) => {
  const tpl = FALLBACK_TEMPLATES.find((t) => t.form_key === k);
  if (!tpl) throw new Error(`fallback 템플릿 누락: ${k}`);
  return tpl;
});

// ⚠️ AC-0 진단(2026-06-08) 회귀 가드 — 운영 DB form_templates 실제 행 시뮬레이션.
//   운영 활성 "처방전"은 form_key='rx_standard'(NOT 'prescription'). DB 빈 환경이 아니면
//   line 432-434 에서 DB 행이 fallback 을 대체 → canAccess 는 'rx_standard' 로 판정된다.
//   직전 보강(bef9a98)은 fallback 키 'prescription' 만 추가해 처방전이 coordinator 에게
//   계속 비활성 노출됨. 본 spec 이 운영 실키를 막아 재발을 차단한다.
const PROD_RX_STANDARD: FormTemplate = {
  id: 'tpl-prod-rx-standard',
  clinic_id: FOOT_CLINIC_ID,
  category: 'foot-service',
  form_key: 'rx_standard',
  name_ko: '처방전(표준처방전)',
  template_path: '',
  template_format: 'jpg',
  field_map: [],
  requires_signature: false,
  required_role: 'admin|manager|director', // 운영 DB 실제 값(coordinator 미포함)
  active: true,
  sort_order: 20,
};

// 회귀 검증용 — 5종 외 양식(의무기록사본발급신청서). coordinator 는 required_role 정책 그대로.
const medRecordReq: FormTemplate = {
  id: 'tpl-med-record-request',
  clinic_id: FOOT_CLINIC_ID,
  category: 'foot-service',
  form_key: 'medical_record_request',
  name_ko: '의무기록사본발급신청서',
  template_path: '',
  template_format: 'html',
  field_map: [],
  requires_signature: true,
  required_role: 'admin|manager|coordinator',
  active: true,
  sort_order: 95,
};

// admin|manager 한정 양식(5종 외) — therapist/staff 누락이 유지돼야 정상(회귀 차단)
const adminOnlyForm: FormTemplate = {
  ...medRecordReq,
  id: 'tpl-admin-only',
  form_key: 'med_record_short',
  name_ko: '진료기록사본(1-5매)',
  required_role: 'admin|manager',
};

// ── AC-1: coordinator 는 5종 모두 인쇄목록 접근 허용 ─────────────────────────
test('AC-1: coordinator(데스크/코디) 는 5종 서류 인쇄목록 모두 접근 허용', () => {
  for (const tpl of targetTemplates) {
    expect(canAccessFormTemplate(tpl, 'coordinator'), `coordinator ${tpl.form_key}(${tpl.name_ko}) 누락`).toBe(true);
  }
});

test('AC-1: 보강 상수 ALL_ROLE_PRINT_FORM_KEYS 에 5종 모두 포함', () => {
  for (const k of TARGET_KEYS) {
    expect([...ALL_ROLE_PRINT_FORM_KEYS]).toContain(k);
  }
  // AC-0 진단 후: 운영 DB 처방전 실키 'rx_standard' 도 포함되어야 함(fallback 'prescription' 과 병행).
  expect([...ALL_ROLE_PRINT_FORM_KEYS]).toContain('rx_standard');
});

// ── AC-1b: 운영 DB 실키 회귀 가드 — 처방전(rx_standard) coordinator 접근 ──────
test('AC-1b: [운영DB 회귀가드] 처방전 form_key=rx_standard 는 coordinator 접근 허용', () => {
  // 직전 보강이 놓친 핵심 케이스. DB 시드가 fallback 을 대체하는 운영 환경 재현.
  expect(canAccessFormTemplate(PROD_RX_STANDARD, 'coordinator'),
    '처방전(rx_standard) coordinator 비활성 — AC-0 근본원인 재발').toBe(true);
  for (const role of ['staff', 'therapist', 'consultant']) {
    expect(canAccessFormTemplate(PROD_RX_STANDARD, role), `${role} 처방전(rx_standard) 누락`).toBe(true);
  }
});

// ── AC-2: 모든 비-admin role 에서 5종 노출 ──────────────────────────────────
test('AC-2: 임의 role(staff/therapist/consultant/director/빈문자열)에서도 5종 노출', () => {
  for (const role of ['staff', 'therapist', 'consultant', 'director', '']) {
    for (const tpl of targetTemplates) {
      expect(canAccessFormTemplate(tpl, role), `${role || '(빈)'} ${tpl.form_key} 누락`).toBe(true);
    }
  }
});

// ── AC-3: 5종 한정 — 그 외 양식은 required_role 정책 그대로(회귀 차단) ───────
test('AC-3: 5종 외 양식(med_record_short, admin|manager)은 coordinator 접근 불가 유지', () => {
  expect(canAccessFormTemplate(adminOnlyForm, 'coordinator')).toBe(false);
  expect(canAccessFormTemplate(adminOnlyForm, 'therapist')).toBe(false);
});

test('AC-3: 5종 외 양식(medical_record_request)은 required_role 정책 그대로 적용', () => {
  // coordinator 포함 → 허용 / consultant 미포함 → 불가
  expect(canAccessFormTemplate(medRecordReq, 'coordinator')).toBe(true);
  expect(canAccessFormTemplate(medRecordReq, 'consultant')).toBe(false);
});

// ── AC-4: 기존 admin/manager 인쇄 경로 회귀 없음 ────────────────────────────
test('AC-4: admin/manager — 5종 노출 유지(회귀 없음)', () => {
  for (const role of ['admin', 'manager']) {
    for (const tpl of targetTemplates) {
      expect(canAccessFormTemplate(tpl, role), `${role} ${tpl.form_key} 누락`).toBe(true);
    }
  }
});

test('AC-4: admin — 5종 외 일반 양식도 기존대로 노출(회귀 없음)', () => {
  expect(canAccessFormTemplate(adminOnlyForm, 'admin')).toBe(true);
  expect(canAccessFormTemplate(medRecordReq, 'manager')).toBe(true);
});
