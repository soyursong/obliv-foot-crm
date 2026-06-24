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
// T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (item2): 금기증 복수선택 조합 + 플레이스홀더 치환 합성 계층.
import { buildContraindTemplates } from '@/lib/contraindicationCombine';
import type { HepatitisType } from '@/lib/contraindicationCombine';
import {
  composeOpinionDoc,
  buildContraindKeySet,
  classifySelection,
  needsHepatitisType,
  needsOralXReason,
  needsDate,
  ORAL_X_DEFAULT_REASON,
} from '@/lib/opinionDocCompose';
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
  // T-20260623-foot-OPINIONPHRASE-REVISION-NOTE-COLUMN (문지은 대표원장):
  //   reporter 가 수기로 남기는 '수정기록' 메모(무엇을/언제/왜 고쳤는지). 상용구 관리 화면 전용 메타.
  //   ★소견서 작성 화면(phrase 실소비처)에는 노출/삽입되지 않음 — 버튼 클릭 삽입은 phrase 만.
  //   ★ADDITIVE jsonb 키 — 기존 option(필드 없음)은 undefined → 빈값 안전 렌더(backward-compat).
  //   ⚠ field_map.phrase_meta[key].last_updated_at(자동 타임스탬프)와 별개 — 이건 수기 메모.
  revisionNote?: string;
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
// T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ (AC-1) — 소견서 옵션 ← 발건강 질문지 자동 pre-check 매핑.
//   환자가 모바일/키오스크로 미리 작성한 health_q_results.form_data 의 medical_history(string[])·medications(string[])
//   를 읽어 아래 매핑대로 소견서 체크박스를 미리 체크(QR입력 뱃지). 의사가 수동 해제 가능, 최종 확정은 의사(발행 게이트).
//   ★ 값(라벨)은 HealthQMobilePage.tsx 의 MEDICAL_HISTORY_OPTIONS / MEDICATION_OPTIONS 와 정확히 일치해야 함 —
//      질문지 라벨 변경 시 여기도 동기화 필수.
//   pregnant/preparing_pregnancy: 질문지는 '임신중 또는 임신준비중' 단일 옵션 → §확인-1 A안(둘 다 pre-check).
//   hbv_carrier: AC-2 로 질문지에 '간염보균자' 추가 → 활성.
// ---------------------------------------------------------------------------
export const HEALTHQ_AUTOCHECK_MAP: Record<string, { medical_history?: string[]; medications?: string[] }> = {
  diabetes:            { medical_history: ['당뇨'] },
  liver_disease:       { medical_history: ['간질환'] },
  hyperlipidemia:      { medical_history: ['고지혈증'], medications: ['콜레스테롤약'] },
  immune_disease:      { medical_history: ['자가면역질환'] },
  thyroid_med:         { medical_history: ['갑상선질환'] },
  gi_disorder:         { medical_history: ['위장장애·역류성식도염'] },
  pregnant:            { medical_history: ['임신중 또는 임신준비중'] },
  preparing_pregnancy: { medical_history: ['임신중 또는 임신준비중'] },
  psychiatric_med:     { medications: ['정신과약'] },
  bp_med:              { medications: ['혈압약'] },
  cardio_med:          { medications: ['협심증약'] },
  on_chemo:            { medications: ['항암제'] },
  hbv_carrier:         { medical_history: ['간염보균자'] },
};

