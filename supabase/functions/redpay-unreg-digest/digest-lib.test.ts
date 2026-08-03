// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — 단위검증(ef_only, CRM UI 동선 없음).
//   커버: dedup 키 정규화 · digest 집계 · 미등록 필터 · 등록전이 제외 · 발송억제(0건) · 행 포맷.
//   run: deno test supabase/functions/redpay-unreg-digest/digest-lib.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDigestText,
  buildEscalationText,
  daysSince,
  dedupKey,
  formatDigestRow,
  LONG_UNPROC_DAYS,
  partitionByRegistry,
  selectLongUnprocessed,
  type UnregRow,
} from "./digest-lib.ts";

function row(p: Partial<UnregRow>): UnregRow {
  return {
    id: p.id ?? "id-1",
    merchant_id: p.merchant_id ?? null,
    merchant_name: p.merchant_name ?? null,
    tid: p.tid ?? null,
    first_seen_at: p.first_seen_at ?? "2026-08-01T02:00:00Z", // 08-01 11:00 KST
    hit_count: p.hit_count ?? 1,
  };
}

// ── dedup 키 정규화 (RPC SQL 정규화 미러) ──────────────────────────────────────
Deno.test("dedupKey: merchant+tid 조합 안정 키", () => {
  assertEquals(dedupKey("1777289099", "1047470000"), "1777289099::1047470000");
});
Deno.test("dedupKey: trim 적용", () => {
  assertEquals(dedupKey("  1777289099 ", " 1047470000"), "1777289099::1047470000");
});
Deno.test("dedupKey: 부재값 ∅ 정규화 (같은 조합 = 같은 키 = dedup)", () => {
  assertEquals(dedupKey(null, null), "∅::∅");
  assertEquals(dedupKey("", ""), "∅::∅");
  assertEquals(dedupKey("1777289099", null), "1777289099::∅");
  assertEquals(dedupKey(null, "1047470000"), "∅::1047470000");
  // 같은 미등록 회선 반복 감지 → 동일 키 → 같은 행 증분(반복 금지).
  assertEquals(dedupKey("1777289099", "x"), dedupKey(" 1777289099 ", "x"));
});

// ── 미등록 필터 + 등록전이 제외 ────────────────────────────────────────────────
Deno.test("partitionByRegistry: 등록된 merchant 는 resolved(제외), 미등록만 남김", () => {
  const rows = [
    row({ id: "a", merchant_id: "REGISTERED_1" }),
    row({ id: "b", merchant_id: "UNREG_1" }),
    row({ id: "c", merchant_id: "REGISTERED_2" }),
    row({ id: "d", merchant_id: "UNREG_2" }),
  ];
  const active = new Set(["REGISTERED_1", "REGISTERED_2"]);
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, active);
  assertEquals(stillUnreg.map((r) => r.id), ["b", "d"]);
  assertEquals(resolvedIds.sort(), ["a", "c"]);
});

Deno.test("partitionByRegistry: 등록전이 — 이전 미등록이 registry 등록되면 다음 digest 제외", () => {
  const rows = [row({ id: "x", merchant_id: "M1" })];
  // 등록 전: M1 미등록 → digest 대상.
  assertEquals(partitionByRegistry(rows, new Set()).stillUnreg.length, 1);
  // 등록 후: M1 registry active → resolved(제외).
  const after = partitionByRegistry(rows, new Set(["M1"]));
  assertEquals(after.stillUnreg.length, 0);
  assertEquals(after.resolvedIds, ["x"]);
});

Deno.test("partitionByRegistry: AC5 — registry 조회 실패(빈 set) 시 전량 미등록 취급(유실 0)", () => {
  const rows = [row({ id: "a", merchant_id: "M1" }), row({ id: "b", merchant_id: "M2" })];
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, new Set());
  assertEquals(stillUnreg.length, 2);
  assertEquals(resolvedIds.length, 0);
});

Deno.test("partitionByRegistry: merchant 부재(∅) 행은 절대 resolved 안 됨(수동 확인 대상 유지)", () => {
  const rows = [row({ id: "n", merchant_id: null, tid: "1047470000" })];
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, new Set(["M1"]));
  assertEquals(stillUnreg.length, 1);
  assertEquals(resolvedIds.length, 0);
});

