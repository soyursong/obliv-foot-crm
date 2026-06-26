// src/lib/flag.ts — 국가코드 → Unicode 국기 이모지 공용 유틸 (무패키지)
// 이식 출처: obliv-derm-crm src/lib/flag.ts (T-20260625-foot-PASSPORT-PORT)
//   regional indicator 코드포인트 산술. 국적 셀렉트 국기 렌더에 재사용.

const REGIONAL_INDICATOR_BASE = 0x1f1e6; // 'A'

/**
 * 국가코드(ISO 3166-1 alpha-2) → Unicode 국기 이모지.
 * - 대소문자 무관, 앞뒤 공백 허용.
 * - 2글자 알파벳이 아니면(빈값·숫자·3글자 등) null 반환 → 호출부에서 graceful 생략.
 *
 * @example countryCodeToFlag('TW') // '🇹🇼'
 * @example countryCodeToFlag(null) // null
 */
export function countryCodeToFlag(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return String.fromCodePoint(
    REGIONAL_INDICATOR_BASE + (cc.charCodeAt(0) - 65),
    REGIONAL_INDICATOR_BASE + (cc.charCodeAt(1) - 65),
  );
}
