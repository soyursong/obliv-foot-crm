// 금액/번호 포맷 — 풋센터 규칙: 천단위 콤마만, 화폐 단위(₩, 원) 표기 안 함

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.round(value).toLocaleString('ko-KR');
}

export function parseAmount(value: string): number {
  return Number(value.replace(/[^\d-]/g, '')) || 0;
}

// PHONE_E164: 입력 E.164(+8210...) / 010 / 01012345678 모두 한국식(010-1234-5678)로 표시.
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  // +82 prefix 제거 → 0 시작 변환
  if (digits.startsWith('821') && (digits.length === 12 || digits.length === 11)) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

/**
 * 전화번호 입력 실시간 포맷터 (T-20260513-foot-PHONE-HYPHEN-FORMAT)
 * 숫자만 입력해도 010-xxxx-xxxx 형식으로 자동 변환.
 * 붙여넣기(공백·하이픈 포함) 도 정규화 처리.
 * DB 저장 전 strip이 필요하면 phone.replace(/\D/g,'') 사용.
 */
export function formatPhoneInput(value: string): string {
  // 숫자만 추출 (+82 prefix 처리 포함)
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('821') && digits.length >= 11) {
    digits = '0' + digits.slice(2);
  }
  // 최대 11자리 제한 (010-1234-5678)
  digits = digits.slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function maskPhoneTail(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}
