// scripts/lib/redpay_unreg_digest.test.mjs
// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — 순수 로직 self-test (네트워크 無, e2e_spec_exempt: ef_only 대체).
//   run: node scripts/lib/redpay_unreg_digest.test.mjs
import {
  detectionKey, kstMonthDay, kstDateStr, daysElapsed,
  accruePollerDetection, seedWatchdogDetection, pruneResolvedEntries,
  buildDailyDigest, selectLongUnprocessed, markLongUnprocessedAlerted,
} from "./redpay_unreg_digest.mjs";

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ FAIL: ${msg}`); }
}

console.log("[redpay-unreg-digest] self-test 시작");

// ── 키/날짜 헬퍼 ──
assert(detectionKey("1777289007", "1047538243") === "tid:1047538243", "detectionKey: tid 우선");
assert(detectionKey("1777289099", null) === "mer:1777289099", "detectionKey: tid 없으면 merchant");
assert(daysElapsed("2026-08-01T00:00:00Z", "2026-08-04T00:00:00Z") === 3, "daysElapsed: 3일");
assert(kstMonthDay("2026-08-03T15:00:00Z") === "8/4", "kstMonthDay: UTC→KST 날짜 넘어감(8/3 15:00Z = 8/4 KST 0시)");

// ── AC1: 폴러 누적 (첫 감지일 1회 고정, 누적 건수 += ) ──
const state = { version: 5, unreg_digest: {} };
accruePollerDetection(state, { merchant_id: "1777289099", merchant_name: "풋케어(신규VAN)", tid: "T99", trx_count: 2 }, "2026-08-01T00:10:00Z");
accruePollerDetection(state, { merchant_id: "1777289099", merchant_name: "풋케어(신규VAN)", tid: "T99", trx_count: 3 }, "2026-08-01T00:20:00Z");
const e99 = state.unreg_digest["tid:T99"];
assert(e99.first_seen_at === "2026-08-01T00:10:00Z", "AC1: 첫 감지일은 최초 1회 고정(재감지에도 불변)");
assert(e99.cumulative_count === 5, `AC1: 누적 건수 = 2+3 = 5 (실제 ${e99.cumulative_count})`);

// ── AC2/AC3/AC4: 발송 시점 여전히 미등록인 회선만, 포맷 ──
// T99 는 여전히 미등록, TREG 는 그 사이 등록완료(→ current 에서 빠짐)
accruePollerDetection(state, { merchant_id: "1777289007", merchant_name: "풋(멀티)", tid: "TREG", trx_count: 1 }, "2026-08-01T01:00:00Z");
const currentLines = [{ merchant_id: "1777289099", merchant_name: "풋케어(신규VAN)", tid: "T99", trx_count: 5 }];
const currentKeys = new Set(currentLines.map((l) => detectionKey(l.merchant_id, l.tid)));
const released = pruneResolvedEntries(state, currentKeys);
assert(released.includes("tid:TREG"), "AC3: 등록완료(미감지) 회선 상태 제거(auto-release)");
assert(!state.unreg_digest["tid:TREG"], "AC3: 제거된 회선은 digest 대상에서 빠짐");
const digest = buildDailyDigest(currentLines, state);
assert(digest.count === 1, `AC2: 미등록 회선 1건만 요약 (실제 ${digest.count})`);
assert(/미등록 회선 1건/.test(digest.text), "AC4: 헤더에 총 건수");
assert(/가맹점 1777289099 \/ 회선 T99 \(첫 감지 .+, 누적 5건\)/.test(digest.text), "AC4: 행 포맷(가맹점/회선/첫감지/누적)");

// ── AC5: 미등록 0건이면 요약 미발송(count 0) ──
const emptyDigest = buildDailyDigest([], state);
assert(emptyDigest.count === 0 && emptyDigest.text === null, "AC5: 미등록 0건 → 요약 text 없음(무발송)");

// ── 워치독 seed (폴러 미관측 회선 fallback, 이중계상 방지) ──
const state2 = { version: 5, unreg_digest: {} };
seedWatchdogDetection(state2, { merchant_id: "1777289055", merchant_name: "풋(신규)", tid: "TW1", trx_count: 4 }, "2026-08-02T00:00:00Z");
assert(state2.unreg_digest["tid:TW1"].cumulative_count === 4, "watchdog seed: 폴러 미관측 회선 fallback 누적");
seedWatchdogDetection(state2, { merchant_id: "1777289055", merchant_name: "풋(신규)", tid: "TW1", trx_count: 99 }, "2026-08-03T00:00:00Z");
assert(state2.unreg_digest["tid:TW1"].cumulative_count === 4, "watchdog seed: 기존 엔트리 누적 미변경(폴러 소유·이중계상 방지)");
assert(state2.unreg_digest["tid:TW1"].first_seen_at === "2026-08-02T00:00:00Z", "watchdog seed: 첫 감지일 불변");

// ── AC7: 3일+ 장기 미처리 별도 알림 + 회선당 1회/일 상한 ──
const state3 = { version: 5, unreg_digest: {}, long_unproc_alerted: {} };
// 8/1 첫 감지, 8/4 판정 = 3일 경과 → 장기 미처리
accruePollerDetection(state3, { merchant_id: "1777289099", merchant_name: "풋(신규)", tid: "T99", trx_count: 3 }, "2026-08-01T00:00:00Z");
// 8/3 첫 감지 = 1일 경과 → 장기 미처리 아님
accruePollerDetection(state3, { merchant_id: "1777289100", merchant_name: "풋(신규2)", tid: "T100", trx_count: 1 }, "2026-08-03T00:00:00Z");
const cur3 = [
  { merchant_id: "1777289099", tid: "T99" },
  { merchant_id: "1777289100", tid: "T100" },
];
const long1 = selectLongUnprocessed(cur3, state3, "2026-08-04T00:00:00Z", 3);
assert(long1.count === 1 && long1.rows[0].tid === "T99", "AC7: 3일+ 회선만 에스컬레이션(1일 회선 제외)");
assert(/장기 방치 에스컬레이션/.test(long1.text) && /3일째 미처리/.test(long1.text), "AC7: 헤더에 '장기 방치' 목적 명시");
markLongUnprocessedAlerted(state3, long1.rows, long1.today);
// 같은 날 재실행 → 상한으로 억제
const long2 = selectLongUnprocessed(cur3, state3, "2026-08-04T06:00:00Z", 3);
assert(long2.count === 0, "AC7: 같은 날 재실행 시 회선당 1회/일 상한으로 억제");
// 다음 날 → 다시 발송
const long3 = selectLongUnprocessed(cur3, state3, "2026-08-05T00:00:00Z", 3);
assert(long3.count === 1, "AC7: 다음 날 여전히 미등록이면 재에스컬레이션(방치 계속 알림)");

console.log(`\n[redpay-unreg-digest] self-test 완료: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
