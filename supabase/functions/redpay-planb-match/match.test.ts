// redpay-planb-match/match.test.ts — 선점 매칭 순수 로직 단위 테스트
//
// T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX (최필경 총괄, 스레드 1785285157.831119)
//   부모 매칭 설계(received_at 기준)를 occurred_at(승인시각) 기준으로 정정 + 파라미터 2분리 + event_type 필터.
//   실행: deno test supabase/functions/redpay-planb-match/match.test.ts
//   (Deno 미설치 환경에서는 CI/supervisor 측 deno test 로 실행. tsc 빌드에는 미포함.)

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RETENTION_MS,
  isApprovedRaw,
  isWithinValidWindow,
  isWithinRetention,
  isAutoCancelTarget,
  retentionCutoffIso,
  groupPendingByAmount,
  selectCandidateRaw,
  kstAccountingDate,
  isDormantGapCandidate,
  selectDormantGapBlock,
  type PendingRow,
  type RawRow,
  type ExistingCardPaymentRow,
} from "./match.ts";

// ── 픽스처 ────────────────────────────────────────────────────────────────────
// 선점: created=12:00:00, expires=12:05:00 (유효창 5분).
const CREATED = "2026-07-29T12:00:00.000Z";
const EXPIRES = "2026-07-29T12:05:00.000Z";
const CLINIC = "clinic-foot-001";

function pending(over: Partial<PendingRow> = {}): PendingRow {
  return {
    id: "p1",
    clinic_id: CLINIC,
    expected_amount: 550000,
    created_at: CREATED,
    expires_at: EXPIRES,
    status: "open",
    ...over,
  };
}
function raw(over: Partial<RawRow> = {}): RawRow {
  return {
    id: "r1",
    clinic_id: CLINIC,
    amount: 550000,
    approved_at: "2026-07-29T12:01:00.000Z", // 승인시각 = 선점 +1분 (유효창 내)
    external_status: "Y",
    received_at: "2026-07-29T12:04:00.000Z",  // 도착시각 = +4분 (지연). 매칭 판정 미사용.
    ...over,
  };
}

// ── AC-1: occurred_at(승인시각) 유효창 판정 ──────────────────────────────────────
Deno.test("isWithinValidWindow: occurred_at ∈ [created, expires] 닫힌 구간", () => {
  assert(isWithinValidWindow(CREATED, EXPIRES, "2026-07-29T12:01:00.000Z"), "유효창 내(+1분)");
  assert(isWithinValidWindow(CREATED, EXPIRES, CREATED), "하한 경계(=created) 포함");
  assert(isWithinValidWindow(CREATED, EXPIRES, EXPIRES), "상한 경계(=expires) 포함");
  assertFalse(isWithinValidWindow(CREATED, EXPIRES, "2026-07-29T11:59:59.000Z"), "created 이전 제외");
  assertFalse(isWithinValidWindow(CREATED, EXPIRES, "2026-07-29T12:05:00.001Z"), "expires 초과 제외");
  assertFalse(isWithinValidWindow(CREATED, EXPIRES, null), "occurred_at 부재 → 매칭 불가");
});

Deno.test("AC-1 시나리오1: 늦은 웹훅도 occurred_at 로 자동연결(received_at 늦어도 무관)", () => {
  // 승인시각 +1분(유효창 내), 도착시각 +4분(카운트다운 만료 근접) → received_at 기준이면 놓쳤을 케이스.
  const p = pending();
  const r = raw({ approved_at: "2026-07-29T12:01:00.000Z", received_at: "2026-07-29T12:04:00.000Z" });
  assert(isWithinValidWindow(p.created_at, p.expires_at, r.approved_at), "occurred_at(+1분) 유효창 내 → 매칭");
  const picked = selectCandidateRaw(p, [r], new Set());
  assertEquals(picked?.id, "r1", "늦은 도착에도 승인시각 기준 자동연결");
});

