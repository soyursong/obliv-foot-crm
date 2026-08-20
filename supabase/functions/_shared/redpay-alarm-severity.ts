// _shared/redpay-alarm-severity.ts — 레드페이 알람 3등급 심각도 정책 SSOT (순수 로직 모듈)
//
// T-20260820-foot-ALARM-SEVERITY-3TIER-POLICY (P1, 최필경 총괄 · U05L6HE7QF6, field-authority)
//   지시: "앞으로 전 알람 이 정책 기준 적용." — 심각치 않은 알람의 5분 주기 반복(하루 288개)이
//   정작 심각한 알람을 매몰 → 심각도 3등급으로 나눠 즉시 알림의 신호대잡음비 회복. 기존 5분 반복 폐지.
//
//   ★이 모듈은 발화 정책의 SSOT — 발화지점(webhook non2xx / 미등록회선 / reconcile 미매칭·금액불일치 /
//     watchdog 수집멈춤 / bizno 0건 / stats 추세)이 분류·반복규칙을 여기서만 참조한다(divergence 금지).
//
// ── 3등급 매핑 (확정 스펙, 티켓 본문 매핑표) ─────────────────────────────────────
//   1 즉시(IMMEDIATE)  : 결제승인 불명 / 이중결제 의심 / 수집 완전멈춤(6h+) / 사업자번호 0건조회 /
//                        ★미등록 회선 + 실거래 발생(돈 새는 중)
//   2 일일요약(DAILY)  : 미등록 회선 목록(실거래0) / 미매칭 건수 / 금액 불일치 건 (아침 1회 다이제스트)
//   3 주간요약(WEEKLY) : 통계·추세 (주 1회)
//
// ── 반복 규칙 (전 등급 공통 — 즉시등급 포함) ─────────────────────────────────────
//   #1 같은 건은 최초 1회만 알림.
//   #2 상태가 바뀔 때 1회 (미해결 → 실거래 발생 / 해결됨).
//   #3 해결되면 "해결됨" 한 줄로 종료.
//   ★ '즉시=억제 없음' 오구현 금지 — 즉시등급도 dedup(최초1회)+상태전이 트리거를 적용한다.
//
// ── db_change=false ───────────────────────────────────────────────────────────
//   상태 마킹은 in-memory(EF 인스턴스 단위 best-effort) / 운영 state 파일·env 로 유지.
//   DB 테이블로 저장 시 db_change=true 재판정 + MIG-GATE 필요 — 본 모듈은 순수 로직만.

// ── 등급 ────────────────────────────────────────────────────────────────────────
export enum AlarmTier {
  IMMEDIATE = 1, // 즉시 발화
  DAILY = 2,     // 아침 1회 일일요약
  WEEKLY = 3,    // 주 1회 주간요약
}

// ── 알람 종류 (발화지점이 사용하는 canonical kind) ────────────────────────────────
export type AlarmKind =
  // ── 1등급 즉시 (5항목) ──
  | "payment_approval_unknown"    // 결제 승인 여부 불명 (무응답·C011·8003·8555)
  | "double_payment_suspected"    // 이중 결제 의심
  | "ingestion_full_stop"         // 수집 완전 멈춤 (6h+)
  | "bizno_zero_result"           // 사업자번호 오류 → 0건 조회
  | "unregistered_line_live_txn"  // ★미등록 회선 + 실거래 발생 (돈 새는 중)
  // ── 2등급 일일요약 (3항목) ──
  | "unregistered_line"           // 미등록 회선 목록 (실거래0)
  | "unmatched_count"             // 미매칭 건수
  | "amount_mismatch"             // 금액 불일치 건
  // ── 3등급 주간요약 ──
  | "stats_trend";                // 통계·추세

/** 1등급(즉시) 5항목 — 강등 회귀가드의 권위 목록. 이 집합은 절대 2/3등급으로 강등 금지. */
export const TIER1_KINDS: readonly AlarmKind[] = Object.freeze([
  "payment_approval_unknown",
  "double_payment_suspected",
  "ingestion_full_stop",
  "bizno_zero_result",
  "unregistered_line_live_txn",
]);

/** 2등급(일일요약) 3항목. */
export const TIER2_KINDS: readonly AlarmKind[] = Object.freeze([
  "unregistered_line",
  "unmatched_count",
  "amount_mismatch",
]);

