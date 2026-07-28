/**
 * redpayPlanbTtl.ts — 레드페이 플랜B(비대기형 결제) TTL 정책 단일소스(SSOT)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD · TTL 축소 fold (2026-07-29, MSG-ku9c)
 *
 * ★ 정책 단일소스(DA 명시): app enforcement 상수가 TTL 판정의 유일 권위.
 *   DB DEFAULT(pending_payment.expires_at = now()+5min)는 앱 누락 대비 fallback 일 뿐.
 *   FE(PaymentPlanb route) / EF(redpay-webhook·redpay-reconcile 매칭) / cron(만료 배치)은
 *   모두 이 모듈의 상수를 유일 소스로 소비해야 한다(값 하드코딩 금지).
 *
 * 현장(최필경 총괄) 확정값 — 7/28~29 재실측 기반:
 *   · 자동연결(auto-connect) 유효 = created_at + 5분  (경과 후 자동매칭 대상 제외)
 *   · 선점잠금(preempt lock)      = created_at + 6분  (같은 단말 다음 결제 block; 6분 만료+미매칭 → expired)
 *   근거: 7/28 실측 최대 4분5초(5분이 실측 최대 커버) + 레드페이 재시도 1/5/30분(5분 미달=worker 지연 꼬리) +
 *         소액 반복거래(10,000·8,800·1,400원) '같은 금액' 충돌창 최소화.
 *
 * 이력: 최초 A안 10분/12분(w5rs ADDITIVE) → 2026-07-29 5분/6분 축소 확정(값 조정, 구조 불변).
 */

/** 자동연결 유효 시간(분). 이 시간 경과 후 도착한 웹훅은 자동매칭 대상에서 제외(미배정 결제함으로). */
export const REDPAY_PLANB_AUTO_CONNECT_MIN = 5;

/** 선점 잠금 시간(분). 이 시간 동안 같은 단말의 다음 결제를 block. 만료+미매칭 시 status=expired 전이. */
export const REDPAY_PLANB_LOCK_MIN = 6;

/** 밀리초 환산 상수(FE 타이머/EF 판정 공통 사용). */
export const REDPAY_PLANB_TTL = {
  autoConnectMin: REDPAY_PLANB_AUTO_CONNECT_MIN,
  lockMin: REDPAY_PLANB_LOCK_MIN,
  autoConnectMs: REDPAY_PLANB_AUTO_CONNECT_MIN * 60 * 1000,
  lockMs: REDPAY_PLANB_LOCK_MIN * 60 * 1000,
} as const;

/**
 * 선점 등록시각(created_at) 기준 expires_at(자동연결 만료 예정 시각) 계산.
 * app-set 값 = created_at + 5분. pending_payment INSERT 시 명시 세팅(정책 단일소스).
 */
export function computeExpiresAt(createdAt: Date | string | number): Date {
  const base = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return new Date(base + REDPAY_PLANB_TTL.autoConnectMs);
}

/**
 * 선점 등록시각(created_at) 기준 locked_until(선점 잠금 만료 시각) 계산.
 * app-set 값 = created_at + 6분. pending_payment INSERT 시 명시 세팅(정책 단일소스).
 */
export function computeLockedUntil(createdAt: Date | string | number): Date {
  const base = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return new Date(base + REDPAY_PLANB_TTL.lockMs);
}

/**
 * 자동연결 유효 판정: 웹훅 수신시각(receivedAt)이 expires_at 이내인가?
 * true = 자동매칭 대상 / false = TTL 초과(미배정 결제함 → 사후 수동 연결).
 */
export function isWithinAutoConnect(
  createdAt: Date | string | number,
  receivedAt: Date | string | number,
): boolean {
  const recv = receivedAt instanceof Date ? receivedAt.getTime() : new Date(receivedAt).getTime();
  return recv < computeExpiresAt(createdAt).getTime();
}

/** 직원 안내 문구(완료 뱃지). "결제는 최대 5분 내 자동 기록". */
export const REDPAY_PLANB_AUTO_RECORD_NOTICE = `결제는 최대 ${REDPAY_PLANB_AUTO_CONNECT_MIN}분 내 자동 기록`;
