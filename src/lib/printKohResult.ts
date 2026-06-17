// printKohResult — 균검사 결과지(검사결과 보고서) 인쇄/미리보기/이미지 단일 소스 헬퍼
// T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4): 발행된 form_submissions(koh_result) field_data 바인딩.
// T-20260617-foot-KOHGEN-HTMLPORT (KOH-REPORT-TAB Phase2 unblock): 대표원장 자작 HTML 양식 이식.
//   - bindKohResultHtml: field_data → KOH_RESULT_HTML 바인딩(LOGIC-LOCK L-006 bindHtmlTemplate 단일 경로).
//   - 인쇄(printKohResult) + 화면 미리보기/PNG(KohResultDialog) 가 같은 바인딩 결과를 공유(복제 금지).

import { getHtmlTemplate, bindHtmlTemplate } from '@/lib/htmlFormTemplates';

/** KOH 결과지 sheet 루트 element id — KOH_RESULT_HTML 스코프 루트(html2canvas 캡처 타겟). */
export const KOH_SHEET_ID = 'koh-report-sheet';

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
  win.document.write(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>검사결과 보고서</title></head><body>${html}` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`,
  );
  win.document.close();
  return true;
}
