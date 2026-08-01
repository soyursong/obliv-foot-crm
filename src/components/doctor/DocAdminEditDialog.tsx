// DocAdminEditDialog.tsx — 소견서·진단서 [행정정보 수정] 편집기 (공용 모달)
// Ticket: T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK (AC-3/AC-4)
//   T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN 이 DiagDocSection(치료테이블)에 배포한
//   [행정정보 수정] 편집기 모달을 '공용 컴포넌트'로 승격 — 치료테이블(DiagDocSection)과
//   2번차트(OpinionDocHistorySection) 두 surface 가 동일 편집기를 재사용(중복 구현 금지, 단일 소스).
//
//   ★편집 대상 = 발행완료 요청행(status='voided'+resolved_reason='published') field_data.admin_overrides.
//     발행 원본(published)·발행 파이프라인 무접촉(의료법§22 스냅샷 불변). 신규 스키마 0(NO-DDL).
//   ★서류에 실제 출력되는 행정필드만: 발급요청일자 · 발급일 · 상병코드(편집) + 진료의(발급 의료인, Option A 컨펌 활성).
//   ★진료의(발급 의료인) 변경 = 법정 귀속 → 문지은 대표원장 Option A 컨펌 완료로 드롭다운 활성(DOCTOR_FIELD_EDITABLE).

import { useEffect, useState } from 'react';
import { useClinicDoctors } from '@/components/doctor/OpinionDocTab';
import {
  useUpdateOpinionAdminFields,
  docTypeLabel,
  type OpinionRequestRow,
  type PublishedOpinionDoc,
} from '@/lib/opinionRequest';
import {
  DOCTOR_FIELD_EDITABLE,
  EMPTY_DOC_ADMIN_FORM,
  buildDocAdminSavePayload,
  isDocAdminFormDirty,
  seedDocAdminForm,
  type DocAdminEditForm,
} from '@/lib/docAdminEdit';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, FilePen, Lock } from 'lucide-react';

interface Props {
  /** 편집 대상 요청행(발행완료). null = 모달 닫힘. */
  target: OpinionRequestRow | null;
  /** 발행본 스냅샷(발급일·발행자 seed 소스). */
  viewDoc: PublishedOpinionDoc | null;
  clinicId: string | null;
  onClose: () => void;
  /** 저장 성공 후 콜백 — 각 surface 가 자기 query key 를 invalidate(오버레이 즉시 반영). */
  onSaved?: () => void;
  /** data-testid 접두사(surface 별 spec 앵커 유지). 예: 'diagdoc-admin' / 'opinion-history-admin'. */
  testIdPrefix: string;
}

