// _shared/redpay-foot-merchants.ts — RedPay 풋센터 merchant 화이트리스트 + 사업자번호 SSOT
//
// T-20260722-foot-REDPAY-WEBHOOK-RECV-EF (P1, 최필경 C0ATE5P6JTH · 결제자동화 플랜B)
//   redpay-webhook 수신 EF 의 "센터 분리(merchant_id 화이트리스트)" 판별을 위한 공유 모듈.
//   문자열 파싱 금지 — merchant_id 는 반드시 이 화이트리스트 Set 으로만 판별한다(AC-2.5).
//
// ── canonical SSOT ──────────────────────────────────────────────────────────
//   값 표준 = redpay_foot_terminal_registry.md §2 26-set(last_verified 2026-07-20,
//   FOOT-CONFIRMED ADDITIVE). redpay-reconcile/index.ts 의 인라인 FOOT_MERCHANT_SET/
//   BODY_MERCHANT_SET 과 미러(동일 값). 인라인 정의의 형제 EF 공유 불가 문제를
//   redpay-config.ts 와 같은 방식으로 해소(향후 reconcile 도 이 모듈로 수렴 = 별도 통합 티켓).
//   ⇒ ⛔ 'dohsu'/'dosu'(display alias) ⛔ 'body_rehab'(축오염). 재활도 center='body'.
//
// ── merchant_id/tid 판별 재사용 (TERMINAL-REGISTRY, T-20260711) ────────────────
//   본 화이트리스트는 단말기 레지스트리(redpay_terminal_registry)의 canonical 26-set 을
//   코드-레벨로 박제한 미러다. 신규 단말 추가 시 registry §2 갱신 → 이 Set 동기(중복 신설 금지).

/** 풋센터(서울오리진 종로 풋) 26-set merchant_id. FOOT-CONFIRMED ADDITIVE 2026-07-20. */
export const FOOT_MERCHANT_SET: ReadonlySet<string> = new Set<string>([
  "1777285001", "1777285003", "1777285004", "1777285005", "1777285006",
  "1777285007", "1777285008",             // VAN7
  "1777288001", "1777288003", "1777288004", "1777288005", "1777288006",
  "1777288008",                           // 유선6
  "1777289001", "1777289002", "1777289003", "1777289004", "1777289005",
  "1777289006", "1777289007", "1777289008",
  "1777289009", "1777289010", "1777289011", "1777289012", "1777289013",
]);

/** 도수(재활, body) 14-band merchant_id. foot 웹훅 관점에서는 '타 센터' → drop. */
export const BODY_MERCHANT_SET: ReadonlySet<string> = new Set<string>([
  "1777274001",
  "1777275001", "1777275002", "1777275003", "1777275004",
  "1777275005", "1777275006", "1777275007", "1777275008",
  "1777276001", "1777276002", "1777276003", "1777276004", "1777276005",
]);

export type MerchantCenter = "foot" | "body" | "unknown";

/**
 * merchant_id → center 판별 (화이트리스트 기반, 문자열 파싱 금지).
 *   foot 26-set → 'foot' / body 14-band → 'body' / 미등록 → 'unknown'.
 *   'unknown' 은 호출부가 Slack 알림 + 미적재로 처리(AC-2.5).
 */
export function centerForMerchant(merchantId: string | null | undefined): MerchantCenter {
  const mid = (merchantId ?? "").trim();
  if (mid === "") return "unknown";
  if (FOOT_MERCHANT_SET.has(mid)) return "foot";
  if (BODY_MERCHANT_SET.has(mid)) return "body";
  return "unknown";
}

/** 하이픈·공백 제거 후 사업자번호 비교용 정규화. (511-60-00988 ↔ 5116000988) */
export function normalizeBusinessNo(bizNo: string | null | undefined): string {
  return (bizNo ?? "").replace(/[^0-9]/g, "");
}

/**
 * 서울오리진(풋) 사업자번호 방어 필터(AC-2.6).
 *   allowRaw = 허용 사업자번호 CSV(env REDPAY_WEBHOOK_BUSINESS_NO_ALLOW ‖ REDPAY_BUSINESS_NO).
 *     - 비어있으면(초기·미설정) true 반환 = pass-through(활성화 전 차단 방지).
 *     - business_no 는 세무 cert 정정으로 mutable(511→457 divergence, RESOLVER-SLUG 사고) →
 *       CSV 로 복수 허용값을 담을 수 있게 설계(단일 하드코딩 금지).
 */
export function isAllowedBusinessNo(
  payloadBizNo: string | null | undefined,
  allowRaw: string | null | undefined,
): boolean {
  const allow = (allowRaw ?? "")
    .split(",")
    .map((b) => normalizeBusinessNo(b))
    .filter((b) => b.length > 0);
  if (allow.length === 0) return true; // 미설정 = pass-through(setup-safe)
  return allow.includes(normalizeBusinessNo(payloadBizNo));
}
