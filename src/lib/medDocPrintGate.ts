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
import { parseAdminOverrides, type AdminFieldOverrides } from '@/lib/opinionRequest';
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
   * T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: 발행자(진료의) clinic_doctors.id 스냅샷 — 도장 결선용.
   *   데스크 출력도 loadAutoBindContext 가 내원행 치료의로 도장을 해석해, 발행자(문지은)≠방문 치료의(김윤기)면
   *   '문지은 발행 소견서에 김윤기 도장'이 찍힌다. 출력 시 이 id 로 도장을 발행자 본인 직인으로 결선. 레거시=null.
   */
  issuedByDoctorId: string | null;
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
  /**
   * T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE [P0]: 발행 후 원내 직원이 '행정정보 수정'으로
   *   정정한 행정필드 오버레이(발행본이 아니라 요청행 field_data.admin_overrides 에 저장됨 — 발행본 불변).
   *   ★RC: 데스크 출력(printAuthoredMedDoc)은 발행본(status='published') 스냅샷만 읽어 발행 당시 담당의
   *      (issuedByName)·발행자 도장(issuedByDoctorId)을 그대로 뽑았다 → 담당의 정정(문지은→한동훈)이
   *      출력에 반영 안 됨. 반면 화면 열람(IssuedOpinionDocFormView)은 이 오버레이를 얹어 정정값을 보여줌.
   *   이제 useAuthoredMedDocs 가 요청행 오버레이를 발행본에 매칭(check_in_id + doc_type)해 얹고,
   *   printAuthoredMedDoc 이 IssuedOpinionDocFormView 와 동형으로 override(담당의·도장·발급일·상병코드)한다.
   *   미정정(오버레이 없음)이면 undefined → 종전 발행본 스냅샷 그대로 출력(회귀 0).
   */
  adminOverrides?: AdminFieldOverrides;
}

interface AuthoredMedDocResult {
  /** 서류종류별 최신 발행본(없으면 미존재 = 원장 미작성). */
  byType: Partial<Record<MedDocType, AuthoredMedDoc>>;
}

/**
 * T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE: 발행본 ↔ '행정정보 수정' 오버레이 매칭 후보(순수).
 *   오버레이는 발행본(published)이 아니라 그 발행을 만든 '요청행'(status='voided'+resolved_reason='published')
 *   field_data.admin_overrides 에 저장된다(발행본 불변, T-20260724 PERMSPLIT). 요청행의 top-level check_in_id 로
 *   발행본과 원자 링크(발행 RPC 가 요청 check_in 을 발행본 check_in_id 로 각인 — matchPublishedOpinionDoc 동일 키).
 */
export interface AdminOverrideCandidate {
  docType: MedDocType;
  /** 요청행 top-level check_in_id(발행본과 매칭 키). 레거시/미상=null. */
  checkInId: string | null;
  overrides: AdminFieldOverrides;
}

/**
 * 발행본 1건에 얹을 행정 오버레이를 요청행 후보에서 고른다(순수, spec 직접 import → drift 방지).
 *   1순위: 같은 doc_type + check_in_id 일치(발행 RPC 가 요청 check_in 을 발행본에 각인 → 요청1↔발행1 원자 링크).
 *          발행본 check_in 이 있는데 일치 후보가 없으면 = 이 서류엔 정정 없음 → undefined(다른 방문 정정 오적용 차단).
 *   폴백: 발행본 check_in 미상(레거시)이면 같은 doc_type 중 최신 오버레이(candidates 는 created_at desc 로 전달).
 *   후보 없음/미정정 → undefined(정정 없음 = 발행본 스냅샷 그대로 출력, 회귀 0).
 */