export default function DocAdminEditDialog({ target, viewDoc, clinicId, onClose, onSaved, testIdPrefix }: Props) {
  const { profile } = useAuth();
  const adminMut = useUpdateOpinionAdminFields(clinicId);
  // 진료의(발급 의료인) 옵션 소스 — 진료대시보드와 동일 훅(react-query dedup → 신규 조회 0).
  const { data: clinicDoctors = [] } = useClinicDoctors(clinicId);

  const [adminForm, setAdminForm] = useState<DocAdminEditForm>(EMPTY_DOC_ADMIN_FORM);
  const [adminInit, setAdminInit] = useState<DocAdminEditForm>(EMPTY_DOC_ADMIN_FORM);

  // 편집 대상 바뀔 때 폼 초기화 — 오버레이(정정값) 우선, 없으면 요청행/발행본 스냅샷(공용 seed).
  useEffect(() => {
    if (!target) return;
    const init = seedDocAdminForm(target, viewDoc, clinicDoctors);
    setAdminForm(init);
    setAdminInit(init);
  }, [target, viewDoc, clinicDoctors]);

  const adminDirty = isDocAdminFormDirty(adminForm, adminInit);
  // 진료의(발급 의료인) read-only 표시명 — 오버레이 정정값 우선, 없으면 발행본 발행자명.
  const currentDoctorName = target?.adminOverrides?.doctorName ?? viewDoc?.doctorName ?? '';

  const handleAdminSave = async () => {
    if (!target || !adminDirty) return;
    if (!profile?.id) { toast.error('직원 계정 정보를 확인할 수 없습니다.'); return; }
    const payload = buildDocAdminSavePayload(adminForm, adminInit);
    try {
      await adminMut.mutateAsync({
        requestId: target.id,
        ...payload, // requestDate/issueDate/diagCode/진료의(doctorName+doctorId)(변경분만).
        editorId: profile.id,
        editorName: profile.name ?? profile.email ?? '직원',
      });
      toast.success('행정 정보를 저장했습니다.');
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(`저장에 실패했습니다. ${(e as Error)?.message ?? ''}`);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid={`${testIdPrefix}-edit-dialog`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid={`${testIdPrefix}-edit-title`}>
            <FilePen className="h-5 w-5 text-teal-600" />
            행정정보 수정
            {target && (
              <span className="text-sm font-normal text-muted-foreground">
                · {docTypeLabel(target.docType)}
                {target.patientName ? ` · ${target.patientName}` : ''}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            서류에 출력되는 발급 정보만 정정할 수 있어요. 진단소견·의사소견 본문은 원장님 작성분이라 수정할 수 없어요.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            발급요청일자
            <input
              type="date"
              value={adminForm.requestDate}
              onChange={(e) => setAdminForm((f) => ({ ...f, requestDate: e.target.value }))}
              className="h-11 rounded-md border border-input bg-background px-2 text-sm"
              data-testid={`${testIdPrefix}-request-date`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            발급일
            <input
              type="date"
              value={adminForm.issueDate}
              onChange={(e) => setAdminForm((f) => ({ ...f, issueDate: e.target.value }))}
              className="h-11 rounded-md border border-input bg-background px-2 text-sm"
              data-testid={`${testIdPrefix}-issue-date`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            상병코드
            <input
              type="text"
              value={adminForm.diagCode}
              onChange={(e) => setAdminForm((f) => ({ ...f, diagCode: e.target.value }))}
              placeholder="예: K29.7"
              className="h-11 rounded-md border border-input bg-background px-2 text-sm"
              data-testid={`${testIdPrefix}-diag-code`}
            />
          </label>

          {/* 진료의(발급 의료인) — MEDSPACE-CONFIRM-GATE(문지은 대표원장) Option A 컨펌 완료 → 드롭다운 활성.
              유효 발급 의료인(clinic_doctors, active=true) 목록만 노출(진료대시보드와 동일 소스). 선택 →
              doctor_id(도장 자동추종 앵커) + doctor_name(표시명) 을 admin_overrides 에 정정(감사로그 append). */}
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            진료의 (발급 의료인)
            {DOCTOR_FIELD_EDITABLE ? (
              <select
                value={adminForm.doctorId}
                onChange={(e) => {
                  const id = e.target.value;
                  const doc = clinicDoctors.find((d) => d.id === id);
                  setAdminForm((f) => ({ ...f, doctorId: id, doctorName: doc?.name ?? '' }));
                }}
                className="h-11 rounded-md border border-input bg-background px-2 text-sm"
                data-testid={`${testIdPrefix}-doctor-select`}
              >
                <option value="">진료의 선택</option>
                {clinicDoctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <div
                className="flex h-11 items-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 text-sm text-slate-600"
                data-testid={`${testIdPrefix}-doctor-readonly`}
                title="발급 의료인 변경은 대표원장 확인 후 활성화됩니다"
              >
                <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{currentDoctorName || '미지정'}</span>
              </div>
            )}
          </label>
        </div>

        {!DOCTOR_FIELD_EDITABLE && (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-500" data-testid={`${testIdPrefix}-doctor-gate-note`}>
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            진료의(발급 의료인) 변경은 법정 서류 귀속과 관련되어 대표원장님 확인 후 열릴 예정이에요. 현재는 발급된 의료인이 표시만 됩니다.
          </p>
        )}
        <p className="text-[11px] leading-snug text-slate-500">
          ※ 상병코드는 진단과 관련된 정보라 정정 내역(누가·언제·이전값)이 기록으로 남아요. 상병명은 진료 기록 기준으로 표시됩니다.
        </p>

        <DialogFooter className="flex-row justify-end gap-2 border-t pt-3">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid={`${testIdPrefix}-cancel-btn`}
          >
            닫기
          </Button>
          <Button
            onClick={() => void handleAdminSave()}
            disabled={!adminDirty || adminMut.isPending}
            className="bg-teal-600 text-white hover:bg-teal-700"
            data-testid={`${testIdPrefix}-save-btn`}
          >
            {adminMut.isPending ? (
              <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> 저장 중…</>
            ) : (
              '행정 정보 저장'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
