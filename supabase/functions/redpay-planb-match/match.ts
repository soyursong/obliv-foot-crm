// redpay-planb-match/match.ts — 선점 매칭 순수 로직 모듈 (단위테스트 대상)
//
// T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX (최필경 총괄, 스레드 1785285157.831119)
//   부모 T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD(deployed, flag OFF) 의 매칭 설계를
//   reporter 명시 정정 3🔴 로 supersede. Supabase/Deno 런타임 의존은 index.ts 에 격리하고,
//   검증 가능한 순수 매칭 로직만 여기 둔다(redpay-webhook/verify.ts, redpay-reconcile/guard.ts 동일 패턴).
//
// ── 정정 반영 요약 ────────────────────────────────────────────────────────────
//   · (정정2) 매칭 시간 키 = occurred_at(승인시각). redpay_raw_transactions.approved_at 컬럼에 영속
//     (웹훅 buildWebhookRawRow: data.approved_at ?? envelope.occurred_at → approved_at / 폴러도 approved_at 세팅).
//     유효창 판정 = approved_at ∈ [pending.created_at, pending.expires_at]  (expires_at = created_at + 5분).
//     웹훅 도착시각(received_at)은 매칭 판정에서 완전히 제거 → 웹훅 지연이 유효창을 잠식하지 않음.
//   · (정정2 파라미터 2분리) 선점 유효창(5분, 위 window) / 선점표 보관 기간(1시간, 아래 retention) 분리.
//     만료(status='expired')된 선점도 만료 후 1시간(RETENTION_MS) 내이면 MATCH 후보 유지 → late 웹훅(재시도 1/5/30분) 자동연결.
//     1시간 초과분은 후보에서 자연 제외(시간 필터). 행 즉시삭제 없음(status='expired' 보존 → 미배정 유입지표 정합).
//   · (정정3) 매칭 대상 = 승인(external_status='Y' == event_type=payment.approved) 한정.
//     cancelled/refunded(external_status N/M/X, cancelled_at 세팅)는 매칭 제외 → 기존 취소 대사 경로(redpay-reconcile).
//     ⚠ 취소 raw 도 approved_at 이 세팅될 수 있음(원 승인시각 보존) → approved_at NOT NULL 만으로는 불충분,
//        external_status='Y' 가 승인 판별의 1급 게이트(결제후즉시취소 양수 2건 오연결 차단).

// ── 정책 상수 (SSOT mirror: src/lib/redpayPlanbTtl.ts) ─────────────────────────
//   EF 는 TS lib 를 import 할 수 없어 값을 미러한다(divergence 방지 위해 주석에 SSOT 명시).
//   · 선점 유효창 = pending.expires_at 컬럼(app-set = created_at + 5분, redpayPlanbTtl.REDPAY_PLANB_AUTO_CONNECT_MIN)을 그대로 사용(EF 재복제 없음).
//   · 선점표 보관 기간 = 만료 후 1시간(REDPAY_PLANB_RETENTION_MIN=60).
export const RETENTION_MS = 60 * 60 * 1000; // 1h — 선점표 보관 기간(late 웹훅 매칭 후보 보관 창).

export interface PendingRow {
  id: string;
  clinic_id: string;
  expected_amount: number;
  created_at: string; // ISO
  expires_at: string; // ISO (app-set = created_at + 5분)
  status: string;     // open | matched | expired | failed | cancelled
  // T-20260730-...-SINGLE-RPC-GOLIVE: auto-create(경로A) RPC 호출용 귀속 필드(순수 매칭 로직 미사용).
  customer_id?: string | null;
  check_in_id?: string | null;
}

export interface RawRow {
  id: string;
  clinic_id: string | null;
  amount: number | null;
  approved_at: string | null;       // occurred_at(승인시각). 매칭 시간 키.
  external_status?: string | null;  // Y=승인 N=취소 M=부분취소 X=오류
  received_at?: string | null;      // 웹훅 수신시각(관측용, 매칭 판정 미사용).
}

/**
 * 승인 raw 판별 (정정3 AC-3).
 *   external_status='Y'(=event_type payment.approved) 가 승인 판별의 1급 게이트.
 *   cancelled/refunded(N/M/X)는 approved_at 이 세팅돼 있어도 제외 → 결제후즉시취소(양수 2건) 오연결 차단.
 *   amount>0 + approved_at(occurred_at) 존재는 매칭 필수 조건(시간 키 부재 시 매칭 불가).
 */
