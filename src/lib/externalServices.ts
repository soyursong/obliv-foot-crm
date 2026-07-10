// T-20260710-foot-NO-HARDCODE-ENUM-GUARDRAIL
// 외부 서비스 엔드포인트 / Supabase Edge Function 이름 단일소스(SSOT).
// 여기저기 문자열로 하드코딩하면 오타 시 조용한 런타임 실패(빌드·타입체크 통과)로
// 이어지므로, 2회 이상 참조되는 외부 URL·EF 이름은 이 모듈을 참조한다.
// (동작 보존: 값은 기존 리터럴과 동일. 신규 의존/네트워크 변경 없음.)

/**
 * QR 이미지 생성 외부 API (foot-native 패턴, 신규 npm 없음).
 * base + querystring 조합으로 사용: `${QR_CODE_API_ENDPOINT}?size=...&data=...`
 */
export const QR_CODE_API_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/';

/**
 * supabase.functions.invoke(name) 로 호출하는 Edge Function 이름.
 * 2회 이상 호출되는 것만 등재(1회성은 자명하므로 미등재 — 과잉 추상화 지양).
 */
export const EDGE_FUNCTIONS = {
  /** CRM → 도파민 상태 callback (예약 취소/결제완료 등) */
  DOPAMINE_CALLBACK: 'dopamine-callback',
  /** 알림/문자 발송 (테스트/수동 발송 공통) */
  SEND_NOTIFICATION: 'send-notification',
} as const;

export type EdgeFunctionName = (typeof EDGE_FUNCTIONS)[keyof typeof EDGE_FUNCTIONS];
