// reverseMatch.ts — 레드페이 역방향 매칭([수납] 저장 훅) 순수 로직 모듈
// ════════════════════════════════════════════════════════════════════════════════
// T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD
//   SSOT = da_consult_reply_foot_redpay_reverse_match_susu_hook_20260730.md
//   decision_id = DA-20260730-FOOT-REDPAY-REVERSE-MATCH-SUSU-HOOK · verdict=GO · change-class=no-DDL
//   (precondition 실측 확정: payment_reconciliation_log.event_type CHECK 부재 → 자유텍스트 → 진성 no-DDL)
//
// ── 무엇 ──────────────────────────────────────────────────────────────────────
//   방향: 기존 forward 매처(raw→기존 payment, matcher.ts)의 거울상. 직원이 [수납] 저장으로 payment 를
//   남긴 시점(now), 그 직전 유효창(10분) 내 승인(external_status='Y') 되었으나 auto-match 를 놓쳐
//   matched_payment_id IS NULL 로 남은 redpay raw(reverse-miss)를 1건만 안전히 되찾아 연결한다.
//
// ── 왜 순수 함수 ────────────────────────────────────────────────────────────────
//   matcher.ts / match.ts 동일 규율 — Supabase/Deno 런타임 의존 배제 → deno test 로 후보선택·유효창·
//   모호성 스킵·앵커일자 계산·멱등 claim payload 를 전수 검증. 실제 DB write(claim UPDATE rows-affected
//   가드 + payment annotate + reconciliation_log INSERT)는 호출부(오케스트레이션 레이어)가 이 모듈의
//   판정 결과대로 수행한다.
//
// ── DA 착수 AC 매핑 ─────────────────────────────────────────────────────────────
//   AC1  트리거=[수납] 저장 1회 pass, 대상=matched_payment_id IS NULL 승인 후보, 후보없음/모호=no-op.
//   AC2  payments 귀속 불변 — method='card'(prod 실측: pg_provider 컬럼 부재, RedPay-ness=method+external_*).
//        'external'/'manual' 개념은 foot payments 에 컬럼 자체가 없음 → 해당 없음(불변식 자동 충족).
//   AC4  ★매출-일자 앵커 = raw.approved_at(승인시각)의 KST 일자. 감지·저장 시각 아님(late-arrival 일경계 drift).
//        anchorAccountingDateKst() 가 approved_at → KST YYYY-MM-DD 를 계산(matcher.toKstDateStr 동치).
//   AC5  멱등 = raw.id 원자 claim(UPDATE...WHERE matched_payment_id IS NULL, rows-affected=1). trxid 단독키 금지.
//   AC6/E-2  오연결 방지 4조건: ①승인만 ②금액 완전일치 ③같은금액 창내 2건↑→스킵 ④raw.id 앵커(단독 trxid 금지).
//   AC9  single-matcher-per-event — 저장 핸들러당 selectReverseMatchCandidate 1회 호출.
//
// ── forward 매처(match.ts)와의 대칭 ────────────────────────────────────────────
//   forward: pending(예상금액) 하나에 대해 raw 후보들에서 1건 선택, (clinic,expected_amount) pending 2건+ 모호.
//   reverse: payment(실금액) 하나에 대해 unmatched raw 후보들에서 1건 선택, 같은금액 raw 2건+ 모호.
//   승인판별(isApprovedRaw)·유효창(닫힌구간)·raw.id 앵커 규율은 공유(값만 forward=+N, reverse=−window).

// ── 정책 상수 (SSOT mirror: src/lib/redpayPlanbTtl.ts, EF 는 TS lib import 불가하여 미러) ──
//   REDPAY_REVERSE_MATCH_WINDOW_MIN = 10 (역방향 자동대조 유효창). raw 보관창(1h)과 별개 축(E-1).
export const REVERSE_MATCH_WINDOW_MS = 10 * 60 * 1000; // 10분 — [수납] 저장 직전 승인 신뢰창.

//   raw 보관창(후보 pool 조회창) — 기존 REDPAY_PLANB_RETENTION_MIN(1h) 미러(E-1 (b) 별개 축).
//   [수납] 저장 시점에 조회할 unmatched raw 후보 pool 의 시간 하한(approved_at >= now-보관창).
//   실제 자동대조 유효창(10분) 필터는 selectReverseMatchCandidate 안의 isWithinReverseWindow 가 적용.
export const REVERSE_MATCH_RETENTION_MS = 60 * 60 * 1000; // 1h

//   match_rule — 역방향 저장훅 매칭 provenance(forward tier0~4 와 분리). reconciliation_log/raw.match_rule 공용.
export const REVERSE_MATCH_RULE = "reverse_susu_hook" as const;

