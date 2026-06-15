// printKohResult — 균검사 결과지(검사결과 보고서) 인쇄/미리보기 헬퍼
// T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4)
//   발행된 form_submissions(koh_result) 의 field_data 를 KOH_RESULT_HTML 에 바인딩해 새 창 인쇄.
//   서류 HTML 바인딩은 LOGIC-LOCK L-006 의 bindHtmlTemplate 단일 경로 재사용(복제 금지).

import { getHtmlTemplate, bindHtmlTemplate } from '@/lib/htmlFormTemplates';

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
 * 균검사 결과지 인쇄 — 새 창에 KOH_RESULT_HTML 바인딩 결과를 띄우고 인쇄 다이얼로그 호출.
 * 팝업 차단 시 false 반환(호출부에서 toast 안내).
 */
export function printKohResult(fieldData: unknown): boolean {
  const tpl = getHtmlTemplate('koh_result');
  if (!tpl) return false;
  const html = bindHtmlTemplate(tpl, toStringMap(fieldData));
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
