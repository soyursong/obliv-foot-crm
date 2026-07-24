// IssuedOpinionDocFormView — 발행완료 소견서/진단서 '양식 그대로' read-only 열람 렌더러.
// Ticket: T-20260724-foot-ISSUEDDOCS-DOCVIEW-FORMLAYOUT (P1, 김주연 총괄 풋센터 요청)
//
//   요청: 발행완료 서류명 클릭 열람(ISSUEDDOCS-DOCVIEW-CLICKOPEN, deployed)이 지금은 본문 텍스트만
//     나온다 → 실제 소견서 발행/출력 시 보이는 '양식 그대로'(병원 헤더·환자정보 블록·상병/소견 영역·
//     발급일·담당의·서명/도장)로 렌더링해 달라.
//
//   설계(재사용 원칙, AC2 — 신규 양식 스택 금지):
//     · 양식 HTML = printOpinionDoc 이 인쇄 시 쓰는 renderOpinionDocHtml(bindHtmlTemplate L-006 단일 경로)를
//       그대로 재사용 → 인쇄본과 열람본이 구조적으로 동일 양식(양식 SSOT 1개). 좌표/여백 추측 없음.
//     · 데이터 = 발행 저장본(form_submissions.field_data) READ + 인쇄 경로(OpinionDocTab.handlePrint)와
//       동일한 공용 바인더(loadAutoBindContext + applyDiagCodesFromVisit)로 환자정보·상병코드·직인 주입.
//       발행자·면허·차트번호·발행일·본문은 스냅샷 override(법정 의무기록 불변) — renderOpinionDocHtml 내부 규칙.
//     · read-only: 화면에 그리기만(재발행/취소/수정 없음). 발행/취소 RPC 무접촉. db_change=false(신규 write 0).
//
//   graceful fallback: check_in 결측(레거시) 등으로 자동바인딩 불가하면 autoValues 없이 렌더 → 환자정보 등
//     일부 칸이 공란이어도 양식 레이아웃은 유지(AC5 시나리오3 빈칸 정상 표시). 본문 저장본조차 없으면 안내문.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadAutoBindContext, applyDiagCodesFromVisit } from '@/lib/autoBindContext';
import { renderOpinionDocHtml, type OpinionPrintData } from '@/lib/printOpinionDoc';
import { seoulISODate } from '@/lib/format';
import type { OpinionRequestRow, PublishedOpinionDoc } from '@/lib/opinionRequest';
import type { CheckIn } from '@/lib/types';

interface ClinicHeaderLike {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface Props {
  clinicId: string | null;
  /** 열람 대상 요청 행(환자·서류종류·차트번호·발행시각 앵커). */
  viewTarget: OpinionRequestRow | null;
  /** 원자 매핑된 실제 발행본 스냅샷(final_text/발행자/면허/발행자직인 id). 미발견 시 null(폴백 body 렌더). */
  viewDoc: PublishedOpinionDoc | null;
  /** 열람 본문 = 발행본 final_text 우선, 미발견 시 요청 저장본 재구성(호출부에서 계산·전달). */
  body: string;
  /** 병원(의료기관) 헤더 — 양식 상단/발행블록 바인딩. */
  clinicHeader: ClinicHeaderLike | null;
}

export default function IssuedOpinionDocFormView({
  clinicId,
  viewTarget,
  viewDoc,
  body,
  clinicHeader,
}: Props) {
  // 인쇄 경로(OpinionDocTab.handlePrint)와 동일한 공용 바인더로 환자정보·상병·직인 토큰 로드(read-only).
  //   check_in / customer 결측이면 미로드(폴백) → 양식은 그대로 그리되 해당 칸만 공란(레이아웃 유지).
  const autoValuesQuery = useQuery({
    queryKey: [
      'issued-doc-formview-autobind',
      clinicId,
      viewTarget?.checkInId,
      viewTarget?.customerId,
      viewDoc?.doctorName,
      viewDoc?.issuedByDoctorId,
    ],
    enabled: !!clinicId && !!viewTarget?.checkInId && !!viewTarget?.customerId,
    staleTime: 30_000,
    queryFn: async () => {
      // check_ins 앵커로 최소 CheckIn 구성(loadAutoBindContext 는 id/clinic_id/customer_id/checked_in_at/
      //   treating_doctor_id 만 참조 — 부재 필드는 내부 DB 재조회로 보강). handlePrint 와 동일 패턴.
      const checkIn = {
        id: viewTarget!.checkInId!,
        clinic_id: clinicId!,
        customer_id: viewTarget!.customerId,
        customer_name: viewTarget!.patientName,
        customer_phone: null,
        checked_in_at: viewTarget!.resolvedAt ?? viewTarget!.requestDate ?? viewTarget!.createdAt,
      } as CheckIn;
      // 도장은 발행자 본인 직인으로 결선(SEAL-DOCTOR-MATCH 동형): 발행자 clinic_doctors.id → clinicDoctorId,
      //   발행자명 → doctorNameOverride(레거시 id 부재 시 이름 폴백).
      const values = await loadAutoBindContext(
        checkIn,
        viewDoc?.doctorName || undefined,
        viewDoc?.issuedByDoctorId ?? undefined,
      );
      // 상병(코드/명) = 발행본 원 방문(check_in) 상병항목에서 재현(medical_charts 공란 대비, DIAGCODE-BLANK 동형).
      await applyDiagCodesFromVisit(values, { id: viewTarget!.checkInId!, clinic_id: clinicId! });
      return values;
    },
  });

  // 발행본 스냅샷 → 양식 HTML(인쇄 렌더러 재사용). 본문(final_text/재구성) 없으면 null → 안내문 렌더.
  const rendered = useMemo(() => {
    if (!viewTarget || !body.trim()) return null;
    const data: OpinionPrintData = {
      body,
      chartNo: viewDoc?.chartNo ?? viewTarget.chartNo ?? null,
      patientName: viewTarget.patientName ?? null,
      issuedByName: viewDoc?.doctorName || null,
      issuedByLicenseNo: viewDoc?.issuedByLicenseNo ?? null,
      issueDate: viewDoc?.issuedAt
        ? seoulISODate(viewDoc.issuedAt)
        : viewTarget.resolvedAt
          ? seoulISODate(viewTarget.resolvedAt)
          : null,
      clinicName: clinicHeader?.name ?? null,
      clinicAddress: clinicHeader?.address ?? null,
      clinicPhone: clinicHeader?.phone ?? null,
      formKey: viewTarget.docType === 'diagnosis' ? 'diagnosis' : 'diag_opinion',
      autoValues: autoValuesQuery.data,
    };
    return renderOpinionDocHtml(data);
  }, [viewTarget, viewDoc, body, clinicHeader, autoValuesQuery.data]);

  if (!rendered) {
    return (
      <div
        className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 px-4 py-3 text-[13px] leading-relaxed text-gray-800"
        data-testid="docreq-doc-view-form-empty"
      >
        표시할 서류 내용이 없습니다.
      </div>
    );
  }

  // read-only iframe — 발행/출력과 동일 양식 HTML 을 격리 렌더(스타일 충돌 방지). 인쇄 스크립트 없음(열람 전용).
  const srcDoc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;background:#f1f5f9;} body{padding:10px 4px;}</style></head>` +
    `<body>${rendered.html}</body></html>`;

  return (
    <iframe
      title={rendered.title}
      srcDoc={srcDoc}
      className="h-[68vh] w-full rounded-md border bg-slate-100"
      data-testid="docreq-doc-view-form"
    />
  );
}