export function isApprovedRaw(raw: RawRow): boolean {
  return (
    raw.external_status === "Y" &&
    raw.approved_at != null &&
    raw.amount != null &&
    Number(raw.amount) > 0
  );
}

/**
 * 유효창 판정 (정정2 AC-1).
 *   occurred_at(승인시각) ∈ [pending.created_at, pending.expires_at]  (닫힌 구간, expires_at=created_at+5분).
 *   ISO8601(UTC, 동일 포맷) 문자열은 사전식 비교 = 시각 비교와 동치(웹훅/폴러 모두 toISOString UTC 저장).
 */
export function isWithinValidWindow(
  createdAtIso: string,
  expiresAtIso: string,
  occurredAtIso: string | null,
): boolean {
  if (!occurredAtIso) return false;
  const t = Date.parse(occurredAtIso);
  const lo = Date.parse(createdAtIso);
  const hi = Date.parse(expiresAtIso);
  if (Number.isNaN(t) || Number.isNaN(lo) || Number.isNaN(hi)) return false;
  return t >= lo && t <= hi;
}

/**
 * 보관창 경계 판정 (정정2 AC-2).
 *   만료된 선점표가 '만료 후 retention(1h)' 이내인가? → true 면 MATCH 후보 유지.
 *   candidate ⟺ now < expires_at + retention ⟺ expires_at > now - retention.
 *   (유효 open 선점: expires_at > now > now-retention → 항상 true. 만료 후 1h 초과: false.)
 */
export function isWithinRetention(
  expiresAtIso: string,
  nowIso: string,
  retentionMs: number = RETENTION_MS,
): boolean {
  const exp = Date.parse(expiresAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(exp) || Number.isNaN(now)) return false;
  return exp > now - retentionMs;
}

/** MATCH 후보 pending 을 supabase 쿼리 없이 판별할 때 쓰는 보관창 cutoff(now - retention) ISO. */
export function retentionCutoffIso(
  nowIso: string,
  retentionMs: number = RETENTION_MS,
): string {
  return new Date(Date.parse(nowIso) - retentionMs).toISOString();
}

/**
 * autoCancel 대상 판정 (T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #4).
 *   ★match-before-cancel: 이 판정은 matchPass '이후' autoCancelPass 에서만 소비 —
 *     보관창(retention, 1h) '초과'한 미매칭 선점만 대상. 보관창 내(late 웹훅 매칭 여지)면 절대 취소하지 않는다.
 *   조건: expires_at <= now - retention  (= !isWithinRetention 의 여집합, 동일 컷오프 SSOT).
 *   호출부(index.ts)는 여기에 status ∈ {expired, failed} 필터를 추가로 강제(승인/매칭 완료 건 무접촉).
 *   경계: expires_at == now-retention 도 취소 대상(보관창 딱 종료). isWithinRetention 의 경계(exp > now-retention)와 상보.
 */
export function isAutoCancelTarget(
  expiresAtIso: string,
  nowIso: string,
  retentionMs: number = RETENTION_MS,
): boolean {
  const exp = Date.parse(expiresAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(exp) || Number.isNaN(now)) return false;
  return exp <= now - retentionMs;
}

/** (clinic_id, expected_amount) 그룹핑 — 2건+ 은 모호(자동매칭 제외). */
export function groupPendingByAmount(pendings: PendingRow[]): Map<string, PendingRow[]> {
  const groups = new Map<string, PendingRow[]>();
  for (const p of pendings) {
    const k = `${p.clinic_id}::${p.expected_amount}`;
    const bucket = groups.get(k);
    if (bucket) bucket.push(p);
    else groups.set(k, [p]);
  }
  return groups;
}

/**
 * 단일 pending 선점에 대한 후보 raw 선택.
 *   조건: 같은 clinic + 동일 금액 + 승인 raw(isApprovedRaw) + occurred_at 유효창 + 미소비.
 *   정렬: 가장 이른 승인시각(approved_at asc) 우선.
 *   반환: 최우선 후보 또는 null.
 */
export function selectCandidateRaw(
  pending: PendingRow,
  raws: RawRow[],
  used: Set<string>,
): RawRow | null {
  const candidates = raws
    .filter((r) =>
      r.clinic_id === pending.clinic_id &&
      r.amount != null &&
      Number(r.amount) === Number(pending.expected_amount) &&
      isApprovedRaw(r) &&
      isWithinValidWindow(pending.created_at, pending.expires_at, r.approved_at) &&
      !used.has(r.id)
    )
    .sort((a, b) => (String(a.approved_at) < String(b.approved_at) ? -1 : 1));
  return candidates[0] ?? null;
}