// form_data(health_q_results) → 자동 체크 대상 소견서 옵션 key 목록. 질문지 없음/매칭 0 → 빈 배열(수동 모드).
export function computeAutoCheckedKeys(formData: Record<string, unknown> | null | undefined): string[] {
  if (!formData) return [];
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)) : [];
  const mh = toStrArr(formData['medical_history']);
  const meds = toStrArr(formData['medications']);
  const keys: string[] = [];
  for (const [key, rule] of Object.entries(HEALTHQ_AUTOCHECK_MAP)) {
    const hitMH = (rule.medical_history ?? []).some((v) => mh.includes(v));
    const hitMed = (rule.medications ?? []).some((v) => meds.includes(v));
    if (hitMH || hitMed) keys.push(key);
  }
  return keys;
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
        const parsed: OpinionOption = { key: opt['key'] as string, label: opt['label'] as string, phrase: opt['phrase'] as string };
        // T-20260623 REVISION-NOTE-COLUMN: ADDITIVE '수정기록' 보존(read→write round-trip 유실 방지).
        if (typeof opt['revisionNote'] === 'string') parsed.revisionNote = opt['revisionNote'] as string;
        options.push(parsed);
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
  /** 서류종류 — 발행 시점 field_data.doc_type. 미존재(legacy 발행본)는 '소견서'(opinion)로 폴백. */
  doc_type: 'opinion' | 'diagnosis';
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
          doc_type: fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion',
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
  // T-20260620-foot-MEDDOC-DESK-PRINTONLY: 서류종류(소견서/진단서) 스냅샷 — 데스크 서류출력 게이트 식별키.
  docType: 'opinion' | 'diagnosis';
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
          // T-20260620-foot-MEDDOC-DESK-PRINTONLY: 서류종류 스냅샷(JSONB ADDITIVE, NO-DDL).
          //   데스크 서류출력(소견서/진단서)이 이 발행본으로 출력 버튼 활성화 게이트를 식별.
          doc_type: input.docType,
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
// T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ (AC-1) — 그 환자의 최신 발건강 질문지(form_data) read-only 조회.
//   submitted_at 최신 1건. 없으면 null(자동화 스킵=수동 모드). HealthQResultsPanel.loadResults 조회 컨벤션 재사용.
// ---------------------------------------------------------------------------
function useLatestHealthQ(clinicId: string | null, customerId: string | null) {
  return useQuery<Record<string, unknown> | null>({
    queryKey: ['opinion_latest_healthq', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return null;
      const { data, error } = await supabase
        .from('health_q_results')
        .select('form_data, submitted_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as { form_data?: Record<string, unknown> } | null;
      return row?.form_data ?? null;
    },
    staleTime: 30_000,
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
  // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (B-1): 실장이 2번차트 서류요청에서 고른 날짜(YYYY-MM-DD).
  //   없으면 오늘(KST) 기본값. `[날짜]` 치환 + 작성창 날짜 입력칸 초기값.
  initialDate,
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
  initialDate?: string | null;
  onPublished?: (publishedId: string) => void;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (item2): 조합 합성 controlled state.
  //   editor 본문은 선택/플레이스홀더에서 자동 합성하되, 원장이 직접 수정하면(textTouched) 자동합성 중단(AC-4 SSOT).
  const [textTouched, setTextTouched] = useState(false);
  const [hepatitisType, setHepatitisType] = useState<HepatitisType | null>(null); // 간염 B/C 드롭다운(미선택=null)
  const [oralXReason, setOralXReason] = useState('');   // 경구약X 사유(괄호 치환, 빈값=원문 보존)
  const [docDate, setDocDate] = useState<string>('');   // 서류 날짜 YYYY-MM-DD ([날짜] 치환)
  // AC-1: 발건강 질문지에서 자동 pre-check 된 키(QR입력 뱃지 표기용). 의사가 토글하면 해당 키 제거(의사확인).
  const [autoChecked, setAutoChecked] = useState<Set<string>>(new Set());
  const [healthQAppliedFor, setHealthQAppliedFor] = useState<string | null>(null); // 자동체크 적용한 bindKey(오픈당 1회)
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

  // AC-1: 그 환자의 최신 발건강 질문지(read-only) — 자동 pre-check 소스.
  const { data: healthQData, isLoading: hqLoading } = useLatestHealthQ(clinicId, visitor?.customer_id ?? null);
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

  // ── item2 조합 합성 ──────────────────────────────────────────────────────────
  // 금기증 그룹 key 집합(복수선택·조합 대상). 그 외(진단서 표준)는 단일배타.
  const contraindKeySet = useMemo(() => buildContraindKeySet(sections), [sections]);
  // 검출용 원문 맵(치환 前 raw) — `B(C)`·경구약X 괄호·`[날짜]` 마커 유무 판정.
  const detectTemplates = useMemo(() => buildContraindTemplates(sections), [sections]);
  const selectedKeysArr = useMemo(() => [...selected], [selected]);
  // 선택 그룹 분리(진단서 단일 / 금기증 복수) — 버튼 배타 disable 판정.
  const { diagnosisKeys: selDiagnosis, contraindKeys: selContraind } = useMemo(
    () => classifySelection(selectedKeysArr, contraindKeySet),
    [selectedKeysArr, contraindKeySet],
  );
  const hasDiagnosis = selDiagnosis.length > 0;
  const hasContraind = selContraind.length > 0;
  // 플레이스홀더 부가 UI 노출 여부 — 선택된 원문에 실제 마커가 있을 때만(data-driven).
  const showHepatitis = useMemo(() => needsHepatitisType(selectedKeysArr, detectTemplates), [selectedKeysArr, detectTemplates]);
  const showOralXReason = useMemo(() => needsOralXReason(selectedKeysArr, detectTemplates), [selectedKeysArr, detectTemplates]);
  const showDate = useMemo(() => needsDate(selectedKeysArr, detectTemplates), [selectedKeysArr, detectTemplates]);
  // 합성 본문(MD §B 치환순서 + §3 조합). editor SSOT 의 출발점.
  const composedText = useMemo(
    () => composeOpinionDoc({
      sections,
      selectedKeys: selectedKeysArr,
      hepatitisType,
      oralXReason,
      dateISO: docDate,
    }),
    [sections, selectedKeysArr, hepatitisType, oralXReason, docDate],
  );

  // 팝업이 새 환자/요청으로 열릴 때마다 editor 초기화(직전 잔상 방지).
  //   AC-10: 큐('작성하기')로 열린 경우 initialSelectedKeys 를 미리 선택 + 해당 문구를 본문에 합성(출발점).
  const visitorId = visitor?.id ?? null;
  const bindKey = `${visitorId ?? ''}|${requestId ?? ''}`;
  const [boundTo, setBoundTo] = useState<string | null>(null);
  if (open && bindKey !== boundTo) {
    setBoundTo(bindKey);
    // AC-10: 큐('작성하기')로 열린 경우 실장이 고른 항목을 미리 선택. 본문은 compose effect 가 합성(item2).
    const keys = (initialSelectedKeys ?? []).filter((k) => phraseByKey.has(k));
    setSelected(new Set(keys));
    // 플레이스홀더 입력 초기화 — 날짜는 실장 요청날짜(initialDate) 또는 오늘(KST) 기본값(B-1 LOCK).
    setHepatitisType(null);
    setOralXReason('');
    setDocDate(initialDate || todaySeoulISODate());
    setTextTouched(false); // 새 바인딩 → 자동합성 허용(직전 잔상 방지)
    setAutoChecked(new Set()); // AC-1: 새 환자/요청 바인딩 시 자동체크 뱃지 초기화(자동체크는 아래 effect 가 적용)
    setDoctorId(defaultDoctorId);
    setDoctorTouched(false);
    setChartOpen(false);
  }

  // item2: 선택/플레이스홀더 변화 → 본문 자동 합성. 원장이 직접 수정(textTouched)하면 덮어쓰지 않음(AC-4 SSOT).
  useEffect(() => {
    if (!open) return;
    if (textTouched) return;
    setText(composedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, composedText, textTouched]);

  // 진료의 정보가 (비동기로) 도착하면 — 사용자가 아직 발행자를 손대지 않았을 때 한해 기본값을 진료 본 의사로 스냅.
  useEffect(() => {
    if (!open || doctorTouched) return;
    const signed = doctors.find((d) => signingIds.has(d.id));
    if (signed && signed.id !== doctorId) setDoctorId(signed.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doctorTouched, doctors, visitSigning]);

  // AC-1: 발건강 질문지 자동 pre-check — 질문지 로드 완료 후 오픈당 1회 적용.
  //   매핑된 옵션 중 아직 선택되지 않은 것을 추가 선택 + 문구 삽입 + QR입력 뱃지(autoChecked) 표기.
  //   질문지 없음/매칭 0 → 스킵(수동 모드 그대로, 에러 없음 = AC-1.4). 큐 prefill 과는 상보(이미 선택된 키는 무변경).
  //   바인딩 블록(위)이 text/selected 를 먼저 리셋한 뒤 이 effect 가 적용 → 직전 잔상 없음.
  useEffect(() => {
    if (!open || hqLoading) return;
    if (healthQAppliedFor === bindKey) return; // 이번 오픈에 이미 적용
    const autoKeys = computeAutoCheckedKeys(healthQData ?? null).filter((k) => phraseByKey.has(k));
    setHealthQAppliedFor(bindKey);
    if (autoKeys.length === 0) return; // 질문지 없음/매칭 0 → 수동 모드
    // item2: 자동체크는 선택 set 에만 반영 — 본문은 compose effect 가 합성(직접 토글 합성 제거).
    //   ★ 진단서가 이미 선택된(단일배타) 상태면 금기증 자동추가가 모드를 깨므로 스킵(배타 보존).
    const newKeys = autoKeys.filter((k) => !selected.has(k) && contraindKeySet.has(k));
    const blockedByDiagnosis = [...selected].some((k) => !contraindKeySet.has(k));
    if (newKeys.length > 0 && !blockedByDiagnosis) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of newKeys) next.add(k);
        return next;
      });
    }
    setAutoChecked(new Set(autoKeys)); // 이미 선택돼 있던 키도 QR입력 뱃지 표기
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bindKey, hqLoading, healthQData, phraseByKey, healthQAppliedFor]);

  // item2 P1-1: 진단서(표준)=단일배타 / 금기증=복수선택.
  //   - 금기증 클릭 → 토글(복수).
  //   - 진단서 클릭 → 이미 선택이면 해제, 아니면 그 1개만(다른 선택 전부 해제 = 단일배타).
  //   선택이 바뀌면 textTouched 해제 → 본문 재합성(조합 출력 = 선택 반영).
  const handleOptionClick = (opt: OpinionOption) => {
    const isContraind = contraindKeySet.has(opt.key);
    setSelected((prev) => {
      const next = new Set(prev);
      if (isContraind) {
        if (next.has(opt.key)) next.delete(opt.key);
        else next.add(opt.key);
      } else {
        if (next.has(opt.key)) {
          next.delete(opt.key);
        } else {
          next.clear();
          next.add(opt.key);
        }
      }
      return next;
    });
    setTextTouched(false); // 선택 변경 → 자동 재합성
    // AC-1.3: 의사가 수동 변경한 항목은 QR입력 뱃지 제거(=의사확인). 자동체크 흔적 제거.
    setAutoChecked((prev) => {
      if (!prev.has(opt.key)) return prev;
      const next = new Set(prev);
      next.delete(opt.key);
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
        docType: initialDocType === 'diagnosis' ? 'diagnosis' : 'opinion',
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
      formKey: row.doc_type === 'diagnosis' ? 'diagnosis' : 'diag_opinion',
    });
    if (!ok) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
  };

  // 발행 이력 테이블(우측 단 + 직원뷰 공용) — 각 행 [저장(PDF)] [인쇄] 모두 printOpinionDoc(브라우저 인쇄대화상자=PDF저장/인쇄) 경로.
  const historyPanel = (
    <div className="flex min-h-0 flex-col rounded-md border bg-muted/20" data-testid="opinion-published">
      <p className="border-b px-2 py-1.5 text-base font-bold text-foreground">발행 이력 / 서류 출력</p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {pubLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : published.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground" data-testid="opinion-published-empty">
            아직 발행된 소견서가 없습니다.
          </p>
        ) : (
          <table className="w-full text-xs" data-testid="opinion-published-table">
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
                        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                        onClick={() => handlePrint(row)}
                        data-testid="opinion-save-pdf-btn"
                        title="브라우저 인쇄 대화상자에서 'PDF로 저장'을 선택하세요."
                      >
                        <FileDown className="h-3 w-3" /> 저장(PDF)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
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
                      const isContraindOpt = contraindKeySet.has(opt.key);
                      // item2 P1-1 단일배타: 진단서 선택 시 그 1개 외 전부 비활성 / 금기증 선택 시 진단서 비활성.
                      const disabled = hasDiagnosis
                        ? !active
                        : hasContraind
                          ? !isContraindOpt
                          : false;
                      // AC-1.2: 자동 pre-check(아직 의사 미확인) = amber 강조 + QR입력 뱃지로 시각 구분.
                      const fromQR = active && autoChecked.has(opt.key);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => handleOptionClick(opt)}
                          disabled={disabled}
                          aria-pressed={active}
                          title={
                            disabled
                              ? hasDiagnosis
                                ? '진단서(표준)는 단일선택입니다. 선택을 해제한 뒤 다른 항목을 고르세요.'
                                : '금기증을 선택 중입니다. 진단서(표준)는 함께 선택할 수 없습니다.'
                              : fromQR
                                ? `${opt.phrase}\n\n(발건강 질문지에서 자동 체크됨 — 확인 후 확정/해제)`
                                : opt.phrase
                          }
                          data-testid={`opinion-opt-${opt.key}`}
                          data-autocheck={fromQR ? 'qr' : undefined}
                          className={`relative rounded-md border px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            fromQR
                              ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-sm'
                              : active
                                ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
                                : 'border-input bg-background text-foreground hover:bg-accent'
                          }`}
                        >
                          {opt.label}
                          {fromQR && (
                            <span
                              className="ml-1 inline-block rounded bg-amber-200 px-1 py-px text-[9px] font-semibold leading-none text-amber-900 align-middle"
                              data-testid={`opinion-qr-badge-${opt.key}`}
                            >
                              QR입력
                            </span>
                          )}
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
                <div className="rounded-md border border-teal-200 bg-teal-50/60 px-2 py-1.5 text-sm text-teal-900" data-testid="opinion-staff-request-memo">
                  <span className="font-bold">실장 요청(참고)</span> · {staffMemo}
                </div>
              )}
              {/* AC-1.2: 자동 pre-check 안내 — 발건강 질문지에서 미리 채운 항목(QR입력) 확인 유도. */}
              {autoChecked.size > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-sm text-amber-900" data-testid="opinion-autocheck-hint">
                  <span className="font-bold">QR입력</span> 표시 항목은 환자 발건강 질문지에서 자동으로 미리 체크되었습니다. 내용을 확인하신 뒤 확정하거나, 클릭해 해제하세요. (최종 확정은 발행 시점)
                </div>
              )}
              {/* item2 플레이스홀더 변형 셀렉터 — 선택한 항목 원문에 마커가 있을 때만 노출(금기증/진단서 선택 종속). */}
              {(showDate || showHepatitis || showOralXReason) && (
                <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/70 px-2 py-2" data-testid="opinion-placeholder-controls">
                  {/* B-1 날짜: [날짜] → YYYY년 MM월 DD일. 기본값=실장 요청날짜/오늘. */}
                  {showDate && (
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-sm font-semibold text-foreground" htmlFor="opinion-doc-date">서류 날짜</label>
                      <input
                        id="opinion-doc-date"
                        type="date"
                        value={docDate}
                        onChange={(e) => { setDocDate(e.target.value); setTextTouched(false); }}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                        data-testid="opinion-date-input"
                      />
                    </div>
                  )}
                  {/* §C 간염 B/C 드롭다운: B(C) → B형/C형 전체치환. */}
                  {showHepatitis && (
                    <div className="flex items-center gap-2">
                      <label className="w-20 shrink-0 text-sm font-semibold text-foreground" htmlFor="opinion-hepatitis">간염 타입</label>
                      <select
                        id="opinion-hepatitis"
                        value={hepatitisType ?? ''}
                        onChange={(e) => { setHepatitisType((e.target.value || null) as HepatitisType | null); setTextTouched(false); }}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                        data-testid="opinion-hepatitis-select"
                      >
                        <option value="">간염 타입 선택</option>
                        <option value="B">B형 간염</option>
                        <option value="C">C형 간염</option>
                      </select>
                    </div>
                  )}
                  {/* §B-2 경구약X 사유: 괄호 안 사유 입력 → 본문 치환(대괄호 제거). */}
                  {showOralXReason && (
                    <div className="space-y-1">
                      <label className="block text-sm font-semibold text-foreground" htmlFor="opinion-oralx-reason">경구약 복용 사유</label>
                      <input
                        id="opinion-oralx-reason"
                        type="text"
                        value={oralXReason}
                        onChange={(e) => { setOralXReason(e.target.value); setTextTouched(false); }}
                        placeholder={ORAL_X_DEFAULT_REASON}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        data-testid="opinion-oralx-reason-input"
                      />
                      <p className="text-sm text-blue-600" data-testid="opinion-oralx-preview">
                        {(oralXReason.trim() || ORAL_X_DEFAULT_REASON)}으로 항진균제 복용이 불가하여…
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* ② 라벨 + 자동합성/수기수정 안내 */}
              <div className="flex items-center justify-between gap-2">
                <label className="text-base font-bold text-foreground" htmlFor="opinion-editor-text">
                  소견 내용
                </label>
                {textTouched && (
                  <button
                    type="button"
                    onClick={() => { setTextTouched(false); setText(composedText); }}
                    className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
                    data-testid="opinion-regenerate-btn"
                    title="선택한 항목 기준으로 본문을 다시 자동 합성합니다(수기 수정 내용은 사라집니다)."
                  >
                    문구 재생성
                  </button>
                )}
              </div>
              <Textarea
                id="opinion-editor-text"
                value={text}
                onChange={(e) => { setText(e.target.value); setTextTouched(true); }}
                placeholder="좌측 옵션을 눌러 문구를 삽입하거나 직접 입력하세요."
                className="min-h-[36vh] flex-1 text-sm leading-relaxed"
                data-testid="opinion-editor"
              />

              {/* ③ 발행자(진료의) 선택 + 진료 본 의사 일치 게이트 */}
              {doctors.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="whitespace-nowrap text-sm font-semibold text-foreground" htmlFor="opinion-doctor">
                    발행자(진료의)
                  </label>
                  <select
                    id="opinion-doctor"
                    value={doctorId}
                    onChange={(e) => { setDoctorId(e.target.value); setDoctorTouched(true); }}
                    className={`h-8 flex-1 rounded-md border bg-background px-2 text-sm ${
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
                <p className="rounded-md border border-red-200 bg-red-50/60 px-2 py-1 text-sm text-red-700" data-testid="opinion-doctor-mismatch">
                  진료 본 의사({signingNames.join(', ') || '확인 필요'})와 발행자가 일치해야 발행할 수 있습니다.
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
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
            <p className="rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-sm text-amber-800">
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