// ── 행 포맷 (각 행: 가맹점/회선/첫감지 M/D/누적 N건) ────────────────────────────
Deno.test("formatDigestRow: 티켓 지정 포맷", () => {
  const r = row({ merchant_id: "1777289099", tid: "1047470000", first_seen_at: "2026-08-01T02:00:00Z", hit_count: 12 });
  assertEquals(formatDigestRow(r), "• 가맹점 1777289099 / 회선 1047470000 (첫 감지 8/1, 누적 12건)");
});
Deno.test("formatDigestRow: 부재값 ∅ 표기", () => {
  const r = row({ merchant_id: null, tid: null, first_seen_at: "2026-08-01T02:00:00Z", hit_count: 3 });
  assertEquals(formatDigestRow(r), "• 가맹점 ∅ / 회선 ∅ (첫 감지 8/1, 누적 3건)");
});

// ── 발송 억제(0건 = 빈 digest 금지) + 요약 조립 ────────────────────────────────
Deno.test("buildDigestText: 미등록 0건 → 빈 문자열(발송 억제)", () => {
  assertEquals(buildDigestText([], "2026-08-03 09:00"), "");
});
Deno.test("buildDigestText: 미등록 ≥1 → 헤더 + 회선당 1행(같은 회선 반복 없음)", () => {
  const rows = [
    row({ id: "a", merchant_id: "M1", tid: "T1", hit_count: 5 }),
    row({ id: "b", merchant_id: "M2", tid: "T2", hit_count: 2 }),
  ];
  const text = buildDigestText(rows, "2026-08-03 09:00");
  const lines = text.split("\n");
  assertEquals(lines[0], "📋 *[레드페이 미등록 회선 요약 · 풋센터]* 2026-08-03 09:00");
  assertEquals(lines[1], "등록 대기 2개 회선 — redpay_terminal_registry 등록 필요");
  // 회선 행 2개(입력 2개 = 출력 2개, 중복 없음).
  const rowLines = lines.filter((l) => l.startsWith("• 가맹점"));
  assertEquals(rowLines.length, 2);
});

// ── AC7: 3일+ 장기 미처리 별도 에스컬레이션 ─────────────────────────────────────
const NOW = new Date("2026-08-06T00:00:00Z").getTime(); // 08-06 09:00 KST 기준
Deno.test("daysSince: 절대 경과일(floor)", () => {
  assertEquals(daysSince("2026-08-03T00:00:00Z", NOW), 3);
  assertEquals(daysSince("2026-08-05T23:00:00Z", NOW), 0);
  assertEquals(daysSince("2026-08-01T00:00:00Z", NOW), 5);
});
Deno.test("selectLongUnprocessed: 첫감지 경과 ≥ 3일만 선택", () => {
  const rows = [
    row({ id: "old3", merchant_id: "M1", first_seen_at: "2026-08-03T00:00:00Z" }), // 3일 → 포함
    row({ id: "old5", merchant_id: "M2", first_seen_at: "2026-08-01T00:00:00Z" }), // 5일 → 포함
    row({ id: "new1", merchant_id: "M3", first_seen_at: "2026-08-05T12:00:00Z" }), // <1일 → 제외
  ];
  const long = selectLongUnprocessed(rows, NOW);
  assertEquals(long.map((r) => r.id).sort(), ["old3", "old5"]);
  assertEquals(LONG_UNPROC_DAYS, 3);
});
Deno.test("buildEscalationText: 0건 → 빈 문자열(발송 억제)", () => {
  assertEquals(buildEscalationText([], "2026-08-06 09:00", NOW), "");
});
Deno.test("buildEscalationText: 장기 미처리 ≥1 → 에스컬레이션 헤더 + 경과일 표기", () => {
  const rows = [row({ id: "x", merchant_id: "1777289007", tid: "1047538243", first_seen_at: "2026-08-01T00:00:00Z", hit_count: 9 })];
  const text = buildEscalationText(rows, "2026-08-06 09:00", NOW);
  const lines = text.split("\n");
  assertEquals(lines[0], "🚨 *[레드페이 장기 미처리 에스컬레이션 · 풋센터]* 2026-08-06 09:00");
  assertEquals(lines[1].includes("3일 이상"), true);
  assertEquals(lines[3], "• 가맹점 1777289007 / 회선 1047538243 (첫 감지 8/1, 5일 경과, 누적 9건)");
});
