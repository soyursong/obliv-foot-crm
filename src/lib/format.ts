// 금액/번호 포맷 — 풋센터 규칙: 천단위 콤마만, 화폐 단위(₩, 원) 표기 안 함

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.round(value).toLocaleString('ko-KR');
}

export function parseAmount(value: string): number {
  return Number(value.replace(/[^\d-]/g, '')) || 0;
}

// PHONE_E164: 입력 E.164(+8210...) / 010 / 01012345678 모두 한국식(010-1234-5678)로 표시.
// T-20260521-foot-CLINIC-INFO-SYNC: 서울(02) 지역번호 특수 처리 추가
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  // +82 prefix 제거 → 0 시작 변환
  if (digits.startsWith('821') && (digits.length === 12 || digits.length === 11)) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  // 서울(02) 지역번호: 10자리 = 02-XXXX-XXXX, 9자리 = 02-XXX-XXXX
  if (digits.length === 10 && digits.startsWith('02')) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9 && digits.startsWith('02')) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
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

/**
 * T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: 카드/목록 표기명 결정 헬퍼.
 * 고객관리에서 개명 시 reservations/check_ins의 denormalized customer_name은 stale →
 * customers(name) embed 조인 결과(현재 이름)를 우선 표기, customer_id 미연결(unlink) 또는
 * 조인 미수행 시 denormalized customer_name으로 fallback. 무백필·무회귀(읽기 경로 한정).
 * ※ 표기 전용. RES-NAME-MISMATCH-WARN/동명이인 가드는 denormalized customer_name 기준 유지 —
 *    그 비교 로직 인자(row.customer_name)에는 절대 관여하지 않는다.
 */
export function cardDisplayName(
  row: { customers?: { name: string | null } | null; customer_name: string | null },
): string {
  const current = row.customers?.name?.trim();
  if (current) return current;
  return row.customer_name ?? '';
}

export function maskPhoneTail(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}

// [SYNC: G-007] 오늘(서울 기준) 날짜 유틸 — CheckInDetailSheet.tsx 로컬 정의에서 중앙화
// T-20260522-foot-LOGIC-SYNC-MANDATE Phase 2

/** 오늘(서울 기준) YYYY-MM-DD 반환 (en-CA locale trick) */
export function todaySeoulISODate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/**
 * 임의 타임스탬프 → 서울 기준 YYYY-MM-DD 변환 (en-CA locale trick).
 * T-20260531-foot-CHECKIN-DASHBOARD-SYNC: checked_in_at은 UTC(timestamptz)로 저장되므로
 * KST 오전(00:00~09:00) 체크인이 전날 UTC 날짜가 됨 → 날짜 문자열 단순 비교(startsWith) 시
 * 당일 이벤트를 오탐 제외한다. UTC 타임스탬프를 KST 날짜로 환산할 때 이 함수를 사용.
 */
export function seoulISODate(input: string | number | Date): string {
  return new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** 오늘(서울 기준) ko-KR 날짜 문자열 반환 (예: "2026. 05. 22.") */
export function todaySeoulStr(): string {
  return new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}
