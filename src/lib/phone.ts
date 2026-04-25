// E.164 (+8210XXXXXXXX) ↔ 한국식 (010-XXXX-XXXX) 변환 유틸
// PHONE_E164 통일 (T-PHONE-E164 MSG-20260426-0400, 2026-04-26 09:00 KST)
// DB 저장 = E.164. UI 표시는 src/lib/format.ts formatPhone 사용 (이 모듈은 정규화/검색 보조).

const E164_KR_RX = /^\+82(1[016789]\d{7,8})$/;

export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(1);
  if (/^821[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(2);
  if (/^0821[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(3);
  return null;
}

export function digitsForSearch(input: string): string {
  const d = String(input).replace(/[^0-9]/g, "");
  if (d.startsWith("0")) return "82" + d.slice(1);
  if (d.startsWith("82")) return d;
  return d;
}

export const PHONE_E164_RX = E164_KR_RX;
