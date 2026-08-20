// _shared/redpay-alarm-severity.test.ts — 3등급 심각도 정책 SSOT 단위/회귀 검증
//   T-20260820-foot-ALARM-SEVERITY-3TIER-POLICY
//   AC1(1등급 강등금지 회귀가드) · AC4(반복규칙 전등급) · AC5(등급경계 승격 재현).
//   실행: deno test supabase/functions/_shared/redpay-alarm-severity.test.ts

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AlarmTier,
  type AlarmKind,
  TIER1_KINDS,
  TIER2_KINDS,
  TIER3_KINDS,
  classifyAlarm,
  classifyUnregisteredLine,
  isLiveTransaction,
  assertNoDowngrade,
  CADENCE,
  decideAlarmFire,
  makeAlarmRepeatGate,
  type AlarmRecord,
} from "./redpay-alarm-severity.ts";

// ── 등급 매핑표 (확정 스펙 대조) ──────────────────────────────────────────────────
Deno.test("classifyAlarm — 3등급 매핑표 전 항목 확정 스펙 일치", () => {
  // 1등급 즉시 5항목
  assertEquals(classifyAlarm("payment_approval_unknown"), AlarmTier.IMMEDIATE);
  assertEquals(classifyAlarm("double_payment_suspected"), AlarmTier.IMMEDIATE);
  assertEquals(classifyAlarm("ingestion_full_stop"), AlarmTier.IMMEDIATE);
  assertEquals(classifyAlarm("bizno_zero_result"), AlarmTier.IMMEDIATE);
  assertEquals(classifyAlarm("unregistered_line_live_txn"), AlarmTier.IMMEDIATE);
  // 2등급 일일요약 3항목
  assertEquals(classifyAlarm("unregistered_line"), AlarmTier.DAILY);
  assertEquals(classifyAlarm("unmatched_count"), AlarmTier.DAILY);
  assertEquals(classifyAlarm("amount_mismatch"), AlarmTier.DAILY);
  // 3등급 주간요약
  assertEquals(classifyAlarm("stats_trend"), AlarmTier.WEEKLY);
});

Deno.test("등급 집합 — 5/3/1 분할·겹침 없음", () => {
  assertEquals(TIER1_KINDS.length, 5);
  assertEquals(TIER2_KINDS.length, 3);
  assertEquals(TIER3_KINDS.length, 1);
  const all = [...TIER1_KINDS, ...TIER2_KINDS, ...TIER3_KINDS];
  assertEquals(new Set(all).size, all.length, "등급 간 kind 중복 금지");
});

Deno.test("classifyAlarm — 미정의 kind 는 fail-safe IMMEDIATE(매몰 금지)", () => {
  assertEquals(classifyAlarm("__unknown__" as AlarmKind), AlarmTier.IMMEDIATE);
});

// ── AC1: 1등급 강등 회귀가드 ─────────────────────────────────────────────────────
Deno.test("AC1 — 1등급 5항목은 절대 2/3등급 강등 금지(회귀가드)", () => {
  for (const kind of TIER1_KINDS) {
    // 정상: 즉시로 분류되면 통과.
    assertNoDowngrade(kind, classifyAlarm(kind));
    // 강등 시도 → throw (2등급·3등급 모두).
    assertThrows(() => assertNoDowngrade(kind, AlarmTier.DAILY), Error, "강등 금지 위반");
    assertThrows(() => assertNoDowngrade(kind, AlarmTier.WEEKLY), Error, "강등 금지 위반");
  }
});

Deno.test("AC1 — 매핑표 자체가 1등급 kind 를 강등하지 않음(정적 불변식)", () => {
  for (const kind of TIER1_KINDS) {
    assertEquals(classifyAlarm(kind), AlarmTier.IMMEDIATE, `${kind} 은 반드시 즉시`);
  }
  // 2/3등급 kind 에 대해 assertNoDowngrade 는 무해(통과).
  for (const kind of [...TIER2_KINDS, ...TIER3_KINDS]) {
    assertNoDowngrade(kind, classifyAlarm(kind));
  }
});

// ── AC5: 등급 경계 (미등록 회선 실거래0 vs 실거래발생) ───────────────────────────
Deno.test("isLiveTransaction — 실거래 판정(kind+금액양수, 부호판별 금지)", () => {
  assertEquals(isLiveTransaction("approved", 50000), true);   // 실거래
  assertEquals(isLiveTransaction("cancelled", 50000), true);  // 취소도 실거래(돈 움직임)
  assertEquals(isLiveTransaction("approved", "12000"), true); // 문자열 금액
  assertEquals(isLiveTransaction("approved", 0), false);      // 0원 = 실거래0
  assertEquals(isLiveTransaction("unsupported", 50000), false); // 프로브/미지원
  assertEquals(isLiveTransaction("approved", null), false);
  assertEquals(isLiveTransaction(null, 50000), false);        // GET introspection 등
});

Deno.test("AC5 — 미등록 회선: 실거래0=일일요약 / 실거래발생=즉시승격", () => {
  const noTxn = classifyUnregisteredLine(false);
  assertEquals(noTxn.kind, "unregistered_line");
  assertEquals(noTxn.tier, AlarmTier.DAILY, "실거래0 미등록회선 = 2등급 일일요약(5분반복 폐지)");

  const liveTxn = classifyUnregisteredLine(true);
  assertEquals(liveTxn.kind, "unregistered_line_live_txn");
  assertEquals(liveTxn.tier, AlarmTier.IMMEDIATE, "미등록회선+실거래(돈새는중) = 1등급 즉시");

  // 승격된 kind 는 강등가드도 통과해야 함.
  assertNoDowngrade(liveTxn.kind, liveTxn.tier);
});

