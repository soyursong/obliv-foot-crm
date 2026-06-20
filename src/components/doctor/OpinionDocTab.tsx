// OpinionDocTab — 소견서(진단서) 작성 탭
// Ticket: T-20260616-foot-OPINION-DOC-FEATURE (Phase 2 — 영속·발행·출력, DA CONSULT GO)
//   원 요청: 김주연 총괄 (#foot thread 1781491923.605529). UI ref = 첨부 F0BAETELCTF(소견서 팝업).
//
// ⚠ 균검사지(KohReportTab) NOTOUCH — 본 탭은 균검사지 '옆'에 신설된 독립 탭(DoctorTools.tsx).
//   균검사지 내부 로직(KOH-SPECIMENNO-FORMAT, KOHTOGGLE-NOTRENDER 등 in-flight)에 무간섭.
//
// === 범위 (이 파일) ===
//   AC-2 금일 내방객(check_ins, KST 당일) 리스트업(read-only).
//   AC-3 고객 클릭 → 팝업(F0BAETELCTF 옵션 그리드). 옵션 클릭 → 템플릿 문구 editor 자동 삽입.
//   AC-4 자동삽입 최종본을 원장이 textarea 에서 수기 수정(editor = SSOT).
//   AC-6 [최종 발행] → publish_opinion_doc RPC(form_submissions status='published' insert). window.confirm 가드.
//        발행자(진료의)=clinic_doctors 선택(is_default 기본) → 이름/면허는 field_data 스냅샷. 발행 권한=is_doctor_role(director|doctor, C2).
//        비가역성 = form_submissions published 트리거(C1, 의료법 제22조). 정정=신규 발행(append-only, C4).
//   AC-7 발행 이력 [출력] → printOpinionDoc(diag_opinion 양식, bindHtmlTemplate L-006 재사용, window.open 인쇄).
//        스냅샷 body(field_data.final_text) 그대로 출력(변조 불가). 신규 출력 스택 금지 — 기존 양식·인쇄 경로 재사용.
//   AC-8 템플릿 설정/관리 UI 위치 = planner FOLLOWUP 제안(미구현). 본 파일은 form_templates(form_key='opinion_doc')
//        field_map.sections 를 read 만 wiring(있으면 그 옵션 그리드, 없으면 하드코드 OPINION_SECTIONS — empty-safe).
//
// === DA 재판정(GO_REUSE_A) — KOH form 스택 재사용 ===
//   전용 2테이블(opinion_doc_templates/opinion_documents) 폐기. form_templates + form_submissions 재사용.
//   템플릿 = form_templates(form_key='opinion_doc').field_map.sections. 발행본 = form_submissions(status='published').
//   cross_crm_data_contract §2-7 v2. (마이그 20260616160000_opinion_doc_form_stack.sql)
//
// === 템플릿 옵션(OPINION_SECTIONS) — 하드코드 기본값 ===
//   F0BAETELCTF 의 2개 섹션(진단서 / 금기증) + 옵션 라벨을 그대로 미러.
//   원장이 editor 에서 수기 수정하므로 기본 문구는 출발점일 뿐(AC-4). 임의 임상 단정 회피 — 라벨 기반 중립 문장.
//   form_templates(form_key='opinion_doc').field_map.sections 가 있으면 그 그리드를 우선 사용(없으면 이 하드코드).

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { todaySeoulISODate, seoulISODate, birthYearAgeDisplay, chartNoDisplay } from '@/lib/format';
import { printOpinionDoc } from '@/lib/printOpinionDoc';
import MedicalChartPanel from '@/components/MedicalChartPanel';
import type { UserProfile } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, FileText, FileDown, Search, ClipboardList, Printer } from 'lucide-react';

// ---------------------------------------------------------------------------
// 템플릿 옵션 — F0BAETELCTF 미러 (Phase 1 하드코드 기본값, Phase 2 설정 UI 로 이관 예정 AC-8).
//   key=안정 식별자 / label=버튼 표기(현장) / phrase=클릭 시 editor 자동삽입 문구(기본값).
// ---------------------------------------------------------------------------
export interface OpinionOption {
  key: string;
  label: string;
  phrase: string;
}
export interface OpinionSection {
  title: string;
  options: OpinionOption[];
}