//   event_type — payment_reconciliation_log 신규 값(DA (d) 권고). auto_matched/manual_matched 와 3-provenance 분리
//   → 총괄 회수-가시성 지표(reverse-miss 자동연결 count) 성립. precondition 실측: event_type CHECK 부재(자유텍스트)
//   → 진성 no-DDL(CHECK-widen 아님). forward 값: auto_matched/match_failed/missing_in_crm/missing_at_van.
export const REVERSE_MATCH_EVENT_TYPE = "reverse_matched" as const;

/** RedPay raw(reverse-match 후보) — DB 칼럼 1:1(reconciliation 매처 RawTransaction 부분집합 + tid). */
export interface ReverseRaw {
  id: string;                        // raw PK — ★멱등 claim 앵커(단독 유일키).
  clinic_id: string;
  amount: number;
  approved_at: string | null;        // 승인시각(occurred_at). 매출-일자 앵커(AC4).
  external_status: string;           // Y=승인 N/M/X=취소·부분취소·오류
  matched_payment_id: string | null; // NULL = 미매칭(claim 대상)
  external_trxid?: string | null;    // annotate 승격용(corroborator, 단독키 아님)
  approval_no?: string | null;       // annotate 승격용(있을 때만)
  tid?: string | null;               // annotate 승격용
  raw_payload?: Record<string, unknown> | null; // observe-mode 2차 방어용.
}

/** 방금 [수납] 저장된 payment — 역방향 매칭의 기준(anchor)이 되는 실 결제행. */
export interface SavedPayment {
  id: string;
  clinic_id: string;
  amount: number;
  method: string;        // 'card' 만 대상(RedPay=VAN 카드).
  payment_type: string;  // 'payment' 만 대상(refund 제외).
  created_at: string;    // 저장 시각(now 대용 폴백). 유효창 기준시각.
}

/** 역방향 매칭 판정 결과. */
export interface ReverseMatchDecision {
  /** 자동연결 대상 raw. null = no-op(후보 없음/모호/비대상). */
  raw: ReverseRaw | null;
  /** no-op 사유(관측·로그용). matched 면 null. */
  reason:
    | "matched"
    | "not_card_payment"        // method≠card 또는 payment_type≠payment (비대상)
    | "no_candidate"            // 유효창 내 승인·동금액 미매칭 raw 없음
    | "ambiguous_multi"         // 같은 금액 후보 2건+ (E-2 ③) → 자동 스킵
    | null;
  /** ambiguous_multi 시 후보 수(관측). */
  candidateCount: number;
}

// ── observe-mode 판별 (matcher.isObserveRow 동치) ─────────────────────────────────
//   웹훅 관측모드 적재행(raw_payload._mode='observe')은 실 승격 금지 → reverse-match 후보 제외.
export function isObserveRaw(
  raw: { raw_payload?: Record<string, unknown> | null } | null | undefined,
): boolean {
  const m = raw?.raw_payload?._mode;
  return typeof m === "string" && m.trim().toLowerCase() === "observe";
}

/**
 * 승인 raw 판별 (E-2 ①, match.isApprovedRaw 동치).
 *   external_status='Y'(승인) + approved_at 존재(occurred_at) + amount>0. 취소/환불(N/M/X) 제외.
 *   ★취소 raw 도 approved_at(원 승인시각) 세팅될 수 있음 → external_status='Y' 가 1급 게이트.
 */
export function isApprovedReverseRaw(raw: ReverseRaw): boolean {
  return (
    raw.external_status === "Y" &&
    raw.approved_at != null &&
    raw.amount != null &&
    Number(raw.amount) > 0 &&
    !isObserveRaw(raw)
  );
}

/**
 * 역방향 유효창 판정 (E-1 · AC1).
 *   승인시각(approved_at)이 [수납] 저장시각(nowMs) 직전 window(10분) 이내인가?
 *   닫힌 구간 [nowMs - window, nowMs] — forward 매처의 [approved_at, approved_at+N] 의 거울상.
 *   · 상한 = nowMs (미래 승인 배제: 카드 승인은 저장보다 앞서야 함 = forward 방향).
 *   · 하한 = nowMs - window (그 이전 승인은 '같은 거래' 신뢰 상실 → 창 밖).
 *   경계 포함(승인시각 == 경계값도 유효). 저장 직전 승인만 신뢰(오연결 최소화, 총괄 v2 §E-1).
 */
export function isWithinReverseWindow(
  approvedAtIso: string | null,
  nowMs: number,
  windowMs: number = REVERSE_MATCH_WINDOW_MS,
): boolean {
  if (!approvedAtIso) return false;
  const a = Date.parse(approvedAtIso);
  if (Number.isNaN(a)) return false;
  return a <= nowMs && a >= nowMs - windowMs;
}

