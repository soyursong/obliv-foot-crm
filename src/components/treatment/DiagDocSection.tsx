// DiagDocSection.tsx — 치료테이블 §[소견서·진단서] (치료테이블 맨 뒤 탭)
// Ticket: T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC (planner GREEN-LIGHT, gate-exempt)
//
//   목적: 진료대시보드 [서류작성] 리스트(원장영역)를 치료테이블(치료사 공간)에 read-only ADDITIVE 재노출.
//     치료사/코디팀이 "누가 어떤 서류(소견서/진단서)를 언제 신청했고, 발행됐는지"를 치료테이블에서 바로 확인.
//
//   ★게이트 판정(gate-exempt) 근거 — 넘지 말 것(경계조건):
//     · surface 축: 본 탭은 치료테이블(치료사 공간, 의사공간 아님) 맨 뒤에 append → §11 진료화면 게이트 비대상.
//       (선례: signals 2026-06-30 균검사·피검사 분리표기 = 치료테이블 read surface).
//     · 성격 축: 진료대시보드 [서류작성](DocRequestQueue/opinionRequest.ts 훅)의 read-only ADDITIVE 재노출·상속.
//       진료대시보드/의사화면 코드 무수정, 신규 의료로직 0, 발행상태 상속.
//       (선례: DOCHIST-MULTIPATH item② ADDITIVE 재노출·상속 gate-exempt 판정과 구조 동형).
//
//   ★단일 소스 강제(REDEFINITION_RISK, CHART-ORDER 좀비 교훈): DocRequestQueue 와 동일한 opinionRequest.ts 훅
//     (useOpinionRequestQueue / usePublishedOpinionRequests) 만 재사용. 경로별 별도조회(divergent query) 금지.
//     form_submissions write 금지(발행 파이프라인 read·표기만) — DocRequestQueue/DoctorCallDashboard 코드 미수정.
//
//   ★발행여부 매핑(db_change=false, planner 확정): 기존 발행 파이프라인 상태값 100% 매핑 — 신규 컬럼/파생 0.
//     · 미발행     = 서류작성 큐 draft(useOpinionRequestQueue).
//     · 발행완료   = voided + resolved_reason='published'(usePublishedOpinionRequests).
//     · 취소(cancelled) 제외 = 두 훅이 구조적으로 배제(draft 훅=status='draft'만, published 훅=resolved_reason='published'만).
//
//   ★AC-5 날짜필터 상속: 치료테이블은 day-scoped surface(모든 탭이 부모 공통 날짜선택기 date 를 공유).
//     본 탭도 신청시각(requested_at, KST) 기준으로 선택 날짜에 스코프 → 날짜이동 시 자동 갱신(sibling 탭과 정합).
//     ※ read-only 재사용 한계: usePublishedOpinionRequests 는 당일(KST) 발행 건만 반환 → 과거일자 '발행완료'는
//        재구성 불가(그날 신청 후 미발행으로 남은 draft 만 노출). 현장 주 사용처=당일 라이브 뷰(=진료대시보드 [서류작성] 동일 성격).
//
//   ★T-20260724-foot-TREATTABLE-DOCS-PARITY 기능① (발행 목록 + 클릭 열람): 진료대시보드 서류 스펙 미러.
//     canonical = DASH-ISSUEDDOCS-DOCVIEW-CLICKOPEN(deployed 9ec7e5b6, DocRequestQueue 뷰어). 그 렌더러/로직을
//     그대로 이식 — 발행완료 서류명(요청종류 배지)을 클릭하면 실제 발행본 내용을 read-only 로 열람.
//     · 소스: 기존 usePublishedOpinionDocs(status='published', field_data.final_text) + matchPublishedOpinionDoc
//       원자매핑(check_in_id+doc_type→customer 폴백, 타 환자 교차노출 배제). 미발견 시 composeOpinionDoc 폴백.
//     · 순수 view — 재발행/취소/수정 side-effect 절대 없음(AC5). 발행 파이프라인·의사화면 코드 무접촉(db_change=false).
//     · 기능③(AC3): 원장 작성 medical 본문은 이 뷰어에서 read-only 표시 전용(어떤 경로로도 편집 노출 없음).
//       행정필드(발급요청일자 등) 편집은 기존 실장 요청박스(OpinionRequestBox '서류 날짜')에서 유지 — 여기 미신설(scope-guard).

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import {
  useOpinionRequestQueue,
  usePublishedOpinionRequests,
  docTypeLabel,
  // 기능① 발행본 read-only 열람 — 진료대시보드 뷰어(canonical)와 동일 훅/매핑 재사용(단일 소스, 신규 조회 0).
  useOpinionDocTemplateId,
  usePublishedOpinionDocs,
  matchPublishedOpinionDoc,
  type OpinionDocType,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
// 발행본 미발견(레거시) 시 요청 저장본(selected_keys)으로 본문 재구성 폴백 — 작성창 합성기 재사용(기존 렌더러).
import { composeOpinionDoc } from '@/lib/opinionDocCompose';
import { OPINION_SECTIONS } from '@/components/doctor/OpinionDocTab';
import { seoulISODate, seoulHHMM, chartNoDisplay } from '@/lib/format';
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
import { Loader2, FileText, Users, CheckCircle2, Clock } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

// ─── 순수 파생 로직 (E2E spec 이 동일 함수를 직접 import·단언 → drift 방지) ───────────────

export type DiagPublishStatus = 'published' | 'unpublished';

/** 치료테이블 [소견서·진단서] 표시 1행(진료대시보드 [서류작성] read-only 상속). */
export interface DiagDocRow {
  id: string;
  customerId: string | null;
  patientName: string;
  docType: OpinionDocType;      // 요청종류(소견서/진단서)
  requestedAt: string;          // 신청시각(ISO, KST 파생 기준)
  publishStatus: DiagPublishStatus; // 발행여부(발행완료 / 미발행)
  resolvedAt?: string;          // 발행 시각(발행완료 행만)
}

// 서류작성 큐(draft=미발행) + 발행완료(voided+published) → 단일 표시 리스트로 병합.
//   ★단일 소스: 두 훅 반환값만 사용(별도조회 금지). 발행완료 우선 편입 후 id 중복 방어(구조상 겹치지 않으나 방어적).
//   ★취소(cancelled) 제외: draft 훅(status='draft')·published 훅(resolved_reason='published')이 구조적으로 배제.
export function buildDiagDocRows(
  drafts: OpinionRequestRow[],
  published: OpinionRequestRow[],
): DiagDocRow[] {
  const seen = new Set<string>();
  const out: DiagDocRow[] = [];
  for (const r of published) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      customerId: r.customerId,
      patientName: r.patientName,
      docType: r.docType,
      requestedAt: r.requestedAt,
      publishStatus: 'published',
      resolvedAt: r.resolvedAt,
    });
  }
  for (const r of drafts) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      customerId: r.customerId,
      patientName: r.patientName,
      docType: r.docType,
      requestedAt: r.requestedAt,
      publishStatus: 'unpublished',
    });
  }
  return out;
}

