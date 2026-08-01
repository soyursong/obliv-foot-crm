// docAdminEdit.ts — 소견서·진단서 [행정정보 수정] 편집기 순수 로직 (SSOT)
// Ticket: T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN 에서 DiagDocSection 내부에 있던
//   순수 파생 로직을 추출한 것.
//   T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK (AC-3/AC-4): 치료테이블(DiagDocSection)과
//   2번차트(OpinionDocHistorySection) 두 surface 가 '동일 편집기'를 공유하도록 순수 로직을 lib 로
//   승격 — 중복 구현 금지(단일 소스). DiagDocSection 은 backward-compat 로 이 심볼을 re-export 한다
//   (기존 E2E spec import 경로 '../../src/components/treatment/DiagDocSection' 유지).
//
//   ★편집 가능한 필드셋 = 서류에 실제 출력되는 행정필드만(발급요청일자·발급일·상병코드) + 진료의(발급 의료인).
//     고객관리 전용 필드(외국인정보·우편번호 등)는 이 편집기에 애초에 없음(재배선 자동 해소).
//   ★발행본(medical narrative)·발행 파이프라인 무접촉 — 편집 오버레이는 발행완료 '요청행'
//     (status='voided'+resolved_reason='published') field_data.admin_overrides 에 append(published 불오염).

import { seoulISODate } from '@/lib/format';
import type { AdminFieldOverrides, OpinionRequestRow, PublishedOpinionDoc } from '@/lib/opinionRequest';

export interface DocAdminEditForm {
  requestDate: string; // 발급요청일자(YYYY-MM-DD)
  issueDate: string;   // 발급일(YYYY-MM-DD)
  diagCode: string;    // 상병코드(primary, 예 K29.7)
  doctorId: string;    // 진료의(발급 의료인) 앵커 = clinic_doctors.id. '' = 미지정.
  doctorName: string;  // 진료의 표시명(doctorId 선택 시 함께 결선). '' = 미지정.
}

export const EMPTY_DOC_ADMIN_FORM: DocAdminEditForm = {
  requestDate: '', issueDate: '', diagCode: '', doctorId: '', doctorName: '',
};

// ★MEDSPACE-CONFIRM-GATE(Q2, 문지은 대표원장): 진료의(발급 의료인) 변경 = 의료 법정 귀속 → confirm 필요.
//   T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN fast-follow: 문지은 대표원장 Option A 컨펌 완료
//   (치료사도 [행정정보 수정]에서 담당 진료의를 드롭다운으로 변경 허용) → 플래그 flip.
export const DOCTOR_FIELD_EDITABLE = true;

// 변경된 필드만 담은 저장 payload. 진료의(doctorId)가 바뀌면 doctorName·doctorId 를 함께 실어 보낸다
//   (mutation 이 doctorName 변경분을 감사로그에 남기고 doctor_id 를 도장 자동추종 앵커로 정정).
export function buildDocAdminSavePayload(
  form: DocAdminEditForm,
  init: DocAdminEditForm,
): { requestDate?: string; issueDate?: string; diagCode?: string; doctorName?: string; doctorId?: string } {
  const doctorChanged = form.doctorId !== init.doctorId;
  return {
    requestDate: form.requestDate !== init.requestDate ? form.requestDate : undefined,
    issueDate: form.issueDate !== init.issueDate ? form.issueDate : undefined,
    diagCode: form.diagCode !== init.diagCode ? form.diagCode : undefined,
    doctorName: doctorChanged ? form.doctorName : undefined,
    doctorId: doctorChanged ? form.doctorId : undefined,
  };
}

export function isDocAdminFormDirty(form: DocAdminEditForm, init: DocAdminEditForm): boolean {
  return (
    form.requestDate !== init.requestDate ||
    form.issueDate !== init.issueDate ||
    form.diagCode !== init.diagCode ||
    form.doctorId !== init.doctorId
  );
}

// 편집 대상(요청행)·발행본 스냅샷·등록 진료의 목록으로 폼 초기값을 만든다.
//   오버레이(정정값) 우선, 없으면 요청행/발행본 스냅샷. 진료의는 앵커(doctor_id) 우선, 없으면 표시명 매칭으로 id 복원.
//   ★DiagDocSection 의 seed useEffect 를 그대로 추출 — drift 방지(두 surface 동일 seed 규칙).
export function seedDocAdminForm(
  target: OpinionRequestRow,
  viewDoc: PublishedOpinionDoc | null,
  clinicDoctors: { id: string; name: string }[],
): DocAdminEditForm {
  const ov: AdminFieldOverrides | undefined = target.adminOverrides;
  const seedIssueDate =
    ov?.issueDate
    || (viewDoc?.issuedAt ? seoulISODate(viewDoc.issuedAt)
      : target.resolvedAt ? seoulISODate(target.resolvedAt) : '');
  const seedDoctorName = ov?.doctorName ?? viewDoc?.doctorName ?? '';
  const seedDoctorId =
    ov?.doctorId
    ?? (seedDoctorName ? clinicDoctors.find((d) => d.name === seedDoctorName)?.id : undefined)
    ?? '';
  return {
    requestDate: target.requestDate || '',
    issueDate: seedIssueDate,
    diagCode: ov?.diagCode ?? '',
    doctorId: seedDoctorId,
    doctorName: seedDoctorName,
  };
}
