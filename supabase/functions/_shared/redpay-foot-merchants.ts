// _shared/redpay-foot-merchants.ts — RedPay 풋센터 merchant 화이트리스트 + 사업자번호 SSOT
//
// T-20260722-foot-REDPAY-WEBHOOK-RECV-EF (P1, 최필경 C0ATE5P6JTH · 결제자동화 플랜B)
//   redpay-webhook 수신 EF 의 "센터 분리(merchant_id 화이트리스트)" 판별을 위한 공유 모듈.
//   문자열 파싱 금지 — merchant_id 는 반드시 이 화이트리스트 Set 으로만 판별한다(AC-2.5).
//
// ── canonical SSOT ──────────────────────────────────────────────────────────
//   값 표준 = redpay_foot_terminal_registry.md §2/§8 27-set(EXPAND-0723GAP 285002 편입,
//   FOOT-CONFIRMED ADDITIVE). registry §8.2(a) 285002=풋2(VAN, TID 1047535843) ADDITIVE 확정.
//   redpay-reconcile/scope-filter.ts 의 FOOT_MERCHANT_SET/BODY_MERCHANT_SET 과 미러(동일 값).
//   drift-assert(scope-filter.regress.test.ts)가 reconcile↔_shared 값 정합을 봉인.
//   ⇒ ⛔ 'dohsu'/'dosu'(display alias) ⛔ 'body_rehab'(축오염). 재활도 center='body'.
//
// ── merchant_id/tid 판별 재사용 (TERMINAL-REGISTRY, T-20260711) ────────────────
//   본 화이트리스트는 단말기 레지스트리(redpay_terminal_registry)의 canonical 27-set 을
//   코드-레벨로 박제한 미러다. 신규 단말 추가 시 registry §2 갱신 → 이 Set 동기(중복 신설 금지).

/** 풋센터(서울오리진 종로 풋) 27-set merchant_id. FOOT-CONFIRMED ADDITIVE(26→27: EXPAND-0723GAP 285002 편입). */
export const FOOT_MERCHANT_SET: ReadonlySet<string> = new Set<string>([
  "1777285001", "1777285002", "1777285003", "1777285004", "1777285005",
  "1777285006", "1777285007", "1777285008", // VAN8 (285002=풋2, EXPAND-0723GAP 편입)
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
 *   foot 27-set → 'foot' / body 14-band → 'body' / 미등록 → 'unknown'.
 *   'unknown' 은 호출부가 Slack 알림 + 미적재로 처리(AC-2.5).
 */
export function centerForMerchant(merchantId: string | null | undefined): MerchantCenter {
  return centerForMerchantWithSet(merchantId, FOOT_MERCHANT_SET);
}

// ── A안 (T-20260728-foot-REDPAY-WEBHOOK-ALLOWLIST-RUNTIME-ALIGN) ────────────────
//   웹훅 EF 허용목록(foot admit)을 컴파일타임 상수(code-shadow) → DB redpay_terminal_registry
//   런타임 조회로 정렬해 폴러(loadRegistryFromDb)·워치독과 소스 통일한다.
//   ★admit 권위 키 = merchant_id (TID 아님). registry 는 UNIQUE(merchant_id) 보유.
//   ★fail-open 의무: registry 미가용/빈결과 시 컴파일타임 FOOT_MERCHANT_SET 로 graceful
//     fallback — admit 전면차단 금지(전환이 새 침묵/유실을 만들면 안 됨). union 은 static floor 를
//     절대 축소하지 않으므로 registry 실패 시에도 현행과 동치(under-admit 0).

export interface FootMerchantResolution {
  /** 유효 admit set = registry ∪ FOOT_MERCHANT_SET(fail-open floor), 또는 registry 미가용 시 static. */
  set: ReadonlySet<string>;
  /** 'registry-union' = registry 실적재 소스 정렬 성공 / 'fallback-static' = fail-open(registry 미가용·빈결과). */
  source: "registry-union" | "fallback-static";
  /** registry 에서 로드된 foot merchant_id 개수(fallback 이면 0). */
  registryCount: number;
}

/**
 * registry foot merchant_id 목록 → 유효 admit set 파생 (순수함수, self-test 대상).
 *   유효 set = registry(domain=foot,active) merchant_id ∪ FOOT_MERCHANT_SET(static floor).
 *   - registry 결과가 null/빈배열 → { set: FOOT_MERCHANT_SET, source:'fallback-static' } = 현행 동치(fail-open).
 *   - registry 결과 존재 → union. static floor 는 절대 빠지지 않음 → registry 가 부분적이어도 under-admit 0.
 *   - union 은 foot 도메인 내부만 확장(registry domain=foot·FOOT_MERCHANT_SET 모두 foot) → cross-tenant over-admit 0.
 */
export function deriveFootMerchantSet(
  registryMerchantIds: readonly (string | null | undefined)[] | null | undefined,
): FootMerchantResolution {
  const reg = new Set<string>();
  for (const m of registryMerchantIds ?? []) {
    const s = (m ?? "").trim();
    if (s) reg.add(s);
  }
  if (reg.size === 0) {
    // fail-open: registry 미가용/빈결과 → 컴파일타임 set 유지(현행 100% 동일 동작).
    return { set: FOOT_MERCHANT_SET, source: "fallback-static", registryCount: 0 };
  }
  const union = new Set<string>(FOOT_MERCHANT_SET); // static floor 선주입(축소 불가)
  for (const m of reg) union.add(m);
  return { set: union, source: "registry-union", registryCount: reg.size };
}

/**
 * merchant_id → center 판별(런타임 foot set 주입판, 문자열 파싱 금지).
 *   foot admit = 주입된 footSet(=registry∪static, A안) / body drop = 컴파일타임 BODY_MERCHANT_SET / 그 외 unknown.
 *   ※ body 는 admit 이 아니라 '타 센터 drop(노이즈 억제)' 용도라 컴파일타임 set 유지 —
 *     cross-domain(body) registry 런타임 read 를 도입하지 않아 foot EF 의 도메인 격리·DA CONSULT 면제를 보존한다.
 */
export function centerForMerchantWithSet(
  merchantId: string | null | undefined,
  footSet: ReadonlySet<string>,
): MerchantCenter {
  const mid = (merchantId ?? "").trim();
  if (mid === "") return "unknown";
  if (footSet.has(mid)) return "foot";
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
