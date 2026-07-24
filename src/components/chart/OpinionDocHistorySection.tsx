// OpinionDocHistorySection.tsx — 개별 환자 진료차트 §[소견서·진단서 발행 이력]
// Ticket: T-20260724-foot-PATIENTCHART-ISSUEDDOCS-HISTORY-VIEW (P1, 발행이력 패턴 3번째 surface)
//
//   목적(김주연 총괄 요청): 개별 환자 진료차트(CustomerChartPage 상담내역 탭)에서 그 환자가 신청한
//     소견서·진단서의 (1)신청 이력(누가·언제) (2)발행 여부(발행완료/미발행) (3)발행완료 서류 내용을
//     진료차트 내에서 바로 열람. 진료대시보드(DASH-ISSUEDDOCS)·치료테이블(TREATTABLE-DOCS-PARITY)에 이미
//     넣은 발행이력 기능과 같은 선상 — 세 번째 surface 에 동일 패턴 재적용.
//
//   ★게이트 판정(비대상) 근거 — 넘지 말 것(경계조건):
//     · surface 축: 본 섹션은 CustomerChartPage 상담내역 탭 실장영역(OpinionRequestBox 아래) append =
//       §11.1 고객관리·상담 surface(비대상). 진료대시보드/진료관리(의사공간) 코드 무접촉.
//     · 성격 축: 기존 발행 파이프라인(form_submissions) read-only ADDITIVE 재노출·상속. 신규 의료로직 0,
//       발행상태 상속(진료대시보드·치료테이블과 동일 판정 기준). 원장 작성 medical 본문은 표시 전용(편집 노출 0).
//
//   ★단일 소스 강제(REDEFINITION_RISK 방지): 발행상태·서류내용 모두 form_submissions 단일 원장에서 파생.
//     - 신청이력·발행여부 = useCustomerOpinionRequests(customer-scoped, all-time). day-scoped 훅과 판정기준 동일.
//     - 발행본 내용 = usePublishedOpinionDocs(final_text) + matchPublishedOpinionDoc 원자매핑(DiagDocSection/
//       DocRequestQueue 뷰어와 동일 훅·매핑 재사용). 미발견 시 composeOpinionDoc 폴백.
//     - form_submissions write 금지(발행 파이프라인 read·표기만). db_change=false.
//
//   ★교차노출 금지(회귀임계 b): 훅 2종 모두 customer_id 서버필터 → 타 환자 발행이력·발행본 구조적 배제.
//   ★발행여부 판정(회귀임계 c): 미발행=draft / 발행완료=voided+published (진료대시보드·치료테이블 동일).

import { useMemo, useState } from 'react';
import {
  useCustomerOpinionRequests,
  computeCustomerOpinionSummary,
  useOpinionDocTemplateId,
  usePublishedOpinionDocs,
  matchPublishedOpinionDoc,
  docTypeLabel,
  type CustomerOpinionRequestRow,
  type OpinionPublishStatus,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
// 발행본 미발견(레거시) 시 요청 저장본(selected_keys)으로 본문 재구성 폴백 — 작성창 합성기 재사용(기존 렌더러).
import { composeOpinionDoc } from '@/lib/opinionDocCompose';
import { OPINION_SECTIONS } from '@/components/doctor/OpinionDocTab';
import { seoulHHMM, formatDateTimeDots, chartNoDisplay } from '@/lib/format';
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
import { Loader2, FileText, CheckCircle2, Clock } from 'lucide-react';

// ─── 발행여부 배지 (진료대시보드·치료테이블 동일 색/라벨) ───────────────────────────────
function PublishBadge({ status }: { status: OpinionPublishStatus }) {
  const published = status === 'published';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
      data-testid="opinion-history-publish-badge"
      data-publish-status={status}
    >
      {published ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {published ? '발행완료' : '미발행'}
    </span>
  );
}

interface Props {
  clinicId: string | null;
  customerId: string | null;
}

export default function OpinionDocHistorySection({ clinicId, customerId }: Props) {
  // ★신청이력·발행여부 — customer-scoped·all-time(진료대시보드 day-scoped 와 소스 동일, 스코프만 환자단위).
  const { data: rows = [], isLoading, isError, error } = useCustomerOpinionRequests(clinicId, customerId);
  const summary = useMemo(() => computeCustomerOpinionSummary(rows), [rows]);

  // ── 발행본 read-only 열람 (DASH/치료테이블 뷰어 이식) ─────────────────────────────
  //   발행완료 행의 요청종류(서류명) 클릭 → 실제 발행본(final_text) read-only 뷰어. 발행 파이프라인 무접촉.
  const sourceById = useMemo(() => {
    const m = new Map<string, CustomerOpinionRequestRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const { data: templateId = null } = useOpinionDocTemplateId(clinicId);
  // 이 환자의 발행완료 건이 하나라도 있으면 발행본 조회(customer_id 필터 → 타 환자 발행본 구조적 배제).
  const hasPublished = summary.publishedCount > 0;
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

  // 발행완료 행 서류명 클릭 → 열람. 원본 요청 row 를 id 로 역참조(없으면 무동작=방어).
  const openDocView = (rowId: string) => {
    const src = sourceById.get(rowId);
    if (src) setViewTarget(src);
  };

  return (
    <div
      className="rounded-lg border bg-white p-3 text-xs"
      data-testid="opinion-history-section"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="h-4 w-4 text-teal-600" />
          소견서·진단서 발행 이력
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
            <span className="flex items-center gap-1" data-testid="opinion-history-summary-published" data-count={summary.publishedCount}>
              <span className="text-muted-foreground">발행완료</span>
              <span className="tabular-nums font-semibold text-emerald-700">{summary.publishedCount}건</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1" data-testid="opinion-history-summary-unpublished" data-count={summary.unpublishedCount}>
              <span className="text-muted-foreground">미발행</span>
              <span className="tabular-nums font-semibold text-amber-700">{summary.unpublishedCount}건</span>
            </span>
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
          발행 이력을 불러오지 못했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-[12px] text-muted-foreground"
          data-testid="opinion-history-empty"
        >
          <FileText className="h-5 w-5 text-muted-foreground/40" />
          이 환자의 소견서·진단서 발행 이력이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="opinion-history-table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">요청종류</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청자</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청일시</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">발행여부</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition-colors hover:bg-muted/30"
                  data-testid="opinion-history-row"
                  data-publish-status={r.publishStatus}
                >
                  <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap" data-testid="opinion-history-cell-doctype">
                    {/* 발행완료 서류명 클릭 → 실제 발행본 내용 read-only 열람.
                        미발행 행은 발행본이 없으므로 클릭 불가(정적 배지) — 오표기·빈뷰어 방지(시나리오2-②). */}
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
                    {r.requestedByName || '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums text-muted-foreground whitespace-nowrap" data-testid="opinion-history-cell-time">
                    {r.requestedAt ? formatDateTimeDots(r.requestedAt) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5" data-testid="opinion-history-cell-publish">
                    <PublishBadge status={r.publishStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 발행완료 서류명 클릭 → 실제 발행본 내용 read-only 열람.
          read-only 전용 — 재발행/취소/수정 버튼 없음. 닫기만. 발행 경로(publish_opinion_doc RPC) 미접촉.
          원장 작성 medical 본문은 표시만(어떤 경로로도 편집 노출 없음) — DocRequestQueue/DiagDocSection 뷰어와 동일. */}
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
          <DialogFooter>
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
    </div>
  );
}
