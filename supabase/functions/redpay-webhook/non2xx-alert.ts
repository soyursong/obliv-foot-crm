// redpay-webhook/non2xx-alert.ts — non-2xx 웹훅 응답 상시 슬랙 알림 (순수 로직 모듈)
//
// T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE (P1, 최필경 총괄 · C0ATE5P6JTH)
//   Part B: 레드페이 웹훅이 우리 핸들러 코드에서 non-2xx(2xx 아닌 모든 응답)를 반환하면
//   즉시 슬랙 알림. "결제 유실 직전 신호" 상시감시 격상.
//
//   ── 커버리지(정직 고지) ────────────────────────────────────────────────────
//   우리 핸들러 코드가 반환하는 non-2xx 를 커버:
//     401 invalid_signature(구조적 서명불일치 — 총괄님이 가장 우려한 신호) /
//     400 body_read_failed / 500 clinic_resolve_failed·db_upsert_failed·
//     observe_safety_violation·unexpected_error.
//   ★플랫폼 레벨 503(게이트웨이·워커 실패, 우리 JS 도달 전)은 여기서 잡히지 않음 —
//     로그기반 모니터가 별도 필요(Part A 결론 §Part B 함의 참조). 후속 P2.
//
//   ── 발송 규약 ──────────────────────────────────────────────────────────────
//   장쳰봇 명의(REDPAY_SLACK_BOT_TOKEN) + REDPAY_ALERT_CHANNEL(미등록 merchant 알림과
//   동일 채널 재사용 — 레드페이 계열 기존 배선). 사용자/대표 계정 직접 발송 금지(공통 규약).
//
//   ── 격리 원칙 ──────────────────────────────────────────────────────────────
//   관측 전용 — 알림 처리는 결제 응답(Response)에 절대 영향 없음(예외 삼킴). 순수함수=단위테스트.

export interface Non2xxAlertContext {
  eventId?: string | null;
  trxid?: string | null;
  tid?: string | null;
  merchantId?: string | null;
}

/** 2xx 가 아니면 true(300·400·500 계열 모두 non-2xx). */
export function isNon2xx(status: number): boolean {
  return status < 200 || status >= 300;
}

/**
 * 실제 레드페이 결제 push 인지 판별.
 *   결제 push = POST. GET introspection·비-POST 프로브(405 method_not_allowed)는
 *   결제 신호가 아니므로 알림 대상 제외(노이즈 억제 — Part A 에서 405×7 = 프로브 노이즈 확인).
 */
export function isRealWebhookDelivery(method: string, isIntrospection: boolean): boolean {
  return method === "POST" && !isIntrospection;
}

/** 응답 body(JSON)에서 에러 요약 문자열 추출(error > reason > status 우선). */
export function extractErrorSummary(bodyText: string): string {
  try {
    const b = JSON.parse(bodyText) as Record<string, unknown>;
    const s = b.error ?? b.reason ?? b.status ?? "";
    return String(s ?? "").trim();
  } catch {
    return (bodyText ?? "").trim().slice(0, 120);
  }
}

/**
 * 알림 본문 생성(AC-B1: 발생시각·응답코드·trxid/tid·에러요약).
 *   suppressedSince > 0 = dedup 창 내 묶인 동일원인 건수(운영자 가시성).
 */
export function buildNon2xxAlertText(
  status: number,
  errorSummary: string,
  ctx: Non2xxAlertContext,
  occurredIso: string,
  suppressedSince = 0,
): string {
  const lines = [
    `🚨 [redpay-webhook][foot] non-2xx 응답 — 결제 유실 직전 신호`,
    `발생시각: ${occurredIso}`,
    `응답코드: ${status}`,
    `에러요약: ${errorSummary || "(없음)"}`,
    `trxid=${ctx.trxid ?? "∅"} / tid=${ctx.tid ?? "∅"} / merchant_id=${ctx.merchantId ?? "∅"} / event_id=${ctx.eventId ?? "∅"}`,
    `→ 레드페이 재시도(1/5/30분) 창 내 복구 여부 즉시 확인. 미복구 시 수기보정.`,
  ];
  if (suppressedSince > 0) {
    lines.push(`(직전 발송 이후 동일원인 ${suppressedSince}건 묶임 — dedup 창)`);
  }
  return lines.join("\n");
}

/** dedup 판정 결과. */
export interface DedupDecision {
  send: boolean;
  /** send=true 일 때, 직전 발송 이후 억제됐던 동일원인 건수(본문에 표기). */
  suppressedSince: number;
}

/**
 * dedup 팩토리 — 모듈 스코프 상태(EF 인스턴스 단위 best-effort).
 *   key(=status:reason) 별로 windowMs 내 동일원인 반복은 1건으로 묶음(AC-B3 rate-limit).
 *   ★단 "억제보다 도달 우선"(과억제 금지): window 짧게(기본 60s) → 지속 장애 시 분당 최소 1건은 반드시 도달.
 *   nowMs 주입(테스트 결정성).
 */
export function makeDedup(windowMs: number) {
  const lastSent = new Map<string, number>();
  const suppressed = new Map<string, number>();
  return function decide(key: string, nowMs: number): DedupDecision {
    const last = lastSent.get(key);
    if (last == null || nowMs - last >= windowMs) {
      const s = suppressed.get(key) ?? 0;
      lastSent.set(key, nowMs);
      suppressed.set(key, 0);
      return { send: true, suppressedSince: s };
    }
    suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
    return { send: false, suppressedSince: 0 };
  };
}