Deno.test("AC5 — 오늘 폭주건(신규 TID 2개·실거래0)은 신정책 下 일일요약 대상", () => {
  // 실거래 없는 신규 TID = unregistered_line = DAILY (즉시 아님).
  const { kind, tier } = classifyUnregisteredLine(isLiveTransaction("approved", 0));
  assertEquals(kind, "unregistered_line");
  assertEquals(tier, AlarmTier.DAILY);
});

// ── AC4: 반복규칙 전 등급 공통 (최초1회 + 상태전이 + 해결됨 한줄) ─────────────────
Deno.test("AC4 #1 — 같은 건 최초 1회만(동일 signature 재입력 억제)", () => {
  const gate = makeAlarmRepeatGate();
  const ev = { key: "unreg:M001::T001", signature: "open" };
  assertEquals(gate(ev).kind, "initial");     // 최초 1회 발화
  assertEquals(gate(ev).kind, "suppressed");  // 동일 → 억제
  assertEquals(gate(ev).kind, "suppressed");  // 계속 억제
});

Deno.test("AC4 #2 — 상태전이(미해결→실거래발생)는 1회 재발화", () => {
  const gate = makeAlarmRepeatGate();
  const key = "unreg:M001::T001";
  assertEquals(gate({ key, signature: "no_txn" }).kind, "initial");   // 미해결 최초
  assertEquals(gate({ key, signature: "no_txn" }).kind, "suppressed"); // 동일 억제
  // 실거래 발생 = signature 변경 → 승격 전이 1회.
  assertEquals(gate({ key, signature: "live_txn" }).kind, "transition");
  assertEquals(gate({ key, signature: "live_txn" }).kind, "suppressed"); // 전이 후 다시 억제
});

Deno.test("AC4 #3 — 해결 시 '해결됨' 1회 발화 후 종료(중복 해결 억제)", () => {
  const gate = makeAlarmRepeatGate();
  const key = "non2xx:401:invalid_signature";
  assertEquals(gate({ key, signature: "open" }).kind, "initial");
  assertEquals(gate({ key, signature: "open", resolved: true }).kind, "resolved"); // 해결됨 1회
  assertEquals(gate({ key, signature: "open", resolved: true }).kind, "suppressed"); // 중복 해결 억제
});

Deno.test("AC4 — 즉시등급도 dedup 적용('즉시=억제없음' 오구현 금지)", () => {
  // 1등급(즉시)도 반복규칙 게이트를 통과 → 최초1회+전이만 발화.
  const gate = makeAlarmRepeatGate();
  const key = "immediate:payment_approval_unknown:trx123";
  assertEquals(gate({ key, signature: "unknown" }).kind, "initial");
  assertEquals(gate({ key, signature: "unknown" }).kind, "suppressed"); // 즉시라도 재발화 안 함
});

Deno.test("AC4 — 해결 후 재발(재개)은 다시 최초 1회", () => {
  const gate = makeAlarmRepeatGate();
  const key = "unreg:M001::T001";
  assertEquals(gate({ key, signature: "open" }).kind, "initial");
  assertEquals(gate({ key, signature: "open", resolved: true }).kind, "resolved");
  // 종료 후 같은 건 재발 → 최초 1회로 다시 취급.
  assertEquals(gate({ key, signature: "open" }).kind, "initial");
});

Deno.test("decideAlarmFire — next 상태 레코드 전이 정확성(순수 함수)", () => {
  const initial = decideAlarmFire(undefined, { key: "k", signature: "s1" });
  assertEquals(initial.next, { state: "open", signature: "s1" } as AlarmRecord);

  const trans = decideAlarmFire(initial.next, { key: "k", signature: "s2" });
  assertEquals(trans.kind, "transition");
  assertEquals(trans.next, { state: "open", signature: "s2" } as AlarmRecord);

  const resolved = decideAlarmFire(trans.next, { key: "k", signature: "s2", resolved: true });
  assertEquals(resolved.kind, "resolved");
  assertEquals(resolved.next.state, "resolved");

  // resolved 상태에서 해결 재입력 → 억제(레코드 불변).
  const dupResolve = decideAlarmFire(resolved.next, { key: "k", signature: "s2", resolved: true });
  assertEquals(dupResolve.fire, false);
});

Deno.test("AC4 — 서로 다른 key 는 독립(과억제 금지)", () => {
  const gate = makeAlarmRepeatGate();
  assertEquals(gate({ key: "unreg:A", signature: "open" }).kind, "initial");
  assertEquals(gate({ key: "unreg:B", signature: "open" }).kind, "initial"); // 다른 회선 독립 발화
});

// ── AC2·AC3: cadence 기술자 ──────────────────────────────────────────────────────
Deno.test("AC2·AC3 — cadence: 즉시/일일/주간 스케줄 매핑", () => {
  assertEquals(CADENCE[AlarmTier.IMMEDIATE].schedule, "on_event");
  assertEquals(CADENCE[AlarmTier.DAILY].schedule, "daily_digest");
  assertEquals(CADENCE[AlarmTier.WEEKLY].schedule, "weekly_digest");
});
