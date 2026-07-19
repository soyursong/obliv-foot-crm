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

import { useMemo } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import {
  useOpinionRequestQueue,
  usePublishedOpinionRequests,
  docTypeLabel,
  type OpinionDocType,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
import { seoulISODate, seoulHHMM } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
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
                    <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                      {docTypeLabel(r.docType)}
                    </Badge>
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
    </div>
  );
}