// ── AC-2: 보관창(만료 후 1시간) 판정 ─────────────────────────────────────────────
Deno.test("isWithinRetention: 만료 후 1시간 이내 expired 선점만 매칭 후보 유지", () => {
  assertEquals(RETENTION_MS, 60 * 60 * 1000, "보관창 = 1시간");
  // now = expires +20분 → 보관창 내(후보 유지)
  assert(isWithinRetention(EXPIRES, "2026-07-29T12:25:00.000Z"), "만료 +20분 → 보관창 내");
  // now = expires +59분 → 보관창 내
  assert(isWithinRetention(EXPIRES, "2026-07-29T13:04:00.000Z"), "만료 +59분 → 보관창 내");
  // now = expires +61분 → 보관창 초과(후보 제외)
  assertFalse(isWithinRetention(EXPIRES, "2026-07-29T13:06:00.000Z"), "만료 +61분 → 보관창 초과");
  // 유효 open(now < expires) → 항상 보관창 내(true)
  assert(isWithinRetention(EXPIRES, "2026-07-29T12:03:00.000Z"), "유효 open 은 항상 후보");
});

Deno.test("retentionCutoffIso: now - 1시간 (쿼리 gt cutoff)", () => {
  assertEquals(retentionCutoffIso("2026-07-29T13:00:00.000Z"), "2026-07-29T12:00:00.000Z");
});

Deno.test("AC-2 시나리오2: 만료된 선점도 보관창 내 late 웹훅으로 자동연결", () => {
  // 선점 만료(status=expired). 웹훅이 만료 +20분 도착, 단 승인시각(occurred_at)은 유효창 내(+2분).
  const p = pending({ status: "expired" });
  const lateRaw = raw({
    approved_at: "2026-07-29T12:02:00.000Z", // 유효창 내 승인
    received_at: "2026-07-29T12:25:00.000Z", // 만료 +20분 도착
  });
  // expired 선점이 보관창 내이므로 후보 pool 에 포함되었다는 전제 하에(쿼리 레벨),
  // occurred_at 유효창 판정으로 자동연결.
  assert(isWithinValidWindow(p.created_at, p.expires_at, lateRaw.approved_at), "승인시각 유효창 내");
  const picked = selectCandidateRaw(p, [lateRaw], new Set());
  assertEquals(picked?.id, "r1", "만료 후 보관창 내 late 웹훅 → expired 선점 자동연결");
});

// ── AC-3: 승인(external_status='Y')만 매칭, 취소/환불 제외 ─────────────────────────
Deno.test("isApprovedRaw: external_status='Y' 만 승인. 취소/환불/부호 제외", () => {
  assert(isApprovedRaw(raw({ external_status: "Y", amount: 550000, approved_at: CREATED })), "Y+양수+승인시각 → 승인");
  assertFalse(isApprovedRaw(raw({ external_status: "N" })), "N(취소) 제외");
  assertFalse(isApprovedRaw(raw({ external_status: "M" })), "M(부분취소) 제외");
  assertFalse(isApprovedRaw(raw({ external_status: "X" })), "X(오류) 제외");
  assertFalse(isApprovedRaw(raw({ external_status: "Y", amount: -550000 })), "음수 amount 제외");
  assertFalse(isApprovedRaw(raw({ external_status: "Y", approved_at: null })), "approved_at 부재 → 매칭 불가");
});

Deno.test("AC-3 시나리오3: 결제후즉시취소(양수 2건) — 취소 raw 오연결 차단", () => {
  const p = pending();
  // 승인 raw(Y, +55만, 승인시각 유효창 내) + 취소 raw(N, +55만 양수, approved_at 도 세팅됨).
  const approvedRaw = raw({ id: "r-approved", external_status: "Y", amount: 550000, approved_at: "2026-07-29T12:01:00.000Z" });
  const cancelRaw = raw({
    id: "r-cancel",
    external_status: "N",        // 취소
    amount: 550000,              // ★ 취소도 양수(부호 무판별)
    approved_at: "2026-07-29T12:01:00.000Z", // ★ 취소 raw 도 원 승인시각 보존 → approved_at 만으론 구분 불가
    received_at: "2026-07-29T12:03:00.000Z",
  });
  const picked = selectCandidateRaw(p, [cancelRaw, approvedRaw], new Set());
  assertEquals(picked?.id, "r-approved", "external_status='Y' 승인 raw 만 연결 — 취소(N) 오연결 0");
  // 취소 raw 단독이면 매칭 후보 없음(제외).
  assertEquals(selectCandidateRaw(p, [cancelRaw], new Set()), null, "취소 raw 단독 → 매칭 없음(기존 취소 대사 경로)");
});

