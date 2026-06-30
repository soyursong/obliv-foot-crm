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

// ─── 진료대시보드 '서류 완료' 그룹 (T-20260625-foot-DOCDASH-DOCSECTION-COMPLETED-SUBHEADER) ──
//   원장이 발행을 마치면 useResolveOpinionRequest 가 draft → status='voided' + field_data.resolved_reason='published'
//   로 전환한다(L196~). 그 완료 row 를 read-only 로 다시 읽어 '서류 완료' 서브헤더 그룹에 표시(목록에서 사라지지 않게).
//   ★read-only 표시 전용: authoring/publish 경로(publish_opinion_doc RPC·OpinionEditorDialog) 일절 미접촉.
//   ★스키마 변경 0: 이미 적재되는 field_data.resolved_reason/resolved_at 만 read.
//   ★cancelled(요청취소) 제외: '서류 완료' = resolved_reason='published' 만(흡수 그라운딩 준수).
//   ★day-scoped: 진료대시보드는 당일 뷰 → resolved_at(KST) 이 오늘인 발행 건만. created_at 2일 lookback 으로
//     자정 넘겨 발행된 어제-요청-오늘-완료 건까지 포섭한 뒤 resolved_at KST==today 로 정밀 필터.
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
          resolvedAt: String(fd['resolved_at'] ?? ''),
        }))
        // 최근 발행 순(resolved_at desc) — created_at 정렬과 무관하게 완료시각 기준 재정렬.
        .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
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
