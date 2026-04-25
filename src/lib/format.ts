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

export function maskPhoneTail(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}