export const OPINION_SECTIONS: OpinionSection[] = [
  {
    title: '진단서',
    options: [
      { key: 'oral_o', label: '경구약 O', phrase: '경구약 복용이 가능한 상태로 확인됩니다.' },
      { key: 'oral_x', label: '경구약 X', phrase: '경구약 복용이 어려운 상태로 확인됩니다.' },
      { key: 'after_1m', label: '약복용 1달 후', phrase: '약 복용 1개월 후 경과 관찰이 필요합니다.' },
      { key: 'medical_staff', label: '의료진', phrase: '의료진 판단 하에 진료를 진행하였습니다.' },
    ],
  },
  {
    title: '금기증',
    options: [
      { key: 'hyperlipidemia', label: '고지혈증', phrase: '고지혈증 관련 사항을 확인하였습니다.' },
      { key: 'gi_disorder', label: '위장장애', phrase: '위장장애 관련 사항을 확인하였습니다.' },
      { key: 'oral_ineffective', label: '경구약 효과미비', phrase: '경구약 복용 효과가 미비하여 추가 조치를 고려합니다.' },
      { key: 'gi_after_oral', label: '경구약복용후 위장장애', phrase: '경구약 복용 후 위장장애가 확인됩니다.' },
      { key: 'bp_med', label: '혈압약', phrase: '혈압약 복용 이력을 확인하였습니다.' },
      { key: 'cardio_med', label: '심혈관약', phrase: '심혈관계 약물 복용 이력을 확인하였습니다.' },
      { key: 'liver_disease', label: '간질환', phrase: '간질환 관련 사항을 확인하였습니다.' },
      { key: 'hbv_carrier', label: '간염보균자', phrase: '간염 보균 여부를 확인하였습니다.' },
      { key: 'kidney_disease', label: '신장질환', phrase: '신장질환 관련 사항을 확인하였습니다.' },
      { key: 'gout_med', label: '통풍약', phrase: '통풍약 복용 이력을 확인하였습니다.' },
      { key: 'thyroid_med', label: '갑상선약', phrase: '갑상선약 복용 이력을 확인하였습니다.' },
      { key: 'male_hairloss_med', label: '남성 탈모약', phrase: '남성 탈모약 복용 이력을 확인하였습니다.' },
      { key: 'female_hairloss_med', label: '여성 탈모약', phrase: '여성 탈모약 복용 이력을 확인하였습니다.' },
      { key: 'psychiatric_med', label: '항정신과약', phrase: '항정신과 약물 복용 이력을 확인하였습니다.' },
      { key: 'on_chemo', label: '항암중', phrase: '항암 치료 중인 상태를 확인하였습니다.' },
      { key: 'post_chemo_followup', label: '항암 후 추적', phrase: '항암 치료 후 추적 관찰 중임을 확인하였습니다.' },
      { key: 'preparing_pregnancy', label: '임신준비중', phrase: '임신 준비 중인 상태를 확인하였습니다.' },
      { key: 'pregnant', label: '임신중', phrase: '임신 중인 상태를 확인하였습니다.' },
      { key: 'breastfeeding', label: '수유중', phrase: '수유 중인 상태를 확인하였습니다.' },
      { key: 'pilot', label: '파일럿', phrase: '항공 종사자(파일럿) 직군임을 확인하였습니다.' },
      { key: 'driver', label: '운전기사', phrase: '운전 직군임을 확인하였습니다.' },
      { key: 'immune_disease', label: '면역질환', phrase: '면역질환 관련 사항을 확인하였습니다.' },
      { key: 'diabetes', label: '당뇨', phrase: '당뇨 관련 사항을 확인하였습니다.' },
      { key: 'pediatric', label: '소아', phrase: '소아 환자임을 확인하였습니다.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// editor 텍스트 합성 — 선택된 옵션의 phrase 를 줄 단위로 append/remove(toggle).
//   editor = 최종 SSOT(AC-4 수기수정). selected set 은 시각 강조 + best-effort toggle 용.
//   문구는 줄(\n) 단위로 관리 — 동일 phrase 가 본문에 있으면 제거, 없으면 끝에 추가.
// ---------------------------------------------------------------------------
export function togglePhraseInText(text: string, phrase: string): string {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const idx = lines.findIndex((l) => l.trim() === phrase.trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${phrase}` : phrase;
}

// ---------------------------------------------------------------------------
// 금일 내방객 조회 — check_ins 당일(KST) + customers 조인(차트/생년). read-only.
//   DoctorCallDashboard.useDoctorCallFeed 의 KST 바운드 컨벤션과 동일. cancelled 제외.
// ---------------------------------------------------------------------------
export interface VisitorRow {
  id: string;
  customer_id: string | null;
  customer_name: string;
  chart_number: string | null;
  birth_date: string | null;
  visit_type: string | null;
  checked_in_at: string;
}

function readCustomerField<T>(raw: unknown, key: string): T | null {
  const c = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  return (c?.[key] as T) ?? null;
}

function useTodayVisitors(clinicId: string | null) {
  return useQuery<VisitorRow[]>({
    queryKey: ['opinion_today_visitors', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const today = todaySeoulISODate();
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_id, customer_name, visit_type, checked_in_at, customers!customer_id(chart_number, birth_date)')
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${today}T00:00:00+09:00`)
        .lte('checked_in_at', `${today}T23:59:59+09:00`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row['id']),
        customer_id: (row['customer_id'] as string | null) ?? null,
        customer_name: String(row['customer_name'] ?? '—'),
        chart_number: readCustomerField<string>(row['customers'], 'chart_number'),
        birth_date: readCustomerField<string>(row['customers'], 'birth_date'),
        visit_type: (row['visit_type'] as string | null) ?? null,
        checked_in_at: String(row['checked_in_at'] ?? ''),
      }));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Phase 2 데이터 계층(form 스택 재사용) — 템플릿(form_templates)·진료의·기관 헤더·발행본(form_submissions).
//   DA 재판정 GO_REUSE_A: 전용테이블 X. form_key='opinion_doc' + status='published'.
// ---------------------------------------------------------------------------

// field_map.sections(jsonb) → OpinionSection[] 방어적 파싱(형식 불량/누락 시 빈 배열 → 하드코드 폴백).
export function parseOpinionSections(fieldMap: unknown): OpinionSection[] {
  const fm = (fieldMap ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(fm['sections']) ? (fm['sections'] as unknown[]) : [];
  const out: OpinionSection[] = [];
  for (const s of raw) {
    const sec = (s ?? {}) as Record<string, unknown>;
    const title = typeof sec['title'] === 'string' ? (sec['title'] as string) : '';
    const optsRaw = Array.isArray(sec['options']) ? (sec['options'] as unknown[]) : [];
    const options: OpinionOption[] = [];
    for (const o of optsRaw) {
      const opt = (o ?? {}) as Record<string, unknown>;
      if (
        typeof opt['key'] === 'string' &&
        typeof opt['label'] === 'string' &&
        typeof opt['phrase'] === 'string'
      ) {
        options.push({ key: opt['key'] as string, label: opt['label'] as string, phrase: opt['phrase'] as string });
      }
    }
    if (title && options.length > 0) out.push({ title, options });
  }
  return out;
}

// opinion_doc form_template — templateId(발행/이력 필터·provenance) + field_map.sections(옵션 그리드).
//   마이그 미적용/seed 없음 → templateId=null, sections=[] (FE 하드코드 OPINION_SECTIONS 폴백, empty-safe).
export interface OpinionTemplate {
  templateId: string | null;
  sections: OpinionSection[];
}
function useOpinionTemplate(clinicId: string | null) {
  return useQuery<OpinionTemplate>({
    queryKey: ['opinion_form_template', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return { templateId: null, sections: [] };
      const { data, error } = await supabase
        .from('form_templates')
        .select('id, field_map')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'opinion_doc')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const tpl = (data ?? null) as { id?: string; field_map?: unknown } | null;
      if (!tpl?.id) return { templateId: null, sections: [] };
      return { templateId: String(tpl.id), sections: parseOpinionSections(tpl.field_map) };
    },
    staleTime: 60_000,
  });
}

// 진료의(clinic_doctors, active) — 발행자(issued_by) 결정. is_default 우선.
export interface ClinicDoctorOption {
  id: string;
  name: string;
  license_no: string | null;
  is_default: boolean;
}
function useClinicDoctors(clinicId: string | null) {
  return useQuery<ClinicDoctorOption[]>({
    queryKey: ['opinion_clinic_doctors', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { data, error } = await supabase
        .from('clinic_doctors')
        .select('id, name, license_no, is_default')
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r['id']),
        name: String(r['name'] ?? ''),
        license_no: (r['license_no'] as string | null) ?? null,
        is_default: Boolean(r['is_default']),
      }));
    },
    staleTime: 60_000,
  });
}