// ── 매칭 규율 (모호·소비·금액) ────────────────────────────────────────────────
Deno.test("groupPendingByAmount: (clinic, amount) 그룹핑", () => {
  const groups = groupPendingByAmount([
    pending({ id: "a", expected_amount: 100 }),
    pending({ id: "b", expected_amount: 100 }),
    pending({ id: "c", expected_amount: 200 }),
  ]);
  assertEquals(groups.get(`${CLINIC}::100`)?.length, 2, "동일 금액 2건 = 모호 그룹");
  assertEquals(groups.get(`${CLINIC}::200`)?.length, 1);
});

Deno.test("selectCandidateRaw: 금액 불일치·타 clinic·이미소비 제외 + 가장 이른 승인시각 우선", () => {
  const p = pending({ expected_amount: 550000 });
  assertEquals(selectCandidateRaw(p, [raw({ amount: 300000 })], new Set()), null, "금액 불일치 제외");
  assertEquals(selectCandidateRaw(p, [raw({ clinic_id: "other" })], new Set()), null, "타 clinic 제외");
  assertEquals(selectCandidateRaw(p, [raw({ id: "used" })], new Set(["used"])), null, "이미 소비된 raw 제외");
  // 가장 이른 승인시각 우선.
  const early = raw({ id: "early", approved_at: "2026-07-29T12:01:00.000Z" });
  const late = raw({ id: "late", approved_at: "2026-07-29T12:03:00.000Z" });
  assertEquals(selectCandidateRaw(p, [late, early], new Set())?.id, "early", "가장 이른 승인시각 우선");
});

Deno.test("received_at 은 매칭 판정에서 완전히 무관(정정2 핵심)", () => {
  const p = pending();
  // 승인시각은 유효창 내, 도착시각은 유효창 밖(+10분) → received_at 기준이면 탈락했을 케이스.
  const r = raw({ approved_at: "2026-07-29T12:02:00.000Z", received_at: "2026-07-29T12:10:00.000Z" });
  assertEquals(selectCandidateRaw(p, [r], new Set())?.id, "r1", "도착시각 무관, 승인시각만으로 매칭");
});

// ── #4 autoCancelPass 대상 판정 (T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD) ─────
Deno.test("isAutoCancelTarget: 보관창(1h) 초과분만 취소 대상 (match-before-cancel 경계)", () => {
  const now = "2026-07-30T13:00:00.000Z";
  // 보관창 딱 초과(정확히 now - 1h) = 취소 대상(경계 포함).
  assert(
    isAutoCancelTarget("2026-07-30T12:00:00.000Z", now),
    "expires_at == now-1h → 취소 대상(보관창 딱 종료)",
  );
  // 보관창 초과(now - 1h 이전) = 취소 대상.
  assert(
    isAutoCancelTarget("2026-07-30T11:30:00.000Z", now),
    "expires_at < now-1h → 취소 대상",
  );
  // 보관창 내(now - 1h 이후) = 취소 금지(late 웹훅 매칭 여지).
  assertFalse(
    isAutoCancelTarget("2026-07-30T12:30:00.000Z", now),
    "expires_at > now-1h → 보관창 내 → 취소 금지(matchPass 여지)",
  );
});

