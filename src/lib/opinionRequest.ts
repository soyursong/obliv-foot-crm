// opinionRequest — 실장(데스크)→원장 '소견서/진단서 발행 요청' 데이터 계층.
// Ticket: T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK
//   상담내역 탭(실장영역)에서 실장이 서류종류(진단서/소견서)+해당항목(옵션)+메모를 골라 '발행 요청'을
//   진료 대시보드 서류작성 탭(원장영역)으로 보낸다. 실장 선택 = '요청/참고'(request)일 뿐,
//   소견서 본문 작성·확정·발행은 원장 전용(publish_opinion_doc RPC, is_doctor_role 게이트).
//
// ★의료문서 authoring 경계(AC-4, BLOCKING): 본 모듈은 form_submissions status='draft' row 만 다룬다.
//   - 발행(published) 경로는 절대 건드리지 않음 — 발행은 OpinionEditorDialog → publish_opinion_doc RPC(원장 전용).
//   - draft = 요청 메타데이터(field_data.request_origin='staff_consult'). 의무기록(published)이 아님.
//
// === NO-DDL 재사용 (dev-foot RC MSG-20260620-185017-asdn) ===
//   저장 = form_submissions 재사용. status='draft'(기존 CHECK 허용), template_id=opinion_doc(seed).
//   신규 컬럼/테이블/enum/status/RLS = 0. RLS(form_submissions_insert/read/update) = active clinic member 전원 허용.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { OPINION_SECTIONS, type OpinionSection } from '@/components/doctor/OpinionDocTab';
import { formatRxItemToken } from '@/lib/rxTooltip';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
// T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK: 오늘시술(package_sessions.session_type) 간략형 라벨 SSOT 재사용.
import { sessionTypeLabel } from '@/lib/progressTreatmentCsv';

// 서류종류 2종 (AC-6) — 진단서 / 소견서.
export type OpinionDocType = 'diagnosis' | 'opinion';
export const OPINION_DOC_TYPES: { value: OpinionDocType; label: string }[] = [
  { value: 'opinion', label: '소견서' },
  { value: 'diagnosis', label: '진단서' },
];
export function docTypeLabel(v: string | null | undefined): string {
  return OPINION_DOC_TYPES.find((t) => t.value === v)?.label ?? '소견서';
}

// 옵션 라벨 조회용 평탄화 맵 (선택 key → 라벨). 진료대시보드/상담내역 공통.
export function buildOptionLabelMap(sections: OpinionSection[] = OPINION_SECTIONS): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sections) for (const o of s.options) m.set(o.key, o.label);
  return m;
}

