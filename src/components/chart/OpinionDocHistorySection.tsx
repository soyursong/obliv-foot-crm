// OpinionDocHistorySection.tsx — 개별 환자 진료차트 §[소견서·진단서 서류요청 이력]
// Ticket: T-20260724-foot-PATIENTCHART-ISSUEDDOCS-HISTORY-VIEW (P1, 발행이력 3번째 surface)
//   ↳ T-20260728-foot-CHART2-DOCREQ-HISTORY-COORDPERM (item①, P1): 요약 줄 → **상세 테이블** 확장.
//     칼럼(현장 확정): 신청일시 · 서류종류 · 신청직원 · 발급상태(신청됨/발급완료/취소 3-state).
//     ★발급상태 = DIAGDOC(closed) 상태매핑 재사용(신규 컬럼·파생 0): 신청됨=draft / 발급완료=voided+published /
//       취소=voided+cancelled. (기존 2-state '발행완료/미발행'에 '취소'를 추가 = 취소 오분류 0, AC①-2.)
//     ★신청직원 = field_data.requested_by_name **단독**(DA MSG-8dqz): issued_by→staff 조인 금지(발급 시 printer/
//       issuer 로 재기입돼 '발급직원' 오표시) · requested_by_id 컬럼 실측 부재. 결측 → '—' placeholder(신규 write 0).
//
//   목적(김주연 총괄 요청): 개별 환자 진료차트(CustomerChartPage 상담내역 탭)에서 그 환자가 신청한
//     소견서·진단서의 (1)신청 이력(누가·언제) (2)발급상태(신청됨/발급완료/취소) (3)발급완료 서류 내용을
//     진료차트 내에서 바로 열람. 진료대시보드(DASH-ISSUEDDOCS)·치료테이블(TREATTABLE-DOCS-PARITY) 발행이력 패턴 정합.
//
//   ★게이트 판정(비대상) 근거 — 넘지 말 것(경계조건):
//     · surface 축: 본 섹션은 CustomerChartPage 상담내역 탭 실장영역(OpinionRequestBox 아래) append =
//       §11.1 고객관리·상담 surface(비대상). 진료대시보드/진료관리(의사공간) 코드 무접촉.
//     · 성격 축: 기존 발행 파이프라인(form_submissions) read-only ADDITIVE 재노출. 신규 의료로직 0.
//
//   ★단일 소스 강제(REDEFINITION_RISK 방지): 발급상태·서류내용 모두 form_submissions 단일 원장에서 파생.
//     - 신청이력·발급상태 = useCustomerDocRequestHistory(customer-scoped, all-time, 3-state 취소 포함).
//     - 발행본 내용 = usePublishedOpinionDocs(final_text) + matchPublishedOpinionDoc 원자매핑(기존 뷰어 재사용).
//     - form_submissions write 금지(발행 파이프라인 read·표기만). db_change=false.
//
//   ★교차노출 금지(회귀임계 b): 훅 2종 모두 customer_id 서버필터 → 타 환자 유입 구조적 배제.

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCustomerDocRequestHistory,
  computeDocRequestSummary,
  DOC_REQUEST_STATUS_LABEL,
  useOpinionDocTemplateId,
  usePublishedOpinionDocs,
  matchPublishedOpinionDoc,
  docTypeLabel,
  type CustomerDocRequestRow,
  type DocRequestIssueStatus,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
// 발행본 미발견(레거시) 시 요청 저장본(selected_keys)으로 본문 재구성 폴백 — 작성창 합성기 재사용(기존 렌더러).
import { composeOpinionDoc } from '@/lib/opinionDocCompose';
import { OPINION_SECTIONS, useClinicHeader } from '@/components/doctor/OpinionDocTab';
// T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK (AC-3): 2번차트 재출력 동선에 [출력] + [행정정보 수정] 연동.
//   발행 고정본 출력 공용 헬퍼 + 공용 편집기 재사용(치료테이블과 단일 소스, 중복 구현 금지).
import { printIssuedOpinionDoc } from '@/lib/printOpinionDoc';
import DocAdminEditDialog from '@/components/doctor/DocAdminEditDialog';
import { seoulHHMM, formatDateTimeDots, chartNoDisplay } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, FileText, CheckCircle2, Clock, XCircle, Pencil, Printer } from 'lucide-react';