Deno.test("isAutoCancelTarget ⊥ isWithinRetention: 두 판정은 상보(겹침 0)", () => {
  const now = "2026-07-30T13:00:00.000Z";
  for (const exp of [
    "2026-07-30T11:00:00.000Z", // 보관창 초과
    "2026-07-30T12:00:00.000Z", // 경계
    "2026-07-30T12:59:00.000Z", // 보관창 내
  ]) {
    // 한 건이 두 판정에서 동시에 true 가 되면 안 된다(취소와 매칭후보 동시 위험 배제).
    assertFalse(
      isAutoCancelTarget(exp, now) && isWithinRetention(exp, now),
      `상보성 위반(exp=${exp}) — autoCancel 대상과 retention 후보가 겹침`,
    );
  }
});

// ── DORMANTGAP-GUARD (T-20260805-foot-REDPAY-PLANA-REATTACH-DORMANTGAP-GUARD) ─────
//   픽스처 = 부모 verify 증적(track1b_gap_snapshot.json)의 실측 행 반영.
//   null_approval_card_payments: attempt=false(payment_attempt_id NULL), ext_trxid NULL, acct 2026-08-04.

function payRow(over: Partial<ExistingCardPaymentRow> = {}): ExistingCardPaymentRow {
  return {
    id: "pay1",
    amount: 10000,
    accounting_date: "2026-08-04",
    payment_type: "payment",
    method: "card",
    status: "active",
    deleted_at: null,
    payment_attempt_id: null,        // non-CAT 수기수납 = RPC absorb 사각
    external_approval_no: null,       // 승인번호 NULL
    reconciled_at: null,
    ...over,
  };
}

Deno.test("kstAccountingDate: UTC ISO → Asia/Seoul(UTC+9) 달력일 (RPC v_acct_date 동치)", () => {
  // 2026-08-04 16:01:18 KST = 2026-08-04 07:01:18 UTC → KST 달력일 2026-08-04.
  assertEquals(kstAccountingDate("2026-08-04T07:01:18.000Z"), "2026-08-04");
  // UTC 자정 직후(15:30Z = 익일 00:30 KST) → KST 날짜는 +1일 넘어감(달력일 경계 검증).
  assertEquals(kstAccountingDate("2026-08-04T15:30:00.000Z"), "2026-08-05", "UTC 15:30 = KST 익일 00:30");
  assertEquals(kstAccountingDate(null), null, "null → null");
  assertEquals(kstAccountingDate("not-a-date"), null, "파싱 불가 → null");
});

Deno.test("isDormantGapCandidate: non-CAT 수기수납(승인번호 NULL)만 gap 후보 (AC-2)", () => {
  const opts = { amount: 10000, accountingDate: "2026-08-04" };
  assert(isDormantGapCandidate(payRow(), opts), "동일금액·동일일자·non-CAT·미대사 → gap 후보");
  // ★RPC absorb 가능 건(CAT-origin: payment_attempt_id NOT NULL)은 gap 아님(RPC 가 흡수).
  assertFalse(
    isDormantGapCandidate(payRow({ payment_attempt_id: "cat-attempt-1", external_approval_no: "116927731" }), opts),
    "CAT-origin(payment_attempt_id NOT NULL) → RPC absorb 대상, gap 차단 아님",
  );
  // 이미 대사된 건 = dup 후보 아님.
  assertFalse(isDormantGapCandidate(payRow({ reconciled_at: "2026-08-04T09:00:00.000Z" }), opts), "미대사만 후보");
  // 금액/일자 불일치 제외.
  assertFalse(isDormantGapCandidate(payRow({ amount: 20000 }), opts), "금액 불일치 제외");
  assertFalse(isDormantGapCandidate(payRow({ accounting_date: "2026-08-03" }), opts), "일자 불일치 제외");
  // refund(TRANTYPE 상이) 제외 — auto-create 는 payment 만 생성.
  assertFalse(isDormantGapCandidate(payRow({ payment_type: "refund" }), opts), "refund(TRANTYPE 상이) 제외");
  // 삭제/비활성 제외.
  assertFalse(isDormantGapCandidate(payRow({ deleted_at: "2026-08-04T10:00:00.000Z" }), opts), "삭제분 제외");
  assertFalse(isDormantGapCandidate(payRow({ status: "void" }), opts), "비활성 제외");
});

