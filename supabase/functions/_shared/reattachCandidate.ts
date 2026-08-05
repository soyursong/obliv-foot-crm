// reattachCandidate.ts — 승인번호-NULL 수기수납 재부착 '후보검색만' 순수 로직 모듈
// ════════════════════════════════════════════════════════════════════════════════
// T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY (reporter 최필경, 스레드 1785911915.148039)
//   부모 T-20260805-foot-REDPAY-PLANA-REATTACH-DORMANTGAP-GUARD(deployed 08-05) = 음성게이트(auto-create 차단).
//   본 모듈 = 그 위 '양성 candidate-surfacing' — 가드가 auto-write 를 막는 동안, 그 후보를 사람에게 노출한다.
//
// ── 논리구멍(봉합 대상) ─────────────────────────────────────────────────────────
//   기존 자동재부착은 4키(승인번호 AUTHNO + 금액 TAMT + 일자 + 승인/취소구분 TRANTYPE)로 동일건을 판정한다.
//   그러나 '수기 영수증 수납'은 승인번호가 없음(external_approval_no IS NULL) → AUTHNO 축이 비어
//   4키 매칭이 성립 불가 → 항상 "다른 건"으로 판정 → 엉뚱하게 재부착됨(구멍).
//   3키(금액+일자+구분) 하향은 REJECT — 08-04 풋 승인 49건 중 34건(69%)이 동일 금액 하루 다건
//   (10,000원 9회 등) → 오탐 69%. 자동 하향 불가.
//
// ── 2-case 분기 (reporter 명시 스펙) ────────────────────────────────────────────
//   Case A (승인번호 有): 4키 자동매칭 → 기존 구현 그대로 유지(본 모듈 무관).
//   Case B (승인번호 無 수기): 금액 + 일자로 '후보검색만' → 자동연결 절대 금지(payment auto-write 0).
//     "이 수기 기록이 이 결제일 수 있습니다" 후보카드 표시 → 담당자 confirm 후 승인번호를 기존 수기행에 채움.
//     ★원칙: "의심건 리스트업까지만, 실제수정은 담당자". 시스템은 후보 제시까지, 확정 write 는 사람.
//     ★후보가 정확히 1건이어도 자동확정하지 않는다(candidate-only의 핵심 — reverseMatch 의 1건 auto-pick 과 대비).
//
// ── 왜 순수 함수 ────────────────────────────────────────────────────────────────
//   match.ts / reverseMatch.ts 동일 규율 — Supabase/Deno 런타임 의존 배제 → deno test 로 후보검색·
//   Case 분류·KST 일자 앵커·candidate-only(자동확정 없음)를 전수 검증. 실제 DB read/write(후보 pool 조회 +
//   담당자 confirm 시 기존행 UPDATE)는 호출부(index.ts 오케스트레이션)가 이 모듈 판정대로 수행한다.

/** 수기수납 후보(payments 조회행). Case B 판별 + 후보검색 앵커(금액·일자)에 필요한 최소 형태. */
export interface ManualReceiptRow {
  id: string;
  clinic_id: string;
  amount: number | null;
  method?: string | null;                 // 'card' 만 대상(레드페이=VAN 카드).
  payment_type?: string | null;           // 'payment' 만 대상(refund 제외).
  status?: string | null;                 // 'active' ...
  deleted_at?: string | null;
  external_approval_no?: string | null;   // NULL = 승인번호 없음(Case B 필수 조건).
  payment_attempt_id?: string | null;     // NULL = non-CAT 수기수납(CAT-origin 아님).
  reconciled_at?: string | null;          // NULL = 아직 대사·연결 안 됨(후보검색 대상).
  accounting_date?: string | null;        // 'YYYY-MM-DD' (KST 회계귀속일). 없으면 created_at KST 폴백.
  created_at?: string | null;             // ISO. accounting_date 부재 시 일자 앵커 폴백.
}

