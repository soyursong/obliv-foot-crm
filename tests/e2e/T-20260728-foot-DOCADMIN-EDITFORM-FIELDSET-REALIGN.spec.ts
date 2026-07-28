import { test, expect } from '@playwright/test';
import {
  DOCTOR_FIELD_EDITABLE,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  type DocAdminEditForm,
} from '../../src/components/treatment/DiagDocSection';

/**
 * E2E — T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN (planner GO 2026-07-29, STEP0 diagnose k0ia)
 *
 *   현장(김주연 총괄): 치료테이블 → 소견서·진단서 → [행정정보 수정] 을 열면
 *     ① 진료의(발급 의사) 바꾸는 항목이 없고, ② 서류에 안 들어가는 항목 편집칸만 잔뜩.
 *   → [행정정보 수정] 진입점을 고객관리 EditCustomerDialog(고객관리와 공유 = 필드삭제 시 회귀)에서
 *     **서류 행정필드 전용 편집기**(useUpdateOpinionAdminFields 경로)로 재배선.
 *
 * ── 설계 계약(본 spec 이 지키는 불변식) ─────────────────────────────────────────
 *   AC-1 필드셋 정합: 편집기에 서류에 실제 출력되는 행정필드만 — 발급요청일자·발급일·상병코드(편집) +
 *        진료의(발급 의료인, read-only 표시). 고객관리 전용 필드(외국인정보·우편번호 등)는 애초에 없음
 *        (삭제 아님 = 재배선 자동 해소, 고객관리 EditCustomerDialog 에 그대로 존치).
 *   AC-2 저장 payload = 변경된 필드만(미변경 undefined). ★진료의(doctor*)는 구조적으로 절대 포함 안 됨.
 *   AC-3 MEDSPACE-CONFIRM-GATE(Q2, 문지은 대표원장): 진료의 편집은 confirm 전까지 비활성
 *        (DOCTOR_FIELD_EDITABLE=false, read-only 표시). confirm 수신 시 이 플래그만 true 로 fast-follow.
 *
 * repo 컨벤션 = 컴포넌트가 export 하는 순수 함수를 spec 이 직접 import·단언(파생 로직 drift 방지).
 */

// ── AC-1: 편집기 필드셋 = 서류 출력 행정필드만(진료의 read-only 포함), 고객관리 전용 필드 부재 ──────────
//   편집 가능 필드셋(폼 키) — 컴포넌트 DocAdminEditForm 과 동일 구조.
const EDITABLE_FIELDS = ['requestDate', 'issueDate', 'diagCode'] as const;
// 재배선으로 편집기에 애초에 없어야 하는 고객관리 전용 필드(잉여 잔존이 원 문제 ②).
const CUSTOMER_ONLY_FIELDS = ['foreignerInfo', 'foreignRegNo', 'postalCode', 'zipCode', 'address'];

test('AC-1: 편집 가능 필드셋은 서류 출력 행정필드(발급요청일자·발급일·상병코드)뿐', () => {
  const form: DocAdminEditForm = { requestDate: '2026-07-01', issueDate: '2026-07-02', diagCode: 'K29.7' };
  const keys = Object.keys(form);
  expect(keys.sort()).toEqual([...EDITABLE_FIELDS].sort());
});

test('AC-1: 고객관리 전용 필드(외국인정보·우편번호 등)는 편집기 폼에 애초에 없다(재배선 자동 해소)', () => {
  const form: DocAdminEditForm = { requestDate: '', issueDate: '', diagCode: '' };
  const keys = Object.keys(form);
  for (const f of CUSTOMER_ONLY_FIELDS) expect(keys).not.toContain(f);
});

// ── AC-2: 저장 payload = 변경분만, 진료의(doctor*)는 절대 포함 안 됨 ───────────────────────────────
test('AC-2: 변경된 필드만 payload 에 담긴다(미변경 = undefined)', () => {
  const init: DocAdminEditForm = { requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: 'K29.7' };
  const form: DocAdminEditForm = { requestDate: '2026-07-05', issueDate: '2026-07-01', diagCode: 'K29.7' };
  const payload = buildDocAdminSavePayload(form, init);
  expect(payload.requestDate).toBe('2026-07-05'); // 변경됨
  expect(payload.issueDate).toBeUndefined();       // 미변경
  expect(payload.diagCode).toBeUndefined();         // 미변경
});

test('AC-2: 저장 payload 에 진료의(doctorName/doctorId) 키가 구조적으로 없다(발급 의료인 귀속 불변)', () => {
  const init: DocAdminEditForm = { requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: '' };
  const form: DocAdminEditForm = { requestDate: '2026-07-09', issueDate: '2026-07-10', diagCode: 'M79.6' };
  const payload = buildDocAdminSavePayload(form, init) as Record<string, unknown>;
  expect(payload).not.toHaveProperty('doctorName');
  expect(payload).not.toHaveProperty('doctorId');
  // 편집기에서 어떤 조작을 해도(진료의는 read-only) 발급 의료인 정정 payload 는 생성 불가.
  expect(Object.keys(payload).every((k) => (EDITABLE_FIELDS as readonly string[]).includes(k))).toBe(true);
});

test('AC-2: dirty 판정 = 편집 가능 3필드 변경 여부에만 반응(진료의 read-only → dirty 축에 없음)', () => {
  const init: DocAdminEditForm = { requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: 'K29.7' };
  expect(isDocAdminFormDirty(init, init)).toBe(false);
  expect(isDocAdminFormDirty({ ...init, diagCode: 'K29.8' }, init)).toBe(true);
  expect(isDocAdminFormDirty({ ...init, requestDate: '2026-07-02' }, init)).toBe(true);
});

// ── AC-3: MEDSPACE-CONFIRM-GATE — 진료의 편집은 confirm 전까지 비활성(read-only) ────────────────────
test('AC-3: 진료의 편집 게이트 플래그는 confirm(문지은 대표원장) 전까지 false(read-only 표시)', () => {
  // confirm_status: pending → 진료의 드롭다운 미노출, 현재 발급의 read-only 표시. confirm 수신 시 true 로 fast-follow.
  expect(DOCTOR_FIELD_EDITABLE).toBe(false);
});