// 의료기관 헤더(clinics) — 인쇄 양식 바인딩용.
export interface ClinicHeader {
  name: string | null;
  address: string | null;
  phone: string | null;
}
// T-20260617-foot-DOCFORM-POPUP-OVERHAUL Phase 1: 진료대시보드(DoctorDocsHubDialog)에서 소견서 팝업을
//   재사용하기 위해 export. 본 탭의 기존 동선·로직은 무변경(진입점만 추가, 회귀 0).
export function useClinicHeader(clinicId: string | null) {
  return useQuery<ClinicHeader | null>({
    queryKey: ['opinion_clinic_header', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return null;
      const { data, error } = await supabase
        .from('clinics')
        .select('name, address, phone')
        .eq('id', clinicId)
        .maybeSingle();
      if (error) throw error;
      const c = (data ?? null) as Record<string, unknown> | null;
      if (!c) return null;
      return {
        name: (c['name'] as string | null) ?? null,
        address: (c['address'] as string | null) ?? null,
        phone: (c['phone'] as string | null) ?? null,
      };
    },
    staleTime: 5 * 60_000,
  });
}

// 발행본(form_submissions, template=opinion_doc, status='published') — 고객의 발행 이력(최신순).
//   데스크 재출력 + 발행 상태 표기. body/발행자/면허/차트번호 = field_data 스냅샷.
export interface PublishedOpinionRow {
  id: string;
  body: string;
  chart_no: string | null;
  issued_by_name: string;
  issued_by_license_no: string | null;
  issued_at: string;
}
function usePublishedOpinions(clinicId: string | null, customerId: string | null, templateId: string | null) {
  return useQuery<PublishedOpinionRow[]>({
    queryKey: ['opinion_published', clinicId, customerId, templateId],
    enabled: !!clinicId && !!customerId && !!templateId,
    queryFn: async () => {
      if (!clinicId || !customerId || !templateId) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('template_id', templateId)
        .eq('status', 'published')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        return {
          id: String(r['id']),
          body: String(fd['final_text'] ?? ''),
          chart_no: (fd['chart_no'] as string | null) ?? null,
          issued_by_name: String(fd['doctor_name'] ?? ''),
          issued_by_license_no: (fd['doctor_license_no'] as string | null) ?? null,
          // 표시·인쇄는 seoulISODate(timestamptz) 경유 → created_at(정규 tz) 사용. field_data.published_at 는 KST 스냅샷 보존.
          issued_at: String(r['created_at'] ?? ''),
        };
      });
    },
    staleTime: 10_000,
  });
}

