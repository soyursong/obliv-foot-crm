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

/**
 * 선점표 보관 기간(분). — T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX 정정2(파라미터 2분리, 신설).
 * 선점이 만료(status='expired')된 뒤에도 이 기간 동안 매칭 후보로 보관 → late 웹훅(레드페이 재시도 1/5/30분) 자동연결.
 *   · 선점 유효창(위 autoConnect 5분) 과 별개 축: 유효창=occurred_at 이 들어와야 하는 창 / 보관창=선점행을 매칭 후보로 유지하는 창.
 *   · 화면에는 미노출(비대기형 UX 유지 — 카운트다운은 유효창 5분만). 매처(redpay-planb-match/match.ts RETENTION_MS)가 이 값을 미러.
 *   · 만료 후 이 기간 초과분은 매칭 후보에서 자연 제외(행은 보존 → 미배정 유입지표 정합, 즉시삭제 없음).
 */
export const REDPAY_PLANB_RETENTION_MIN = 60;

/**
 * 역방향 자동대조 유효창(분). — T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD (DA §E-1 판정).
 *
 * ★ E-1 파라미터 2분리 판정(DA SSOT §SPEC-INPUT E-1 요망):
 *   · (a) 역방향 자동대조 유효창 = 5분  ← 본 상수. [수납] 저장 시점(now) 기준, 그 직전 5분 내 승인(approved_at)
 *         한 raw 만 "같은 거래"로 신뢰해 자동연결. 총괄 확정(플랜B 역방향창 5분, 「지시_플랜B_역방향창_
 *         버튼위치_확정_20260730」): 좁게 시작해 넓히는 방향. 놓침(사후 [환자 연결] 수동 처리 가능) 비용
 *         << 잘못 붙은 건(승인번호 대조 필요) 충돌 비용. 10분(겹침 실측 22.2%)은 철회.
 *   · (b) raw 보관창 = 1h (REDPAY_PLANB_RETENTION_MIN) ← 별개 축. 선점표/raw 를 매칭 후보로 유지하는 창.
 *   → 목적 상이(유효창='같은거래 신뢰창' / 보관창='후보 유지창'). 두 값을 한 상수로 묶지 않는다.
 *
 * ⚠ 값(5분)은 총괄 확정(2026-07-30 최필경). 창을 넘는 late/수일방치 reverse-miss 는 본 저장훅이
 *   자동연결하지 않고(오연결·오backdating 방지) 미배정 결제함(수동)·OPT3 별도버튼 표면으로 위임한다(표면 분리).
 */
export const REDPAY_REVERSE_MATCH_WINDOW_MIN = 5;

/** 밀리초 환산 상수(FE 타이머/EF 판정 공통 사용). */
export const REDPAY_PLANB_TTL = {
  autoConnectMin: REDPAY_PLANB_AUTO_CONNECT_MIN,
  lockMin: REDPAY_PLANB_LOCK_MIN,
  retentionMin: REDPAY_PLANB_RETENTION_MIN,
  reverseMatchWindowMin: REDPAY_REVERSE_MATCH_WINDOW_MIN,
  autoConnectMs: REDPAY_PLANB_AUTO_CONNECT_MIN * 60 * 1000,
  lockMs: REDPAY_PLANB_LOCK_MIN * 60 * 1000,
  retentionMs: REDPAY_PLANB_RETENTION_MIN * 60 * 1000,
  reverseMatchWindowMs: REDPAY_REVERSE_MATCH_WINDOW_MIN * 60 * 1000,
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
 * 자동연결 유효창 판정 — T-20260729 정정2: 시간 키 = occurred_at(승인시각), NOT received_at(도착시각).
 *   승인시각(occurred_at = redpay_raw_transactions.approved_at)이 선점 유효창 [created_at, expires_at] 이내인가?
 *   true = 자동매칭 대상 / false = 유효창 밖(미배정 결제함 → 사후 수동 연결).
 *   ★ 웹훅 도착시각(received_at)은 판정에서 완전히 제거 — 웹훅 지연이 유효창을 잠식하지 않음(카드 삽입 5분 온전 확보).
 *   경계: 닫힌 구간 [created_at, expires_at](승인시각 == expires_at 도 유효). 매처 match.ts isWithinValidWindow 와 동치.
 */
export function isWithinAutoConnect(
  createdAt: Date | string | number,
  occurredAt: Date | string | number,
): boolean {
  const occ = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return occ >= created && occ <= computeExpiresAt(createdAt).getTime();
}

/** 직원 안내 문구(완료 뱃지). "결제는 최대 5분 내 자동 기록". */
export const REDPAY_PLANB_AUTO_RECORD_NOTICE = `결제는 최대 ${REDPAY_PLANB_AUTO_CONNECT_MIN}분 내 자동 기록`;