export function resolveAdminOverrideForDoc(
  docType: MedDocType,
  publishedCheckInId: string | null,
  candidates: AdminOverrideCandidate[],
): AdminFieldOverrides | undefined {
  const sameType = candidates.filter((c) => c.docType === docType);
  if (sameType.length === 0) return undefined;
  if (publishedCheckInId) {
    return sameType.find((c) => c.checkInId === publishedCheckInId)?.overrides;
  }
  return sameType[0].overrides; // 레거시(발행본 check_in 미상) 폴백 — 같은 종류 최신 정정.
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
      //    T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE: top-level check_in_id 도 읽는다
      //    (요청행 오버레이 매칭 키 — field_data.check_in_id 가 아닌 컬럼값이 발행/요청 양측 원자 링크 SSOT).
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, check_in_id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('template_id', templateId)
        .eq('status', 'published')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const byType: Partial<Record<MedDocType, AuthoredMedDoc>> = {};
      // 발행본 top-level check_in_id(오버레이 매칭 키) — byType 채택된 doc 별로 보관.
      const publishedCheckInByType: Partial<Record<MedDocType, string | null>> = {};
      for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (raw['field_data'] ?? {}) as Record<string, unknown>;
        const docType: MedDocType = fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion';
        if (byType[docType]) continue; // 종류별 최신 1건만
        publishedCheckInByType[docType] = (raw['check_in_id'] as string | null) ?? null;
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
          // T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: 발행자 clinic_doctors.id 스냅샷 — 도장 결선용.
          issuedByDoctorId: (fd['issued_by_doctor_id'] as string | null) ?? null,
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

      // 3) T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE [P0]: '행정정보 수정' 오버레이를 발행본에 얹는다.
      //    오버레이는 요청행(status='voided'+resolved_reason='published')의 field_data.admin_overrides 에 저장됨
      //    (발행본 불변, T-20260724 PERMSPLIT). 데스크 출력이 정정 담당의/도장/발급일/상병코드를 따라가도록,
      //    발행본과 check_in_id+doc_type 로 매칭해 오버레이를 attach → printAuthoredMedDoc 이 override 적용.
      //    조회 실패해도 출력은 계속(오버레이 없이 종전 스냅샷 출력, 회귀 0).
      if (Object.keys(byType).length > 0) {
        try {
          const { data: reqData } = await supabase
            .from('form_submissions')
            .select('check_in_id, field_data, created_at')
            .eq('clinic_id', clinicId)
            .eq('customer_id', customerId)
            .eq('status', 'voided')
            .order('created_at', { ascending: false });
          const candidates: AdminOverrideCandidate[] = [];
          for (const r of (reqData ?? []) as Array<Record<string, unknown>>) {
            const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
            // 서류작성 큐(staff_consult)에서 발행 완료된 요청행만 — 취소·타 draft 제출 배제.
            if (fd['request_origin'] !== 'staff_consult') continue;
            if (fd['resolved_reason'] !== 'published') continue;
            const overrides = parseAdminOverrides(fd);
            if (!overrides) continue; // 정정 없는 요청행은 후보 아님.
            candidates.push({
              docType: fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion',
              checkInId: (r['check_in_id'] as string | null) ?? null,
              overrides,
            });
          }
          if (candidates.length > 0) {
            for (const docType of Object.keys(byType) as MedDocType[]) {
              const ov = resolveAdminOverrideForDoc(
                docType,
                publishedCheckInByType[docType] ?? null,
                candidates,
              );
              if (ov) byType[docType]!.adminOverrides = ov;
            }
          }
        } catch (e) {
          console.warn('[OPINIONDOC-ADMININFO-DOCTORNAME-STALE] admin_overrides 로드 실패 — 발행본 스냅샷으로 출력', e);
        }
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
  // T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE [P0]: '행정정보 수정' 오버레이를 발행본 스냅샷 '위에'
  //   얹는다(IssuedOpinionDocFormView 열람 경로와 동형 — 출력↔열람 표기 정합). 발행본 스냅샷은 불변,
  //   출력 렌더 시점에만 정정값이 이긴다(truthy override). 정정 없으면 종전 스냅샷 그대로(회귀 0).
  //   · 담당의명(doctorName) → issuedByName 지배(소견서 {{doctor_name}} + 진단서 {{attending_doctor_name}} 동시).
  //   · 담당의 id(doctorId) → 도장 앵커(effectiveDoctorId) 지배 → 이름↔도장 세트 정합(SEAL-DOCTOR-MATCH 동형, AC-2).
  //   · 발급일(issueDate)/상병코드(diagCode) → 열람과 동일 규칙으로 override(상병은 primary=code1만).
  const ov = doc.adminOverrides;
  const effectiveDoctorName = ov?.doctorName || doc.issuedByName;
  const effectiveDoctorId = ov?.doctorId ?? doc.issuedByDoctorId ?? undefined;
  const effectiveIssueDate = ov?.issueDate || (doc.issuedAt ? seoulISODate(doc.issuedAt) : null);
  const effectiveDiagCodes = ov?.diagCode
    ? { code1: ov.diagCode, code2: null, code3: null, code4: null,
        name1: null, name2: null, name3: null, name4: null }
    : doc.diagCodes;
  let autoValues: Record<string, string> | undefined;
  if (ctx.checkIn?.customer_id) {
    try {
      // T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: 데스크 출력 도장도 '발행자(=정정 시 정정 진료의) 본인 직인'
      //   으로 결선. 정정 진료의 clinic_doctors.id(effectiveDoctorId)를 clinicDoctorId(1순위)로, 정정 진료의명
      //   (effectiveDoctorName)을 doctorNameOverride(레거시 id 부재 시 이름폴백)로 태워 도장 오매핑을 차단한다.
      //   ⚠ 빌링서식 loadAutoBindContext 호출부(PaymentMiniWindow/DocumentPrintPanel 자체 경로)는 무접점 —
      //     본 함수는 소견서/진단서 발행본 출력 전용. 07-14 미지정폴백 법인인감(sealFallbackToInstitution) 불변.
      autoValues = await loadAutoBindContext(
        ctx.checkIn,
        effectiveDoctorName || undefined,
        effectiveDoctorId,
      );
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
    // T-20260729-foot-OPINIONDOC-ADMININFO-DOCTORNAME-STALE: 담당의명 = 정정 오버레이 우선(없으면 발행 스냅샷).
    issuedByName: effectiveDoctorName,
    issuedByLicenseNo: doc.issuedByLicenseNo,
    issueDate: effectiveIssueDate,
    clinicName: ctx.clinicHeader?.name ?? null,
    clinicAddress: ctx.clinicHeader?.address ?? null,
    clinicPhone: ctx.clinicHeader?.phone ?? null,
    formKey: medDocFormKeyToPrintForm(formKey),
    autoValues,
    // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK [FIX-REQUEST]: 발행본 스냅샷 상병(1급 소스).
    //   printOpinionDoc 이 autoValues(check_in 폴백) 뒤에 truthy 일 때만 override → 스냅샷 값 우선.
    //   T-20260729: 상병코드 정정 오버레이가 있으면 그 값(primary)이 이긴다(열람 경로와 동일).
    diagCodes: effectiveDiagCodes,
  });
}