// AC-5 — 선택 날짜(치료테이블 공통 date) 스코프 + 신청시각 역순 정렬.
//   신청시각(requested_at)의 KST 날짜가 선택 날짜와 같은 행만(day-scoped surface 정합). 최신 신청 위로.
export function filterDiagDocByDate(rows: DiagDocRow[], date: string): DiagDocRow[] {
  return rows
    .filter((r) => !!r.requestedAt && seoulISODate(r.requestedAt) === date)
    .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));
}

// 상단 요약(신청 N건 · 발행완료 M건) — 표시 리스트 read-only 카운트. 신규 쿼리 0.
export interface DiagDocSummary {
  total: number;
  publishedCount: number;
  unpublishedCount: number;
}
export function computeDiagDocSummary(rows: DiagDocRow[]): DiagDocSummary {
  let publishedCount = 0;
  for (const r of rows) if (r.publishStatus === 'published') publishedCount += 1;
  return { total: rows.length, publishedCount, unpublishedCount: rows.length - publishedCount };
}

// ─── 발행여부 배지 ────────────────────────────────────────────────────────────
function PublishBadge({ status }: { status: DiagPublishStatus }) {
  const published = status === 'published';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
      data-testid="diagdoc-publish-badge"
      data-publish-status={status}
    >
      {published ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {published ? '발행완료' : '미발행'}
    </span>
  );
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function DiagDocSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const { profile } = useAuth();
  const clinicId = clinic?.id ?? profile?.clinic_id ?? null;

  // ★read-only 재사용 — DocRequestQueue 와 동일 훅(단일 소스). 별도조회/신규 쿼리 없음.
  const { data: drafts = [], isLoading: draftLoading, isError, error } = useOpinionRequestQueue(clinicId);
  const { data: published = [], isLoading: pubLoading } = usePublishedOpinionRequests(clinicId);
  const isLoading = draftLoading || pubLoading;

  // 병합 → 선택 날짜 스코프(AC-5).
  const rows = useMemo(() => {
    const merged = buildDiagDocRows(drafts, published);
    return filterDiagDocByDate(merged, date);
  }, [drafts, published, date]);

  const summary = useMemo(() => computeDiagDocSummary(rows), [rows]);

  // ── 기능① 발행본 read-only 열람 (DASH-ISSUEDDOCS-DOCVIEW-CLICKOPEN 뷰어 이식) ──────────────────
  //   발행완료 행의 요청종류(서류명) 클릭 → 실제 발행본(final_text) read-only 뷰어. 발행 파이프라인 무접촉.
  //   ★단일 소스: 발행완료 원본 OpinionRequestRow 는 published 훅 반환값에서 id 로 역참조(별도조회 없음).
  const sourceById = useMemo(() => {
    const m = new Map<string, OpinionRequestRow>();
    for (const r of published) m.set(r.id, r);
    return m;
  }, [published]);

  const { data: templateId = null } = useOpinionDocTemplateId(clinicId);
  // 화면에 보이는 발행완료 행의 환자만 발행본 조회(customer_id 필터 → 타 환자 교차노출 구조적 배제, AC2/AC3).
  const publishedCustomerIds = useMemo(
    () =>
      rows
        .filter((r) => r.publishStatus === 'published')
        .map((r) => r.customerId)
        .filter(Boolean) as string[],
    [rows],
  );
  const { data: publishedDocs = [] } = usePublishedOpinionDocs(clinicId, publishedCustomerIds, templateId);

  const [viewTarget, setViewTarget] = useState<OpinionRequestRow | null>(null);
  // 원자 매핑(AC2/AC3): check_in_id+doc_type(→customer 폴백)로 요청 1건↔발행본 1건. 다른 환자/서류 노출 방지.
  const viewDoc = useMemo(
    () => (viewTarget ? matchPublishedOpinionDoc(viewTarget, publishedDocs) : null),
    [viewTarget, publishedDocs],
  );
  // 본문 = 실제 발행본 final_text 우선(실발행본 일치). 미발견 시 요청 저장본(selected_keys) 재구성 폴백(기존 합성기).
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

  // 발행완료 행 서류명 클릭 → 열람. 원본 요청 row 를 id 로 역참조해 뷰어에 전달(없으면 무동작=방어).
  const openDocView = (rowId: string) => {
    const src = sourceById.get(rowId);
    if (src) setViewTarget(src);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diagdoc-section">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="h-4 w-4 text-teal-600" />
          소견서·진단서
        </p>
      </div>

      {/* 상단 요약 — 신청/발행완료 한눈. 리스트 있을 때만 노출(read-only 카운트). */}
      {!isLoading && !isError && rows.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-[12px]"
          data-testid="diagdoc-summary"
        >
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5 text-teal-600" />
            소견·진단서 신청
          </span>
          <span className="flex items-center gap-1" data-testid="diagdoc-summary-total" data-count={summary.total}>
            <span className="text-muted-foreground">전체</span>
            <span className="tabular-nums font-semibold text-teal-700">{summary.total}건</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="flex items-center gap-1" data-testid="diagdoc-summary-published" data-count={summary.publishedCount}>
            <span className="text-muted-foreground">발행완료</span>
            <span className="tabular-nums font-semibold text-emerald-700">{summary.publishedCount}건</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="flex items-center gap-1" data-testid="diagdoc-summary-unpublished" data-count={summary.unpublishedCount}>
            <span className="text-muted-foreground">미발행</span>
            <span className="tabular-nums font-semibold text-amber-700">{summary.unpublishedCount}건</span>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-6 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="diagdoc-empty"
        >
          <FileText className="h-5 w-5 text-muted-foreground/40" />
          {format(new Date(date + 'T12:00:00'), 'M월 d일 (EEEE)', { locale: ko })}에 신청된 소견서·진단서가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="diagdoc-table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">환자명</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">요청종류</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">신청시각</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">발행여부</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition-colors hover:bg-muted/30"
                  data-testid="diagdoc-row"
                  data-publish-status={r.publishStatus}
                >
                  <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                    {/* 이름 인터랙션 — 좌클릭=2번차트 open / 우클릭=CRM 컨텍스트 메뉴(부모 nameInteraction 위임, sibling 탭 동일). */}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                      data-testid="diagdoc-name-clickable"
                      onClick={() => nameInteraction.onLeftClick(r.customerId)}
                      onContextMenu={(e) =>
                        nameInteraction.onContextMenu(e, {
                          id: r.customerId ?? '',
                          name: r.patientName,
                          phone: null,
                          visit_type: 'returning',
                        })
                      }
                    >
                      {r.patientName}
                    </button>
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap" data-testid="diagdoc-cell-doctype">
                    {/* 기능①(AC1): 발행완료 서류명 클릭 → 실제 발행본 내용 read-only 열람.
                        미발행 행은 발행본이 없으므로 클릭 불가(정적 배지) — 오표기·빈뷰어 방지. */}
                    {r.publishStatus === 'published' ? (
                      <button
                        type="button"
                        onClick={() => openDocView(r.id)}
                        className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 underline decoration-dotted underline-offset-2 transition hover:bg-slate-200 hover:text-teal-700 hover:decoration-solid"
                        title="클릭하면 발행한 서류 내용을 볼 수 있어요"
                        data-testid="diagdoc-docname-view"
                      >
                        {docTypeLabel(r.docType)}
                      </button>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                        {docTypeLabel(r.docType)}
                      </Badge>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums text-muted-foreground whitespace-nowrap" data-testid="diagdoc-cell-time">
                    {r.requestedAt ? seoulHHMM(r.requestedAt) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5" data-testid="diagdoc-cell-publish">
                    <PublishBadge status={r.publishStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !isLoading && !isError && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
          <Users className="h-3 w-3" />
          진료대시보드 [서류작성]에서 접수된 소견서·진단서 신청이 여기에 표시됩니다.
        </p>
      )}

      {/* 기능①(AC1/AC3): 발행완료 서류명 클릭 → 실제 발행본 내용 read-only 열람.
          read-only 전용 — 재발행/취소/수정 버튼 없음(AC3/AC5). 닫기만. 발행 경로(publish_opinion_doc RPC) 미접촉.
          원장 작성 medical 본문은 표시만(어떤 경로로도 편집 노출 없음) — DocRequestQueue 뷰어와 동일 표현. */}
      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent className="max-w-2xl" data-testid="diagdoc-doc-view-dialog">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2" data-testid="diagdoc-doc-view-title">
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
            data-testid="diagdoc-doc-view-body"
          >
            {viewBody.trim() ? viewBody : '표시할 서류 내용이 없습니다.'}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setViewTarget(null)}
              data-testid="diagdoc-doc-view-close"
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
