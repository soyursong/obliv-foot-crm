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
  retentionCutoffIso,
  groupPendingByAmount,
  selectCandidateRaw,
  type PendingRow,
  type RawRow,
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
