// src/lib/foreign.ts — 외국인 정보 FE 상수/헬퍼
// T-20260625-foot-PASSPORT-PORT (이식 출처: obliv-derm-crm NewCustomerFormModal.COUNTRY_DEFAULT_LANGUAGE)
//
// (DA 정정2) 국적→언어 자동연결은 DB enum/컬럼이 아니라 FE 매핑으로만 수행한다.
//   ⚠ 단, 현 풋CRM customers 에는 derm 과 달리 '언어(language)' 컬럼/폼 필드가 없다(실측).
//      → 본 매핑은 derm-parity 로 이식만 해두고, 연결 대상(언어 필드)이 생기면 그때 배선한다.
//      (planner FOLLOWUP 발행: customers.language 부재로 자동연결 대상 없음)
//   zh-CN 표기규약 포함(중국=zh-CN, 대만/홍콩=zh-TW). MY(말레이시아)→ms / MM(미얀마)→my 혼동 금지.

export const COUNTRY_DEFAULT_LANGUAGE: Record<string, string> = {
  KR: 'ko',
  CN: 'zh-CN',
  JP: 'ja',
  TW: 'zh-TW',
  HK: 'zh-TW',
  US: 'en',
  CA: 'en',
  AU: 'en',
  SG: 'en',
  PH: 'en',
  MN: 'mn',
  VN: 'vi',
  TH: 'th',
  ID: 'id',
  MY: 'ms',
  MM: 'my',
  KH: 'km',
  RU: 'ru',
  KZ: 'kk',
  UZ: 'uz',
  SA: 'ar',
};

/** ISO alpha-2 국가코드 → 기본 언어코드(없으면 null). 언어 필드 배선 시 사용. */
export function nationalityCodeToLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_DEFAULT_LANGUAGE[code.trim().toUpperCase()] ?? null;
}
