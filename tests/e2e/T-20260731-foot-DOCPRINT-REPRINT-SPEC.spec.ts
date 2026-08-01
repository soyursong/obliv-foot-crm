import { test, expect } from '@playwright/test';
// 발행본 1행 ↔ 발행완료 요청행 매칭(순수) — 재출력(발행이력) [행정정보 수정] 편집 대상 결정 로직.
import { matchPublishedRowToAdminReq } from '../../src/components/doctor/OpinionDocTab';
// 공용 편집기 seed/payload 순수 로직(치료테이블·2번차트와 '동일 편집기' 재사용 — 중복 구현 0 계약).
import {
  seedDocAdminForm,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  DOCTOR_FIELD_EDITABLE,
  EMPTY_DOC_ADMIN_FORM,
  type DocAdminEditForm,
} from '../../src/lib/docAdminEdit';
import type { OpinionRequestRow, PublishedOpinionDoc } from '../../src/lib/opinionRequest';

/**
 * E2E(순수 단언) — T-20260731-foot-DOCPRINT-REPRINT-SPEC (안A B안, 1단계=소견서·진단서/OpinionDocTab)
 *   김주연 총괄(풋센터) 요청: 재출력=발행 고정본 '다시보기'(신규 입력 팝업 X) + [행정정보 수정] 버튼으로
 *   행정필드(발급요청일자·발급일·상병코드·담당의)만 정정 / 의사 소견·발행본 본문은 read-only(published 불변) /
 *   원장 선택 조건 없음(재출력=저장값 사용). 편집(신규 발행 폼)은 [당일 서류 발행]에서만.
 *
 *   본 spec 은 repo 컨벤션(컴포넌트/lib export 순수 함수 직접 단언 → 파생 로직 drift 방지)에 따라
 *   ① 재출력행 → 오버레이 저장소(요청행) 매칭 정확성(교차노출 배제·직접발행분 비노출)을 단언하고,
 *   ② 공용 편집기(DocAdminEditDialog) seed/payload 계약이 치료테이블·2번차트와 동일함(중복 구현 0)을 단언한다.
 *   실제 [행정정보 수정] 버튼 렌더는 data-testid(opinion-history-admin-edit-btn / opinion-editor-admin-*)로 커버.
 */

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────
const reqOpinion: OpinionRequestRow = {
  id: 'req-op', customerId: 'c-1', checkInId: 'ci-1', docType: 'opinion',
  selectedKeys: [], staffMemo: '', oralMedReason: '', patientName: '김발', chartNo: 'F-1',
  birthDate: null, requestedByName: '이실장', requestedAt: '2026-07-30T01:00:00Z',
  createdAt: '2026-07-30T01:00:00Z', requestDate: '2026-07-29', resolvedAt: '2026-07-30T02:00:00Z',
  adminOverrides: { doctorName: '김치료', doctorId: 'doc-B', issueDate: '2026-08-01', diagCode: 'K29.8' },
};
const reqDiagnosis: OpinionRequestRow = {
  ...reqOpinion, id: 'req-dx', checkInId: 'ci-2', docType: 'diagnosis',
  resolvedAt: '2026-07-30T03:00:00Z', adminOverrides: undefined,
};
const reqOtherCustomer: OpinionRequestRow = {
  ...reqOpinion, id: 'req-other', customerId: 'c-2', checkInId: 'ci-1',
};

