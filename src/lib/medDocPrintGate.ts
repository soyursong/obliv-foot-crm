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
import { loadAutoBindContext, applyDiagCodesFromVisit } from '@/lib/autoBindContext';
import type { CheckIn } from '@/lib/types';
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
  /**
   * T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: 발행 시점 내원(check_in) — 상병(3칸) 재현 소스 키(폴백).
   *   출력 시 이 방문의 check_in_services(category_label='상병')에서 상병코드를 읽는다. 레거시 미존재=null.
   */
  checkInId: string | null;
  /**
   * T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK [FIX-REQUEST, 이은상 팀장]: 발행본 스냅샷 상병(1급 소스).
   *   발행 시점 field_data 에 고정 저장된 diag_code_1..4 / diag_name_1..4 (원장 발행 당시 확정 4상병).
   *   재출력이 다른 날 이뤄져도 불변 → check_in_services 폴백(방문일 미매칭 위험)보다 우선.
   *   printOpinionDoc override 에서 autoValues 뒤에 truthy 일 때만 얹어 스냅샷 값을 우선 렌더. 미존재=각 null.
   */
  diagCodes: {
    code1: string | null; code2: string | null; code3: string | null; code4: string | null;
    name1: string | null; name2: string | null; name3: string | null; name4: string | null;
  };
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
          // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: 발행 시점 내원(상병 재현 소스, 폴백).
          checkInId: (fd['check_in_id'] as string | null) ?? null,
          // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK [FIX-REQUEST]: 발행본 스냅샷 상병(1급 소스).
          //   field_data.diag_code_1..4 / diag_name_1..4 를 그대로 추출(K29.7/B35.1/B35.3/L60.0 등).
          diagCodes: {
            code1: (fd['diag_code_1'] as string | null) ?? null,
            code2: (fd['diag_code_2'] as string | null) ?? null,
            code3: (fd['diag_code_3'] as string | null) ?? null,
            code4: (fd['diag_code_4'] as string | null) ?? null,
            name1: (fd['diag_name_1'] as string | null) ?? null,
            name2: (fd['diag_name_2'] as string | null) ?? null,
            name3: (fd['diag_name_3'] as string | null) ?? null,
            name4: (fd['diag_name_4'] as string | null) ?? null,
          },
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
  /**
   * T-20260721-foot-OPINIONDOC-DESK-BLANK: 데스크(DocumentPrintPanel)·수납(PaymentMiniWindow) 공용 출력의
   *   autoValues 로드용 내원행(check_in). 지정 시 loadAutoBindContext 로 환자정보(주민번호·생년월일·연령·
   *   성별·주소·연락처)·상병코드 토큰을 채운다. 미지정 시 종전 9필드만 바인딩(회귀 0).
   */
  checkIn?: CheckIn | null;
}

/**
 * 데스크 발행본 출력 — 해당 서류종류의 원장 발행본을 양식에 바인딩해 인쇄.
 * 발행본이 없으면 false(호출부에서 게이트가 disabled 처리하므로 정상 경로에선 도달 안 함).
 *
 * T-20260721-foot-OPINIONDOC-DESK-BLANK (커버리지 보완):
 *   T-20260720 4FIX 는 원장탭(OpinionDocTab) 출력에만 autoValues(공용 바인더)를 배선하고
 *   데스크 경로 2곳(DocumentPrintPanel·PaymentMiniWindow)이 이 공용 함수를 autoValues 없이 호출 →
 *   환자정보·상병 토큰 공란(이름만 표시)이었다. 이제 ctx.checkIn 이 있으면 이 함수 안에서
 *   loadAutoBindContext(checkIn) 로 autoValues 를 로드해 printOpinionDoc 에 주입한다.
 *   발행본 스냅샷(발행자·면허·차트·발행일·본문)은 printOpinionDoc 내부 override 로 보존(법정 의무기록 불변).
 *   조회 실패 시 종전 동작(9필드)으로 폴백해 인쇄 자체는 계속한다.
 */
export async function printAuthoredMedDoc(
  formKey: string,
  doc: AuthoredMedDoc | undefined,
  ctx: MedDocPrintContext,
): Promise<boolean> {
  if (!doc) return false;
  let autoValues: Record<string, string> | undefined;
  if (ctx.checkIn?.customer_id) {
    try {
      autoValues = await loadAutoBindContext(ctx.checkIn);
      // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: 상병(3칸) 공란 복구 — medical_charts(빈 값) 대신
      //   발행본 원 방문(doc.checkInId)의 check_in_services 상병항목에서 diag_code_1..N 을 채운다.
      //   doc.checkInId 미존재(legacy)면 현재 내원(ctx.checkIn)으로 폴백. 상병 없으면 종전 값 유지(회귀 0).
      await applyDiagCodesFromVisit(autoValues, {
        id: doc.checkInId ?? ctx.checkIn.id,
        clinic_id: ctx.checkIn.clinic_id,
      });
    } catch (e) {
      // 폴백: autoValues 미주입(종전 9필드 동작). 인쇄 자체는 계속.
      console.warn('[OPINIONDOC-DESK-BLANK] autoBind 로드 실패 — 기본 바인딩으로 폴백', e);
    }
  }
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
    autoValues,
    // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK [FIX-REQUEST]: 발행본 스냅샷 상병(1급 소스).
    //   printOpinionDoc 이 autoValues(check_in 폴백) 뒤에 truthy 일 때만 override → 스냅샷 값 우선.
    diagCodes: doc.diagCodes,
  });
}