/**
 * 매출-일자 앵커 계산 (AC4 — 본건 최중요).
 *   raw.approved_at(VAN 승인시각) → KST(UTC+9) 날짜 문자열(YYYY-MM-DD). matcher.toKstDateStr 동치.
 *   호출부는 이 값을 payment 의 매출-일자 필드(accounting_date 후보)에 stamp 해야 하며,
 *   감지·INSERT 실행시각(now)을 쓰면 안 된다(late-arrival 일경계 drift 방지).
 *   ⚠ 실제 write 필드(accounting_date vs origin_tx_date vs created_at) 확정은 매출-split SSOT 소관 —
 *      본 함수는 '어떤 날짜값을 앵커로 쓸지'만 계산(값 결정). 필드 배선은 오케스트레이션 레이어.
 */
export function anchorAccountingDateKst(approvedAtIso: string): string {
  const ms = Date.parse(approvedAtIso);
  const kstMs = ms + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

/**
 * 역방향 매칭 후보 선택 — [수납] 저장된 payment 하나에 대해 unmatched 승인 raw 중 1건을 안전 선택.
 *   E-2 오연결 방지 4조건을 모두 강제한다:
 *     ① 승인만(isApprovedReverseRaw = external_status='Y').
 *     ② 금액 완전일치(raw.amount === payment.amount) + 같은 clinic.
 *     ③ 유효창(10분) 내 동일금액 후보가 2건+ 면 모호 → 자동 스킵(ambiguous_multi, 수동 폴백).
 *     ④ 매칭 앵커 = raw.id(단독 유일키). trxid/approval_no 단독 링크 금지(corroborator일 뿐).
 *   비대상: method≠card 또는 payment_type≠payment → not_card_payment(no-op).
 *   used: 같은 저장 pass/배치 내 이미 소비된 raw.id(재사용 금지, 1 raw : 1 payment).
 *
 * @param payment  방금 [수납] 저장된 결제행(기준).
 * @param raws     matched_payment_id IS NULL 로 조회된 raw 후보 pool(보관창 1h 내 조회 권장).
 * @param nowMs    [수납] 저장 기준시각(ms). 미지정 시 payment.created_at 사용.
 * @param used     이미 소비된 raw.id 집합(배치 이중매칭 방지).
 */
export function selectReverseMatchCandidate(
  payment: SavedPayment,
  raws: ReverseRaw[],
  nowMs?: number,
  used: Set<string> = new Set<string>(),
): ReverseMatchDecision {
  // 비대상 결제 — 카드 승인건만 RedPay 역방향 대조 대상(현금/이체/멤버십·환불 제외).
  if (payment.method !== "card" || payment.payment_type !== "payment") {
    return { raw: null, reason: "not_card_payment", candidateCount: 0 };
  }

  const now = typeof nowMs === "number" ? nowMs : Date.parse(payment.created_at);

  // E-2 ①②④ + 유효창 필터 → 같은 금액·같은 clinic·승인·미소비·미매칭·유효창 내 raw 후보.
  const candidates = raws.filter((r) =>
    r.matched_payment_id === null &&
    r.clinic_id === payment.clinic_id &&
    r.amount != null &&
    Number(r.amount) === Number(payment.amount) &&
    isApprovedReverseRaw(r) &&
    isWithinReverseWindow(r.approved_at, now) &&
    !used.has(r.id)
  );

  if (candidates.length === 0) {
    return { raw: null, reason: "no_candidate", candidateCount: 0 };
  }
  // E-2 ③ — 같은 금액 후보 2건+ = 모호 → 자동매칭 스킵(오연결 방지, 수동 폴백).
  if (candidates.length > 1) {
    return { raw: null, reason: "ambiguous_multi", candidateCount: candidates.length };
  }
  return { raw: candidates[0], reason: "matched", candidateCount: 1 };
}

/**
 * 매칭 확정 payment annotate payload 빌더 (AC2·AC4·Model A ② 주석컬럼 동시 populate).
 *   matcher.buildMatchedPaymentUpdate 와 shape-parity(reconciled_at/external_trxid/external_status/
 *   external_approval_no) + reverse 전용으로 external_tid·매출-일자 앵커(AC4)를 함께 stamp 한다.
 *   호출부는 이 payload 를 '단일 UPDATE'(raw claim rows-affected=1 성공 직후, 동일 논리 txn)로 write.
 *
 *   불변식:
 *     · reconciled_at 즉시 stamp → forward 매처 재매칭 skip(orphan 재유입 차단, Model A ②).
 *     · external_* 는 raw 원천 값이 있을 때만 채운다(NULL 덮어쓰기 금지, 멱등).
 *     · method/payment_type/amount 등 매출·매칭 predicate 필드 무접촉(populate 만) — AC2·매출 split 무접점.
 *     · accountingDateKst = anchorAccountingDateKst(raw.approved_at) — AC4 매출-일자 앵커(옵션: 필드 배선은
 *       매출-split SSOT confirm 후 오케스트레이션 레이어가 결정. 미배선 시 payload 에서 생략 가능).
 *
 * @param raw            claim 성공한 raw.
 * @param reconciledAtIso 대사 확정 시각(now, ISO).
 * @param includeAccountingDate  AC4 앵커일자를 payload 에 포함할지(매출-split 필드 확정 후 true).
 */
export function buildReverseMatchPaymentUpdate(
  raw: Pick<ReverseRaw, "external_trxid" | "external_status" | "approval_no" | "tid" | "approved_at">,
  reconciledAtIso: string,
  includeAccountingDate = false,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    reconciled_at: reconciledAtIso,
    external_status: raw.external_status,
  };
  if (raw.external_trxid) payload.external_trxid = raw.external_trxid;
  if (raw.approval_no) payload.external_approval_no = raw.approval_no;
  if (raw.tid) payload.external_tid = raw.tid;
  // AC4 매출-일자 앵커 — approved_at 의 KST 일자. D3 확정: 매출-일자 SSOT 앵커 = accounting_date = raw.approved_at KST.
  //   ⚠ payments.accounting_date 는 INSERT 트리거가 created_at(=저장시각) KST 로 stamp 함(20260515000010_sales_common_db).
  //     reverse-miss = late-arrival → 저장시각 KST 가 승인일과 다를 수 있음(일경계 drift) → 이 UPDATE 로 approved_at KST 덮어씀.
  //     (INSERT 트리거는 UPDATE 에 재발화하지 않음 → 이 값이 최종.) 오케스트레이터는 includeAccountingDate=true 로 호출(D3).
  if (includeAccountingDate && raw.approved_at) {
    payload.accounting_date = anchorAccountingDateKst(raw.approved_at);
  }
  return payload;
}

