import { test, expect } from '@playwright/test';
// 공용 편집기 순수 로직 SSOT(치료테이블·2번차트 공유).
import {
  seedDocAdminForm,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  DOCTOR_FIELD_EDITABLE,
  EMPTY_DOC_ADMIN_FORM,
  type DocAdminEditForm,
} from '../../src/lib/docAdminEdit';
// backward-compat re-export 경로(기존 DOCADMIN spec import 경로 무결 — 리팩터 회귀 0).
import {
  DOCTOR_FIELD_EDITABLE as DIAG_DOCTOR_FIELD_EDITABLE,
  buildDocAdminSavePayload as diagBuildPayload,
  isDocAdminFormDirty as diagIsDirty,
} from '../../src/components/treatment/DiagDocSection';
// 2번차트 발행이력 행 빌더 — adminOverrides 오버레이 편입(AC-4).
import { buildCustomerDocRequestRows, type PublishedOpinionDoc } from '../../src/lib/opinionRequest';

/**
 * E2E(순수 단언) — T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK
 *   총괄(김주연) 요청: (AC-1) 소견서·진단서 출력 배선 → (AC-2) [행정정보 수정] 옆 [출력] 버튼 추가 →
 *   (AC-3) 2번차트 서류 재출력 시 [행정정보 수정] 진입 연동 → (AC-4) 세 동선 단일 연동.
 *
 * 본 spec 은 repo 컨벤션(컴포넌트/lib 가 export 하는 순수 함수를 직접 import·단언 → 파생 로직 drift 방지)에 따라
 *   ① 편집기 로직 lib 승격 후에도 계약 불변(재배선 회귀 0), ② 재출력 동선의 오버레이 편입(AC-4)을 단언한다.
 *   실제 [출력]/[행정정보 수정] 버튼 렌더는 data-testid(diagdoc-doc-view-print-btn / opinion-history-doc-view-*)로
 *   surface 스펙에서 커버(리팩터로 diagdoc-admin-* testid 는 공용 편집기 testIdPrefix 로 보존).
 */

// ── AC-1(회귀0): DOCADMIN 순수 로직을 lib 로 승격해도 계약·값 불변, backward-compat re-export 동일 심볼 ──
test('AC-1: 편집기 순수 로직 lib 승격 후에도 payload·dirty·게이트 계약 불변', () => {
  const init: DocAdminEditForm = { ...EMPTY_DOC_ADMIN_FORM, requestDate: '2026-07-01', issueDate: '2026-07-01', diagCode: 'K29.7' };
  const form: DocAdminEditForm = { ...init, requestDate: '2026-07-05' };
  const payload = buildDocAdminSavePayload(form, init);
  expect(payload.requestDate).toBe('2026-07-05');
  expect(payload.issueDate).toBeUndefined();
  expect(payload.diagCode).toBeUndefined();
  expect(isDocAdminFormDirty(form, init)).toBe(true);
  expect(isDocAdminFormDirty(init, init)).toBe(false);
  expect(DOCTOR_FIELD_EDITABLE).toBe(true);
});

test('AC-1: DiagDocSection re-export = docAdminEdit lib 원본과 동일 심볼(기존 spec import 경로 무결)', () => {
  expect(DIAG_DOCTOR_FIELD_EDITABLE).toBe(DOCTOR_FIELD_EDITABLE);
  expect(diagBuildPayload).toBe(buildDocAdminSavePayload);
  expect(diagIsDirty).toBe(isDocAdminFormDirty);
});