/** 후보 raw(redpay_raw_transactions 조회행) — 승인번호를 가진 승인 raw. */
export interface CandidateRaw {
  id: string;
  clinic_id: string;
  amount: number | null;
  approved_at: string | null;             // 승인시각(occurred_at). KST 일자 앵커.
  external_status?: string | null;        // 'Y'=승인 (N/M/X=취소·부분취소·오류 → 제외).
  matched_payment_id?: string | null;     // NULL = 미매칭(연결 가능 후보).
  approval_no?: string | null;            // ★NOT NULL 필수 — Case B 수기행에 채워질 승인번호.
  external_trxid?: string | null;         // 담당자 표시/annotate 승격용(corroborator).
  tid?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

/** raw 관측모드(_mode='observe') 판별 — 실 승격 금지(reverseMatch.isObserveRaw 동치). */
export function isObserveCandidate(
  raw: { raw_payload?: Record<string, unknown> | null } | null | undefined,
): boolean {
  const m = raw?.raw_payload?._mode;
  return typeof m === "string" && m.trim().toLowerCase() === "observe";
}

/**
 * UTC ISO → Asia/Seoul(UTC+9) 달력일 'YYYY-MM-DD'.
 *   reverseMatch.anchorAccountingDateKst / match.kstAccountingDate 동치(divergence 방지).
 */
export function kstDateStr(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 수기수납의 일자 앵커(KST 'YYYY-MM-DD').
 *   accounting_date(회계귀속일) 우선, 없으면 created_at 의 KST 달력일 폴백.
 *   후보검색의 '날짜' 키 — raw.approved_at 의 KST 일자와 동치 비교한다.
 */
export function receiptAccountingDate(receipt: ManualReceiptRow): string | null {
  if (receipt.accounting_date) return receipt.accounting_date;
  return kstDateStr(receipt.created_at ?? null);
}

/**
 * Case B(승인번호 없는 수기 건) 판별 — 후보검색 대상 여부.
 *   card + payment(환불 아님) + 활성 + 미삭제 + external_approval_no IS NULL(승인번호 없음)
 *   + payment_attempt_id IS NULL(non-CAT 수기수납) + reconciled_at IS NULL(아직 미연결).
 *   ★external_approval_no 가 있으면 Case A(4키 자동매칭 기존경로) → false(본 모듈 무관).
 */
export function isCaseBReceipt(receipt: ManualReceiptRow): boolean {
  return (
    (receipt.method ?? "card") === "card" &&
    (receipt.payment_type ?? "payment") === "payment" &&
    (receipt.status ?? "active") === "active" &&
    receipt.deleted_at == null &&
    receipt.amount != null &&
    Number(receipt.amount) > 0 &&
    receipt.external_approval_no == null &&   // ★승인번호 없음 = Case B 핵심
    receipt.payment_attempt_id == null &&     // non-CAT 수기수납(CAT-origin 아님)
    receipt.reconciled_at == null             // 아직 연결 안 됨
  );
}

/**
 * 승인번호 있는 승인 raw 판별 — 후보 자격.
 *   external_status='Y'(승인) + approved_at 존재 + amount>0 + approval_no NOT NULL + 미매칭 + non-observe.
 *   ★approval_no NOT NULL 이 candidate 의 1급 조건 — 담당자 confirm 시 이 승인번호를 수기행에 채운다.
 */
export function isEligibleCandidateRaw(raw: CandidateRaw): boolean {
  return (
    raw.external_status === "Y" &&
    raw.approved_at != null &&
    raw.amount != null &&
    Number(raw.amount) > 0 &&
    raw.approval_no != null &&
    String(raw.approval_no).trim() !== "" &&
    raw.matched_payment_id == null &&
    !isObserveCandidate(raw)
  );
}

/**
 * Case B 수기수납 1건에 대한 후보검색 (AC-B1/AC-B2 핵심).
 *   조건: 같은 clinic + 동일 금액(완전일치) + 동일 일자(KST) + 승인번호 있는 미매칭 승인 raw.
 *   ★자동연결 절대 금지 — 후보가 0/1/N 건이든 '선택'하지 않고 후보 목록만 반환한다(candidate-only).
 *     (reverseMatch.selectReverseMatchCandidate 는 1건이면 auto-pick, 2건+면 스킵 — 본 함수는 1건도 auto-pick 안 함.)
 *   정렬: 가장 이른 승인시각(approved_at asc) 우선 — 담당자 판단 편의(자동확정 아님).
 *
 * @param receipt Case B 수기수납행(호출부가 isCaseBReceipt 로 사전 필터).
 * @param raws    미매칭 승인 raw 후보 pool(같은 clinic·같은 일자 범위 조회 권장).
 * @returns 일치 후보 raw 배열(0건이면 빈 배열 = "후보 없음", 자동생성 금지).
 */
export function selectReattachCandidates(
  receipt: ManualReceiptRow,
  raws: CandidateRaw[],
): CandidateRaw[] {
  const acctDate = receiptAccountingDate(receipt);
  if (acctDate == null || receipt.amount == null) return [];
  const amt = Number(receipt.amount);
  return raws
    .filter((r) =>
      r.clinic_id === receipt.clinic_id &&
      r.amount != null &&
      Number(r.amount) === amt &&
      isEligibleCandidateRaw(r) &&
      kstDateStr(r.approved_at) === acctDate
    )
    .sort((a, b) => (String(a.approved_at ?? "") < String(b.approved_at ?? "") ? -1 : 1));
}

/**
 * 담당자 confirm 유효성 재검증 (서버측 write 진입 前 게이트).
 *   클라가 넘긴 (payment_id, raw_id) 를 서버 진실로 재확인 — receipt 는 여전히 Case B 이고,
 *   chosen raw 는 그 receipt 의 유효 후보(금액·일자·승인번호·미매칭)여야 한다.
 *   ★fabricate/guess-match 금지: 후보 집합에 없는 raw 로는 승인번호를 채우지 않는다(오연결 차단).
 * @returns 유효 시 chosen raw, 아니면 null(→ 호출부 no-op/거부).
 */
export function validateConfirmPair(
  receipt: ManualReceiptRow,
  chosenRawId: string,
  raws: CandidateRaw[],
): CandidateRaw | null {
  if (!isCaseBReceipt(receipt)) return null;
  const candidates = selectReattachCandidates(receipt, raws);
  return candidates.find((r) => r.id === chosenRawId) ?? null;
}