// ─── 발급상태 배지 (DIAGDOC 3-state: 신청됨=미발행 / 발급완료=발행완료 / 취소) ──────────────
//   ★라벨 리터럴('미발행'/'발행완료'/'취소')을 이 파일에 유지 = 기존 발행이력(대시보드·치료테이블) 표기 정합.
function IssueStatusBadge({ status }: { status: DocRequestIssueStatus }) {
  // status → {icon, class}. 라벨은 DOC_REQUEST_STATUS_LABEL SSOT(미발행/발행완료/취소).
  const meta =
    status === 'issued'
      ? { icon: <CheckCircle2 className="h-3 w-3" />, cls: 'bg-emerald-50 text-emerald-700' }
      : status === 'cancelled'
        ? { icon: <XCircle className="h-3 w-3" />, cls: 'bg-neutral-100 text-neutral-500 line-through decoration-neutral-400' }
        : { icon: <Clock className="h-3 w-3" />, cls: 'bg-amber-50 text-amber-700' };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}
      data-testid="opinion-history-publish-badge"
      data-issue-status={status}
    >
      {meta.icon}
      {DOC_REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

interface Props {
  clinicId: string | null;
  customerId: string | null;
}

export default function OpinionDocHistorySection({ clinicId, customerId }: Props) {
  // ★신청이력·발급상태 — customer-scoped·all-time(신청됨/발급완료/취소 3-state, 취소 포함).
  const { data: rows = [], isLoading, isError, error } = useCustomerDocRequestHistory(clinicId, customerId);
  const summary = useMemo(() => computeDocRequestSummary(rows), [rows]);

  // ── 발행본 read-only 열람 (DASH/치료테이블 뷰어 이식) ─────────────────────────────
  //   발급완료 행의 서류종류 클릭 → 실제 발행본(final_text) read-only 뷰어. 발행 파이프라인 무접촉.
  const sourceById = useMemo(() => {
    const m = new Map<string, CustomerDocRequestRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const { data: templateId = null } = useOpinionDocTemplateId(clinicId);
  // 이 환자의 발급완료 건이 하나라도 있으면 발행본 조회(customer_id 필터 → 타 환자 발행본 구조적 배제).
  const hasPublished = summary.issuedCount > 0;
  const publishedCustomerIds = useMemo(
    () => (hasPublished && customerId ? [customerId] : []),
    [hasPublished, customerId],
  );
  const { data: publishedDocs = [] } = usePublishedOpinionDocs(clinicId, publishedCustomerIds, templateId);

  const [viewTarget, setViewTarget] = useState<OpinionRequestRow | null>(null);
  // 원자 매핑: check_in_id+doc_type(→customer 폴백)로 요청 1건↔발행본 1건. 다른 환자/서류 노출 방지.
  const viewDoc = useMemo(
    () => (viewTarget ? matchPublishedOpinionDoc(viewTarget, publishedDocs) : null),
    [viewTarget, publishedDocs],
  );
  // 본문 = 실제 발행본 final_text 우선. 미발견 시 요청 저장본(selected_keys) 재구성 폴백(기존 합성기).
  const viewBody = useMemo(() => {
    if (!viewTarget) return '';
    const real = viewDoc?.finalText?.trim();
    if (real) return real;
    return composeOpinionDoc({
      sections: OPINION_SECTIONS,
      selectedKeys: viewTarget.selectedKeys,
      hepatitisType: null,
      oralXReason: viewTarget.oralMedReason,
      dateISO: viewTarget.requestDate || null,
    });
  }, [viewTarget, viewDoc]);

  // 발급완료 행 서류종류 클릭 → 열람. 원본 요청 row 를 id 로 역참조(없으면 무동작=방어).
  const openDocView = (rowId: string) => {
    const src = sourceById.get(rowId);
    if (src) setViewTarget(src);
  };

  // ── T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK (AC-3/AC-4): 재출력 동선 + 행정정보 수정 연동 ──
  const qc = useQueryClient();
  // 소견서 양식 렌더용 병원 헤더 — 치료테이블/진료대시보드와 동일 훅(react-query dedup → 신규 조회 0).
  const { data: clinicHeader = null } = useClinicHeader(clinicId);
  const [adminEditTarget, setAdminEditTarget] = useState<OpinionRequestRow | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const openEditAdmin = (target: OpinionRequestRow | null) => {
    if (!target) { toast('편집할 서류 정보를 확인할 수 없습니다'); return; }
    setAdminEditTarget(target);
  };

  // 출력 = 발행 고정본 그대로. 신규 출력 스택 금지(printIssuedOpinionDoc 공용 헬퍼 재사용).
  //   행정정보 수정(adminOverrides)이 담당의·발급일을 정정했으면 재출력물에 반영(단일 동선, AC-4).
  const handlePrintDoc = async (row: OpinionRequestRow | null) => {
    if (!row) { toast('출력할 서류 정보를 확인할 수 없습니다'); return; }
    const doc = matchPublishedOpinionDoc(row, publishedDocs);
    const fallbackBody = viewBody?.trim() || '';
    setPrintingId(row.id);
    try {
      const ok = await printIssuedOpinionDoc({
        clinicId,
        checkInId: doc?.checkInId ?? row.checkInId ?? null,
        customerId: doc?.customerId ?? row.customerId ?? customerId ?? null,
        patientName: row.patientName ?? null,
        chartNo: doc?.chartNo ?? row.chartNo ?? null,
        body: (doc?.finalText || fallbackBody).trim(),
        docType: row.docType,
        issuedByName: row.adminOverrides?.doctorName || doc?.doctorName || '',
        issuedByLicenseNo: doc?.issuedByLicenseNo ?? null,
        issuedByDoctorId: doc?.issuedByDoctorId ?? null,
        issuedAt: doc?.issuedAt ?? row.resolvedAt ?? null,
        clinicHeader,
        adminOverrides: row.adminOverrides ?? null,
      });
      if (!ok) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
    } catch (e) {
      toast.error(`출력에 실패했습니다. ${(e as Error)?.message ?? ''}`);
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div
      className="rounded-lg border bg-white p-3 text-xs"
      data-testid="opinion-history-section"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="h-4 w-4 text-teal-600" />
          소견서·진단서 서류요청 이력
        </p>
        {!isLoading && !isError && rows.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]"
            data-testid="opinion-history-summary"
          >
            <span className="flex items-center gap-1" data-testid="opinion-history-summary-total" data-count={summary.total}>
              <span className="text-muted-foreground">신청</span>
              <span className="tabular-nums font-semibold text-teal-700">{summary.total}건</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1" data-testid="opinion-history-summary-published" data-count={summary.issuedCount}>
              <span className="text-muted-foreground">발행완료</span>
              <span className="tabular-nums font-semibold text-emerald-700">{summary.issuedCount}건</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1" data-testid="opinion-history-summary-unpublished" data-count={summary.requestedCount}>
              <span className="text-muted-foreground">미발행</span>
              <span className="tabular-nums font-semibold text-amber-700">{summary.requestedCount}건</span>
            </span>
            {summary.cancelledCount > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1" data-testid="opinion-history-summary-cancelled" data-count={summary.cancelledCount}>
                  <span className="text-muted-foreground">취소</span>
                  <span className="tabular-nums font-semibold text-neutral-500">{summary.cancelledCount}건</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div
          className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-center text-[12px] text-red-600"
          data-testid="opinion-history-error"
        >
          서류요청 이력을 불러오지 못했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-[12px] text-muted-foreground"
          data-testid="opinion-history-empty"
        >
          <FileText className="h-5 w-5 text-muted-foreground/40" />
          이 환자의 소견서·진단서 서류요청 이력이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="opinion-history-table">
          {/* 칼럼 순서(현장 확정, T-20260728 item①): 신청일시 · 서류종류 · 신청직원 · 발급상태 */}
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청일시</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">서류종류</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청직원</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">발급상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition-colors hover:bg-muted/30"
                  data-testid="opinion-history-row"
                  data-publish-status={r.publishStatus}
                  data-issue-status={r.issueStatus}
                >
                  <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums text-muted-foreground whitespace-nowrap" data-testid="opinion-history-cell-time">
                    {r.requestedAt ? formatDateTimeDots(r.requestedAt) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap" data-testid="opinion-history-cell-doctype">
                    {/* 발급완료 서류종류 클릭 → 실제 발행본 내용 read-only 열람.
                        미발행/취소 행은 발행본이 없으므로 클릭 불가(정적 배지) — 오표기·빈뷰어 방지(시나리오2-②).
                        ★doc-view 게이트는 publishStatus==='published'(=발급완료) 유지(발행이력 판정 정합). */}
                    {r.publishStatus === 'published' ? (
                      <button
                        type="button"
                        onClick={() => openDocView(r.id)}
                        className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 underline decoration-dotted underline-offset-2 transition hover:bg-slate-200 hover:text-teal-700 hover:decoration-solid"
                        title="클릭하면 발행한 서류 내용을 볼 수 있어요"
                        data-testid="opinion-history-docname-view"
                      >
                        {docTypeLabel(r.docType)}
                      </button>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                        {docTypeLabel(r.docType)}
                      </Badge>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap" data-testid="opinion-history-cell-requester">
                    {/* 신청직원 = requested_by_name 단독(issued_by 조인 금지). 결측 → '—'. */}
                    {r.requestedByName || '—'}
                  </td>
                  <td className="px-2.5 py-1.5" data-testid="opinion-history-cell-publish">
                    <IssueStatusBadge status={r.issueStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 발급완료 서류종류 클릭 → 실제 발행본 내용 read-only 열람.
          read-only 전용 — 재발행/취소/수정 버튼 없음. 닫기만. 발행 경로(publish_opinion_doc RPC) 미접촉. */}
      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent className="max-w-2xl" data-testid="opinion-history-doc-view-dialog">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2" data-testid="opinion-history-doc-view-title">
              <FileText className="h-5 w-5 text-emerald-600" />
              {viewTarget ? docTypeLabel(viewTarget.docType) : ''}
              {viewTarget?.patientName && (
                <span className="text-sm font-normal text-muted-foreground">· {viewTarget.patientName}</span>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {viewTarget?.chartNo && <span>차트번호 {chartNoDisplay(viewTarget.chartNo)}</span>}
              {viewTarget?.resolvedAt && <span>발행 {seoulHHMM(viewTarget.resolvedAt)}</span>}
              {viewDoc?.doctorName && <span>발행자 {viewDoc.doctorName}</span>}
            </DialogDescription>
          </DialogHeader>
          {/* 실제 발행본 내용 read-only 열람(작성창 본문과 동일 표현: 원문 그대로 pre-wrap). 편집 요소 없음. */}
          <div
            className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 px-4 py-3 text-[13px] leading-relaxed text-gray-800"
            data-testid="opinion-history-doc-view-body"
          >
            {viewBody.trim() ? viewBody : '표시할 서류 내용이 없습니다.'}
          </div>
          {/* 문서 뷰 하단 액션 — [행정정보 수정] · [출력] · [닫기] (T-20260729-foot-DOCPRINT-BTN-ADMININFO-REPRINT-LINK).
              2번차트 재출력 동선에서도 행정정보 수정 진입 + 발행 고정본 출력을 단일 동선으로 연동(AC-3/AC-4).
              발행본(medical 본문)·발행 파이프라인 무접촉 — 행정필드(발급요청일자/발급일/상병코드·담당의)만 정정. */}
          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="gap-1.5"
                disabled={!viewTarget}
                onClick={() => openEditAdmin(viewTarget)}
                data-testid="opinion-history-doc-view-edit-admin-btn"
              >
                <Pencil className="h-4 w-4" />
                행정정보 수정
              </Button>
              <Button
                className="gap-1.5 bg-teal-600 text-white hover:bg-teal-700"
                disabled={!viewTarget || printingId === viewTarget?.id}
                onClick={() => void handlePrintDoc(viewTarget)}
                data-testid="opinion-history-doc-view-print-btn"
              >
                {printingId === viewTarget?.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                출력
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => setViewTarget(null)}
              data-testid="opinion-history-doc-view-close"
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 서류 행정필드 전용 편집기(공용 컴포넌트, 치료테이블·2번차트 공유).
          저장 후 customer-scoped 발행이력 소스 invalidate(오버레이 즉시 반영, AC-4).
          (useUpdateOpinionAdminFields onSuccess 가 이미 opinion_request_customer_history 를 무효화하므로 onSaved 는 방어적 재무효화.) */}
      <DocAdminEditDialog
        target={adminEditTarget}
        viewDoc={adminEditTarget ? matchPublishedOpinionDoc(adminEditTarget, publishedDocs) : null}
        clinicId={clinicId}
        onClose={() => setAdminEditTarget(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['opinion_request_customer_history', clinicId] })}
        testIdPrefix="opinion-history-admin"
      />
    </div>
  );
}