// opinion_doc form_template id(provenance). seed 미적용 시 null(template_id nullable).
export function useOpinionDocTemplateId(clinicId: string | null) {
  return useQuery<string | null>({
    queryKey: ['opinion_doc_template_id', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return null;
      const { data, error } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'opinion_doc')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { id?: string } | null)?.id ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

// ─── 실장 요청 생성 (form_submissions draft insert) ──────────────────────────
export interface CreateOpinionRequestInput {
  customerId: string;
  patientName: string;
  chartNo: string | null;
  birthDate: string | null;
  docType: OpinionDocType;
  selectedKeys: string[];
  staffMemo: string;
  // T-20260630-foot-DIAGCERT-ORALMED-VIEWERBLUE-PDFBLACK (A안 AC6): 실장이 신설 '경구약 사유' 입력칸에
  //   적은 텍스트. 원장 진단서 작성창에서 경구약X 괄호(`[…경구약 복용중]`) 치환값(oralXReason)으로 prefill.
  //   빈 값이면 기존 동작 유지(원장이 직접 입력 / 괄호 보존). field_data.oral_med_reason(JSONB ADDITIVE).
  oralMedReason: string;
  issuedBy: string;              // staff.id (NOT NULL). 빈 값이면 차단.
  requestedByName: string;       // 표기용 스냅샷(실장 이름)
  templateId: string | null;     // opinion_doc template (provenance, nullable)
  // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (B-1 LOCK): 실장이 2번차트 서류요청에서 고른 서류 날짜(YYYY-MM-DD).
  //   기본값=당일. 원장 작성창에서 `[날짜]` 치환 초기값으로 전달.
  requestDate: string;
}

export function useCreateOpinionRequest(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOpinionRequestInput) => {
      if (!clinicId) throw new Error('클리닉 정보를 확인할 수 없습니다.');
      if (!input.issuedBy) throw new Error('직원 계정 정보를 확인할 수 없어 요청할 수 없습니다.');
      if (input.selectedKeys.length === 0) throw new Error('요청할 항목을 1개 이상 선택해주세요.');

      // 원장이 발행(publish_opinion_doc)할 때 clinic/customer 해석 앵커로 쓸 최근 내방(check_in) 1건.
      //   publish RPC 가 check_in_id 필수 → 내방 이력이 있어야 원장이 발행 가능. 없으면 null(원장측 안내).
      const { data: ci } = await supabase
        .from('check_ins')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('customer_id', input.customerId)
        .order('checked_in_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const checkInId = (ci as { id?: string } | null)?.id ?? null;

      const requestedAt = new Date().toISOString();
      const fieldData = {
        request_origin: 'staff_consult',   // 큐 식별키
        doc_type: input.docType,
        selected_keys: input.selectedKeys,
        staff_memo: input.staffMemo ?? '',
        // A안 AC6: 경구약 사유(원장 작성창 oralXReason prefill 소스). staff_memo 와 별개 전용 키(의미충돌 방지).
        oral_med_reason: input.oralMedReason ?? '',
        patient_name: input.patientName,
        chart_no: input.chartNo ?? '',
        birth_date: input.birthDate ?? '',
        requested_by_name: input.requestedByName ?? '',
        requested_at: requestedAt,
        request_date: input.requestDate ?? '',   // B-1: 서류 날짜(YYYY-MM-DD), 원장 `[날짜]` 치환 초기값.
      };

      const row: Record<string, unknown> = {
        clinic_id: clinicId,
        customer_id: input.customerId,
        issued_by: input.issuedBy,
        field_data: fieldData,
        status: 'draft',
      };
      if (input.templateId) row.template_id = input.templateId;
      if (checkInId) row.check_in_id = checkInId;

      const { data, error } = await supabase
        .from('form_submissions')
        .insert(row)
        .select('id')
        .single();
      if (error) throw error;
      return { id: String((data as { id: string }).id), hasCheckIn: !!checkInId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opinion_request_queue', clinicId] });
    },
  });
}

// ─── T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT: 발행본 행정필드(B부류) 편집 오버레이 ──
//   발행 소견서/진단서(form_submissions status='published')는 DB 트리거·RLS 로 immutable(의료법§22, C1).
//   원장 medical content(진단소견·의사소견 = A부류)는 절대 불변. 반면 김주연 총괄 요청(문지은 대표원장
//   필드분류 relay confirm, thread 1784882479.542659)으로 원내 직원이 행정·발급 metadata(B부류)만 정정 가능.
//   ★AC4(발행 원문 스냅샷 불오염): B부류 편집은 published row 를 절대 건드리지 않는다. 편집 오버레이는
//     '요청 행'(status='voided'+resolved_reason='published', RLS status<>'published' 로 mutable)의 field_data
//     에 append 한다. 발행본(published)은 read-only 로 유지되고, 열람/재출력 시 오버레이를 그 위에 얹어 렌더.
//   ★NO-DDL: 기존 form_submissions.field_data(JSONB) 재사용 — 신규 컬럼/테이블/enum/RLS = 0.
//   ★상병코드=medical-adjacent(진단파생) → 편집 감사로그(누가·언제·이전값→새값)로 의료법§22 정합 방어.
export interface AdminFieldOverrides {
  /** 담당의(발행자명) 정정 — renderOpinionDocHtml issuedByName override(doctor_name). */
  doctorName?: string;
  /**
   * T-20260728-foot-ATTENDINGDR-DOC-ATTRIB-CHART-EDIT (AC-6): 담당의(진료의) doctor_id 앵커.
   *   담당의 정정을 free-text 가 아니라 clinic_doctors 드롭다운으로 받으므로(오타/불일치 명의 원천 차단),
   *   선택 원장 id 를 함께 저장한다. 열람/재출력 시 이 id 를 loadAutoBindContext clinicDoctorId 로 태워
   *   도장(직인)이 정정된 진료의 본인 직인으로 자동 추종(AC-7, SEAL-DOCTOR-MATCH). NO-DDL(JSONB 재사용).
   */
  doctorId?: string;
  /** 발급일(YYYY-MM-DD) 정정 — issue_date override. */
  issueDate?: string;
  /** 상병코드(1급/primary, 예 K29.7) 정정 — diag_code_1 override. 상병명은 진료기록 기준 유지(scope: 코드만). */
  diagCode?: string;
}
export interface AdminEditLogEntry {
  field: string;        // 'request_date' | 'doctor_name' | 'issue_date' | 'diag_code'
  fieldLabel: string;   // 현장 표기('발급요청일자' 등)
  oldValue: string;
  newValue: string;
  by: string;           // staff.id
  byName: string;       // 편집자 표기 스냅샷
  at: string;           // ISO
}

// ─── 진료대시보드 서류작성 큐 (open 요청 = status='draft' + request_origin='staff_consult') ──
export interface OpinionRequestRow {
  id: string;
  customerId: string | null;
  checkInId: string | null;
  docType: OpinionDocType;
  selectedKeys: string[];
  staffMemo: string;
  /** A안 AC6: 실장이 적은 경구약 사유. 없으면 ''(원장 작성창 oralXReason 빈값=기존 동작). */
  oralMedReason: string;
  patientName: string;
  chartNo: string | null;
  birthDate: string | null;
  requestedByName: string;
  requestedAt: string;
  createdAt: string;
  /** B-1: 실장이 고른 서류 날짜(YYYY-MM-DD). 없으면 ''(원장 작성창에서 오늘 기본값). */
  requestDate: string;
  /** T-20260625-DOCDASH-DOCSECTION-COMPLETED-SUBHEADER: 발행 완료 시각(field_data.resolved_at, ISO). 대기 큐 행은 undefined. */
  resolvedAt?: string;
  /** T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT: 발행 후 원내 직원이 정정한 행정필드 오버레이(field_data.admin_overrides). 없으면 undefined. */
  adminOverrides?: AdminFieldOverrides;
  /** 편집 감사로그(field_data.admin_edit_log) — 의료법§22 정합(상병코드=medical-adjacent). */
  adminEditLog?: AdminEditLogEntry[];
}

// field_data.admin_overrides(raw JSONB) → AdminFieldOverrides. 빈/결측 시 undefined.
export function parseAdminOverrides(fd: Record<string, unknown>): AdminFieldOverrides | undefined {
  const raw = fd['admin_overrides'];
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: AdminFieldOverrides = {};
  if (typeof o['doctor_name'] === 'string' && o['doctor_name']) out.doctorName = o['doctor_name'] as string;
  // T-20260728-foot-ATTENDINGDR-DOC-ATTRIB-CHART-EDIT (AC-6): 담당의 doctor_id 앵커(도장 자동추종용).
  if (typeof o['doctor_id'] === 'string' && o['doctor_id']) out.doctorId = o['doctor_id'] as string;
  if (typeof o['issue_date'] === 'string' && o['issue_date']) out.issueDate = o['issue_date'] as string;
  if (typeof o['diag_code'] === 'string' && o['diag_code']) out.diagCode = o['diag_code'] as string;
  return Object.keys(out).length > 0 ? out : undefined;
}
function parseAdminEditLog(fd: Record<string, unknown>): AdminEditLogEntry[] | undefined {
  const raw = fd['admin_edit_log'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw as AdminEditLogEntry[];
}

export function useOpinionRequestQueue(clinicId: string | null) {
  return useQuery<OpinionRequestRow[]>({
    queryKey: ['opinion_request_queue', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as Array<Record<string, unknown>>)
        .map((r) => {
          const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
          return { r, fd };
        })
        // 큐 식별: staff_consult 요청만. (펜차트/기타 draft 제출과 분리)
        .filter(({ fd }) => fd['request_origin'] === 'staff_consult')
        .map(({ r, fd }) => ({
          id: String(r['id']),
          customerId: (r['customer_id'] as string | null) ?? null,
          checkInId: (r['check_in_id'] as string | null) ?? null,
          docType: (fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion') as OpinionDocType,
          selectedKeys: Array.isArray(fd['selected_keys']) ? (fd['selected_keys'] as string[]) : [],
          staffMemo: String(fd['staff_memo'] ?? ''),
          oralMedReason: String(fd['oral_med_reason'] ?? ''),
          patientName: String(fd['patient_name'] ?? '—'),
          chartNo: (fd['chart_no'] as string | null) || null,
          birthDate: (fd['birth_date'] as string | null) || null,
          requestedByName: String(fd['requested_by_name'] ?? ''),
          requestedAt: String(fd['requested_at'] ?? r['created_at'] ?? ''),
          createdAt: String(r['created_at'] ?? ''),
          requestDate: String(fd['request_date'] ?? ''),
        }));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// form_submissions '발행 완료' raw 행(voided+resolved_reason='published') → OpinionRequestRow 순수 매핑.
//   day-scoped(usePublishedOpinionRequests, 진료대시보드) / all-time(useAllPublishedOpinionRequests, 치료테이블)
//   두 훅이 '동일 매핑'을 공유(drift 방지, REDEFINITION_RISK). 발행 여부·날짜 스코프는 각 훅의 쿼리/필터가 결정.
export function mapPublishedRequestRow(
  r: Record<string, unknown>,
  fd: Record<string, unknown>,
): OpinionRequestRow {
  return {
    id: String(r['id']),
    customerId: (r['customer_id'] as string | null) ?? null,
    checkInId: (r['check_in_id'] as string | null) ?? null,
    docType: (fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion') as OpinionDocType,
    selectedKeys: Array.isArray(fd['selected_keys']) ? (fd['selected_keys'] as string[]) : [],
    staffMemo: String(fd['staff_memo'] ?? ''),
    oralMedReason: String(fd['oral_med_reason'] ?? ''),
    patientName: String(fd['patient_name'] ?? '—'),
    chartNo: (fd['chart_no'] as string | null) || null,
    birthDate: (fd['birth_date'] as string | null) || null,
    requestedByName: String(fd['requested_by_name'] ?? ''),
    requestedAt: String(fd['requested_at'] ?? r['created_at'] ?? ''),
    createdAt: String(r['created_at'] ?? ''),
    requestDate: String(fd['request_date'] ?? ''),
    resolvedAt: String(fd['resolved_at'] ?? ''),
    // T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT: 발행 후 정정된 행정필드 오버레이 + 감사로그(있으면).
    adminOverrides: parseAdminOverrides(fd),
    adminEditLog: parseAdminEditLog(fd),
  };
}

// ─── 진료대시보드 '서류 완료' 그룹 (T-20260625-foot-DOCDASH-DOCSECTION-COMPLETED-SUBHEADER) ──
//   원장이 발행을 마치면 useResolveOpinionRequest 가 draft → status='voided' + field_data.resolved_reason='published'
//   로 전환한다(L196~). 그 완료 row 를 read-only 로 다시 읽어 '서류 완료' 서브헤더 그룹에 표시(목록에서 사라지지 않게).
//   ★read-only 표시 전용: authoring/publish 경로(publish_opinion_doc RPC·OpinionEditorDialog) 일절 미접촉.
//   ★스키마 변경 0: 이미 적재되는 field_data.resolved_reason/resolved_at 만 read.
//   ★cancelled(요청취소) 제외: '서류 완료' = resolved_reason='published' 만(흡수 그라운딩 준수).
//   ★day-scoped: 진료대시보드는 당일 뷰 → resolved_at(KST) 이 오늘인 발행 건만. created_at 2일 lookback 으로
//     자정 넘겨 발행된 어제-요청-오늘-완료 건까지 포섭한 뒤 resolved_at KST==today 로 정밀 필터.
//   ※의사공간(§11.1) 진료대시보드 전용 — day-scoped 유지. 치료테이블(치료사 공간) 과거일자 발행완료 조회는
//     별도 useAllPublishedOpinionRequests(all-time) 를 쓴다(본 훅 미변경 = 의료 surface 동작 불변).
export function usePublishedOpinionRequests(clinicId: string | null) {
  return useQuery<OpinionRequestRow[]>({
    queryKey: ['opinion_request_published', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const today = todaySeoulISODate();
      // created_at 하한(2일 lookback) — voided 누적 무한 조회 방지 + 자정 교차 발행 포섭.
      const lookbackStart = seoulISODate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'voided')
        .gte('created_at', `${lookbackStart}T00:00:00+09:00`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as Array<Record<string, unknown>>)
        .map((r) => ({ r, fd: (r['field_data'] ?? {}) as Record<string, unknown> }))
        // 같은 서류작성 큐(staff_consult)에서 발행 완료된 건만. cancelled(요청취소) 제외.
        .filter(({ fd }) => fd['request_origin'] === 'staff_consult')
        .filter(({ fd }) => fd['resolved_reason'] === 'published')
        // 당일(KST) 발행 건만 — day-scoped 뷰.
        .filter(({ fd }) => {
          const ra = fd['resolved_at'];
          return typeof ra === 'string' && !!ra && seoulISODate(ra) === today;
        })
        .map(({ r, fd }) => mapPublishedRequestRow(r, fd))
        // 최근 발행 순(resolved_at desc) — created_at 정렬과 무관하게 완료시각 기준 재정렬.
        .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ─── 치료테이블(치료사 공간) 발행완료 전체이력 (T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND) ──
//   RC: usePublishedOpinionRequests 는 resolved_at KST==today 로 '당일 발행'만 반환 → 치료테이블에서 과거일자를
//     선택해도 그 날짜의 발행완료 소견서/진단서가 재구성 불가(빈 목록). 진료대시보드(의사공간)는 당일 뷰가 맞지만,
//     치료테이블은 부모 날짜선택기(선택 날짜)로 과거일 조회가 가능해야 한다(현장 요청, TREATTABLE-DATA-MISSING).
//   FIX: useCustomerOpinionRequests / usePublishedOpinionDocs 의 all-time 조회 패턴을 그대로 재사용 —
//     clinic-scoped 발행완료(voided+resolved_reason='published') 전건을 반환하고, 날짜 스코프는 소비 컴포넌트
//     (DiagDocSection.filterDiagDocByDate)가 결정한다. 진단서/소견서 모두 동일 스코프(docType 무관 동일 판정).
//   ★§11.1 게이트: 치료테이블 = 치료사 공간(비의료, exempt). 진료대시보드용 usePublishedOpinionRequests(day-scoped)
//     는 미변경 → 의사공간(DocRequestQueue) 동작 불변. 본 훅은 치료테이블에서만 소비.
//   ★read-only READ 전용(db_change=false): 기존 form_submissions field_data read 만. 신규 컬럼/테이블/enum/RLS = 0.
//   ★단일 소스: 매핑은 usePublishedOpinionRequests 와 동일 mapPublishedRequestRow 공유(divergent 재정의 0).
export function useAllPublishedOpinionRequests(clinicId: string | null) {
  return useQuery<OpinionRequestRow[]>({
    queryKey: ['opinion_request_published_all', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'voided')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as Array<Record<string, unknown>>)
        .map((r) => ({ r, fd: (r['field_data'] ?? {}) as Record<string, unknown> }))
        // 서류작성 큐(staff_consult)에서 발행 완료된 건만. cancelled(요청취소) 구조적 제외.
        .filter(({ fd }) => fd['request_origin'] === 'staff_consult')
        .filter(({ fd }) => fd['resolved_reason'] === 'published')
        .map(({ r, fd }) => mapPublishedRequestRow(r, fd))
        // 최근 발행 순(resolved_at desc).
        .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ─── 개별 환자 진료차트 발행이력 (customer-scoped, all-time) ──────────────────────────────
//   Ticket: T-20260724-foot-PATIENTCHART-ISSUEDDOCS-HISTORY-VIEW (P1, 발행이력 패턴 3번째 surface)
//   canonical = DASH-ISSUEDDOCS-NAMELIST-EXPAND(deployed a843b4b7, 진료대시보드) / sibling = TREATTABLE-DOCS-PARITY.
//
//   ★surface 축: 개별 환자 진료차트(CustomerChartPage 상담내역 탭, OpinionRequestBox 아래 = 실장영역) =
//     §11.1 고객관리·상담 surface(비대상). 진료대시보드/진료관리(의사공간) 코드 무접촉 — DocRequestQueue/
//     OpinionDocTab/OpinionEditorDialog/publish_opinion_doc RPC 일절 미수정.
//
//   ★진료대시보드/치료테이블과의 차이(왜 신규 훅): 그 두 surface 는 day-scoped(당일 KST) →
//     usePublishedOpinionRequests 는 '오늘 발행' 건만 반환. 개별 환자 진료차트는 그 환자의 '전체 발행이력'을
//     보여야 하므로 customer-scoped·all-time 조회가 필요. 단, 소스·판정기준은 100% 동일(form_submissions 단일 원장):
//       · 미발행   = status='draft' (서류작성 큐 draft)
//       · 발행완료 = status='voided' + field_data.resolved_reason='published'
//       · 취소(cancelled) 제외 = 두 판정 어디에도 안 들어감(3 surface 발행상태 정합).
//   ★read-only READ 전용(db_change=false): 기존 form_submissions field_data read 만. 신규 컬럼/테이블/enum/RLS = 0.
//   ★교차노출 금지: customer_id 서버필터 → 타 환자 발행이력 구조적 배제.
export type OpinionPublishStatus = 'published' | 'unpublished';
export interface CustomerOpinionRequestRow extends OpinionRequestRow {
  /** 발행여부 — 진료대시보드·치료테이블과 동일 판정(draft=미발행 / voided+published=발행완료). */
  publishStatus: OpinionPublishStatus;
}

// 순수 파생 — form_submissions raw 행 → 발행이력 행. (E2E spec 이 직접 import·단언 → drift 방지)
//   staff_consult 요청만 편입 + cancelled 구조적 제외 + 발행상태 판정 + 신청시각 역순 정렬.
export function buildCustomerOpinionRows(
  raw: Array<Record<string, unknown>>,
): CustomerOpinionRequestRow[] {
  const out: CustomerOpinionRequestRow[] = [];
  for (const r of raw) {
    const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
    // 큐 식별: staff_consult 요청만(펜차트/기타 draft·voided 제출과 분리).
    if (fd['request_origin'] !== 'staff_consult') continue;
    const status = String(r['status'] ?? '');
    let publishStatus: OpinionPublishStatus;
    if (status === 'draft') {
      publishStatus = 'unpublished';
    } else if (status === 'voided' && fd['resolved_reason'] === 'published') {
      publishStatus = 'published';
    } else {
      // voided+cancelled(요청취소) 등 → 발행이력에서 제외(3 surface 판정 정합).
      continue;
    }
    out.push({
      id: String(r['id']),
      customerId: (r['customer_id'] as string | null) ?? null,
      checkInId: (r['check_in_id'] as string | null) ?? null,
      docType: (fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion') as OpinionDocType,
      selectedKeys: Array.isArray(fd['selected_keys']) ? (fd['selected_keys'] as string[]) : [],
      staffMemo: String(fd['staff_memo'] ?? ''),
      oralMedReason: String(fd['oral_med_reason'] ?? ''),
      patientName: String(fd['patient_name'] ?? '—'),
      chartNo: (fd['chart_no'] as string | null) || null,
      birthDate: (fd['birth_date'] as string | null) || null,
      requestedByName: String(fd['requested_by_name'] ?? ''),
      requestedAt: String(fd['requested_at'] ?? r['created_at'] ?? ''),
      createdAt: String(r['created_at'] ?? ''),
      requestDate: String(fd['request_date'] ?? ''),
      resolvedAt: fd['resolved_at'] ? String(fd['resolved_at']) : undefined,
      publishStatus,
    });
  }
  // 최신 신청 위로(신청시각 역순).
  return out.sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));
}

// ─── T-20260728-foot-CHART2-DOCREQ-HISTORY-COORDPERM (item①): 상담내역 '서류요청 이력 상세 테이블' 파생 ──
//   기존 buildCustomerOpinionRows(발행이력, 2-state·cancelled 제외)와 달리 **신청됨/발급완료/취소 3-state 전체**를
//   행으로 노출한다(현장 요청: 요약 줄 → 상세 테이블 확장, 취소 건도 오분류 0으로 표기).
//   ★발급상태 = DIAGDOC(closed) 상태매핑 재사용(신규 컬럼·파생 0):
//       · 신청됨(=미발행) = status='draft'
//       · 발급완료        = status='voided' + field_data.resolved_reason='published'
//       · 취소            = status='voided' + field_data.resolved_reason='cancelled'
//   ★신청직원 = field_data.requested_by_name **단독**(DA 정정 MSG-8dqz):
//       issued_by→staff 조인 금지(발급 시 printer/issuer 로 재기입돼 '발급직원' 오표시) · requested_by_id 컬럼 실측 부재.
//       결측 시 소비 컴포넌트에서 '—' placeholder(신규 write 트리거 금지).
//   ★read-only(db_change=false): 기존 form_submissions.field_data read 만. 신규 컬럼/테이블/enum/RLS = 0.
//   ★buildCustomerOpinionRows(발행이력·cancelled 제외)는 무변경 — 발행이력 배지/요약(computeCustomerOpinionSummary)
//     과 spec(T-20260724) 판정 정합 유지. 본 상세 테이블만 3-state 로 확장(별 파생, drift 방지 위해 소스 동일).
export type DocRequestIssueStatus = 'requested' | 'issued' | 'cancelled'; // 신청됨 / 발급완료 / 취소

export const DOC_REQUEST_STATUS_LABEL: Record<DocRequestIssueStatus, string> = {
  requested: '미발행',   // draft — 신청됨(원장 발행 전). 기존 surface 라벨 정합('미발행').
  issued: '발행완료',    // voided + resolved_reason='published'
  cancelled: '취소',     // voided + resolved_reason='cancelled'
};

// 상세 테이블 행 = 발행이력 행(열람용 필드 계승) + 발급상태(3-state) 증분.
export interface CustomerDocRequestRow extends CustomerOpinionRequestRow {
  /** 발급상태(DIAGDOC 3-state) — 상세 테이블 '발급상태' 칼럼 SSOT. */
  issueStatus: DocRequestIssueStatus;
}

// 순수 파생 — form_submissions raw 행 → 상세 테이블 행(3-state). E2E spec 이 직접 import·단언(drift 방지).
//   staff_consult 요청만 편입 + 3-state 판정(취소 포함) + 신청시각 역순 정렬. published(발행 원본) 행은 제외(요청 이력 아님).
export function buildCustomerDocRequestRows(
  raw: Array<Record<string, unknown>>,
): CustomerDocRequestRow[] {
  const out: CustomerDocRequestRow[] = [];
  for (const r of raw) {
    const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
    if (fd['request_origin'] !== 'staff_consult') continue; // 서류요청 큐(펜차트/기타 제출과 분리)
    const status = String(r['status'] ?? '');
    let issueStatus: DocRequestIssueStatus;
    if (status === 'draft') {
      issueStatus = 'requested';                                              // 신청됨(=미발행)
    } else if (status === 'voided' && fd['resolved_reason'] === 'published') {
      issueStatus = 'issued';                                                 // 발급완료
    } else if (status === 'voided' && fd['resolved_reason'] === 'cancelled') {
      issueStatus = 'cancelled';                                              // 취소
    } else {
      continue; // published 발행 원본 / resolved_reason 미상 voided → 요청 이력 행 아님(제외)
    }
    const publishStatus: OpinionPublishStatus = issueStatus === 'issued' ? 'published' : 'unpublished';
    out.push({
      id: String(r['id']),
      customerId: (r['customer_id'] as string | null) ?? null,
      checkInId: (r['check_in_id'] as string | null) ?? null,
      docType: (fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion') as OpinionDocType,
      selectedKeys: Array.isArray(fd['selected_keys']) ? (fd['selected_keys'] as string[]) : [],
      staffMemo: String(fd['staff_memo'] ?? ''),
      oralMedReason: String(fd['oral_med_reason'] ?? ''),
      patientName: String(fd['patient_name'] ?? '—'),
      chartNo: (fd['chart_no'] as string | null) || null,
      birthDate: (fd['birth_date'] as string | null) || null,
      // ★신청직원 = requested_by_name 단독(issued_by 조인 금지, DA MSG-8dqz). 결측=''(컴포넌트에서 '—').
      requestedByName: String(fd['requested_by_name'] ?? ''),
      requestedAt: String(fd['requested_at'] ?? r['created_at'] ?? ''),
      createdAt: String(r['created_at'] ?? ''),
      requestDate: String(fd['request_date'] ?? ''),
      resolvedAt: fd['resolved_at'] ? String(fd['resolved_at']) : undefined,
      publishStatus,
      issueStatus,
    });
  }
  return out.sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? '')); // 최신 신청 위로
}

export interface DocRequestSummary {
  total: number;
  requestedCount: number; // 미발행(신청됨)
  issuedCount: number;    // 발급완료
  cancelledCount: number; // 취소
}
export function computeDocRequestSummary(rows: CustomerDocRequestRow[]): DocRequestSummary {
  let requestedCount = 0, issuedCount = 0, cancelledCount = 0;
  for (const r of rows) {
    if (r.issueStatus === 'issued') issuedCount += 1;
    else if (r.issueStatus === 'cancelled') cancelledCount += 1;
    else requestedCount += 1;
  }
  return { total: rows.length, requestedCount, issuedCount, cancelledCount };
}

// customer-scoped·all-time 상세 이력 훅 — useCustomerOpinionRequests 와 동일 쿼리(draft+voided) 재사용,
//   빌더만 3-state(buildCustomerDocRequestRows)로 교체(취소 포함). customer_id 서버필터 → 타 환자 유입 금지.
export function useCustomerDocRequestHistory(clinicId: string | null, customerId: string | null) {
  return useQuery<CustomerDocRequestRow[]>({
    queryKey: ['opinion_request_customer_detail', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at, status')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .in('status', ['draft', 'voided'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return buildCustomerDocRequestRows((data ?? []) as Array<Record<string, unknown>>);
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export interface CustomerOpinionSummary {
  total: number;
  publishedCount: number;
  unpublishedCount: number;
}
export function computeCustomerOpinionSummary(rows: CustomerOpinionRequestRow[]): CustomerOpinionSummary {
  let publishedCount = 0;
  for (const r of rows) if (r.publishStatus === 'published') publishedCount += 1;
  return { total: rows.length, publishedCount, unpublishedCount: rows.length - publishedCount };
}

export function useCustomerOpinionRequests(clinicId: string | null, customerId: string | null) {
  return useQuery<CustomerOpinionRequestRow[]>({
    queryKey: ['opinion_request_customer_history', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at, status')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .in('status', ['draft', 'voided'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return buildCustomerOpinionRows((data ?? []) as Array<Record<string, unknown>>);
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ─── 발행완료 서류 '내용 열람'(read-only) — 실제 발행본 조회 (T-20260724-foot-ISSUEDDOCS-DOCVIEW-CLICKOPEN) ──
//   '서류 완료' 그룹 서류명 클릭 → 그 요청으로 실제 발행된 서류(form_submissions status='published', opinion_doc)
//   본문(field_data.final_text)을 read-only 로 열람. hub(NAMELIST-EXPAND)는 서류명 나열+해당항목 미리보기까지 —
//   본 훅은 그 위에 '실제 발행본 내용' 열람 증분을 얹는다(나열/배지 렌더 무접촉, onClick 열람만 결선).
//   ★read-only READ 전용: status='published' 발행본 read 만. authoring/publish 경로(publish_opinion_doc RPC·
//     OpinionEditorDialog)·요청/작성 UI(pending) 일절 미접촉.
//   ★스키마 변경 0(db_change=false): 이미 적재된 field_data(final_text/doc_type/check_in_id) 만 read.
//   ★교차노출 금지(AC2/AC3): customer_id 필터 → 다른 환자 발행본 구조적 배제. 매핑은 check_in_id+doc_type 원자키.
export interface PublishedOpinionDoc {
  id: string;
  customerId: string | null;
  checkInId: string | null;
  docType: OpinionDocType;
  finalText: string;
  chartNo: string | null;
  doctorName: string;
  issuedAt: string;   // created_at(ISO)
  // T-20260724-foot-ISSUEDDOCS-DOCVIEW-FORMLAYOUT: 발행본 '양식 그대로' 열람(양식 렌더러 재사용)을 위한
  //   추가 스냅샷(이미 적재된 field_data read 만 — db_change=false). 인쇄 경로(OpinionDocTab.handlePrint)와
  //   동일하게 면허번호는 스냅샷 override, 도장(seal)은 발행자 clinic_doctors.id 로 결선(이름↔도장 세트 정합).
  issuedByLicenseNo: string | null;   // field_data.doctor_license_no
  issuedByDoctorId: string | null;    // field_data.issued_by_doctor_id
}

export function usePublishedOpinionDocs(
  clinicId: string | null,
  customerIds: string[],
  templateId: string | null,
) {
  const key = [...new Set(customerIds.filter(Boolean))].sort().join(',');
  return useQuery<PublishedOpinionDoc[]>({
    queryKey: ['opinion_published_docs', clinicId, templateId, key],
    enabled: !!clinicId && !!templateId && key.length > 0,
    queryFn: async () => {
      if (!clinicId || !templateId || !key) return [];
      const ids = key.split(',');
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, check_in_id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('template_id', templateId)
        .eq('status', 'published')
        .in('customer_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        return {
          id: String(r['id']),
          customerId: (r['customer_id'] as string | null) ?? null,
          checkInId: (r['check_in_id'] as string | null) ?? null,
          docType: (fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion') as OpinionDocType,
          finalText: String(fd['final_text'] ?? ''),
          chartNo: (fd['chart_no'] as string | null) || null,
          doctorName: String(fd['doctor_name'] ?? ''),
          issuedAt: String(r['created_at'] ?? ''),
          // T-20260724-foot-ISSUEDDOCS-DOCVIEW-FORMLAYOUT: 양식 렌더 바인딩용 추가 스냅샷(read-only field_data).
          issuedByLicenseNo: (fd['doctor_license_no'] as string | null) || null,
          issuedByDoctorId: (fd['issued_by_doctor_id'] as string | null) || null,
        };
      });
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 완료 요청 row ↔ 실제 발행본 원자 매핑(AC3 항목별 매핑 정확·교차노출 금지).
//   ① check_in_id + doc_type 우선 — 발행 RPC 가 요청 앵커(check_in)를 그대로 published.check_in_id 로 각인하므로
//      요청 1건 ↔ 발행본 1건 원자 링크(다른 서류/다른 환자 노출 방지).
//   ② check_in_id 결측(레거시) 시 customer_id + doc_type 폴백 — 여전히 customer 격리(타 환자 배제).
//   ③ 동일 키 복수 발행본은 resolved_at 에 가장 근접한 1건(publish→resolve 순차성). 미발견 시 null(폴백 재구성).
export function matchPublishedOpinionDoc(
  row: OpinionRequestRow,
  docs: PublishedOpinionDoc[],
): PublishedOpinionDoc | null {
  const sameType = docs.filter((d) => d.docType === row.docType);
  const byCheckIn = row.checkInId ? sameType.filter((d) => d.checkInId === row.checkInId) : [];
  const candidates = byCheckIn.length > 0
    ? byCheckIn
    : sameType.filter((d) => !!d.customerId && d.customerId === row.customerId);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const target = row.resolvedAt ? Date.parse(row.resolvedAt) : NaN;
  if (Number.isNaN(target)) return candidates[0];
  return candidates
    .slice()
    .sort((a, b) => Math.abs(Date.parse(a.issuedAt) - target) - Math.abs(Date.parse(b.issuedAt) - target))[0];
}

// 요청 처리 완료(원장 발행 or 직원 취소) → draft 를 'voided' 로 갱신해 큐에서 제거.
//   form_submissions_update RLS = clinic member + status<>'published' → draft 갱신 허용(비가역 트리거 무영향).
export function useResolveOpinionRequest(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; reason: 'published' | 'cancelled'; publishedId?: string }) => {
      const { data: cur } = await supabase
        .from('form_submissions')
        .select('field_data')
        .eq('id', input.requestId)
        .maybeSingle();
      const prev = ((cur as { field_data?: Record<string, unknown> } | null)?.field_data ?? {}) as Record<string, unknown>;
      const merged = {
        ...prev,
        resolved_at: new Date().toISOString(),
        resolved_reason: input.reason,
        ...(input.publishedId ? { resolved_published_id: input.publishedId } : {}),
      };
      const { error } = await supabase
        .from('form_submissions')
        .update({ status: 'voided', field_data: merged })
        .eq('id', input.requestId)
        .eq('status', 'draft');   // 동시성 가드: 이미 처리된 건 재갱신 방지
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opinion_request_queue', clinicId] });
    },
  });
}

// ─── 실장 요청 메모 편집 저장 (T-20260715-foot-DOCREQ-STAFFMEMO-VIEWER-EDITABLE, AC-2/3) ──
//   원장 작성창(OpinionEditorDialog)에서 실장(데스크)이 남긴 요청 메모(field_data.staff_memo)를
//   뷰어→편집 전환. 저장 = 기존 form_submissions.field_data JSONB 재사용 → 신규 컬럼/테이블/enum/RLS = 0 (NO-DDL).
//   ★authoring 경계(AC-4, BLOCKING): staff_memo 단일 키만 merge-update. 진단/소견 본문·서명·직인·발행(published)
//     산출물·publish_opinion_doc RPC 절대 미접촉. request_origin='staff_consult' + status='draft' 인 요청에만 write.
//   ★핸드오프 무결성(AC-3): merge-update(전체 field_data 스프레드 + staff_memo 덮어쓰기) → selected_keys/doc_type/
//     request_date 등 다른 요청 메타 무변경. 요청 1건=작성창 1회 매핑 불변.
//   form_submissions_update RLS = clinic member + status<>'published' → draft 갱신 허용.
export function useUpdateStaffMemo(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; staffMemo: string }) => {
      if (!input.requestId) throw new Error('요청 정보를 확인할 수 없습니다.');
      const { data: cur } = await supabase
        .from('form_submissions')
        .select('field_data, status')
        .eq('id', input.requestId)
        .maybeSingle();
      const prev = ((cur as { field_data?: Record<string, unknown> } | null)?.field_data ?? {}) as Record<string, unknown>;
      // 큐 식별키(staff_consult) 요청만 write 대상 — 오분류/타 draft 제출 오염 방지(AC-4).
      if (prev['request_origin'] !== 'staff_consult') throw new Error('편집 대상 요청이 아닙니다.');
      const merged = { ...prev, staff_memo: input.staffMemo ?? '' };
      const { error } = await supabase
        .from('form_submissions')
        .update({ field_data: merged })
        .eq('id', input.requestId)
        .eq('status', 'draft');   // 경계 가드: 발행(published/voided)된 건은 소급 미변경(AC-4 발행완료 산출물 보호)
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      // 큐(DocRequestQueue) 즉시 반영 — 편집한 메모가 처리대기 큐 표시에도 동기화(AC-1 표시 일관성).
      qc.invalidateQueries({ queryKey: ['opinion_request_queue', clinicId] });
    },
  });
}

// ─── 발행본 행정필드(B부류) 정정 저장 (T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT, AC3/AC4) ──
//   원내 직원이 발행완료 소견서/진단서의 행정·발급 metadata(발급요청일자·상병코드·담당의·발급일)만 정정.
//   ★AC4(발행 원문 스냅샷 불오염, BLOCKING): published row 절대 미접촉. 오버레이는 '요청 행'
//     (status='voided'+resolved_reason='published', RLS status<>'published' 로 mutable) field_data 에 write.
//     - 발급요청일자 = field_data.request_date(기존 top-level 키) 직접 정정.
//     - 담당의/발급일/상병코드 = field_data.admin_overrides.{doctor_name,issue_date,diag_code} 오버레이.
//       (열람/재출력 시 renderOpinionDocHtml override 로 얹음 — 발행본 snapshot 은 불변 유지.)
//   ★A부류(진단소견·의사소견 본문) 절대 미기록 — B부류 4키만 merge(원장 medical content immutable).
//   ★감사로그(의료법§22): 변경 필드마다 admin_edit_log 에 {누가·언제·이전값→새값} append(특히 상병코드=medical-adjacent).
//   ★NO-DDL: form_submissions.field_data(JSONB) 재사용 — 신규 컬럼/테이블/enum/RLS = 0.
export interface UpdateOpinionAdminFieldsInput {
  requestId: string;
  /** 발급요청일자(YYYY-MM-DD). undefined=미변경. */
  requestDate?: string;
  /** 담당의(발행자명). undefined=미변경. */
  doctorName?: string;
  /** T-20260728 (AC-6): 담당의 doctor_id 앵커(clinic_doctors.id). 드롭다운 선택 시 doctorName 과 함께 전달. */
  doctorId?: string;
  /** 발급일(YYYY-MM-DD). undefined=미변경. */
  issueDate?: string;
  /** 상병코드(primary, 예 K29.7). undefined=미변경. */
  diagCode?: string;
  /** 편집자(staff.id) + 표기명 — 감사로그 provenance. */
  editorId: string;
  editorName: string;
}

export function useUpdateOpinionAdminFields(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOpinionAdminFieldsInput) => {
      if (!input.requestId) throw new Error('서류 정보를 확인할 수 없습니다.');
      if (!input.editorId) throw new Error('직원 계정 정보를 확인할 수 없어 저장할 수 없습니다.');
      const { data: cur } = await supabase
        .from('form_submissions')
        .select('field_data, status')
        .eq('id', input.requestId)
        .maybeSingle();
      const row = (cur as { field_data?: Record<string, unknown>; status?: string } | null) ?? null;
      const prev = (row?.field_data ?? {}) as Record<string, unknown>;
      // 경계 가드: 발행완료 요청 행만 대상(staff_consult + 발행됨). 발행본(published) 원본은 절대 미접촉(AC4).
      if (prev['request_origin'] !== 'staff_consult') throw new Error('편집 대상 서류가 아닙니다.');
      if (row?.status === 'published') throw new Error('발행 원본은 수정할 수 없습니다(의무기록 불변).');
      if (prev['resolved_reason'] !== 'published') throw new Error('발행 완료된 서류만 정정할 수 있습니다.');

      const prevOverrides = (prev['admin_overrides'] && typeof prev['admin_overrides'] === 'object'
        ? prev['admin_overrides']
        : {}) as Record<string, unknown>;
      const nowIso = new Date().toISOString();
      const log: AdminEditLogEntry[] = Array.isArray(prev['admin_edit_log'])
        ? (prev['admin_edit_log'] as AdminEditLogEntry[]).slice()
        : [];

      const pushLog = (field: string, fieldLabel: string, oldValue: string, newValue: string) => {
        if (oldValue === newValue) return; // 실제 변경만 기록(무변경 no-op)
        log.push({ field, fieldLabel, oldValue, newValue, by: input.editorId, byName: input.editorName, at: nowIso });
      };

      const nextTop: Record<string, unknown> = { ...prev };
      const nextOverrides: Record<string, unknown> = { ...prevOverrides };

      // 발급요청일자 = top-level request_date 직접 정정.
      if (input.requestDate !== undefined) {
        const oldV = String(prev['request_date'] ?? '');
        const newV = input.requestDate;
        pushLog('request_date', '발급요청일자', oldV, newV);
        nextTop['request_date'] = newV;
      }
      // 담당의 = admin_overrides.doctor_name 오버레이.
      //   T-20260728 (AC-6): 드롭다운 선택 → doctor_name(표시)과 doctor_id(도장 자동추종 앵커)를 함께 정정.
      //   doctorName 변경분만 감사로그에 남긴다(현장 표기값). doctor_id 는 도장 결선용 내부 앵커.
      if (input.doctorName !== undefined) {
        const oldV = String(prevOverrides['doctor_name'] ?? '');
        const newV = input.doctorName;
        pushLog('doctor_name', '담당의', oldV, newV);
        if (newV) nextOverrides['doctor_name'] = newV; else delete nextOverrides['doctor_name'];
        // 이름을 비우면 앵커도 함께 제거(정합). 드롭다운은 항상 doctorId 동반 전달.
        if (newV) {
          if (input.doctorId) nextOverrides['doctor_id'] = input.doctorId; else delete nextOverrides['doctor_id'];
        } else {
          delete nextOverrides['doctor_id'];
        }
      }
      // 발급일 = admin_overrides.issue_date 오버레이.
      if (input.issueDate !== undefined) {
        const oldV = String(prevOverrides['issue_date'] ?? '');
        const newV = input.issueDate;
        pushLog('issue_date', '발급일', oldV, newV);
        if (newV) nextOverrides['issue_date'] = newV; else delete nextOverrides['issue_date'];
      }
      // 상병코드 = admin_overrides.diag_code 오버레이(medical-adjacent → 감사로그 필수).
      if (input.diagCode !== undefined) {
        const oldV = String(prevOverrides['diag_code'] ?? '');
        const newV = input.diagCode;
        pushLog('diag_code', '상병코드', oldV, newV);
        if (newV) nextOverrides['diag_code'] = newV; else delete nextOverrides['diag_code'];
      }

      const merged: Record<string, unknown> = {
        ...nextTop,
        admin_overrides: nextOverrides,
        admin_edit_log: log,
      };
      const { error } = await supabase
        .from('form_submissions')
        .update({ field_data: merged })
        .eq('id', input.requestId)
        .eq('status', 'voided'); // 경계 가드: 발행 원본(published) 미접촉 — 요청 행(voided)만 write(AC4)
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      // 완료 그룹 + 발행본 열람 뷰 즉시 반영.
      qc.invalidateQueries({ queryKey: ['opinion_request_published', clinicId] });
      qc.invalidateQueries({ queryKey: ['opinion_request_customer_history', clinicId] });
      // T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE [P0, AC3]: 데스크/수납 출력 게이트 캐시도 무효화 →
      //   담당의 정정 저장 직후 '새로고침 없이' 출력(useAuthoredMedDocs)에 정정 담당의·도장이 반영된다.
      //   (queryKey=['meddoc_authored', clinicId, customerId] — clinicId prefix 무효화로 해당 환자 게이트 포함.)
      qc.invalidateQueries({ queryKey: ['meddoc_authored', clinicId] });
    },
  });
}

// ─── 큐 행 임상 컬럼(오늘시술/처방내역/임상경과) — 최근 medical_chart 스냅샷 (read-only, 방어적) ──
//   AC-11 9컬럼 중 오늘시술/처방내역/임상경과 보조표시. 조회 실패/컬럼부재여도 큐는 깨지지 않음(빈 맵 폴백).
//   T-20260620-foot-CHART2-DOC-REQUEST-INTEGRATION (AC-2): 처방내역=medical_charts.prescription_items(JSONB)
//     기존 컬럼 ADDITIVE read — 신규 DDL/조인 없음. formatRxItemToken(referralAutoLoad와 동일 패턴) 재사용.
export interface ClinicalSnap {
  treatment: string | null;     // 오늘시술 ← treatment_record
  prescription: string | null;  // 처방내역 ← prescription_items(JSONB) 요약
  progress: string | null;      // 임상경과 ← chief_complaint || diagnosis
}

// prescription_items(JSONB 배열) → 약물명 토큰 요약(', ' 구분, 테이블셀 1줄용). 빈/결측 시 null.
function summarizeRxItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const tokens = items
    .map((it) => formatRxItemToken(it).trim())
    .filter((s) => s.length > 0 && s !== '(이름 미입력)');
  return tokens.length > 0 ? tokens.join(', ') : null;
}
// ─── T-20260728-foot-DOCWRITE-DOCTOR-LINK: 서류작성 큐 행 '담당 진료의'(치료테이블 [진료]와 동일 값) ──
//   RC(현장, 김주연 총괄 U0ATDB587PV 2026-07-28): 진료 대시보드 [서류작성] 탭 각 행에 담당 진료의가 하나도
//   안 따라온다(치료테이블 [진료]에서는 정상 표시). 담당 진료의 SSOT = check_ins.treating_doctor_id →
//   clinic_doctors.name — TreatingDoctorSelect(write 단일경로)·치료테이블 [진료] 표시·서류 출력 바인딩
//   (loadAutoBindContext treatingDoctor)·발행자 seed(useVisitTreatingDoctor) 가 공유하는 단일 소스다.
//   서류요청 큐 행은 checkInId(요청 생성 시 '최근 내원' 앵커, useCreateOpinionRequest)를 이미 들고 있으므로,
//   그 check_in 의 treating_doctor_id 를 이름으로 해석해 표시한다 → 치료테이블 [진료]와 '동일한 값'(AC).
//   ★확정 방식(문지은 대표원장 §11 컨펌 '표시+폼 기본값 자동입력 ADDITIVE'): 조회에 진료의 read 만 추가.
//     발행/저장/귀속 로직 무변경.
//   ★read-only READ 전용(db_change=false): 기존 check_ins.treating_doctor_id + clinic_doctors.name read 만.
//     신규 컬럼/테이블/enum/RLS = 0. 미지정/조회실패 → 빈 맵 폴백(graceful, 큐 무붕괴 = 임상스냅 훅과 동형).
//   ★교차노출 없음: clinic-scoped + 큐가 이미 소유한 checkInId 로만 조회(타 환자/타 지점 유입 배제).
export function useQueueTreatingDoctors(clinicId: string | null, checkInIds: string[]) {
  const key = [...new Set(checkInIds.filter(Boolean))].sort().join(',');
  return useQuery<Record<string, string>>({
    queryKey: ['opinion_queue_treating_doctor', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      if (!clinicId || !key) return out;
      try {
        const ids = key.split(',');
        // 1) 요청행 checkIn → treating_doctor_id (치료테이블 [진료] 저장 앵커, 동일 필드)
        const { data: ciData, error: ciErr } = await supabase
          .from('check_ins')
          .select('id, treating_doctor_id')
          .eq('clinic_id', clinicId)
          .in('id', ids);
        if (ciErr) throw ciErr;
        const ciRows = (ciData ?? []) as Array<{ id: string; treating_doctor_id: string | null }>;
        const doctorIds = [...new Set(ciRows.map((r) => r.treating_doctor_id).filter(Boolean) as string[])];
        if (doctorIds.length === 0) return out;
        // 2) treating_doctor_id → clinic_doctors.name. active 필터 없이 이름만 해석 —
        //    비활성/삭제 원장이라도 이름 유실 방지(TreatingDoctorSelect renderLabel 컨벤션과 정합).
        const { data: docData, error: docErr } = await supabase
          .from('clinic_doctors')
          .select('id, name')
          .eq('clinic_id', clinicId)
          .in('id', doctorIds);
        if (docErr) throw docErr;
        const nameById = new Map<string, string>();
        for (const d of (docData ?? []) as Array<{ id: string; name: string | null }>) {
          if (d.id) nameById.set(String(d.id), String(d.name ?? ''));
        }
        for (const r of ciRows) {
          if (r.treating_doctor_id) {
            const nm = nameById.get(r.treating_doctor_id);
            if (nm) out[r.id] = nm; // checkInId → 담당 진료의명
          }
        }
      } catch {
        // 진료의 조회 불가/컬럼부재 — 담당 진료의 셀은 '미지정' 폴백. 큐 자체는 정상(graceful).
        return {};
      }
      return out;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ─── T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT ──────────────────────────────────────────
//   진료 알림판(DoctorCallDashboard 상시뷰) 소견서·진단서 '처리대기'/'서류 완료' 테이블의 3개 컬럼이
//   전 환자 '—' 로 비어 있던 회귀를 실 데이터에 연동한다(김주연 총괄 지적, MSG-b6gp confirm 확정).
//   전부 read-only READ 전용(db_change=false) — 신규 컬럼/테이블/enum/RLS = 0. 조회 실패/컬럼부재여도
//   큐는 깨지지 않음(빈 맵 폴백 = 기존 임상스냅/담당진료의 훅과 동형 graceful).
//   ★Silent 0-Row Read 주의(cross-CRM 표준): anon/RLS 0-row 는 '데이터 없음'이 아니라 미조회일 수 있으므로
//     쿼리는 clinic-scoped + id 필터로 정확히 겨눈다(교차노출 배제 + 실측 근거).
//
//   ─ AC-1(생년/만나이): customers.birth_date '실시간' 소스 —
//     기존 큐 birthDate 는 요청 생성시 field_data 에 박힌 '스냅샷'이라 결측/공란이면 만나이가 안 뜬다.
//     진료대시보드 환자테이블이 쓰는 live 소스(customers.birth_date, opinionAutofillRef 패턴)를 그대로 읽어
//     스냅샷보다 우선한다. birthYearAgeDisplay 로 "YYYY (만 N세)" 파생(결측 '—', null-safe).
export function useQueueCustomerBirthDates(clinicId: string | null, customerIds: string[]) {
  const key = [...new Set(customerIds.filter(Boolean))].sort().join(',');
  return useQuery<Record<string, string>>({
    queryKey: ['opinion_queue_birthdate', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      if (!clinicId || !key) return out;
      try {
        const ids = key.split(',');
        // customer_id 는 이미 clinic-scoped 큐(form_submissions)에서 유래 → id 필터로 정확 조회
        //   (opinionAutofillRef 의 customers.birth_date 단건 조회 패턴과 동일 소스). RLS 로 지점 격리.
        const { data, error } = await supabase
          .from('customers')
          .select('id, birth_date')
          .in('id', ids);
        if (error) throw error;
        for (const r of (data ?? []) as Array<{ id: string; birth_date: string | null }>) {
          if (r.id && r.birth_date) out[String(r.id)] = String(r.birth_date);
        }
      } catch {
        // 생년 조회 불가 — 셀은 스냅샷 폴백 또는 '—'(큐 무붕괴).
        return {};
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
}

//   ─ AC-2(오늘시술) / AC-3(처방내역): 당일(KST) check-in 기준 실 소스 연동.
//     AC-2 = check_ins.treatment_kind(?? treatment_category) — '2번차트(펜차트) 티켓 차감 기준'(confirm 확정).
//            당일 차감 시술을 '모두' 나열(첫 건/한 건 아님, MSG-b6gp: "당일 시술 모두 표기").
//            표시값 SSOT = PKG-BOX-INDICATOR(가열/비가열/포돌로게/수액/체험권 …) = treatment_kind 원값.
//     AC-3 = 결제미니창(PMW) 당일 처방약 목록(confirm 확정: "결제 창이 더 정확"). PMW settle 시
//            처방약(services.category_label='처방약') 라인아이템은 check_in_services 로 영속된다
//            (PaymentMiniWindow.saveCheckInServices, selectedItems=시술+코드아이템 전건 insert). 그 당일
//            check_in 의 처방약 service_name 을 나열(=medical_charts.prescription_items 아님).
export interface TodayProcedureRx {
  procedures: string[];    // AC-2: 당일 차감 시술(treatment_kind) 전체
  prescriptions: string[]; // AC-3: 당일 PMW 처방약 service_name 전체
}

// 순수 파생(E2E spec 이 직접 import·단언 → drift 방지) — check-in 행 → 오늘시술 라벨(ProcedureCell SSOT 동형).
export function procedureLabelOf(row: { treatment_kind?: string | null; treatment_category?: string | null }): string {
  return String(row.treatment_kind ?? row.treatment_category ?? '').trim();
}

// 순수 파생 — check_in_services(services.category_label 임베드) 행 목록 → 처방약 service_name 배열.
//   PostgREST 임베드는 object|array 양쪽 직렬화 가능 → 둘 다 흡수(readChartNo 패턴 동형).
export function extractRxDrugNames(
  cisRows: Array<Record<string, unknown>>,
): string[] {
  const names: string[] = [];
  for (const r of cisRows) {
    const svc = r['services'] as
      | { category_label?: string | null }
      | Array<{ category_label?: string | null }>
      | null
      | undefined;
    const cat = Array.isArray(svc) ? (svc[0]?.category_label ?? '') : (svc?.category_label ?? '');
    if (cat !== '처방약') continue;
    const nm = String(r['service_name'] ?? '').trim();
    if (nm) names.push(nm);
  }
  return names;
}

export function useQueueTodayProcedureRx(clinicId: string | null, customerIds: string[]) {
  const key = [...new Set(customerIds.filter(Boolean))].sort().join(',');
  return useQuery<Record<string, TodayProcedureRx>>({
    queryKey: ['opinion_queue_today_proc_rx', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const out: Record<string, TodayProcedureRx> = {};
      if (!clinicId || !key) return out;
      try {
        const ids = key.split(',');
        const today = todaySeoulISODate();
        // 1) 당일(KST) check-in — checked_in_at 는 timestamptz 이므로 +09:00 오프셋 경계로 정확 필터
        //    (KST 오전 UTC 전일 저장분도 offset 비교로 당일에 포함). clinic-scoped + customer in ids.
        const { data: ciData, error: ciErr } = await supabase
          .from('check_ins')
          .select('id, customer_id, treatment_kind, treatment_category, checked_in_at')
          .eq('clinic_id', clinicId)
          .in('customer_id', ids)
          .gte('checked_in_at', `${today}T00:00:00+09:00`)
          .lte('checked_in_at', `${today}T23:59:59.999+09:00`)
          .order('checked_in_at', { ascending: true });
        if (ciErr) throw ciErr;
        const ciRows = (ciData ?? []) as Array<{
          id: string; customer_id: string | null;
          treatment_kind: string | null; treatment_category: string | null;
        }>;
        const checkInToCustomer = new Map<string, string>();
        for (const ci of ciRows) {
          const cid = String(ci.customer_id ?? '');
          if (!cid) continue;
          checkInToCustomer.set(String(ci.id), cid);
          if (!out[cid]) out[cid] = { procedures: [], prescriptions: [] };
          const label = procedureLabelOf(ci);
          if (label) out[cid].procedures.push(label);
        }
        // 2) 그 당일 check-in 들의 PMW 처방약(check_in_services + services.category_label='처방약')
        const checkInIds = ciRows.map((c) => String(c.id)).filter(Boolean);
        if (checkInIds.length > 0) {
          const { data: cisData, error: cisErr } = await supabase
            .from('check_in_services')
            .select('check_in_id, service_name, services:service_id(category_label)')
            .in('check_in_id', checkInIds);
          if (cisErr) throw cisErr;
          // check_in_id 별 처방약명 수집 → 소속 customer 로 귀속(당일 여러 내원도 합산).
          const byCheckIn = new Map<string, Array<Record<string, unknown>>>();
          for (const raw of (cisData ?? []) as Array<Record<string, unknown>>) {
            const cin = String(raw['check_in_id'] ?? '');
            if (!cin) continue;
            const arr = byCheckIn.get(cin) ?? [];
            arr.push(raw);
            byCheckIn.set(cin, arr);
          }
          for (const [cin, rows] of byCheckIn) {
            const cid = checkInToCustomer.get(cin);
            if (!cid || !out[cid]) continue;
            out[cid].prescriptions.push(...extractRxDrugNames(rows));
          }
        }
      } catch {
        // 당일 시술/처방 조회 불가 — 두 컬럼은 '—' 폴백. 큐 자체는 정상(graceful).
        return {};
      }
      return out;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK (AC-2/3): 오늘시술·처방내역을 '행의 방문(check_in_id)' 스코프로 재결선.
//   RC(런타임 확정 — scripts/T-20260729-...-COL-BLANK_probe.mjs):
//     직전 useQueueTodayProcedureRx 는 (a) check_ins.treatment_kind(전행 NULL) 을 오늘시술 소스로 삼고,
//     (b) '글로벌 오늘(KST) check_ins' 만 조회 → 서류완료(과거일)·비-today 발행요청 행이 전면 공란이었다.
//   FIX: 알림판 목록의 각 행은 자신의 발행요청 방문 check_in_id 를 앵커로 가진다(loadOpinionAutofillRef 동형).
//     그 방문 스코프로 소스를 다시 결선(read-only, DDL/write 0. check_in_id 는 clinic-scoped form_submissions 유래 → 타 환자 유입 배제).
//     · AC-2 오늘시술 = 그 방문의 package_sessions.session_type(=차트2 티켓 차감 = 패키지 회차 차감 = 당일 시술 확정 신호)
//         → sessionTypeLabel 간략형(레이저비가열/레이저가열/발톱교정/각질/수액/체험/Re:Born). 차감 없으면 공란(AC).
//     · AC-3 처방내역 = 그 방문의 check_in_services 처방약(services.category_label='처방약') service_name (extractRxDrugNames 재사용).
export function useQueueVisitProcedureRx(clinicId: string | null, checkInIds: string[]) {
  const key = [...new Set(checkInIds.filter(Boolean))].sort().join(',');
  return useQuery<Record<string, TodayProcedureRx>>({
    queryKey: ['opinion_queue_visit_proc_rx', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const out: Record<string, TodayProcedureRx> = {};
      if (!clinicId || !key) return out;
      try {
        const ids = key.split(',');
        for (const id of ids) out[id] = { procedures: [], prescriptions: [] };
        // AC-2: 그 방문의 회차 차감(package_sessions) — soft-delete 제외, 세션번호순으로 전부 나열.
        const { data: psData, error: psErr } = await supabase
          .from('package_sessions')
          .select('check_in_id, session_type, session_number')
          .in('check_in_id', ids)
          .is('deleted_at', null)
          .order('session_number', { ascending: true });
        if (psErr) throw psErr;
        for (const raw of (psData ?? []) as Array<{ check_in_id: string | null; session_type: string | null }>) {
          const cin = String(raw.check_in_id ?? '');
          if (!cin || !out[cin]) continue;
          const label = sessionTypeLabel(raw.session_type);
          if (label && !out[cin].procedures.includes(label)) out[cin].procedures.push(label);
        }
        // AC-3: 그 방문의 처방약(check_in_services + services.category_label='처방약').
        const { data: cisData, error: cisErr } = await supabase
          .from('check_in_services')
          .select('check_in_id, service_name, services:service_id(category_label)')
          .in('check_in_id', ids);
        if (cisErr) throw cisErr;
        const byCheckIn = new Map<string, Array<Record<string, unknown>>>();
        for (const raw of (cisData ?? []) as Array<Record<string, unknown>>) {
          const cin = String(raw['check_in_id'] ?? '');
          if (!cin) continue;
          const arr = byCheckIn.get(cin) ?? [];
          arr.push(raw);
          byCheckIn.set(cin, arr);
        }
        for (const [cin, rowsForCin] of byCheckIn) {
          if (!out[cin]) continue;
          for (const nm of extractRxDrugNames(rowsForCin)) {
            if (!out[cin].prescriptions.includes(nm)) out[cin].prescriptions.push(nm);
          }
        }
      } catch {
        // 방문 스코프 시술/처방 조회 불가 — 두 컬럼은 '—' 폴백. 큐 자체는 정상(graceful).
        return {};
      }
      return out;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useQueueClinicalSnaps(clinicId: string | null, customerIds: string[]) {
  const key = [...new Set(customerIds.filter(Boolean))].sort().join(',');
  return useQuery<Record<string, ClinicalSnap>>({
    queryKey: ['opinion_queue_clinical', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const out: Record<string, ClinicalSnap> = {};
      if (!clinicId || !key) return out;
      try {
        const ids = key.split(',');
        const { data, error } = await supabase
          .from('medical_charts')
          .select('customer_id, treatment_record, prescription_items, chief_complaint, diagnosis, visit_date, created_at')
          .eq('clinic_id', clinicId)
          .in('customer_id', ids)
          .order('visit_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (error) throw error;
        for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
          const cid = String(raw['customer_id'] ?? '');
          if (!cid || out[cid]) continue; // 최신 1건만(정렬 우선)
          out[cid] = {
            treatment: (raw['treatment_record'] as string | null) || null,
            prescription: summarizeRxItems(raw['prescription_items']),
            progress: ((raw['chief_complaint'] as string | null) || (raw['diagnosis'] as string | null)) || null,
          };
        }
      } catch {
        // 진료기록 접근 불가/컬럼부재 — 임상 보조컬럼은 '—' 폴백. 큐 자체는 정상.
        return {};
      }
      return out;
    },
    staleTime: 30_000,
  });
}