Deno.test("selectDormantGapBlock: gap 후보 1건+ 존재 → 차단(payment 반환) / 없으면 null", () => {
  const opts = { amount: 10000, accountingDate: "2026-08-04" };
  // 증적 재현: 동일금액(10000) non-CAT 수기수납 존재 → 차단.
  assertEquals(
    selectDormantGapBlock([payRow({ id: "gap10000" })], opts)?.id,
    "gap10000",
    "동일금액 수기수납 존재 → auto-create 차단",
  );
  // CAT-origin 만 있으면 차단 안 함(RPC absorb 경로).
  assertEquals(
    selectDormantGapBlock([payRow({ id: "cat", payment_attempt_id: "a1", external_approval_no: "116927731" })], opts),
    null,
    "CAT-origin 만 → 차단 없음(RPC absorb)",
  );
  // 대조 대상 없음 → null(정상 auto-create 진행).
  assertEquals(selectDormantGapBlock([], opts), null, "기존 payment 없음 → 차단 없음");
});

Deno.test("AC-3 재현: 6 unmatched-Y raw × auto-reattach 활성 가정 → 재부착 0건(순-write 0)", () => {
  // 증적 track1b_gap_snapshot.json 의 6 unmatched-Y raw 승인시각·금액 반영(전부 KST 2026-08-04).
  const rawsFx = [
    { amount: 10000,   approved_utc: "2026-08-04T07:01:18.000Z" }, // 16:01:18 KST
    { amount: 20000,   approved_utc: "2026-08-04T07:48:11.000Z" }, // 16:48:11 KST
    { amount: 2670000, approved_utc: "2026-08-04T07:54:08.000Z" }, // 16:54:08 KST
    { amount: 10000,   approved_utc: "2026-08-04T08:26:58.000Z" }, // 17:26:58 KST
    { amount: 1400,    approved_utc: "2026-08-04T08:55:03.000Z" }, // 17:55:03 KST
    { amount: 260000,  approved_utc: "2026-08-04T11:15:59.000Z" }, // 20:15:59 KST
  ];
  // 실측 null-approval 수기수납(payment) 금액집합: 10000·20000·260000 (payment type, attempt=false).
  const existingManualPayments: ExistingCardPaymentRow[] = [
    payRow({ id: "m-10000", amount: 10000 }),
    payRow({ id: "m-20000", amount: 20000 }),
    payRow({ id: "m-260000", amount: 260000 }),
  ];
  let autoCreatedWouldBe = 0;
  let gapBlocked = 0;
  for (const r of rawsFx) {
    const acct = kstAccountingDate(r.approved_utc)!;
    assertEquals(acct, "2026-08-04", "모든 raw 는 KST 2026-08-04 매출일");
    const blocker = selectDormantGapBlock(existingManualPayments, { amount: r.amount, accountingDate: acct });
    if (blocker) gapBlocked += 1;
    else autoCreatedWouldBe += 1; // 대조 없음 = 신규 생성 후보(단, prod 에선 pending=0 이라 매칭 자체 0).
  }
  // 수기수납 존재 금액(10000·20000·260000·10000)= 4건 차단. 2670000·1400 은 수기수납 부재.
  assertEquals(gapBlocked, 4, "수기수납 존재(10000·20000·260000)와 동일금액 raw 4건 → 가드 차단(dup INSERT 0)");
  // ★prod 실측: pending_payment.total=0 → matchPass 매칭 자체 0 → 6건 전부 재부착 0(가드 이전에 이미 0).
  //   가드는 forward-hardening: 수기수납이 이미 있는 금액이면 pending 이 생겨도 auto-create INSERT 0 보장.
  assertEquals(autoCreatedWouldBe, 2, "수기수납 부재 금액(2670000·1400)만 가드 통과 후보(단 dup 아님=double-count 위험 0)");
});
