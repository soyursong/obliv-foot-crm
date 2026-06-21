// medDocPrintGate — 의료판단 서류(소견서·진단서)의 '데스크 출력만(원장 작성 기반)' 게이트.
// Ticket: T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED (B안 확정)
//
// 요구(김주연 총괄, #foot):
//   "소견서/진단서는 원장님께서 작성해주신 내용 기반으로 데스크에서 출력만 가능해야 함"
//   - 작성(authoring) = 원장 전용(소견서 전용 탭 → publish_opinion_doc RPC, is_doctor_role 게이트).
//   - 데스크(출력) = 원장이 발행(published opinion_doc)한 내용만 출력. 본문 직접입력/편집 불가.
//   - v2 B안: 원장 미작성 = 데스크 출력 버튼 비활성(disabled). 작성 완료 = 활성 → 발행본 출력.
//
// 적용 대상 = 데스크 서류출력 목록 중 4.소견서(diag_opinion) / 5.진단서(diagnosis) 2종만.
//   나머지 8종은 무게이트(기존 동작 유지).
//
// === NO-DDL 재사용 ===
//   '작성 완료' 신호원 = form_submissions(template=opinion_doc, status='published').
//   서류종류 식별 = field_data.doc_type('opinion'|'diagnosis'). 미존재(legacy) = 'opinion' 폴백.
//   신규 컬럼/테이블/enum/RLS = 0. 출력은 printOpinionDoc(L-006 bindHtmlTemplate 단일 경로) 재사용.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { seoulISODate } from '@/lib/format';
import { printOpinionDoc, type OpinionPrintFormKey } from '@/lib/printOpinionDoc';
import type { ClinicHeader } from '@/components/doctor/OpinionDocTab';

/** 게이트 적용 대상 form_key — 소견서 / 진단서. */
export const GATED_MEDDOC_FORM_KEYS: ReadonlyArray<string> = ['diag_opinion', 'diagnosis'];

export type MedDocType = 'opinion' | 'diagnosis';

/** 게이트 대상 여부. */
export function isGatedMedDoc(formKey: string): boolean {
  return GATED_MEDDOC_FORM_KEYS.includes(formKey);
}

/** form_key → 서류종류. diag_opinion=소견서(opinion), diagnosis=진단서(diagnosis). */
export function medDocFormKeyToDocType(formKey: string): MedDocType {
  return formKey === 'diagnosis' ? 'diagnosis' : 'opinion';
}

/** form_key → 출력 양식 키(printOpinionDoc). */
function medDocFormKeyToPrintForm(formKey: string): OpinionPrintFormKey {
  return formKey === 'diagnosis' ? 'diagnosis' : 'diag_opinion';
}

/** 원장 발행본 스냅샷(데스크 출력용). */
export interface AuthoredMedDoc {
  id: string;
  docType: MedDocType;
  body: string;
  chartNo: string | null;
  issuedByName: string;
  issuedByLicenseNo: string | null;
  issuedAt: string;
}

interface AuthoredMedDocResult {
  /** 서류종류별 최신 발행본(없으면 미존재 = 원장 미작성). */
  byType: Partial<Record<MedDocType, AuthoredMedDoc>>;
}

/**
 * 환자(customer)의 원장 발행본(소견서/진단서)을 조회.
 *   opinion_doc form_template id 를 먼저 해석한 뒤, 그 template 의 published 발행본을 서류종류별로 최신 1건씩.
 *   clinicId/customerId 미확정이면 비활성(빈 결과) — 게이트는 '미작성' 취급(보수적 disabled).
 */
export function useAuthoredMedDocs(clinicId: string | null, customerId: string | null) {
  return useQuery<AuthoredMedDocResult>({
    queryKey: ['meddoc_authored', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      const empty: AuthoredMedDocResult = { byType: {} };
      if (!clinicId || !customerId) return empty;

      // 1) opinion_doc 활성 템플릿 id (provenance 필터). 미시드 환경이면 게이트 불가 → 빈 결과.
      const { data: tplRow, error: tplErr } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'opinion_doc')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      if (tplErr) throw tplErr;
      const templateId = (tplRow as { id?: string } | null)?.id ?? null;
      if (!templateId) return empty;

      // 2) 발행본(published) 최신순. 서류종류별 첫 행(최신)만 채택.
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('template_id', templateId)
        .eq('status', 'published')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const byType: Partial<Record<MedDocType, AuthoredMedDoc>> = {};
      for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (raw['field_data'] ?? {}) as Record<string, unknown>;
        const docType: MedDocType = fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion';
        if (byType[docType]) continue; // 종류별 최신 1건만
        byType[docType] = {
          id: String(raw['id']),
          docType,
          body: String(fd['final_text'] ?? ''),
          chartNo: (fd['chart_no'] as string | null) ?? null,
          issuedByName: String(fd['doctor_name'] ?? ''),
          issuedByLicenseNo: (fd['doctor_license_no'] as string | null) ?? null,
          issuedAt: String(raw['created_at'] ?? ''),
        };
      }
      return { byType };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/** 데스크 출력 컨텍스트(환자명·병원 헤더). */
export interface MedDocPrintContext {
  patientName: string | null;
  clinicHeader: ClinicHeader | null;
}

/**
 * 데스크 발행본 출력 — 해당 서류종류의 원장 발행본을 양식에 바인딩해 인쇄.
 * 발행본이 없으면 false(호출부에서 게이트가 disabled 처리하므로 정상 경로에선 도달 안 함).
 */
export function printAuthoredMedDoc(
  formKey: string,
  doc: AuthoredMedDoc | undefined,
  ctx: MedDocPrintContext,
): boolean {
  if (!doc) return false;
  return printOpinionDoc({
    body: doc.body,
    chartNo: doc.chartNo,
    patientName: ctx.patientName ?? null,
    issuedByName: doc.issuedByName,
    issuedByLicenseNo: doc.issuedByLicenseNo,
    issueDate: doc.issuedAt ? seoulISODate(doc.issuedAt) : null,
    clinicName: ctx.clinicHeader?.name ?? null,
    clinicAddress: ctx.clinicHeader?.address ?? null,
    clinicPhone: ctx.clinicHeader?.phone ?? null,
    formKey: medDocFormKeyToPrintForm(formKey),
  });
}