export interface PublishOpinionInput {
  checkInId: string;                // check_ins.id (RPC 가 clinic/customer 해석)
  customerId: string;               // invalidate 키용
  chartNo: string | null;
  finalText: string;                // 수기 최종본 SSOT(C4)
  selectedOptionKeys: string[];
  sourceOptionName: string | null;
  doctorId: string | null;          // clinic_doctors.id (진료의 provenance)
  doctorName: string;
  doctorLicenseNo: string | null;
}
// 발행 = publish_opinion_doc RPC(form_submissions published insert, append-only). 비가역=published 트리거(C1).
function usePublishOpinion(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PublishOpinionInput) => {
      const { data, error } = await supabase.rpc('publish_opinion_doc', {
        p_check_in_id: input.checkInId,
        p_field_data: {
          final_text: input.finalText,
          selected_option_keys: input.selectedOptionKeys,
          source_option_name: input.sourceOptionName,
          doctor_name: input.doctorName,
          doctor_license_no: input.doctorLicenseNo,
          issued_by_doctor_id: input.doctorId,
          chart_no: input.chartNo,
        },
      });
      if (error) throw error;
      return data as { id: string; published_at: string };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['opinion_published', clinicId, vars.customerId] });
    },
  });
}

// ---------------------------------------------------------------------------
// ③ 발행자(진료의) = 그 내원의 진료 본 의사 일치 게이트 — read-only(NO-DDL).
//   T-20260618-foot-OPINIONDOC-DLG-OVERHAUL AC-0 RC: medical_charts 에 check_in_id 없음 →
//   check_ins(내원) ↔ 진료의 유일 연결키 = customer_id + visit_date(KST). (DoctorPatientList.useSigningDoctorsByDate 패턴)
//   signing_doctor_id = clinic_doctors.id 이므로 발행자 드롭다운(clinic_doctors.id)과 직접 비교 가능.
//   1환자 N차트 = 그날 진료의 합집합(Set). 미서명/레거시 NULL/차트없음 = 빈 Set →
//   ★fallback 정책: 진료의 정보가 전혀 없으면 게이트 미적용(경고 후 허용) — 정상 발행 오차단 방지.
//   정보가 있을 때만(set non-empty) 발행자가 그 Set 에 속해야 발행 가능.
export interface VisitSigningDoctors {
  ids: Set<string>;     // 그 내원 진료의 clinic_doctors.id 집합(non-null)
  names: string[];      // 표기용 진료의명(중복 제거)
}
function useVisitSigningDoctors(clinicId: string | null, customerId: string | null, visitDate: string | null) {
  return useQuery<VisitSigningDoctors>({
    queryKey: ['opinion_visit_signing_doctors', clinicId, customerId, visitDate],
    enabled: !!clinicId && !!customerId && !!visitDate,
    queryFn: async () => {
      const empty: VisitSigningDoctors = { ids: new Set(), names: [] };
      if (!clinicId || !customerId || !visitDate) return empty;
      const { data, error } = await supabase
        .from('medical_charts')
        .select('signing_doctor_id, signing_doctor_name')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('visit_date', visitDate);
      if (error) throw error;
      const ids = new Set<string>();
      const names: string[] = [];
      for (const raw of (data ?? []) as Array<{ signing_doctor_id: string | null; signing_doctor_name: string | null }>) {
        const did = raw.signing_doctor_id;
        if (!did) continue; // 미서명/레거시 NULL → 게이트 제외(빈 Set 처리)
        ids.add(did);
        const nm = (raw.signing_doctor_name ?? '').trim();
        if (nm && !names.includes(nm)) names.push(nm);
      }
      return { ids, names };
    },
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// 소견서 작성 팝업 — F0BAETELCTF 옵션 그리드 + editor.
//   옵션 클릭 → phrase 자동삽입(toggle). editor = textarea(수기수정 SSOT).
// ---------------------------------------------------------------------------
// T-20260617-foot-DOCFORM-POPUP-OVERHAUL Phase 1 (AC-2): 진료대시보드 행 → 소견서 작성 팝업 직접 오픈을 위해 export.
//   발행(publish_opinion_doc)·비가역 트리거(의료법§22)·출력(printOpinionDoc, L-006)은 그대로 — 진입점만 공유.
export function OpinionEditorDialog({
  visitor,
  open,
  onOpenChange,
  clinicId,
  profile,
  clinicHeader,
  // T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK (AC-10): 진료대시보드 서류작성 큐에서
  //   원장이 '작성하기'로 열 때 실장이 고른 항목을 미리 선택(prefill) + 실장 요청 메모를 참고패널로 노출.
  //   ★authoring 경계(AC-4): prefill 은 '출발점'일 뿐, 발행은 원장 publish_opinion_doc RPC 게이트 그대로.
  initialSelectedKeys,
  initialDocType,
  staffRequestMemo,
  requestId,
  onPublished,
}: {
  visitor: VisitorRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clinicId: string | null;
  profile: UserProfile | null;
  clinicHeader: ClinicHeader | null;
  initialSelectedKeys?: string[];
  initialDocType?: 'diagnosis' | 'opinion';
  staffRequestMemo?: string | null;
  requestId?: string | null;
  onPublished?: (publishedId: string) => void;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doctorId, setDoctorId] = useState<string>(''); // clinic_doctors.id ('' = 미선택→profile 명의)
  const [doctorTouched, setDoctorTouched] = useState(false); // 발행자를 사용자가 수동 변경했는지(자동 기본값 덮어쓰기 방지)
  const [chartOpen, setChartOpen] = useState(false);         // ① 헤더 환자명 클릭 → 진료차트 drawer

  // 발행 게이트(C2, DA ruling B): is_doctor_role = director|doctor 만(의료법 §17 진료의 전속).
  //   ⚠ QuickRxBar.isDoctor(director|admin|manager, Rx취소용)와 의도적으로 다름 — 재사용 금지.
  //   DB publish_opinion_doc RPC 가 is_doctor_role() 로 hard-enforce → FE 도 동일해야 admin/manager dead-button 방지.
  const canPublish = ['director', 'doctor'].includes(profile?.role ?? '');

  // AC-6/12: 서류종류 라벨(진단서/소견서) — 큐에서 열리면 실장이 고른 doc_type, 아니면 소견서(기본).
  const docTitle = initialDocType === 'diagnosis' ? '진단서' : '소견서';
  const staffMemo = (staffRequestMemo ?? '').trim();

  // opinion_doc 템플릿(form_templates: templateId + field_map 옵션 그리드) + clinic_doctors + 발행 이력.
  const { data: tpl } = useOpinionTemplate(clinicId);
  const templateId = tpl?.templateId ?? null;
  const dbSections = tpl?.sections ?? [];
  const { data: doctors = [] } = useClinicDoctors(clinicId);
  const { data: published = [], isLoading: pubLoading } = usePublishedOpinions(
    clinicId,
    visitor?.customer_id ?? null,
    templateId,
  );
  const publishMut = usePublishOpinion(clinicId);

  // ③ 그 내원(customer_id + visit_date=내원일 KST)의 진료 본 의사 — 발행자 일치 게이트용(read-only).
  const visitDate = visitor?.checked_in_at ? seoulISODate(visitor.checked_in_at) : null;
  const { data: visitSigning } = useVisitSigningDoctors(clinicId, visitor?.customer_id ?? null, visitDate);
  const signingIds = useMemo(() => visitSigning?.ids ?? new Set<string>(), [visitSigning]);
  const signingNames = visitSigning?.names ?? [];
  const hasSigningInfo = signingIds.size > 0; // 진료의 정보 존재 여부(없으면 fallback=경고 후 허용)
  // 발행자 ↔ 진료의 일치: 정보가 없으면 게이트 미적용(true), 있으면 발행자가 그날 진료의 Set 에 속해야 true.
  const issuerMatchesSigning = !hasSigningInfo || (doctorId !== '' && signingIds.has(doctorId));

  // 발행자 기본값: 그 내원 진료 본 의사가 등록 진료의에 있으면 우선 → is_default → 첫 진료의.
  const defaultDoctorId = useMemo(() => {
    if (doctors.length === 0) return '';
    const signed = doctors.find((d) => signingIds.has(d.id));
    if (signed) return signed.id;
    return (doctors.find((d) => d.is_default) ?? doctors[0]).id;
  }, [doctors, signingIds]);

  // 옵션 그리드 = form_templates(opinion_doc).field_map.sections 우선, 없으면 하드코드 OPINION_SECTIONS(empty-safe).
  const sections: OpinionSection[] = useMemo(
    () => (dbSections.length > 0 ? dbSections : OPINION_SECTIONS),
    [dbSections],
  );

  // 클릭된 옵션 라벨(provenance) — source_option_name 스냅샷용.
  const labelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const o of s.options) m.set(o.key, o.label);
    return m;
  }, [sections]);

  // AC-10 prefill: 옵션 key → 자동삽입 문구 맵(초기 본문 합성용).
  const phraseByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const o of s.options) m.set(o.key, o.phrase);
    return m;
  }, [sections]);

  // 팝업이 새 환자/요청으로 열릴 때마다 editor 초기화(직전 잔상 방지).
  //   AC-10: 큐('작성하기')로 열린 경우 initialSelectedKeys 를 미리 선택 + 해당 문구를 본문에 합성(출발점).
  const visitorId = visitor?.id ?? null;
  const bindKey = `${visitorId ?? ''}|${requestId ?? ''}`;
  const [boundTo, setBoundTo] = useState<string | null>(null);
  if (open && bindKey !== boundTo) {
    setBoundTo(bindKey);
    const keys = (initialSelectedKeys ?? []).filter((k) => phraseByKey.has(k));
    if (keys.length > 0) {
      let t = '';
      for (const k of keys) {
        const phrase = phraseByKey.get(k);
        if (phrase) t = togglePhraseInText(t, phrase);
      }
      setText(t);
      setSelected(new Set(keys));
    } else {
      setText('');
      setSelected(new Set());
    }
    setDoctorId(defaultDoctorId);
    setDoctorTouched(false);
    setChartOpen(false);
  }

  // 진료의 정보가 (비동기로) 도착하면 — 사용자가 아직 발행자를 손대지 않았을 때 한해 기본값을 진료 본 의사로 스냅.
  useEffect(() => {
    if (!open || doctorTouched) return;
    const signed = doctors.find((d) => signingIds.has(d.id));
    if (signed && signed.id !== doctorId) setDoctorId(signed.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doctorTouched, doctors, visitSigning]);

  const handleOptionClick = (opt: OpinionOption) => {
    setText((prev) => togglePhraseInText(prev, opt.phrase));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt.key)) next.delete(opt.key);
      else next.add(opt.key);
      return next;
    });
  };

  const resolveIssuer = () => {
    const doc = doctors.find((d) => d.id === doctorId) ?? null;
    return {
      issuedBy: doc?.id ?? null,
      issuedByName: doc?.name || profile?.name || '원장',
      issuedByLicenseNo: doc?.license_no ?? null,
    };
  };

  const handlePublish = async () => {
    if (!clinicId || !visitor?.customer_id) {
      toast.error('환자 정보를 확인할 수 없어 발행할 수 없습니다.');
      return;
    }
    const body = text.trim();
    if (!body) {
      toast.error('소견 내용을 입력해주세요.');
      return;
    }
    if (
      !window.confirm(
        `${visitor.customer_name} 님의 소견서를 발행하시겠습니까?\n\n발행 후에는 수정·취소할 수 없습니다(의무기록·비가역).\n정정이 필요하면 새 소견서를 발행하세요.`,
      )
    )
      return;

    const issuer = resolveIssuer();
    const selectedKeys = [...selected];
    const sourceOptionName =
      selectedKeys.map((k) => labelByKey.get(k)).filter(Boolean).join(', ') || null;

    try {
      const result = await publishMut.mutateAsync({
        checkInId: visitor.id,
        customerId: visitor.customer_id,
        chartNo: visitor.chart_number,
        finalText: body,
        selectedOptionKeys: selectedKeys,
        sourceOptionName,
        doctorId: issuer.issuedBy,
        doctorName: issuer.issuedByName,
        doctorLicenseNo: issuer.issuedByLicenseNo,
      });
      toast.success(`${docTitle}가 발행되었습니다.`);
      setText('');
      setSelected(new Set());
      // AC-3/10: 큐('작성하기')에서 열린 발행이면 해당 요청을 처리완료로 닫도록 콜백 통지.
      if (onPublished && result?.id) onPublished(String(result.id));
    } catch (e) {
      toast.error(`발행 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    }
  };

  const handlePrint = (row: PublishedOpinionRow) => {
    const ok = printOpinionDoc({
      body: row.body,
      chartNo: row.chart_no ?? visitor?.chart_number ?? null,
      patientName: visitor?.customer_name ?? null,
      issuedByName: row.issued_by_name,
      issuedByLicenseNo: row.issued_by_license_no,
      issueDate: row.issued_at ? seoulISODate(row.issued_at) : null,
      clinicName: clinicHeader?.name ?? null,
      clinicAddress: clinicHeader?.address ?? null,
      clinicPhone: clinicHeader?.phone ?? null,
    });
    if (!ok) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
  };

  // 발행 이력 테이블(우측 단 + 직원뷰 공용) — 각 행 [저장(PDF)] [인쇄] 모두 printOpinionDoc(브라우저 인쇄대화상자=PDF저장/인쇄) 경로.
  const historyPanel = (
    <div className="flex min-h-0 flex-col rounded-md border bg-muted/20" data-testid="opinion-published">
      <p className="border-b px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">발행 이력 / 서류 출력</p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {pubLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : published.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground/70" data-testid="opinion-published-empty">
            아직 발행된 소견서가 없습니다.
          </p>
        ) : (
          <table className="w-full text-[11px]" data-testid="opinion-published-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">발행일시</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">발행자</th>
                <th className="px-1.5 py-1 font-medium">내용</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-right">출력</th>
              </tr>
            </thead>
            <tbody>
              {published.map((row) => (
                <tr key={row.id} className="border-b last:border-0 align-top" data-testid="opinion-published-row">
                  <td className="px-1.5 py-1 font-mono text-muted-foreground whitespace-nowrap">{seoulISODate(row.issued_at)}</td>
                  <td className="px-1.5 py-1 text-muted-foreground/90 whitespace-nowrap">{row.issued_by_name}</td>
                  <td className="px-1.5 py-1 text-foreground/80">
                    <span className="block max-w-[14rem] truncate" title={row.body}>{row.body.replace(/\n+/g, ' ')}</span>
                  </td>
                  <td className="px-1.5 py-1 whitespace-nowrap text-right">
                    <span className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 gap-1 px-2 text-[10px]"
                        onClick={() => handlePrint(row)}
                        data-testid="opinion-save-pdf-btn"
                        title="브라우저 인쇄 대화상자에서 'PDF로 저장'을 선택하세요."
                      >
                        <FileDown className="h-3 w-3" /> 저장(PDF)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 gap-1 px-2 text-[10px]"
                        onClick={() => handlePrint(row)}
                        data-testid="opinion-print-btn"
                      >
                        <Printer className="h-3 w-3" /> 인쇄
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={canPublish ? 'max-w-5xl' : 'max-w-2xl'} data-testid="opinion-dialog">
        {/* ① 헤더 1줄: 왼쪽 서류명(크고 볼드) · 오른쪽 환자이름(클릭→진료차트 drawer)·생년(만나이)·차트번호. ×는 Dialog 기본(우측). */}
        <DialogTitle className="flex items-center justify-between gap-3 pr-7">
          <span className="flex shrink-0 items-center gap-2">
            <FileText className="h-5 w-5 text-teal-600" />
            <span className="text-lg font-bold text-foreground" data-testid="opinion-doc-title">{docTitle}</span>
          </span>
          {visitor && (
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-muted-foreground" data-testid="opinion-header-patient">
              <button
                type="button"
                onClick={() => visitor.customer_id && setChartOpen(true)}
                disabled={!visitor.customer_id}
                className="max-w-[10rem] truncate font-semibold text-teal-700 underline-offset-2 hover:underline focus:underline focus:outline-none disabled:no-underline disabled:text-muted-foreground"
                title={visitor.customer_id ? `${visitor.customer_name} — 클릭 시 진료차트 열기` : visitor.customer_name}
                data-testid="opinion-header-name"
              >
                {visitor.customer_name}
              </button>
              {birthYearAgeDisplay(visitor.birth_date) && (
                <span className="whitespace-nowrap tabular-nums">· {birthYearAgeDisplay(visitor.birth_date)}</span>
              )}
              {visitor.chart_number && (
                <span className="whitespace-nowrap font-mono">· {chartNoDisplay(visitor.chart_number)}</span>
              )}
            </span>
          )}
        </DialogTitle>

        {canPublish ? (
          /* ④ 3단 레이아웃: 옵션그리드 | editor+발행자+발행 | 발행이력/출력(우측 단) */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* 1단: 옵션 그리드 (F0BAETELCTF) */}
            <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1" data-testid="opinion-options">
              {sections.map((section) => (
                <div key={section.title}>
                  <p className="mb-1.5 text-center text-xs font-semibold text-muted-foreground">{section.title}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {section.options.map((opt) => {
                      const active = selected.has(opt.key);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => handleOptionClick(opt)}
                          aria-pressed={active}
                          title={opt.phrase}
                          data-testid={`opinion-opt-${opt.key}`}
                          className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                            active
                              ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
                              : 'border-input bg-background text-foreground hover:bg-accent'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 2단: editor(수기수정) + 발행자 + 발행하기 */}
            <div className="flex flex-col gap-2">
              {/* AC-3/10 참고 패널: 실장(데스크)이 보낸 요청 메모 — '참고용'만(authoring 경계 AC-4). */}
              {staffMemo && (
                <div className="rounded-md border border-teal-200 bg-teal-50/60 px-2 py-1.5 text-[11px] text-teal-800" data-testid="opinion-staff-request-memo">
                  <span className="font-semibold">실장 요청(참고)</span> · {staffMemo}
                </div>
              )}
              {/* ② 안내문구 제거 — 라벨만 유지 */}
              <label className="text-xs font-medium text-muted-foreground" htmlFor="opinion-editor-text">
                소견 내용
              </label>
              <Textarea
                id="opinion-editor-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="좌측 옵션을 눌러 문구를 삽입하거나 직접 입력하세요."
                className="min-h-[36vh] flex-1 text-sm leading-relaxed"
                data-testid="opinion-editor"
              />

              {/* ③ 발행자(진료의) 선택 + 진료 본 의사 일치 게이트 */}
              {doctors.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="whitespace-nowrap text-xs font-medium text-muted-foreground" htmlFor="opinion-doctor">
                    발행자(진료의)
                  </label>
                  <select
                    id="opinion-doctor"
                    value={doctorId}
                    onChange={(e) => { setDoctorId(e.target.value); setDoctorTouched(true); }}
                    className={`h-8 flex-1 rounded-md border bg-background px-2 text-xs ${
                      hasSigningInfo && !issuerMatchesSigning ? 'border-red-400' : 'border-input'
                    }`}
                    data-testid="opinion-doctor-select"
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.license_no ? ` (면허 ${d.license_no})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* ③ 불일치 사유 안내 */}
              {hasSigningInfo && !issuerMatchesSigning && (
                <p className="rounded-md border border-red-200 bg-red-50/60 px-2 py-1 text-[11px] text-red-600" data-testid="opinion-doctor-mismatch">
                  진료 본 의사({signingNames.join(', ') || '확인 필요'})와 발행자가 일치해야 발행할 수 있습니다.
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/70">
                  ※ 발행 후에는 수정·취소할 수 없습니다(의무기록·비가역).
                </span>
                <Button
                  size="sm"
                  className="h-8 gap-1 bg-neutral-800 px-3 text-xs text-white hover:bg-neutral-900 disabled:opacity-40"
                  disabled={!canPublish || publishMut.isPending || !text.trim() || (hasSigningInfo && !issuerMatchesSigning)}
                  onClick={handlePublish}
                  title={
                    hasSigningInfo && !issuerMatchesSigning
                      ? '진료 본 의사와 발행자가 일치해야 발행할 수 있습니다.'
                      : '소견서를 발행합니다(비가역).'
                  }
                  data-testid="opinion-publish-btn"
                >
                  {publishMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  {publishMut.isPending ? '발행 중…' : '발행하기'}
                </Button>
              </div>
            </div>

            {/* 3단: 발행 이력 / 서류 출력 (독립 우측 단) */}
            <div className="flex min-h-0 max-h-[62vh] flex-col">{historyPanel}</div>
          </div>
        ) : (
          /* ⑥ 직원(비의사) 출력전용 뷰 — editor/발행자/발행하기 숨김, 발행이력에서 저장(PDF)·인쇄만. */
          <div className="space-y-2" data-testid="opinion-staff-view">
            <p className="rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[11px] text-amber-700">
              ※ 소견서 발행은 원장(의료진) 권한입니다. 직원은 발행된 서류의 저장(PDF)·인쇄만 가능합니다.
            </p>
            <div className="flex max-h-[60vh] flex-col">{historyPanel}</div>
          </div>
        )}
      </DialogContent>

      {/* ① 진료차트 drawer — MedicalChartPanel(자체 portal drawer, read-only 진입). 소견서 팝업과 중첩 충돌 없음. */}
      <MedicalChartPanel
        open={chartOpen}
        onOpenChange={setChartOpen}
        customerId={visitor?.customer_id ?? null}
        clinicId={clinicId ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
        variant="full"
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// OpinionDocTab — Main (금일 내방객 명단 + 소견서 작성 진입)
// ---------------------------------------------------------------------------
export default function OpinionDocTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [query, setQuery] = useState('');
  const [activeVisitor, setActiveVisitor] = useState<VisitorRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rows = [], isLoading, isError, error } = useTodayVisitors(clinicId);
  const { data: clinicHeader = null } = useClinicHeader(clinicId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.chart_number ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const openOpinion = (v: VisitorRow) => {
    setActiveVisitor(v);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            소견서 — 금일 내방객
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            오늘 내원한 고객 명단입니다. 고객을 누르면 소견서 작성 창이 열립니다.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="환자이름 · 차트번호 검색"
            className="h-9 pl-8 text-sm"
            data-testid="opinion-search"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query.trim() ? '검색 결과가 없습니다.' : '오늘 내원한 고객이 없습니다.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="opinion-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">이름</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">차트</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">생년(만나이)</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">구분</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">소견서</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition hover:bg-accent/30"
                  data-testid="opinion-row"
                >
                  <td className="px-1.5 py-1 whitespace-nowrap max-w-[8rem]" data-testid="opinion-cell-name">
                    <button
                      type="button"
                      onClick={() => openOpinion(r)}
                      className="block max-w-full truncate text-left font-semibold text-teal-700 underline-offset-2 hover:underline focus:underline focus:outline-none"
                      title={`${r.customer_name} — 클릭 시 소견서 작성`}
                      data-testid="opinion-open"
                    >
                      {r.customer_name}
                    </button>
                  </td>
                  <td className="px-1.5 py-1 font-mono text-foreground/90 whitespace-nowrap" data-testid="opinion-cell-chart">
                    {r.chart_number ? chartNoDisplay(r.chart_number) : '—'}
                  </td>
                  <td className="px-1.5 py-1 tabular-nums text-foreground/90 whitespace-nowrap" data-testid="opinion-cell-birth">
                    {birthYearAgeDisplay(r.birth_date) || '—'}
                  </td>
                  <td className="px-1.5 py-1 text-muted-foreground whitespace-nowrap" data-testid="opinion-cell-visittype">
                    {r.visit_type || '—'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap" data-testid="opinion-cell-action">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => openOpinion(r)}
                      data-testid="opinion-write-btn"
                    >
                      <FileText className="h-3 w-3" /> 작성
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        ※ 금일(오늘) 내원 고객 명단입니다. 고객 이름 또는 작성 버튼을 누르면 소견서 작성 창이 열립니다. 옵션 버튼을 누르면 문구가 자동으로 삽입되며(다시 누르면 해제), 원장님이 내용을 자유롭게 수정할 수 있습니다. 내용을 확인한 뒤 [발행하기]를 누르면 소견서가 발행되며(발행 후 수정·취소 불가), 발행 이력에서 [저장(PDF)]·[인쇄]로 서류를 출력할 수 있습니다.
      </p>

      <OpinionEditorDialog
        visitor={activeVisitor}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clinicId={clinicId}
        profile={profile}
        clinicHeader={clinicHeader}
      />
    </div>
  );
}