/** 3등급(주간요약). */
export const TIER3_KINDS: readonly AlarmKind[] = Object.freeze([
  "stats_trend",
]);

const _TIER_BY_KIND: Record<AlarmKind, AlarmTier> = {
  payment_approval_unknown:   AlarmTier.IMMEDIATE,
  double_payment_suspected:   AlarmTier.IMMEDIATE,
  ingestion_full_stop:        AlarmTier.IMMEDIATE,
  bizno_zero_result:          AlarmTier.IMMEDIATE,
  unregistered_line_live_txn: AlarmTier.IMMEDIATE,
  unregistered_line:          AlarmTier.DAILY,
  unmatched_count:            AlarmTier.DAILY,
  amount_mismatch:            AlarmTier.DAILY,
  stats_trend:                AlarmTier.WEEKLY,
};

/** 알람 종류 → 등급. 미정의 kind 는 fail-safe 로 IMMEDIATE(매몰 금지 — 놓치느니 울린다). */
export function classifyAlarm(kind: AlarmKind): AlarmTier {
  const tier = _TIER_BY_KIND[kind];
  if (tier == null) {
    // 알 수 없는 kind = 등급 미상 → 매몰 위험 회피(fail-loud): 즉시로 취급.
    return AlarmTier.IMMEDIATE;
  }
  return tier;
}

// ── ★ 핵심 등급 경계 (GO_WARN 크럭스) ───────────────────────────────────────────
//   같은 "미등록 회선"이라도 실거래 유무로 등급이 바뀐다.
//     실거래0        → 2등급(일일요약) : "unregistered_line"
//     실거래 발생    → 1등급(즉시)     : "unregistered_line_live_txn" (돈 새는 중)
//   반복규칙 #2(상태전이 미해결→실거래발생)가 이 승격을 담당.

/**
 * 실거래(live transaction) 판정 — 미등록 회선 위에서 실제 돈이 움직였는가.
 *   실거래 = 실제 금전 이벤트(approved/cancelled) & 금액 > 0.
 *   introspection·0원·미지원 이벤트(GET 프로브·설치검증 net0 등)는 실거래 아님(실거래0).
 *   ★부호로 판별 금지(취소도 amount 양수) — kind 로 이벤트 실체 판별 후 금액 양수만 확인.
 */
export function isLiveTransaction(
  eventKind: "approved" | "cancelled" | "unsupported" | null | undefined,
  amount: number | string | null | undefined,
): boolean {
  if (eventKind !== "approved" && eventKind !== "cancelled") return false;
  const amt = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  return Number.isFinite(amt) && amt > 0;
}

/**
 * 미등록 회선 알람의 등급 경계 판정.
 *   hasLiveTransaction=true  → IMMEDIATE (돈 새는 중, unregistered_line_live_txn)
 *   hasLiveTransaction=false → DAILY     (미등록 회선 목록, unregistered_line)
 */
export function classifyUnregisteredLine(hasLiveTransaction: boolean): {
  kind: AlarmKind;
  tier: AlarmTier;
} {
  const kind: AlarmKind = hasLiveTransaction ? "unregistered_line_live_txn" : "unregistered_line";
  return { kind, tier: classifyAlarm(kind) };
}

/**
 * 강등 회귀가드 — 1등급 5항목이 2/3등급으로 강등되면 throw (AC1).
 *   호출측(발화지점)이 등급을 계산한 직후 자기검증에 사용. 배포 전 회귀테스트가 전 tier1 kind 를 검증.
 */
export function assertNoDowngrade(kind: AlarmKind, resolvedTier: AlarmTier): void {
  if (TIER1_KINDS.includes(kind) && resolvedTier !== AlarmTier.IMMEDIATE) {
    throw new Error(
      `[redpay-alarm-severity] 강등 금지 위반: 1등급 알람 '${kind}' 이(가) ${resolvedTier}등급으로 강등됨. ` +
        `1등급 5항목은 절대 요약/로그로 강등할 수 없다(심각 알람 매몰 방지).`,
    );
  }
}

// ── 발화 cadence 기술자 (AC2·AC3 — 발화지점/스케줄러가 참조) ──────────────────────
export interface CadenceSpec {
  tier: AlarmTier;
  /** 발화 방식 사람이 읽는 라벨. */
  label: string;
  /** 스케줄 성격: 이벤트 즉시 / 일 1회 / 주 1회. */
  schedule: "on_event" | "daily_digest" | "weekly_digest";
}

