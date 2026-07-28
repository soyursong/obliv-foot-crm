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
//     (useOpinionRequestQueue / useAllPublishedOpinionRequests — 후자는 day-scoped 훅과 동일 mapPublishedRequestRow
//     매핑 공유) 만 재사용. 경로별 별도조회(divergent query) 금지.
//     form_submissions write 금지(발행 파이프라인 read·표기만) — DocRequestQueue/DoctorCallDashboard 코드 미수정.
//
//   ★발행여부 매핑(db_change=false, planner 확정): 기존 발행 파이프라인 상태값 100% 매핑 — 신규 컬럼/파생 0.
//     · 미발행     = 서류작성 큐 draft(useOpinionRequestQueue).
//     · 발행완료   = voided + resolved_reason='published'(usePublishedOpinionRequests).
//     · 취소(cancelled) 제외 = 두 훅이 구조적으로 배제(draft 훅=status='draft'만, published 훅=resolved_reason='published'만).
//
//   ★AC-5 날짜필터 상속 + T-20260724-foot-DOCWRITE-UNISSUED-PERSIST-FILTER(김주연 총괄) 전환:
//     치료테이블은 day-scoped surface(모든 탭이 부모 공통 날짜선택기 date 를 공유)이나, 필터 기준을
//     '날짜'→'발행여부'로 전환 — 미발행(unpublished) 건은 신청 날짜가 지나도 계속 잔류하고(발행 완료 시에만
//     제거), 발행완료(published) 건만 기존 day-scoped(선택 날짜) 동작을 유지한다. 상세=filterDiagDocByDate 주석.
//     ※ T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND: 발행완료 소스를 all-time(useAllPublishedOpinionRequests)
//        로 확장 → 과거일자를 선택하면 그 날의 발행완료 소견서/진단서도 정상 조회(이전엔 당일 KST 발행만 반환돼
//        과거일 '발행완료'가 빈 목록). 진료대시보드용 day-scoped 훅은 미변경(§11.1 의료 surface 동작 불변).
//        미발행 잔류는 useOpinionRequestQueue(draft, 날짜무관 전건)로 보장.
//
//   ★T-20260724-foot-TREATTABLE-DOCS-PARITY 기능① (발행 목록 + 클릭 열람): 진료대시보드 서류 스펙 미러.
//     canonical = DASH-ISSUEDDOCS-DOCVIEW-CLICKOPEN(deployed 9ec7e5b6, DocRequestQueue 뷰어). 그 렌더러/로직을
//     그대로 이식 — 발행완료 서류명(요청종류 배지)을 클릭하면 실제 발행본 내용을 read-only 로 열람.
//     · 소스: 기존 usePublishedOpinionDocs(status='published', field_data.final_text) + matchPublishedOpinionDoc
//       원자매핑(check_in_id+doc_type→customer 폴백, 타 환자 교차노출 배제). 미발견 시 composeOpinionDoc 폴백.
//     · 순수 view — 재발행/취소/수정 side-effect 절대 없음(AC5). 발행 파이프라인·의사화면 코드 무접촉(db_change=false).
//     · 기능③(AC3): 원장 작성 medical 본문은 이 뷰어에서 read-only 표시 전용(어떤 경로로도 편집 노출 없음).
//       행정필드(발급요청일자 등) 편집은 기존 실장 요청박스(OpinionRequestBox '서류 날짜')에서 유지 — 여기 미신설(scope-guard).

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import {
  useOpinionRequestQueue,
  // T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND: 치료테이블은 과거일자 발행완료도 조회해야 하므로
  //   day-scoped(당일) usePublishedOpinionRequests(진료대시보드 전용) 대신 all-time 훅을 쓴다.
  //   진료대시보드(의사공간)용 day-scoped 훅은 미변경 → §11.1 의료 surface 동작 불변.
  useAllPublishedOpinionRequests,
  docTypeLabel,
  // 기능① 발행본 read-only 열람 — 진료대시보드 뷰어(canonical)와 동일 훅/매핑 재사용(단일 소스, 신규 조회 0).
  useOpinionDocTemplateId,
  usePublishedOpinionDocs,
  matchPublishedOpinionDoc,
  // T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN: [행정정보 수정]을 고객관리 EditCustomerDialog(공유·회귀위험)
  //   에서 서류 행정필드 전용 편집기로 재배선. 발행완료 요청행 field_data.admin_overrides 정정(published 불오염).
  useUpdateOpinionAdminFields,
  type OpinionDocType,
  type OpinionRequestRow,
} from '@/lib/opinionRequest';
// 발행본 미발견(레거시) 시 요청 저장본(selected_keys)으로 본문 재구성 폴백 — 작성창 합성기 재사용(기존 렌더러).
import { composeOpinionDoc } from '@/lib/opinionDocCompose';
import { OPINION_SECTIONS, useClinicHeader, useClinicDoctors } from '@/components/doctor/OpinionDocTab';
// T-20260725-foot-OPINIONDOC-...-TREATTABLE-VIEW-PARITY (AC2): 치료테이블 발행본 열람을 진료대시보드
//   뷰어와 '동일 컴포넌트'로 렌더 — 소견서 양식 그대로(병원헤더·환자정보·상병/소견·발급일·서명/도장).
//   read-only 전용(재발행/취소/수정/재출력 신규 도입 없음, 의료법§22 발행본 불변). 신규 양식 스택 0.
import IssuedOpinionDocFormView from '@/components/doctor/IssuedOpinionDocFormView';
import { seoulISODate, seoulHHMM, chartNoDisplay, chartNoBadge } from '@/lib/format';
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
import { Loader2, FileText, Users, CheckCircle2, Clock, Pencil, FilePen, Lock } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';
// T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN (planner GO 2026-07-29):
//   [행정정보 수정] 진입점을 고객관리 EditCustomerDialog(고객관리와 공유 → 필드삭제 시 회귀) 대신
//   **서류 행정필드 전용 편집기**(useUpdateOpinionAdminFields 경로)로 재배선.
//   · 원 문제 ①진료의(발급 의료인) 편집칸 누락 + ②서류에 안 나가는 항목(외국인정보·우편번호 등) 편집칸 잔존
//     → 재배선으로 동시 해소. 잉여필드는 doc-admin 편집기에 애초에 없고(삭제 아님), 두 필드는 고객관리에 그대로 존치.
//   · 편집 대상 = 발행완료 요청행(status='voided'+resolved_reason='published') field_data.admin_overrides 오버레이.
//     발행 원본(published)·발행 파이프라인 무접촉(의료법§22 스냅샷 불변). 신규 스키마 0(NO-DDL, db_change=false).
//   ★§11 / MEDSPACE-CONFIRM-GATE(Q2): 재배선 + 비의료 행정필드(발급요청일자/발급일/상병코드) 편집 = 게이트 밖(선행 배포).
//     진료의(발급 의료인) 변경 = 법정 귀속 → 문지은 대표원장 confirm(confirm_status: pending) 전까지 read-only 표시.
//     confirm 수신 후 DOCTOR_FIELD_EDITABLE=true 로 fast-follow(별도 커밋).
import { toast } from '@/lib/toast';