/**
 * raw claim UPDATE payload (D1 · AC5 — 직렬화점).
 *   호출부는 이 payload 로 `UPDATE redpay_raw_transactions SET ... WHERE id=raw.id AND matched_payment_id IS NULL`
 *   (rows-affected=1 검증)을 수행한다. WHERE 의 `matched_payment_id IS NULL` 가 유일 직렬화점(D1):
 *   webhook auto-match / OPT3 버튼 / 본 저장훅 최대 3 경쟁자 중 rows-affected=1 획득자만 후속 write 진입,
 *   패자(rows-affected=0)는 payment annotate 진입 전 abort(D2: payment 는 [수납]흐름이 이미 생성 → 무접촉).
 */
export function buildReverseClaimUpdate(paymentId: string): Record<string, unknown> {
  return { matched_payment_id: paymentId, match_rule: REVERSE_MATCH_RULE };
}

/**
 * raw claim rollback payload (D2 · forward 매처 rollback 미러).
 *   claim 성공(rows-affected=1) 후 payment annotate 실패/0-row 시 raw 링크만 원복.
 *   ★payment 자체는 삭제하지 않는다(D2: annotate-on-existing, [수납]흐름이 생성한 정상 수납 레코드 유지).
 */
export function buildReverseClaimRollback(): Record<string, unknown> {
  return { matched_payment_id: null, match_rule: null };
}

/** reconciliation_log 1행(reverse_matched) — index.ts insertReconciliationLog 행 shape parity. */
export interface ReverseReconLogRow {
  clinic_id: string;
  raw_transaction_id: string;
  payment_id: string;
  event_type: typeof REVERSE_MATCH_EVENT_TYPE;
  match_rule: typeof REVERSE_MATCH_RULE;
  mismatch_reason: null;
  external_trxid: string | null;
  external_amount: number;
  crm_amount: number;
  raw_payload: null;
  center: string;
}

/**
 * reconciliation_log INSERT 행 빌더 (AC8 — 신규 event_type='reverse_matched').
 *   forward auto_matched 로그 shape 와 parity(center NOT NULL 폴백 'foot'). append-only 관측 로그이므로
 *   INSERT 실패는 money-path 를 rollback 하지 않는다(forward 동형 — best-effort).
 */
export function buildReverseReconLogRow(
  raw: Pick<ReverseRaw, "id" | "clinic_id" | "amount" | "external_trxid">,
  payment: Pick<SavedPayment, "id" | "amount">,
  center = "foot",
): ReverseReconLogRow {
  return {
    clinic_id: raw.clinic_id,
    raw_transaction_id: raw.id,
    payment_id: payment.id,
    event_type: REVERSE_MATCH_EVENT_TYPE,
    match_rule: REVERSE_MATCH_RULE,
    mismatch_reason: null,
    external_trxid: raw.external_trxid ?? null,
    external_amount: Number(raw.amount),
    crm_amount: Number(payment.amount),
    raw_payload: null,
    center,
  };
}