export const CADENCE: Record<AlarmTier, CadenceSpec> = {
  [AlarmTier.IMMEDIATE]: { tier: AlarmTier.IMMEDIATE, label: "즉시 발화",           schedule: "on_event" },
  [AlarmTier.DAILY]:     { tier: AlarmTier.DAILY,     label: "아침 1회 일일요약",   schedule: "daily_digest" },
  [AlarmTier.WEEKLY]:    { tier: AlarmTier.WEEKLY,    label: "주 1회 주간요약",     schedule: "weekly_digest" },
};

// ── 반복 규칙 상태 기계 (전 등급 공통 — AC4) ─────────────────────────────────────
//   #1 최초 1회 / #2 상태전이 1회 / #3 해결 시 "해결됨" 한 줄 종료.

export type AlarmLifecycle = "none" | "open" | "resolved";

export interface AlarmRecord {
  state: AlarmLifecycle;
  /** 마지막으로 발화한 상태 서명(signature). 값이 바뀌면 = 상태전이 → 재발화 1회. */
  signature: string;
}

export type FireKind = "initial" | "transition" | "resolved" | "suppressed";

export interface FireDecision {
  fire: boolean;
  kind: FireKind;
  /** 갱신된 상태 레코드(호출측이 다음 판정을 위해 저장). */
  next: AlarmRecord;
}

export interface AlarmEvent {
  /** 알람 식별 키(회선/원인 단위). 예: `unreg:${merchant}::${tid}` · `non2xx:${status}:${reason}`. */
  key: string;
  /**
   * 상태 서명 — 같은 key 라도 이 값이 바뀌면 상태전이(#2)로 간주해 1회 재발화.
   *   미등록회선 승격은 signature 를 "live_txn" 으로 바꿔 미해결→실거래발생 전이를 표현.
   */
  signature: string;
  /** true = 이 이벤트가 "해결됨" 신호(#3). */
  resolved?: boolean;
}

const _EMPTY: AlarmRecord = Object.freeze({ state: "none", signature: "" });

/**
 * 반복규칙 판정(순수 함수, nowMs 불필요 — 시간창 아닌 상태기반).
 *   prev 없거나 none/resolved 상태 + 미해결 이벤트 → initial 발화(#1).
 *   open 상태 + signature 변경 → transition 발화(#2, 미해결→실거래발생 승격 포함).
 *   open 상태 + signature 동일 → suppressed(#1: 최초 1회만).
 *   해결 이벤트 + open → resolved 발화(#3, "해결됨" 한 줄) → resolved 상태로 종료.
 *   해결 이벤트 + open 아님(이미 해결/미개시) → suppressed(중복 "해결됨" 금지).
 */
export function decideAlarmFire(prev: AlarmRecord | undefined, ev: AlarmEvent): FireDecision {
  const p = prev ?? _EMPTY;

  if (ev.resolved) {
    if (p.state === "open") {
      return { fire: true, kind: "resolved", next: { state: "resolved", signature: ev.signature } };
    }
    return { fire: false, kind: "suppressed", next: p };
  }

  if (p.state !== "open") {
    // none / resolved → 신규 open (재발(재개)도 최초 1회로 취급).
    return { fire: true, kind: "initial", next: { state: "open", signature: ev.signature } };
  }

  // 이미 open.
  if (p.signature !== ev.signature) {
    return { fire: true, kind: "transition", next: { state: "open", signature: ev.signature } };
  }
  return { fire: false, kind: "suppressed", next: p };
}

/**
 * 반복규칙 게이트 팩토리 — 모듈 스코프 상태(EF 인스턴스 단위 best-effort, in-memory).
 *   makeDedup(비교: 시간창 rate-limit)과 달리 상태기반(최초1회+전이+해결). db_change=false.
 *   운영상 EF 콜드스타트로 상태가 휘발될 수 있음 → 지속 상태가 필요한 등급(2/3)은
 *   cron digest EF(redpay-unreg-digest 등)가 DB accumulate 를 SSOT 로 삼아 보완한다.
 */
export function makeAlarmRepeatGate() {
  const records = new Map<string, AlarmRecord>();
  return function decide(ev: AlarmEvent): FireDecision {
    const d = decideAlarmFire(records.get(ev.key), ev);
    records.set(ev.key, d.next);
    return d;
  };
}
