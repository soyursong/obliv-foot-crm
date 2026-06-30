// printOpinionDoc — 발행된 소견서/진단서(form_submissions, template=opinion_doc) 인쇄/미리보기 헬퍼
// T-20260616-foot-OPINION-DOC-FEATURE (Phase 2, AC-7 출력 연동 — DA 재판정 form 스택 재사용)
//   데스크 서류 출력 = 발행본(field_data.final_text 스냅샷)을 기존 소견서/진단서 HTML 양식에
//   바인딩해 새 창 인쇄. ⚠ 신규 출력 스택 금지 — 양식 바인딩은 LOGIC-LOCK L-006 의
//   bindHtmlTemplate 단일 경로 재사용, 인쇄 창은 printKohResult 와 동일 패턴(window.open).
//   "데스크 출력 = SELECT(스냅샷 body 그대로, 재조회 변조 불가)" — body 는 발행 시점 그대로 출력.
// T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED (B안):
//   데스크 서류출력의 소견서(diag_opinion)·진단서(diagnosis) 카드 = 원장 발행본(opinion_doc)을
//   그대로 출력. formKey 로 양식 분기 — 소견서=diag_opinion(diagnosis_ko 소견란),
//   진단서=diagnosis(treatment_opinion 의견란). 본문은 발행 body 스냅샷 그대로(데스크 작성 불가).

import { getHtmlTemplate, bindHtmlTemplate } from '@/lib/htmlFormTemplates';

/** 발행본 출력 대상 양식 — 소견서 / 진단서 */
export type OpinionPrintFormKey = 'diag_opinion' | 'diagnosis';

export interface OpinionPrintData {
  /** 발행본 body(수기수정 반영 최종, 스냅샷) — 양식의 본문(소견/의견)란에 출력 */
  body: string;
  /** 발행시점 차트번호 스냅샷 */
  chartNo?: string | null;
  /** 환자 성명(customers, 현재값) */
  patientName?: string | null;
  /** 발행자명 스냅샷(불변) */
  issuedByName?: string | null;
  /** 면허번호 스냅샷 */
  issuedByLicenseNo?: string | null;
  /** 발행일(YYYY-MM-DD 등 표시 문자열) */
  issueDate?: string | null;
  /** 의료기관 헤더(있으면 바인딩) */
  clinicName?: string | null;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  /** 출력 양식 — 기본 소견서(diag_opinion). 진단서 출력 시 'diagnosis'. */
  formKey?: OpinionPrintFormKey;
}

// 양식별 본문(발행 body)이 들어갈 필드 키.
//   diag_opinion(소견서) = {{diagnosis_ko}} 소견란(large-area)
//   diagnosis(진단서)    = {{treatment_opinion}} 치료의견란(large-area)
const BODY_FIELD_BY_FORM: Record<OpinionPrintFormKey, string> = {
  diag_opinion: 'diagnosis_ko',
  diagnosis: 'treatment_opinion',
};

const TITLE_BY_FORM: Record<OpinionPrintFormKey, string> = {
  diag_opinion: '소견서',
  diagnosis: '진단서',
};

/**
 * 소견서/진단서 인쇄 — 해당 양식에 발행본 스냅샷을 바인딩해 새 창 인쇄.
 * 팝업 차단 시 false 반환(호출부 toast 안내).
 */
export function printOpinionDoc(data: OpinionPrintData): boolean {
  const formKey: OpinionPrintFormKey = data.formKey ?? 'diag_opinion';
  const tpl = getHtmlTemplate(formKey);
  if (!tpl) return false;
  const bodyField = BODY_FIELD_BY_FORM[formKey];
  const fieldValues: Record<string, string> = {
    record_no: data.chartNo ?? '',
    patient_name: data.patientName ?? '',
    [bodyField]: data.body ?? '',           // 본문(소견/의견)란 — 발행 body 그대로
    issue_date: data.issueDate ?? '',
    clinic_name: data.clinicName ?? '',
    clinic_address: data.clinicAddress ?? '',
    clinic_phone: data.clinicPhone ?? '',
    doctor_name: data.issuedByName ?? '',
    doctor_license_no: data.issuedByLicenseNo ?? '',
  };
  const html = bindHtmlTemplate(tpl, fieldValues);
  const title = TITLE_BY_FORM[formKey];
  const win = window.open('', '_blank', 'width=820,height=1000');
  if (!win) return false;
  win.document.open();
  // T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 이 raw 인쇄 경로(소견서/진단서 발행본 데스크 출력)도
  //   openBatchPrintWindow 와 동일한 "@page 물리 여백 = 엔진 중앙배치" 모델로 통일한다.
  //   form-wrap(COMMON_STYLE @media print 에서 margin:0 auto)이 콘텐츠박스를 채우고 엔진이 시트에 물리 배치.
  // T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 경로1·4와 동일하게 상단 margin 12mm→30mm 하향
  //   (약 +68px ≈ 엔터 4~5줄). 하단 12mm 유지. 콘텐츠박스 255mm(=297-30-12) → 단일 페이지·넘침/잘림 없음.
  win.document.write(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>@page { size: A4 portrait; margin: 30mm 10mm 12mm; } html, body { margin: 0; padding: 0; }</style></head><body>${html}` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`,
  );
  win.document.close();
  return true;
}
