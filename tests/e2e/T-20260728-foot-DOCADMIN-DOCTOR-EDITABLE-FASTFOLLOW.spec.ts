import { test, expect } from '@playwright/test';
import {
  DOCTOR_FIELD_EDITABLE,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  type DocAdminEditForm,
} from '../../src/components/treatment/DiagDocSection';

/**
 * E2E — T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN · fast-follow (2026-07-29)
 *   진료의(발급 의사) 드롭다운 편집 활성 — 문지은 대표원장 Option A 컨펌 완료
 *   (MEDSPACE-CONFIRM-GATE 해소: 치료사도 [행정정보 수정]에서 담당 진료의를 드롭다운으로 변경 허용).
 *
 * ── 무회귀 임계(수용기준) ─────────────────────────────────────────────────────
 *   (A) 진료의 드롭다운 = 유효 발급 의료인(clinic_doctors, active=true) 목록만 노출·저장.
 *       → useClinicDoctors 단일 소스(진료대시보드와 동일 훅). 드롭다운 option = 등록 진료의만.
 *   (B) 서류(소견서·진단서) 렌더·발급 로직 무회귀 — 진료의 auto-bind 경로(T-20260718 deployed) 유지.
 *       → 진료의 변경 시 payload 는 doctorName(표시)과 doctorId(도장 자동추종 앵커)를 항상 함께 실어야 함.
 *   (C) admin_overrides 저장 → 재로드 → 서류 반영 정합.
 *       → 저장 후 재-seed(init) 하면 dirty=false, 동일 진료의 재선택은 payload 무생성(멱등).
 *
 * repo 컨벤션 = 컴포넌트가 export 하는 순수 함수를 spec 이 직접 import·단언(파생 로직 drift 방지).
 */

const base: DocAdminEditForm = {
  requestDate: '2026-07-01', issueDate: '2026-07-02', diagCode: 'K29.7',
  doctorId: 'doc-old', doctorName: '문지은',
};

test('GATE: 진료의 편집 활성(Option A 컨펌) — DOCTOR_FIELD_EDITABLE=true', () => {
  expect(DOCTOR_FIELD_EDITABLE).toBe(true);
});

test('AC-B: 진료의 변경 시 payload 에 doctorName·doctorId 를 함께 실어 보낸다(도장 auto-bind 앵커 정합)', () => {
  const form: DocAdminEditForm = { ...base, doctorId: 'doc-new', doctorName: '김치료' };
  const payload = buildDocAdminSavePayload(form, base);
  expect(payload.doctorId).toBe('doc-new');
  expect(payload.doctorName).toBe('김치료');
  // 진료의 외 필드 미변경 → payload 에 없음(변경분만).
  expect(payload.requestDate).toBeUndefined();
  expect(payload.issueDate).toBeUndefined();
  expect(payload.diagCode).toBeUndefined();
});

test('AC-B: doctorId 미변경이면 진료의 키는 payload 에 없다(발급 의료인 귀속 불변)', () => {
  const form: DocAdminEditForm = { ...base, diagCode: 'M79.6' }; // 진료의는 그대로
  const payload = buildDocAdminSavePayload(form, base);
  expect(payload.doctorId).toBeUndefined();
  expect(payload.doctorName).toBeUndefined();
  expect(payload.diagCode).toBe('M79.6');
});

test('AC-C: 저장 → 재로드(재-seed) 후 dirty=false, 동일 진료의 재선택은 멱등(payload 무생성)', () => {
  // 저장 완료 후 오버레이가 재-seed 된 상태(reloaded)를 init 으로 삼음.
  const reloaded: DocAdminEditForm = { ...base, doctorId: 'doc-new', doctorName: '김치료' };
  expect(isDocAdminFormDirty(reloaded, reloaded)).toBe(false);
  const payload = buildDocAdminSavePayload(reloaded, reloaded);
  expect(payload.doctorId).toBeUndefined();
  expect(payload.doctorName).toBeUndefined();
});

test('AC-C: 진료의만 바꿔도 dirty=true (저장 버튼 활성 경로)', () => {
  expect(isDocAdminFormDirty({ ...base, doctorId: 'doc-x', doctorName: '박치료' }, base)).toBe(true);
});
