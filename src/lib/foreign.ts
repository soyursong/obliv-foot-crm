// src/lib/foreign.ts — 외국인 정보 FE 상수/헬퍼
// T-20260625-foot-PASSPORT-PORT (이식 출처: obliv-derm-crm NewCustomerFormModal.COUNTRY_DEFAULT_LANGUAGE)
//
// (DA 정정2) 국적→언어 자동연결은 DB enum/컬럼이 아니라 FE 매핑으로만 수행한다.
//   ✅ T-20260625-foot-FOREIGN-LANG-SAVE: customers.language(TEXT NULL) 컬럼 신설(BCP-47 코드 저장).
//      국적 선택 시 이 매핑으로 언어를 '제안'(language 비어있을 때만) → 폼 표시 + 저장.
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

// ─────────────────────────────────────────────────────────────────────────────
// T-20260625-foot-FOREIGN-LANG-SAVE — 환자 선호 언어(customers.language) FE 상수
//   DA CONSULT-REPLY(MSG-20260625-131444-2prw, DA-20260625-FOOT-FOREIGN-LANG-CANON):
//     · canonical 컬럼 = customers.language (preferred_language 기각)
//     · 저장 value = BCP-47 코드(ko/en/ja/zh-CN/zh-TW …) — 표시명 저장 금지
//     · DB CHECK 없음(derm 선례 정합) → FE LANGUAGE_OPTIONS 앱레벨 검증 의무. 코드 확장 시 5 CRM 동기.
//   라벨은 운영표기(영어/중국어/일본어/대만어), 저장 value(enum)는 불변 — derm LANGUAGE_OPTIONS 그대로 이식(16종 parity).
//   COUNTRY_DEFAULT_LANGUAGE 21국 매핑값이 모두 이 옵션에 존재해야 자동연결 제안값이 고아가 되지 않음.
// ─────────────────────────────────────────────────────────────────────────────
export const LANGUAGE_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'zh-CN', label: '중국어' },
  { value: 'zh-TW', label: '대만어' },
  { value: 'mn', label: '몽골어' },
  { value: 'vi', label: '베트남어' },
  { value: 'th', label: '태국어' },
  { value: 'id', label: '인도네시아어' },
  { value: 'ms', label: '말레이어' },
  { value: 'my', label: '미얀마어' },
  { value: 'km', label: '크메르어' },
  { value: 'ru', label: '러시아어' },
  { value: 'kk', label: '카자흐어' },
  { value: 'uz', label: '우즈베크어' },
  { value: 'ar', label: '아랍어' },
] as const;

/** BCP-47 언어코드 → 운영 표기 라벨(없으면 코드 그대로). */
export function languageCodeToLabel(code: string | null | undefined): string {
  if (!code) return '';
  return LANGUAGE_OPTIONS.find((o) => o.value === code)?.label ?? code;
}
