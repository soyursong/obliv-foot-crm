// redpay-reconcile/scope-filter.ts — 풋 스코프 필터(ingest-time merchant-drop) + center 파생 (순수 모듈)
//
// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트A (Q1=ingest-drop GO, DA CONSULT-REPLY 2026-07-24)
//   [배경] 부모 T-20260724-foot-REDPAY-DAY1-RECONCILE 포렌식이 도수(비풋) leak 1건
//     (approval_no 62071914, merchant_id 1777276003, 2행)을 확정. 근본 벡터 = redpay-reconcile 폴러
//     경로의 filterToFootScope 가 **TID 화이트리스트만** 보고 merchant_id 도메인 경계 drop 을 안 함
//     (tidWhitelist 비면 pass-through). webhook EF(centerForMerchant→unknown/body drop)·macstudio
//     poller(.mjs, merchant_id 1차 권위 drop)와 **필터 parity 비대칭** → 도수 신호 유입.
//   [조치] filterToFootScope 를 poller/.mjs·webhook 과 **동일 semantic** 으로 정합:
//     merchant_id allowlist(FOOT_MERCHANT_SET) = 1차 권위(도메인 경계), TID = belt-and-suspenders 보조,
//     merchant 값 부재(레거시/이상행) 시에만 TID 폴백(행 유실 방지). → 도수/비풋 merchant 는 ingest 前 drop.
//
//   ▸ 순수 모듈(Deno.env 미접근) → `deno test` 로 직접 import 가능(index.ts 는 top-level env read 로 import 불가).
//     drift-assert 회귀 가드(scope-filter.regress.test.ts)가 이 모듈의 merchant set 을
//     _shared/redpay-foot-merchants.ts SSOT 와 대조(Q3 단일SSOT 정합 + divergence 감지).
//
// ── canonical SSOT (registry §2 미러) ─────────────────────────────────────────
//   값 표준 = redpay_foot_terminal_registry.md §2/§8 27-set(EXPAND-0723GAP 285002 편입,
//   FOOT-CONFIRMED ADDITIVE). registry §8.2(a) 285002=풋2(VAN, TID 1047535843) ADDITIVE 확정 편입분.
//   _shared/redpay-foot-merchants.ts (webhook path) 와 동일 값 미러. reconcile 의 _shared 수렴은
//   별도 통합 티켓(현행 유지). drift-assert 테스트로 divergence 를 봉인.
//   ⇒ ⛔ 'dohsu'/'dosu'(display alias) ⛔ 'body_rehab'(축오염). 재활도 center='body'.

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

/** 도수(재활, body) 14-band merchant_id. foot reconcile 관점에서는 '타 센터' → drop. */
export const BODY_MERCHANT_SET: ReadonlySet<string> = new Set<string>([
  "1777274001",
  "1777275001", "1777275002", "1777275003", "1777275004",
  "1777275005", "1777275006", "1777275007", "1777275008",
  "1777276001", "1777276002", "1777276003", "1777276004", "1777276005",
]);

/** raw_payload.merchant.id 추출 → 안전 문자열. 부재 시 null. (DB row 용) */
export function merchantIdOf(rawPayload: unknown): string | null {
  const m = (rawPayload as { merchant?: { id?: unknown } } | null | undefined)?.merchant?.id;
  return m != null && `${m}`.trim() !== "" ? `${m}`.trim() : null;
}

/** RedPay 트랜잭션(ingest item).merchant.id 추출 → 안전 문자열. 부재 시 null. */
export function merchantIdOfTrx(
  t: { merchant?: { id?: unknown } | null } | null | undefined,
): string | null {
  const m = t?.merchant?.id;
  return m != null && `${m}`.trim() !== "" ? `${m}`.trim() : null;
}

/**
 * raw 트랜잭션(merchant band) → center 명시 파생.
 *   body 14-band → 'body' / foot 27-set → 'foot' / 미분류 → 'foot' 폴백 + WARN 표면화(silent 금지, registry §6).
 */
export function centerForRawRow(
  raw: { raw_payload?: unknown } | null | undefined,
): "foot" | "body" {
  const mid = merchantIdOf(raw?.raw_payload);
  if (mid && BODY_MERCHANT_SET.has(mid)) return "body";
  if (mid && FOOT_MERCHANT_SET.has(mid)) return "foot";
  console.warn(
    `[redpay-reconcile][center] 미분류 merchant(id=${mid ?? "∅"}) — center='foot' 폴백(표면화). ` +
    `신규 단말 후보면 registry(redpay_terminal_registry)에 등록 필요.`,
  );
  return "foot";
}

/** ingest item 최소 형태(구조적 타입). index.ts RedpayTransaction 가 구조적으로 만족. */
export interface ScopeItem {
  tid?: string | null;
  merchant?: { id?: unknown } | null;
}

/**
 * ★파트A 핵심 — 풋 도메인 스코프 ingest 필터 (merchant_id 1차 권위 피벗).
 *   poller(.mjs) filterToFootScope / webhook centerForMerchant 와 semantic 정합:
 *     · merchant_id ∈ FOOT_MERCHANT_SET  → keep  (1차 권위 = 도메인 경계)
 *     · merchant_id ∈ BODY_MERCHANT_SET  → drop  (도수/비풋 신호 차단 — 62071914 leak 벡터 봉인)
 *     · merchant_id 미등록(unknown)      → drop  (silent include 금지, registry §6)
 *     · merchant 값 아예 부재(mid==null) → TID 보조필터로만 폴백(레거시/이상행 유실 방지)
 *   drift = 자도메인 merchant 인정 + 미등록 TID → 신규 단말 후보(silent include 금지 → 호출부 알람).
 *   ⚠ tidWhitelist 가 비면(TID 스코프 비활성) merchant-only 스코핑(도수·TID 미상 정상 케이스).
 *
 *   [정정 이력] 구 filterToFootScope(index.ts, ~L1063)은 TID-only(비면 pass-through) → merchant 도메인
 *     경계 부재 = 도수 유입 벡터. 본 함수가 그 parity gap 을 닫는다(재발방지 근본).
 */
export function filterToFootScope<T extends ScopeItem>(
  items: T[],
  tidWhitelist: Set<string>,
): { kept: T[]; dropped: T[]; drift: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const drift: T[] = [];
  const tidScopeActive = tidWhitelist.size > 0; // TID 보조필터/drift 판정 활성 여부
  for (const it of items) {
    const mid = merchantIdOfTrx(it);
    const merchantOk = mid != null && FOOT_MERCHANT_SET.has(mid);            // 1차 권위(도메인 경계)
    const tidOk = tidScopeActive && it.tid != null && tidWhitelist.has(it.tid); // belt-and-suspenders 보조
    // merchant 가 권위. merchant 값이 아예 없을 때만 TID 보조필터로 폴백(tid 스코프 활성 시).
    const keep = merchantOk || (mid == null && tidOk);
    if (keep) {
      kept.push(it);
      // drift = merchant 인정 + 미등록 TID. tid 스코프 비활성 시엔 판정 억제(전건 오탐 방지).
      if (tidScopeActive && merchantOk && !tidOk) drift.push(it);
    } else {
      dropped.push(it);
    }
  }
  return { kept, dropped, drift };
}