// ── AC-3/AC-4: 공용 seed — 행정정보 수정(오버레이) 우선, 없으면 발행본/요청행 스냅샷 ──
const baseTarget = {
  id: 'req-1', customerId: 'c-1', checkInId: 'ci-1', docType: 'opinion' as const,
  selectedKeys: [], staffMemo: '', oralMedReason: '', patientName: '김발', chartNo: 'F-1',
  birthDate: null, requestedByName: '이실장', requestedAt: '2026-07-20T01:00:00Z',
  createdAt: '2026-07-20T01:00:00Z', requestDate: '2026-07-19', resolvedAt: '2026-07-20T02:00:00Z',
};
const viewDoc: PublishedOpinionDoc = {
  id: 'pub-1', customerId: 'c-1', checkInId: 'ci-1', docType: 'opinion',
  finalText: '소견 본문', chartNo: 'F-1', doctorName: '문지은', issuedAt: '2026-07-20T02:00:00Z',
  issuedByLicenseNo: 'L-1', issuedByDoctorId: 'doc-A',
};
const clinicDoctors = [{ id: 'doc-A', name: '문지은' }, { id: 'doc-B', name: '김치료' }];

test('AC-3: seed — 오버레이 없으면 발행본 스냅샷(발행자명·발행일·진료의 id 복원)', () => {
  const seed = seedDocAdminForm({ ...baseTarget }, viewDoc, clinicDoctors);
  expect(seed.requestDate).toBe('2026-07-19');
  expect(seed.doctorName).toBe('문지은');
  expect(seed.doctorId).toBe('doc-A');       // 표시명 → 등록 진료의 id 복원
  expect(seed.diagCode).toBe('');
});

test('AC-4: seed — 행정정보 수정(오버레이) 정정값이 스냅샷보다 우선', () => {
  const target = {
    ...baseTarget,
    adminOverrides: { doctorName: '김치료', doctorId: 'doc-B', issueDate: '2026-07-25', diagCode: 'K29.8' },
  };
  const seed = seedDocAdminForm(target, viewDoc, clinicDoctors);
  expect(seed.doctorName).toBe('김치료');
  expect(seed.doctorId).toBe('doc-B');
  expect(seed.issueDate).toBe('2026-07-25');  // 오버레이 발급일 우선
  expect(seed.diagCode).toBe('K29.8');
});

// ── AC-4: 2번차트 발행이력 행 빌더가 admin_overrides 오버레이를 함께 실어준다(재출력·seed 반영) ──
test('AC-4: buildCustomerDocRequestRows — 발행완료 행에 admin_overrides 오버레이 편입', () => {
  const raw = [{
    id: 'req-9', customer_id: 'c-1', check_in_id: 'ci-9', created_at: '2026-07-20T01:00:00Z',
    status: 'voided',
    field_data: {
      request_origin: 'staff_consult', resolved_reason: 'published', doc_type: 'opinion',
      patient_name: '김발', requested_by_name: '이실장', request_date: '2026-07-19',
      resolved_at: '2026-07-20T02:00:00Z',
      admin_overrides: { doctor_name: '김치료', doctor_id: 'doc-B', issue_date: '2026-07-25', diag_code: 'K29.8' },
    },
  }];
  const rows = buildCustomerDocRequestRows(raw);
  expect(rows).toHaveLength(1);
  expect(rows[0].issueStatus).toBe('issued');
  expect(rows[0].adminOverrides).toBeDefined();
  expect(rows[0].adminOverrides?.doctorName).toBe('김치료');
  expect(rows[0].adminOverrides?.issueDate).toBe('2026-07-25');
  expect(rows[0].adminOverrides?.diagCode).toBe('K29.8');
});

test('AC-4: buildCustomerDocRequestRows — 오버레이 없는 행은 adminOverrides undefined(회귀 0)', () => {
  const raw = [{
    id: 'req-10', customer_id: 'c-1', check_in_id: 'ci-10', created_at: '2026-07-20T01:00:00Z',
    status: 'draft',
    field_data: {
      request_origin: 'staff_consult', doc_type: 'diagnosis', patient_name: '박발', requested_by_name: '이실장',
    },
  }];
  const rows = buildCustomerDocRequestRows(raw);
  expect(rows).toHaveLength(1);
  expect(rows[0].issueStatus).toBe('requested');
  expect(rows[0].adminOverrides).toBeUndefined();
});
