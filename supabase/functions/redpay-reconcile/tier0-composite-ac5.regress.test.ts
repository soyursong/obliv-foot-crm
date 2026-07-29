// redpay-reconcile/tier0-composite-ac5.regress.test.ts — AC-5 self-test (DA 필수 3항)
//
// T-20260729-foot-REDPAY-TIER0-COMPOSITE-OR-CARD-SAMEDAY
//   DA CONSULT-REPLY GO (SSOT=da_reply_foot_redpay_tier0_composite_20260728.md).
//   AC-5 필수 3항을 assert 로 동봉:
//     (A) 358 Y-row 0 회귀 — 현 CRM 데이터 shape(external_approval_no/tid 노출 0/295)에서
//         composite 는 inert → tier0 auto-link 0건. 매칭되던 건은 여전히 매칭 or 수동강등,
//         오링크 절대 0. (하위 Tier1/2/3 는 predicate 무변경 → 링크 보존.)
//     (B) tier별 링크 delta 정량(조용히 버리지 않음) — 하드닝 전/후 tier0 링크 델타 = 0.
//         현 tier0 사용 0 이므로 신 composite 로 사라지는 링크 0, 신규 오링크 0.
//     (C) approval_no 충돌 합성 fixture(동일 approval_no·상이 거래) →
//         composite 가 정답단일(amount 대조로 분리) or 수동(tie 시 tier4_manual), 오링크 0.
//   실행: deno test supabase/functions/redpay-reconcile/tier0-composite-ac5.regress.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findTier0Direct,
  matchTransaction,
  matchTransactionsBatch,
  type RawTransaction,
  type CrmPayment,
} from "./matcher.ts";

const APPROVED_AT = "2026-07-28T01:00:00.000Z"; // KST 2026-07-28 10:00

function rawRow(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    id: "raw-1",
    clinic_id: "clinic-1",
    external_trxid: "TRX-RAW-1",
    external_status: "Y",
    amount: 120000,
    approval_no: "APP123",
    root_trxid: null,
    tid: "TID-A",
    approved_at: APPROVED_AT,
    matched_payment_id: null,
    raw_payload: null,
    ...overrides,
  };
}

function crmPay(overrides: Partial<CrmPayment>): CrmPayment {
  return {
    id: "pay-1",
    clinic_id: "clinic-1",
    amount: 120000,
    method: "card",
    payment_type: "payment",
    created_at: "2026-07-28T01:05:00.000Z",
    external_trxid: null,
    external_approval_no: null,
    external_tid: null,
    reconciled_at: null,
    ...overrides,
  };
}

// ── (A) 358 Y-row 0 회귀 — 현 데이터 shape 에서 composite inert ────────────────
//   현 prod: CRM payments 의 external_approval_no·external_tid 노출 = 0/295 (AC-1 evidence).
//   → 어떤 raw 든 corroborator 부재 → tier0 링크 0. 하위 Tier 로 자연 폴백(무회귀).
Deno.test("AC-5(A): CRM 식별자 노출 0(현 prod shape) → tier0 auto-link 0건 = 0 회귀", () => {
  const raws = [
    rawRow({ id: "r1", approval_no: "APP1", tid: "T1", amount: 100000 }),
    rawRow({ id: "r2", approval_no: "APP2", tid: "T2", amount: 200000 }),
    rawRow({ id: "r3", approval_no: "APP3", tid: "T3", amount: 300000 }),
  ];
  // 현 prod 재현: payments 는 external_approval_no/external_tid 미노출(null)
  const payments = [
    crmPay({ id: "p1", amount: 100000, external_approval_no: null, external_tid: null }),
    crmPay({ id: "p2", amount: 200000, external_approval_no: null, external_tid: null }),
    crmPay({ id: "p3", amount: 300000, external_approval_no: null, external_tid: null }),
  ];
  for (const r of raws) {
    assertEquals(findTier0Direct(r, payments).length, 0, `${r.id}: 식별자 노출 0 → tier0 발화 불가`);
  }
});

// ── (B) tier별 링크 delta 정량 — 하드닝 delta 0 (조용히 버리지 않음) ───────────
Deno.test("AC-5(B): 현 데이터 shape 에서 tier0 delta = 0 (behavior-preserving)", () => {
  // 직전 Model A(approval_no∧tid∧amount∧+15min)도, 신 composite 도 corroborator 부재이면 0.
  const raws = Array.from({ length: 20 }, (_, i) =>
    rawRow({ id: `r${i}`, approval_no: `AP${i}`, tid: `TD${i}`, amount: 10000 + i })
  );
  const payments = raws.map((r, i) =>
    // 실 prod: 식별자 미노출 → tier0 후보 pool 자체가 비어 있음
    crmPay({ id: `p${i}`, amount: r.amount, external_approval_no: null, external_tid: null })
  );
  const results = matchTransactionsBatch(raws, payments, new Set());
  const tier0Count = results.filter((x) => x.match_rule === "tier0_direct").length;
  assertEquals(tier0Count, 0, "tier0 링크 델타 = 0 (하드닝 전/후 불변)");
  // 오링크 0 의 강한 형태: matched 된 건이 있어도 tier0 로 잘못 붙지 않음.
  for (const x of results) {
    if (x.match_rule === "tier0_direct") assert(false, "현 shape 에서 tier0 발화 불가");
  }
});