// ── item1/2: 재출력행 → 오버레이 저장소(요청행) 매칭 ──────────────────────────────
test('item1: check_in_id + doc_type 로 발행본↔요청행 원자 매칭', () => {
  const row = { check_in_id: 'ci-1', doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  const m = matchPublishedRowToAdminReq(row, 'c-1', [reqOpinion, reqDiagnosis]);
  expect(m?.id).toBe('req-op');
});

test('item1: doc_type 이 다르면 매칭되지 않음(진단서↔소견서 교차 금지)', () => {
  const row = { check_in_id: 'ci-1', doc_type: 'diagnosis' as const, issued_at: '2026-07-30T02:00:00Z' };
  // ci-1 요청행은 opinion 뿐 → check_in 폴백(customer+doc_type)으로도 diagnosis(ci-2) 만 후보.
  const m = matchPublishedRowToAdminReq(row, 'c-1', [reqOpinion, reqDiagnosis]);
  expect(m?.id).toBe('req-dx');
});

test('item2: check_in_id 결측(레거시) → customer_id + doc_type 폴백', () => {
  const row = { check_in_id: null, doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  const m = matchPublishedRowToAdminReq(row, 'c-1', [reqOpinion, reqDiagnosis]);
  expect(m?.id).toBe('req-op');
});

test('교차노출 배제: 다른 환자(customer_id)의 요청행은 후보에서 제외', () => {
  const row = { check_in_id: 'ci-1', doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  // c-1 스코프 → 같은 check_in_id 를 가진 c-2 요청행(reqOtherCustomer)은 매칭 안 됨.
  const m = matchPublishedRowToAdminReq(row, 'c-1', [reqOtherCustomer]);
  expect(m).toBeNull();
});

test('직접 발행분(요청 큐 경유 아님) → 매칭 없음 = 편집 버튼 비노출(오편집 차단)', () => {
  const row = { check_in_id: 'ci-99', doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  // ci-99 발행본에 대응하는 요청행이 없고, customer 폴백 대상도 없음 → null.
  const m = matchPublishedRowToAdminReq(row, 'c-1', []);
  expect(m).toBeNull();
});

test('custId 없으면(방어) 매칭 없음', () => {
  const row = { check_in_id: 'ci-1', doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  expect(matchPublishedRowToAdminReq(row, null, [reqOpinion])).toBeNull();
});

test('동일 check_in+doc_type 복수 요청행 → 발행시각 최근접 1건 선택', () => {
  const near: OpinionRequestRow = { ...reqOpinion, id: 'near', resolvedAt: '2026-07-30T02:00:05Z' };
  const far: OpinionRequestRow = { ...reqOpinion, id: 'far', resolvedAt: '2026-07-30T09:00:00Z' };
  const row = { check_in_id: 'ci-1', doc_type: 'opinion' as const, issued_at: '2026-07-30T02:00:00Z' };
  const m = matchPublishedRowToAdminReq(row, 'c-1', [far, near]);
  expect(m?.id).toBe('near');
});

// ── 공용 편집기 계약(치료테이블·2번차트와 동일 = 중복 구현 0) ──────────────────────
const viewDoc: PublishedOpinionDoc = {
  id: 'pub-1', customerId: 'c-1', checkInId: 'ci-1', docType: 'opinion',
  finalText: '소견 본문(read-only)', chartNo: 'F-1', doctorName: '문지은', issuedAt: '2026-07-30T02:00:00Z',
  issuedByLicenseNo: 'L-1', issuedByDoctorId: 'doc-A',
};
const clinicDoctors = [{ id: 'doc-A', name: '문지은' }, { id: 'doc-B', name: '김치료' }];

test('공용 seed — 오버레이(정정값)가 발행본 스냅샷보다 우선(재출력 반영)', () => {
  const seed = seedDocAdminForm(reqOpinion, viewDoc, clinicDoctors);
  expect(seed.requestDate).toBe('2026-07-29');
  expect(seed.doctorName).toBe('김치료');   // 오버레이 담당의
  expect(seed.doctorId).toBe('doc-B');
  expect(seed.issueDate).toBe('2026-08-01'); // 오버레이 발급일
  expect(seed.diagCode).toBe('K29.8');       // 오버레이 상병코드
});

test('공용 seed — 오버레이 없으면 발행본 스냅샷(발행자명·진료의 id 복원)', () => {
  const seed = seedDocAdminForm({ ...reqOpinion, adminOverrides: undefined }, viewDoc, clinicDoctors);
  expect(seed.doctorName).toBe('문지은');
  expect(seed.doctorId).toBe('doc-A');
  expect(seed.diagCode).toBe('');
});

test('행정필드만 정정 payload(의사 소견 본문 미포함) + dirty 판정 계약', () => {
  const init: DocAdminEditForm = { ...EMPTY_DOC_ADMIN_FORM, requestDate: '2026-07-29', issueDate: '2026-07-30', diagCode: 'K29.7' };
  const form: DocAdminEditForm = { ...init, issueDate: '2026-08-01' };
  const payload = buildDocAdminSavePayload(form, init);
  expect(payload.issueDate).toBe('2026-08-01');
  expect(payload.requestDate).toBeUndefined();
  expect(payload.diagCode).toBeUndefined();
  // payload 에는 행정필드 키만 — 의사 소견/본문 필드가 존재하지 않음(published 불변 계약).
  expect(Object.keys(payload).sort()).toEqual(['diagCode', 'doctorId', 'doctorName', 'issueDate', 'requestDate']);
  expect(isDocAdminFormDirty(form, init)).toBe(true);
  expect(isDocAdminFormDirty(init, init)).toBe(false);
  // 담당의(발급 의료인) 편집 = Option A 컨펌 활성(치료테이블·2번차트와 동일 flag).
  expect(DOCTOR_FIELD_EDITABLE).toBe(true);
});
