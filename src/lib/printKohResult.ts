// printKohResult — 균검사 결과지(검사결과 보고서) 인쇄/미리보기/이미지 단일 소스 헬퍼
// T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4): 발행된 form_submissions(koh_result) field_data 바인딩.
// T-20260617-foot-KOHGEN-HTMLPORT (KOH-REPORT-TAB Phase2 unblock): 대표원장 자작 HTML 양식 이식.
//   - bindKohResultHtml: field_data → KOH_RESULT_HTML 바인딩(LOGIC-LOCK L-006 bindHtmlTemplate 단일 경로).
//   - 인쇄(printKohResult) + 화면 미리보기/PNG(KohResultDialog) 가 같은 바인딩 결과를 공유(복제 금지).

import { getHtmlTemplate, bindHtmlTemplate } from '@/lib/htmlFormTemplates';
import { supabase } from '@/lib/supabase';

/** KOH 결과지 sheet 루트 element id — KOH_RESULT_HTML 스코프 루트(html2canvas 캡처 타겟). */
export const KOH_SHEET_ID = 'koh-report-sheet';

/**
 * 발행된 KOH 결과지(form_submissions, template=koh_result, status='published')의 field_data 조회.
 * T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE (AC-2/AC-3): 서류출력 명단(DocumentPrintPanel)에서
 *   koh_result 를 출력할 때, 검사결과 탭(KohPublishedResults)과 **동일한 발행 field_data**(발톱부위·
 *   의뢰번호·채취일 등)를 바인딩해 표기 오류(공란) 없이 정확 렌더한다.
 * - 쿼리는 KohPublishedResults 와 동형(마이그 미적용 시 템플릿 없음 → null 폴백, 무파손).
 * - checkInId 가 주어지면 그 방문의 발행분 우선, 없으면 고객 최신 발행분(검사결과 탭 표시분과 동일 semantics).
 * - 발행분이 없으면 null → 호출부는 기존 autobind(공란) 유지.
 */
export async function loadPublishedKohFieldData(
  clinicId: string | null,
  customerId: string | null,
  checkInId?: string | null,
): Promise<Record<string, unknown> | null> {
  if (!clinicId || !customerId) return null;
  // koh_result 템플릿 id — 미적용 prod/dev 면 없음 → null 폴백.
  const { data: tpl } = await supabase
    .from('form_templates')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('form_key', 'koh_result')
    .limit(1)
    .maybeSingle();
  if (!tpl?.id) return null;
  const { data, error } = await supabase
    .from('form_submissions')
    .select('field_data, check_in_id, created_at')
    .eq('clinic_id', clinicId)
    .eq('customer_id', customerId)
    .eq('template_id', tpl.id as string)
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error || !data || data.length === 0) return null;
  const rows = data as Array<{ field_data: unknown; check_in_id: string | null }>;
  // 이 방문 발행분 우선 → 없으면 고객 최신 발행분.
  const row = (checkInId ? rows.find((r) => r.check_in_id === checkInId) : undefined) ?? rows[0];
  return (row?.field_data ?? null) as Record<string, unknown> | null;
}

/** field_data(jsonb) → 문자열 맵 정규화(bindHtmlTemplate 입력 shape). */
function toStringMap(fieldData: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (fieldData && typeof fieldData === 'object') {
    for (const [k, v] of Object.entries(fieldData as Record<string, unknown>)) {
      out[k] = v == null ? '' : String(v);
    }
  }
  return out;
}

/**
 * field_data → KOH_RESULT_HTML 바인딩 결과(스코프 <style> + #koh-report-sheet).
 * 템플릿 부재 시 빈 문자열. 인쇄/화면/PNG 가 공유하는 단일 바인딩 경로.
 */
export function bindKohResultHtml(fieldData: unknown): string {
  const tpl = getHtmlTemplate('koh_result');
  if (!tpl) return '';
  return bindHtmlTemplate(tpl, toStringMap(fieldData));
}

/**
 * 균검사 결과지 인쇄 — 새 창에 KOH_RESULT_HTML 바인딩 결과를 띄우고 인쇄 다이얼로그 호출.
 * 팝업 차단 시 false 반환(호출부에서 toast 안내).
 */
export function printKohResult(fieldData: unknown): boolean {
  const html = bindKohResultHtml(fieldData);
  if (!html) return false;
  const win = window.open('', '_blank', 'width=820,height=1000');
  if (!win) return false;
  win.document.open();
  // T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE: 기존엔 @page 미선언 → 브라우저 기본여백 박스에
  //   인쇄일시·제목 헤더가 자동 삽입됨. @page margin:0 으로 여백 박스를 없애 헤더 제거(콘텐츠 공백은 body padding).
  win.document.write(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>검사결과 보고서</title>` +
      `<style>@page { size: A4 portrait; margin: 0; } html, body { margin: 0; } body { box-sizing: border-box; padding: 12mm; }</style></head><body>${html}` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`,
  );
  win.document.close();
  return true;
}
