// printOpinionDoc — 발행된 소견서(form_submissions, template=opinion_doc) 인쇄/미리보기 헬퍼
// T-20260616-foot-OPINION-DOC-FEATURE (Phase 2, AC-7 출력 연동 — DA 재판정 form 스택 재사용)
//   데스크 서류 출력 = 발행본(field_data.final_text 스냅샷)을 기존 소견서 HTML 양식(diag_opinion)에
//   바인딩해 새 창 인쇄. ⚠ 신규 출력 스택 금지 — 양식 바인딩은 LOGIC-LOCK L-006 의
//   bindHtmlTemplate 단일 경로 재사용, 인쇄 창은 printKohResult 와 동일 패턴(window.open).
//   "데스크 출력 = SELECT(스냅샷 body 그대로, 재조회 변조 불가)" — body 는 발행 시점 그대로 출력.

import { getHtmlTemplate, bindHtmlTemplate } from '@/lib/htmlFormTemplates';

export interface OpinionPrintData {
  /** 발행본 body(수기수정 반영 최종, 스냅샷) — diag_opinion 의 {{diagnosis_ko}} 소견란에 출력 */
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
}

/**
 * 소견서 인쇄 — diag_opinion 양식에 발행본 스냅샷을 바인딩해 새 창 인쇄.
 * 팝업 차단 시 false 반환(호출부 toast 안내).
 */
export function printOpinionDoc(data: OpinionPrintData): boolean {
  const tpl = getHtmlTemplate('diag_opinion');
  if (!tpl) return false;
  const fieldValues: Record<string, string> = {
    record_no: data.chartNo ?? '',
    patient_name: data.patientName ?? '',
    diagnosis_ko: data.body ?? '',           // 소견란(large-area) — 발행 body 그대로
    issue_date: data.issueDate ?? '',
    clinic_name: data.clinicName ?? '',
    clinic_address: data.clinicAddress ?? '',
    clinic_phone: data.clinicPhone ?? '',
    doctor_name: data.issuedByName ?? '',
    doctor_license_no: data.issuedByLicenseNo ?? '',
  };
  const html = bindHtmlTemplate(tpl, fieldValues);
  const win = window.open('', '_blank', 'width=820,height=1000');
  if (!win) return false;
  win.document.open();
  win.document.write(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>소견서</title></head><body>${html}` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`,
  );
  win.document.close();
  return true;
}
