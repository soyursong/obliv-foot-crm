// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX — 파트A 재검증 replay (FIX-REQUEST §5)
//
// 실행: deno run scripts/T-20260724-foot-REDPAY-DOSU-CONTAM-FIX_reverify285002.ts
//
// 목적: 7/23 daily_full 대표 신호 지문을 **수정 후 실제 scope-filter.ts 모듈**로 재생(replay)하여
//   (a) 도수 62071914(merchant 1777276003, 2행) 재유입 0 (DROP)
//   (b) 풋2 VAN 285002(merchant 1777285002, tid 1047535843) 정상 유입 유지 (KEEP, tidWhitelist 비어도)
//   를 동시 재현. deploy 前에도 결정론적으로 CODE 정합을 증명(라이브 re-pull 은 deploy 이후 별건).
//
// 지문 출처(권위): registry §8 / 8loci-audit / RESIDUAL-CAPTURE-RC done_log
//   62071914 = merchant 1777276003 (도수, 승인취소 2행) — DOSU-CONTAM leak 벡터
//   285002    = merchant 1777285002 (풋2 VAN), tid 1047535843, 승인 23005414/30031451/30024628 (미적재 3건 RC)

import { filterToFootScope, FOOT_MERCHANT_SET } from "../supabase/functions/redpay-reconcile/scope-filter.ts";
import { FOOT_MERCHANT_SET as SHARED_FOOT } from "../supabase/functions/_shared/redpay-foot-merchants.ts";

// 7/23 daily_full 대표 신호 지문(권위 지문 기반 재구성). merchant_id 1차 권위 판정 대상.
const items = [
  // ── (a) 도수 62071914 leak 벡터 (재유입 0 이어야 함) ──
  { tid: "1047479115", merchant: { id: "1777276003" }, approval_no: "62071914", label: "도수 62071914(승인)" },
  { tid: "1047479115", merchant: { id: "1777276003" }, approval_no: "62071914", label: "도수 62071914(취소쌍)" },
  // ── (b) 풋2 VAN 285002 (정상 유입 유지 = KEEP) ──
  { tid: "1047535843", merchant: { id: "1777285002" }, approval_no: "23005414", label: "풋2 285002(RC 미적재#1)" },
  { tid: "1047535843", merchant: { id: "1777285002" }, approval_no: "30031451", label: "풋2 285002(RC 미적재#2)" },
  { tid: "1047535843", merchant: { id: "1777285002" }, approval_no: "30024628", label: "풋2 285002(RC 미적재#3)" },
  // ── 대조군: 기존 풋 VAN(285001) keep 유지 ──
  { tid: "1047479255", merchant: { id: "1777285001" }, approval_no: "PF285001", label: "풋1 285001(회귀 대조)" },
];

// tidWhitelist 를 비워 TID 폴백을 봉쇄 → merchant 1차 권위만으로 판정(회귀 조건 재현).
const { kept, dropped } = filterToFootScope(items, new Set<string>());

console.log("═══ DOSU-CONTAM-FIX §5 재검증 replay (tidWhitelist=∅, merchant 1차 권위) ═══");
console.log(`FOOT_MERCHANT_SET size = ${FOOT_MERCHANT_SET.size} (기대 27) | _shared size = ${SHARED_FOOT.size} (기대 27)`);
console.log(`285002 ∈ reconcile set = ${FOOT_MERCHANT_SET.has("1777285002")} | ∈ _shared = ${SHARED_FOOT.has("1777285002")}`);
console.log("");
console.log("── KEEP ──");
for (const k of kept) console.log(`  KEEP  merchant=${k.merchant.id} approval=${k.approval_no}  ${k.label}`);
console.log("── DROP ──");
for (const d of dropped) console.log(`  DROP  merchant=${d.merchant.id} approval=${d.approval_no}  ${d.label}`);
console.log("");

// 판정 assertion
const dosuReinflux = kept.filter((k) => k.approval_no === "62071914").length;
const foot2Kept = kept.filter((k) => k.merchant.id === "1777285002").length;
const foot1Kept = kept.filter((k) => k.merchant.id === "1777285001").length;

const passA = dosuReinflux === 0;                 // 도수 재유입 0
const passB = foot2Kept === 3;                    // 풋2 285002 3건 전량 유입 유지
const passC = foot1Kept === 1;                    // 기존 풋 회귀 없음
const pass27 = FOOT_MERCHANT_SET.size === 27 && SHARED_FOOT.size === 27 && FOOT_MERCHANT_SET.has("1777285002") && SHARED_FOOT.has("1777285002");

console.log("═══ 판정 ═══");
console.log(`  (a) 도수 62071914 재유입 0        : ${passA ? "PASS" : "FAIL"} (재유입=${dosuReinflux})`);
console.log(`  (b) 풋2 VAN 285002 유입 유지(3/3) : ${passB ? "PASS" : "FAIL"} (keep=${foot2Kept})`);
console.log(`  (c) 기존 풋 285001 회귀 없음      : ${passC ? "PASS" : "FAIL"} (keep=${foot1Kept})`);
console.log(`  (d) 27-set staleness-seal        : ${pass27 ? "PASS" : "FAIL"}`);

const allPass = passA && passB && passC && pass27;
console.log("");
console.log(allPass ? "✅ ALL PASS — 도수 재유입 0 & 풋2 285002 유입 유지 동시 재현(회귀 없음)" : "❌ FAIL");
if (!allPass) Deno.exit(1);
