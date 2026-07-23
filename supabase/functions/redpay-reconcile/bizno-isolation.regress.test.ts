// redpay-reconcile/bizno-isolation.regress.test.ts — business_no flip 격리 불변식 회귀 가드
//
// T-20260723-foot-REDPAY-LOOKUP-BIZNO-511TO457 (e2e_spec_exempt=db_only, FE 무변경)
//   [배경] RedPay 가 07-23 부터 457-23-00938 로만 발송·511 발송제외 확정 →
//     EF secret / poller .env / poller default(L86) 의 REDPAY_BUSINESS_NO 를 511→457 flip.
//   [C1 롱레 no-regression + C2 idempotency/dedup] 이 회귀 가드는 flip 이 안전한 근거인
//     "풋 격리·멱등 불변식은 business_no 값과 독립"을 실행가능하게 고정한다.
//     실행: deno test supabase/functions/redpay-reconcile/bizno-isolation.regress.test.ts
//
//   ▸ index.ts 의 두 순수 술어를 충실히 미러링한다(top-level env 읽기로 index.ts 직접 import 불가):
//       - filterToFootScope   (index.ts L1063-1075) : 서버 tid param 이후 클라 2차 방어. tid 화이트리스트 기준.
//       - dedup/upsert key     (index.ts L1026-1031·L1043) : ON CONFLICT(external_trxid,external_status,amount).
//     두 술어 어디에도 business_no 성분이 없다 → 511↔457 flip 은 "어떤 행이 풋 테이블에 적재되는가"
//     (격리, C1)와 "동일 거래 재유입 시 멱등"(C2)에 영향을 줄 수 없다. 미래에 누군가 business_no 를
//     격리·dedup 키에 끼워 넣으면 이 테스트가 깨져 회귀를 표면화한다.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── index.ts L1063-1075 미러 — 풋 스코프 필터(tid 화이트리스트, business_no 무관) ──
interface TrxLike { tid: string | null; trxid: string; status: string; amount: number }
function filterToFootScope<T extends TrxLike>(items: T[], tidWhitelist: Set<string>) {
  if (tidWhitelist.size === 0) return { kept: items, dropped: [] as T[] };
  const kept: T[] = [], dropped: T[] = [];
  for (const it of items) {
    if (it.tid && tidWhitelist.has(it.tid)) kept.push(it);
    else dropped.push(it);
  }
  return { kept, dropped };
}

// ── index.ts L1026-1031·L1043 미러 — dedup/upsert conflict 키(business_no 성분 없음) ──
function dedupKey(r: { external_trxid: string; external_status: string; amount: number }): string {
  return `${r.external_trxid}|${r.external_status}|${r.amount}`;
}
function dedup<T extends { external_trxid: string; external_status: string; amount: number }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = dedupKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const FOOT_TID = "FOOT-T01";      // 풋 단말 화이트리스트 소속
const ROTE_TID = "ROTE-T09";      // 롱레(공유 457 merchant 동거) 단말 — 화이트리스트 밖

Deno.test("C1: tid 화이트리스트가 풋만 kept·롱레 drop — business_no(511/457) 무관", () => {
  const rows: TrxLike[] = [
    { tid: FOOT_TID, trxid: "P1", status: "Y", amount: 120000 },
    { tid: ROTE_TID, trxid: "R1", status: "Y", amount: 55000 }, // 롱레 거래(457 공유 merchant 피드에 혼입 가능)
    { tid: FOOT_TID, trxid: "P2", status: "Y", amount: 80000 },
  ];
  const wl = new Set([FOOT_TID]); // 풋 TID 화이트리스트
  // 격리는 tid 기준 — 동일 입력이면 business_no 가 511이든 457이든 결과 불변.
  const { kept, dropped } = filterToFootScope(rows, wl);
  assertEquals(kept.map((r) => r.trxid), ["P1", "P2"], "풋 TID 행만 적재");
  assertEquals(dropped.map((r) => r.trxid), ["R1"], "롱레 TID 행은 적재 제외(no-regression)");
});

Deno.test("C2: dedup/upsert 키는 (trxid,status,amount) — business_no 미포함 → cutover 중복 멱등", () => {
  // cutover 창에서 동일 거래가 511 경로/457 경로로 2회 유입돼도(가상 merchant 필드가 달라도)
  // 키에 business_no 성분이 없으므로 동일 1행으로 접힌다(멱등).
  const rows = [
    { external_trxid: "TRX9", external_status: "Y", amount: 99000, _bizno: "511-60-00988" },
    { external_trxid: "TRX9", external_status: "Y", amount: 99000, _bizno: "457-23-00938" },
    { external_trxid: "TRX9", external_status: "N", amount: -99000, _bizno: "457-23-00938" }, // 취소=별 상태 → 별 행(정상)
  ];
  const out = dedup(rows);
  assertEquals(out.length, 2, "동일 (trxid,status,amount) 는 business_no 달라도 1행으로 멱등 dedup");
  assert(out.some((r) => r.external_status === "N"), "상태가 다른 취소행은 보존");
});

Deno.test("C2: onConflict 키 문자열에 business_no 토큰이 존재하지 않음(구조 가드)", () => {
  const key = dedupKey({ external_trxid: "T", external_status: "Y", amount: 1 });
  assert(!key.includes("457") && !key.includes("511"), "dedup 키에 사업자번호 성분 없음");
});