// ── (C) approval_no 충돌 합성 fixture — 오링크 0 증명 ─────────────────────────
//   현장 실측 예: approval_no 30024107 = 7/02 ₩2,890,000(tid …67) / 7/14 ₩10,000(tid …68).
//   완전 무관한 별개 거래가 동일 approval_no 재활용. composite(amount 대조)로 분리되어야 함.
Deno.test("AC-5(C1): 동일 approval_no·상이 amount → amount 대조로 오링크 차단(각자 정답만)", () => {
  const DUP = "30024107";
  const rawBig = rawRow({ id: "rawBig", approval_no: DUP, tid: "2074000067", amount: 2890000, external_trxid: "TRX-BIG" });
  const rawSml = rawRow({ id: "rawSml", approval_no: DUP, tid: "2074000068", amount: 10000, external_trxid: "TRX-SML" });
  // CRM 에 두 결제가 각자 correct amount·correct tid 로 존재
  const pBig = crmPay({ id: "pBig", amount: 2890000, external_approval_no: DUP, external_tid: "2074000067", created_at: "2026-07-28T01:03:00.000Z" });
  const pSml = crmPay({ id: "pSml", amount: 10000,   external_approval_no: DUP, external_tid: "2074000068", created_at: "2026-07-28T01:04:00.000Z" });

  // rawBig 는 pBig 만(amount 2,890,000), pSml(10,000) 은 amount 불일치로 배제
  const hitsBig = findTier0Direct(rawBig, [pBig, pSml]);
  assertEquals(hitsBig.length, 1, "동일 approval_no 여도 amount 대조로 단일 정답");
  assertEquals(hitsBig[0].id, "pBig", "big raw → big payment (오링크 0)");

  const hitsSml = findTier0Direct(rawSml, [pBig, pSml]);
  assertEquals(hitsSml.length, 1);
  assertEquals(hitsSml[0].id, "pSml", "sml raw → sml payment (오링크 0)");
});

Deno.test("AC-5(C2): 동일 approval_no·동일 amount·상이 거래(진짜 충돌) → 최근접 tie-break", () => {
  const DUP = "30024107";
  const raw = rawRow({ id: "rawC", approval_no: DUP, tid: "TID-RAW", amount: 50000 });
  // 두 후보 모두 approval_no·amount·card·same-day·forward 충족, created_at 만 다름
  const near = crmPay({ id: "pNear", amount: 50000, external_approval_no: DUP, external_tid: null, created_at: "2026-07-28T01:02:00.000Z" }); // +2min
  const far  = crmPay({ id: "pFar",  amount: 50000, external_approval_no: DUP, external_tid: null, created_at: "2026-07-28T03:00:00.000Z" }); // +2h (same day)
  const hits = findTier0Direct(raw, [far, near]); // 입력 순서 무관
  assertEquals(hits.length, 1, "충돌은 최근접 tie-break 으로 단일화");
  assertEquals(hits[0].id, "pNear", "approved_at 이후 최근접 created_at 선택");
});

Deno.test("AC-5(C3): 동일 approval_no·동일 amount·동률 시각(모호) → tier4_manual(오토 오링크 0)", () => {
  const DUP = "30024107";
  const raw = rawRow({ id: "rawT", approval_no: DUP, tid: "TID-RAW", amount: 50000 });
  const SAME = "2026-07-28T01:02:00.000Z"; // 동일 delta
  const p1 = crmPay({ id: "p1", amount: 50000, external_approval_no: DUP, external_tid: null, created_at: SAME });
  const p2 = crmPay({ id: "p2", amount: 50000, external_approval_no: DUP, external_tid: null, created_at: SAME });
  const hits = findTier0Direct(raw, [p1, p2]);
  assertEquals(hits.length, 2, "동률 → 다건 반환(단일 확정 금지)");
  // matchTransaction 은 다건 → tier4_manual 로 강등(오토 오링크 아님)
  const res = matchTransaction(raw, [p1, p2], new Set());
  assertEquals(res.match_rule, "tier4_manual", "모호 충돌 → 수동 큐");
  assertEquals(res.matched, false, "오토 매칭 금지");
  assertEquals(res.payment_id, null, "어느 쪽에도 오링크하지 않음");
  assert(res.needs_manual, "수동 확인 플래그");
});

// ── 배치 레벨: 동일 approval_no 충돌이 배치 순서에 흔들리지 않음 ───────────────
Deno.test("AC-5(C4): 배치 — 동일 approval_no·상이 amount 2거래가 서로 오링크 안 됨", () => {
  const DUP = "30024107";
  const rawBig = rawRow({ id: "rawBig", approval_no: DUP, tid: "2074000067", amount: 2890000, external_trxid: "TRX-BIG" });
  const rawSml = rawRow({ id: "rawSml", approval_no: DUP, tid: "2074000068", amount: 10000, external_trxid: "TRX-SML" });
  const pBig = crmPay({ id: "pBig", amount: 2890000, external_approval_no: DUP, external_tid: "2074000067", created_at: "2026-07-28T01:03:00.000Z" });
  const pSml = crmPay({ id: "pSml", amount: 10000,   external_approval_no: DUP, external_tid: "2074000068", created_at: "2026-07-28T01:04:00.000Z" });
  const results = matchTransactionsBatch([rawSml, rawBig], [pBig, pSml], new Set());
  const byRaw = new Map(results.map((r) => [r.raw_transaction_id, r]));
  assertEquals(byRaw.get("rawBig")!.payment_id, "pBig", "big → big (배치 순서 무관)");
  assertEquals(byRaw.get("rawSml")!.payment_id, "pSml", "sml → sml (배치 순서 무관)");
  assertEquals(byRaw.get("rawBig")!.match_rule, "tier0_direct");
  assertEquals(byRaw.get("rawSml")!.match_rule, "tier0_direct");
});
