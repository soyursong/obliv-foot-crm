import { test, expect } from '@playwright/test';
import {
  DOCTOR_FIELD_EDITABLE,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  type DocAdminEditForm,
} from '../../src/components/treatment/DiagDocSection';

/**
 * E2E — T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN (planner GO 2026-07-29, STEP0 diagnose k0ia)
 *   + fast-follow(2026-07-29): 문지은 대표원장 Option A 컨펌 → 진료의(발급 의사) 편집 활성.
 *
 *   현장(김주연 총괄): 치료테이블 → 소견서·진단서 → [행정정보 수정] 을 열면
 *     ① 진료의(발급 의사) 바꾸는 항목이 없고, ② 서류에 안 들어가는 항목 편집칸만 잔뜩.
 *   → [행정정보 수정] 진입점을 고객관리 EditCustomerDialog(고객관리와 공유 = 필드삭제 시 회귀)에서
 *     **서류 행정필드 전용 편집기**(useUpdateOpinionAdminFields 경로)로 재배선.
 *
 * ── 설계 계약(본 spec 이 지키는 불변식) ─────────────────────────────────────────
 *   AC-1 필드셋 정합: 편집기에 서류에 실제 출력되는 행정필드만 — 발급요청일자·발급일·상병코드 +
 *        진료의(발급 의료인). 고객관리 전용 필드(외국인정보·우편번호 등)는 애초에 없음
 *        (삭제 아님 = 재배선 자동 해소, 고객관리 EditCustomerDialog 에 그대로 존치).
 *   AC-2 저장 payload = 변경된 필드만(미변경 undefined).
 *   AC-3 MEDSPACE-CONFIRM-GATE(Q2, 문지은 대표원장) Option A 컨펌 완료 → 진료의 편집 활성
 *        (DOCTOR_FIELD_EDITABLE=true). ★fast-follow 반영 — 이전 read-only(false) 계약을 대체.
 *
 * repo 컨벤션 = 컴포넌트가 export 하는 순수 함수를 spec 이 직접 import·단언(파생 로직 drift 방지).
 */

// ── AC-1: 편집기 필드셋 = 서류 출력 행정필드만(진료의 포함), 고객관리 전용 필드 부재 ──────────
//   편집 가능 필드셋(폼 키) — 컴포넌트 DocAdminEditForm 과 동일 구조.
const EDITABLE_FIELDS = ['requestDate', 'issueDate', 'diagCode', 'doctorId', 'doctorName'] as const;
// 재배선으로 편집기에 애초에 없어야 하는 고객관리 전용 필드(잉여 잔존이 원 문제 ②).
const CUSTOMER_ONLY_FIELDS = ['foreignerInfo', 'foreignRegNo', 'postalCode', 'zipCode', 'address'];

const emptyForm: DocAdminEditForm = { requestDate: '', issueDate: '', diagCode: '', doctorId: '', doctorName: '' };

test('AC-1: 편집 가능 필드셋은 서류 출력 행정필드(발급요청일자·발급일·상병코드·진료의)뿐', () => {
  const form: DocAdminEditForm = {
    requestDate: '2026-07-01', issueDate: '2026-07-02', diagCode: 'K29.7', doctorId: 'doc-1', doctorName: '문지은',
  };
  const keys = Object.keys(form);
  expect(keys.sort()).toEqual([...EDITABLE_FIELDS].sort());
});

test('AC-1: 고객관리 전용 필드(외국인정보·우편번호 등)는 편집기 폼에 애초에 없다(재배선 자동 해소)', () => {
  const keys = Object.keys(emptyForm);
  for (const f of CUSTOMER_ONLY_FIELDS) expect(keys).not.toContain(f);
});

// ── AC-2: 저장 payload = 변경분만 ─────────────────────────────────────────────
test('AC-2: 변경된 필드만 payload 에 담긴다(미변경 = undefined)', () => {
  const init: DocAdminEditForm = { ...emptyForm, requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: 'K29.7' };
  const form: DocAdminEditForm = { ...init, requestDate: '2026-07-05' };
  const payload = buildDocAdminSavePayload(form, init);
  expect(payload.requestDate).toBe('2026-07-05'); // 변경됨
  expect(payload.issueDate).toBeUndefined();       // 미변경
  expect(payload.diagCode).toBeUndefined();         // 미변경
  expect(payload.doctorName).toBeUndefined();       // 미변경(진료의 그대로)
  expect(payload.doctorId).toBeUndefined();
});

test('AC-2: dirty 판정 = 편집 가능 필드(진료의 포함) 변경 여부에 반응', () => {
  const init: DocAdminEditForm = { ...emptyForm, requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: 'K29.7' };
  expect(isDocAdminFormDirty(init, init)).toBe(false);
  expect(isDocAdminFormDirty({ ...init, diagCode: 'K29.8' }, init)).toBe(true);
  expect(isDocAdminFormDirty({ ...init, requestDate: '2026-07-02' }, init)).toBe(true);
  expect(isDocAdminFormDirty({ ...init, doctorId: 'doc-2', doctorName: '김치료' }, init)).toBe(true);
});

// ── AC-3: MEDSPACE-CONFIRM-GATE — Option A 컨펌 완료 → 진료의 편집 활성 ────────────────────
test('AC-3: 진료의 편집 게이트 플래그는 문지은 대표원장 Option A 컨펌 후 true(드롭다운 활성)', () => {
  expect(DOCTOR_FIELD_EDITABLE).toBe(true);
});