// ─── 순수 파생 로직 (E2E spec 이 동일 함수를 직접 import·단언 → drift 방지) ───────────────

export type DiagPublishStatus = 'published' | 'unpublished';

/** 치료테이블 [소견서·진단서] 표시 1행(진료대시보드 [서류작성] read-only 상속). */
export interface DiagDocRow {
  id: string;
  customerId: string | null;
  patientName: string;
  // T-20260724-foot-TREATTABLE-CHARTNO-CHART2-LINK (AC-1): 성함 옆 차트번호 병기용.
  //   OpinionRequestRow.chartNo(field_data.chart_no) 상속 — 신규 조회 0(단일 소스 유지). 미발번=null.
  chartNo: string | null;
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
      chartNo: r.chartNo,
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
      chartNo: r.chartNo,
      docType: r.docType,
      requestedAt: r.requestedAt,
      publishStatus: 'unpublished',
    });
  }
  return out;
}

// T-20260724-foot-DOCWRITE-UNISSUED-PERSIST-FILTER (김주연 총괄) — 필터 기준을 '날짜'→'발행여부'로 전환.
//   현장 요청: 미발행(unpublished) 건은 그 신청 날짜가 지나도 리스트에서 사라지지 않고 계속 남아야 한다
//   (뒤늦게 발행하려 할 때 찾을 수 있게). 발행을 완료해야만 리스트에서 빠진다.
//   ─ 미발행(unpublished): 선택 날짜와 무관하게 항상 잔류(AC1/AC2). '미발행 고정 표시'(AC3) — 날짜 필터가
//       미발행 잔류를 덮어쓰지 않는다.
//   ─ 발행완료(published): day-scoped 동작 유지(신청 KST 날짜 == 선택 날짜) → 발행완료본이 미발행
//       잔류 리스트에 섞이지 않음(AC4 회귀0). 발행완료 소스 = useAllPublishedOpinionRequests(all-time)
//       — TREATTABLE-PUBDOC-DATESCOPE-EXPAND 로 과거일자 발행완료도 이 필터가 선택 날짜에 맞춰 노출.
//   audit-first(planner db_change 게이트): 발행/미발행 구분은 기존 발행 파이프라인 상태값(draft=미발행 /
//     voided+resolved_reason='published'=발행완료)에 이미 존재 → 신규 컬럼/파생 0(db_change=false).
//   정렬: 신청시각 역순(최신 위). 미발행이 과거일이어도 잔류하므로 날짜 혼재 가능 — 신청시각 셀에서 표기 보강.
export function filterDiagDocByDate(rows: DiagDocRow[], date: string): DiagDocRow[] {
  return rows
    .filter((r) => {
      // 미발행: 날짜 경과와 무관하게 항상 잔류(발행 완료 시에만 제거).
      if (r.publishStatus === 'unpublished') return true;
      // 발행완료: 기존 day-scoped(선택 날짜) 동작 유지.
      return !!r.requestedAt && seoulISODate(r.requestedAt) === date;
    })
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

// ─── 서류 행정필드 편집기(재배선) 순수 로직 — E2E spec 이 동일 함수 import·단언(drift 방지) ──────────
//   T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN. 편집 가능한 필드셋 = 서류에 실제 출력되는 행정필드만.
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
//   (치료사도 [행정정보 수정]에서 담당 진료의를 드롭다운으로 변경 허용) → 플래그 flip(별도 커밋·게이트 배포).
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
  // all-time 발행완료(치료테이블 과거일자 조회) — 날짜 스코프는 아래 filterDiagDocByDate(선택 날짜)가 결정.
  const { data: published = [], isLoading: pubLoading } = useAllPublishedOpinionRequests(clinicId);
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
  // TREATTABLE-VIEW-PARITY: 소견서 양식 렌더용 병원 헤더 — 진료대시보드 뷰어와 동일 훅(신규 조회 0).
  const { data: clinicHeader = null } = useClinicHeader(clinicId);

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

  // ── 행정정보 수정(재배선, T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN) ──────────────────────
  //   [행정정보 수정] → 서류 행정필드 전용 편집기(useUpdateOpinionAdminFields). 편집 대상 = 발행완료 요청행.
  //   진료의는 게이트(DOCTOR_FIELD_EDITABLE) 전까지 read-only 표시(현재 발급의 노출, 편집 불가).
  const qc = useQueryClient();
  const adminMut = useUpdateOpinionAdminFields(clinicId);
  // 진료의(발급 의료인) read-only 표시용 옵션 소스 — 진료대시보드와 동일 훅(신규 조회 0).
  const { data: clinicDoctors = [] } = useClinicDoctors(clinicId);
  const [adminEditTarget, setAdminEditTarget] = useState<OpinionRequestRow | null>(null);
  const [adminForm, setAdminForm] = useState<DocAdminEditForm>(EMPTY_DOC_ADMIN_FORM);
  const [adminInit, setAdminInit] = useState<DocAdminEditForm>(EMPTY_DOC_ADMIN_FORM);

  const openEditAdmin = (target: OpinionRequestRow | null) => {
    if (!target) {
      toast('편집할 서류 정보를 확인할 수 없습니다');
      return;
    }
    setAdminEditTarget(target);
  };

  // 편집 대상 바뀔 때 폼 초기화 — 오버레이(정정값) 우선, 없으면 요청행/발행본 스냅샷.
  useEffect(() => {
    if (!adminEditTarget) return;
    const ov = adminEditTarget.adminOverrides;
    const seedIssueDate =
      ov?.issueDate
      || (viewDoc?.issuedAt ? seoulISODate(viewDoc.issuedAt)
        : adminEditTarget.resolvedAt ? seoulISODate(adminEditTarget.resolvedAt) : '');
    // 진료의 seed — 오버레이 앵커(doctor_id) 우선, 없으면 현재 표시명으로 등록 진료의 매칭(id 복원).
    const seedDoctorName = ov?.doctorName ?? viewDoc?.doctorName ?? '';
    const seedDoctorId =
      ov?.doctorId
      ?? (seedDoctorName ? clinicDoctors.find((d) => d.name === seedDoctorName)?.id : undefined)
      ?? '';
    const init: DocAdminEditForm = {
      requestDate: adminEditTarget.requestDate || '',
      issueDate: seedIssueDate,
      diagCode: ov?.diagCode ?? '',
      doctorId: seedDoctorId,
      doctorName: seedDoctorName,
    };
    setAdminForm(init);
    setAdminInit(init);
  }, [adminEditTarget, viewDoc, clinicDoctors]);

  const adminDirty = isDocAdminFormDirty(adminForm, adminInit);

  // 진료의(발급 의료인) read-only 표시명 — 오버레이 정정값 우선, 없으면 발행본 발행자명.
  const currentDoctorName = adminEditTarget?.adminOverrides?.doctorName ?? viewDoc?.doctorName ?? '';

  const handleAdminSave = async () => {
    if (!adminEditTarget || !adminDirty) return;
    if (!profile?.id) { toast.error('직원 계정 정보를 확인할 수 없습니다.'); return; }
    const payload = buildDocAdminSavePayload(adminForm, adminInit);
    try {
      await adminMut.mutateAsync({
        requestId: adminEditTarget.id,
        ...payload, // requestDate/issueDate/diagCode/진료의(doctorName+doctorId)(변경분만). Option A 컨펌 후 진료의 편집 활성.
        editorId: profile.id,
        editorName: profile.name ?? profile.email ?? '직원',
      });
      toast.success('행정 정보를 저장했습니다.');
      // 치료테이블 발행완료 소스(all-time)는 별도 query key → 저장 후 명시 invalidate(오버레이 즉시 반영).
      qc.invalidateQueries({ queryKey: ['opinion_request_published_all', clinicId] });
      setAdminEditTarget(null);
    } catch (e) {
      toast.error(`저장에 실패했습니다. ${(e as Error)?.message ?? ''}`);
    }
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
                  /* T-20260725-foot-DOCVIEW-...-CLICKFAIL (이슈2): 발행완료 행 '어디를 클릭해도' 발행본 열람.
                     이전엔 요청종류(서류명) 배지만 클릭 대상이라 현장에서 발행완료 항목/상태배지를 눌러도
                     안 열렸다(클릭 타깃 발견성 회귀). 발행완료 행 전체를 클릭 타깃으로 확장(미발행 행은 비활성). */
                  className={`border-b last:border-0 transition-colors ${
                    r.publishStatus === 'published'
                      ? 'cursor-pointer hover:bg-teal-50/60'
                      : 'hover:bg-muted/30'
                  }`}
                  data-testid="diagdoc-row"
                  data-publish-status={r.publishStatus}
                  onClick={r.publishStatus === 'published' ? () => openDocView(r.id) : undefined}
                  title={r.publishStatus === 'published' ? '클릭하면 발행한 서류 내용을 볼 수 있어요' : undefined}
                >
                  <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                    {/* 이름 인터랙션 — 좌클릭=2번차트 open / 우클릭=CRM 컨텍스트 메뉴(부모 nameInteraction 위임, sibling 탭 동일). */}
                    {/* T-20260724-foot-TREATTABLE-CHARTNO-CHART2-LINK (AC-1): 성함 옆 차트번호 병기.
                        표기 스타일 = 형제 치료테이블 탭(DoctorHistory/Exam) chartNoBadge 그대로 준용(#F-1234 / 미발번=#미발번).
                        AC-2(성함클릭→2번차트)는 부모 nameInteraction.onLeftClick(useChart) 로 이미 배선(형제 탭 동일). */}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                      data-testid="diagdoc-name-clickable"
                      /* 성함 클릭=2번차트 open(부모 위임) — 행 전체 열람 클릭과 분리하기 위해 전파 차단. */
                      onClick={(e) => { e.stopPropagation(); nameInteraction.onLeftClick(r.customerId); }}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        nameInteraction.onContextMenu(e, {
                          id: r.customerId ?? '',
                          name: r.patientName,
                          phone: null,
                          visit_type: 'returning',
                        });
                      }}
                    >
                      <span>{r.patientName}</span>
                      <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                        {chartNoBadge(r.chartNo)}
                      </span>
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
                    {r.requestedAt ? (
                      <>
                        {/* T-20260724-foot-DOCWRITE-UNISSUED-PERSIST-FILTER: 미발행 잔류로 과거일자 건이 섞일 수 있어,
                            신청 날짜가 선택 날짜와 다르면 날짜(월/일)를 함께 표기(어느 날 신청인지 식별). 같으면 기존 시각만. */}
                        {seoulISODate(r.requestedAt) !== date && (
                          <span
                            className="mr-1 rounded bg-amber-50 px-1 py-px text-[10px] font-semibold text-amber-700"
                            data-testid="diagdoc-cell-carryover-date"
                            title="신청 날짜가 지난 미발행 건이에요"
                          >
                            {seoulISODate(r.requestedAt).slice(5).replace('-', '/')}
                          </span>
                        )}
                        {seoulHHMM(r.requestedAt)}
                      </>
                    ) : (
                      '—'
                    )}
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
        {/* TREATTABLE-VIEW-PARITY (AC2): 진료대시보드 뷰어(DocRequestQueue)와 동일한 뷰포트-가둠 flex-col 구성 —
            헤더/푸터 고정(shrink-0), 가운데(소견서 양식 iframe)만 스크롤(min-h-0 flex-1). 양식이 뷰포트를
            넘겨도 '닫기' 버튼 항상 하단 노출(BTNCLIP 재발 방지). */}
        <DialogContent
          className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
          data-testid="diagdoc-doc-view-dialog"
        >
          <DialogHeader className="shrink-0">
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
          {/* 실제 발행본 내용 read-only 열람 — 진료대시보드와 '동일 컴포넌트'(IssuedOpinionDocFormView)로
              소견서 양식 그대로 렌더. 텍스트 나열 → 발행/출력 양식 레이아웃(parity). 발행본 스냅샷 + 원내직원
              정정 행정필드(adminOverrides) 오버레이 열람 반영. 편집/재출력 트리거 없음(read-only). */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="diagdoc-doc-view-scroll">
            <div data-testid="diagdoc-doc-view-body">
              <IssuedOpinionDocFormView
                clinicId={clinicId}
                viewTarget={viewTarget}
                viewDoc={viewDoc}
                body={viewBody}
                clinicHeader={clinicHeader}
                adminOverrides={viewTarget?.adminOverrides}
              />
            </div>
          </div>
          {/* T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN: 소견서 문서 뷰 '하단' [행정정보 수정] 진입점을
              고객관리 EditCustomerDialog → 서류 행정필드 전용 편집기로 재배선. 클릭 → 이 발행완료 요청행의
              행정필드(발급요청일자/발급일/상병코드 편집 + 진료의 read-only 표시) 편집기 오픈.
              발행본(medical 본문)·발행 파이프라인 무접촉(published 불오염, therapist surface, 원장 무접점). */}
          <DialogFooter className="shrink-0 flex-row justify-between gap-2 border-t pt-3 sm:justify-between">
            <Button
              variant="secondary"
              className="gap-1.5"
              disabled={!viewTarget}
              onClick={() => openEditAdmin(viewTarget)}
              data-testid="diagdoc-doc-view-edit-admin-btn"
            >
              <Pencil className="h-4 w-4" />
              행정정보 수정
            </Button>
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

      {/* T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN: 서류 행정필드 전용 편집기(재배선).
          편집 = 발행완료 요청행 field_data.admin_overrides(published 불오염, 의료법§22 스냅샷 불변).
          ★서류에 실제 출력되는 행정필드만 노출: 발급요청일자 · 발급일 · 상병코드(편집) + 진료의(read-only, 게이트).
            고객관리 전용 필드(외국인정보·우편번호 등)는 이 편집기에 애초에 없음(재배선 자동 해소, 고객관리에 존치). */}
      <Dialog open={!!adminEditTarget} onOpenChange={(o) => { if (!o) setAdminEditTarget(null); }}>
        <DialogContent className="max-w-lg" data-testid="diagdoc-admin-edit-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="diagdoc-admin-edit-title">
              <FilePen className="h-5 w-5 text-teal-600" />
              행정정보 수정
              {adminEditTarget && (
                <span className="text-sm font-normal text-muted-foreground">
                  · {docTypeLabel(adminEditTarget.docType)}
                  {adminEditTarget.patientName ? ` · ${adminEditTarget.patientName}` : ''}
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
                data-testid="diagdoc-admin-request-date"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              발급일
              <input
                type="date"
                value={adminForm.issueDate}
                onChange={(e) => setAdminForm((f) => ({ ...f, issueDate: e.target.value }))}
                className="h-11 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="diagdoc-admin-issue-date"
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
                data-testid="diagdoc-admin-diag-code"
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
                  data-testid="diagdoc-admin-doctor-select"
                >
                  <option value="">진료의 선택</option>
                  {clinicDoctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              ) : (
                <div
                  className="flex h-11 items-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 text-sm text-slate-600"
                  data-testid="diagdoc-admin-doctor-readonly"
                  title="발급 의료인 변경은 대표원장 확인 후 활성화됩니다"
                >
                  <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{currentDoctorName || '미지정'}</span>
                </div>
              )}
            </label>
          </div>

          {!DOCTOR_FIELD_EDITABLE && (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-500" data-testid="diagdoc-admin-doctor-gate-note">
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
              onClick={() => setAdminEditTarget(null)}
              data-testid="diagdoc-admin-cancel-btn"
            >
              닫기
            </Button>
            <Button
              onClick={() => void handleAdminSave()}
              disabled={!adminDirty || adminMut.isPending}
              className="bg-teal-600 text-white hover:bg-teal-700"
              data-testid="diagdoc-admin-save-btn"
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
    </div>
  );
}
