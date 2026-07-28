#!/usr/bin/env node
/**
 * T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY — STEP1 read-only probe
 *
 * 목적(planner NEW-TASK): Axis B census 부산물 관찰 1건 검증.
 *   관찰: TID 1047479158 / merchant 1777289012 / 풋 무선 / net ₩0 / DB 미적재.
 *   질문: 다음 폴 사이클(들)에 이 TID가 redpay_raw_transactions에 (재)적재되는가?
 *     · 적재 확정 → 일시적 캡처 갭(self-heal). 관찰 종결. STEP2 불필요.
 *     · 미적재(폴 사이클 지나도 없음) → 실 캡처 갭. STEP2 승격 요청.
 *
 * ★ no-DDL / no-data-write / read-only. registry SSOT 무접촉.
 *   service_role GET 만 수행(redpay_raw_transactions / redpay_poller_state).
 *
 * 사실 기준(코드 확인):
 *   · 1777289012 ∈ FOOT_MERCHANT_WHITELIST_DEFAULT (무선5) — admit 권위 통과 대상.
 *   · 1047479158  ∈ FOOT_TID_WHITELIST_DEFAULT (무선5) — 등록 TID(drift 아님).
 *   ⇒ 필터 배제 원인 아님. net ₩0(승인+취소 상쇄) 캡처 타이밍 관찰건.
 *
 * author: dev-foot / 2026-07-29
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* ignore */ }
  return out;
}
const fileEnv = {
  ...loadEnvFile(join(process.cwd(), ".env.local")),
  ...loadEnvFile(join(homedir(), ".env.redpay-foot")),
  ...loadEnvFile(join(homedir(), ".env.redpay")),
};
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).trim();

const SUPABASE_URL = cfg("SUPABASE_URL", cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co"));
const KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
if (!KEY) { console.error("SERVICE_ROLE_KEY 없음 — .env.local 확인"); process.exit(2); }

const TID = "1047479158";
const MERCHANT = "1777289012";

async function get(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET 실패 ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : [];
}

(async () => {
  console.log(`[STEP1-PROBE] ${new Date().toISOString()} — TID ${TID} / merchant ${MERCHANT} 적재 여부 검증`);

  // 1) tid 컬럼 직접 조회
  const byTid = await get(
    `redpay_raw_transactions?tid=eq.${TID}&select=id,external_trxid,external_status,amount,tid,approved_at,cancelled_at,created_at,clinic_id&order=created_at.desc&limit=50`
  );
  console.log(`\n[1] redpay_raw_transactions WHERE tid=${TID} → ${byTid.length}행`);
  for (const r of byTid) {
    console.log(`   trxid=${r.external_trxid} status=${r.external_status} amount=${r.amount} approved=${r.approved_at} cancelled=${r.cancelled_at} created=${r.created_at}`);
  }

  // 2) external_trxid 로도 조회(관찰 원본이 trxid를 TID로 라벨했을 가능성 방어)
  const byTrxid = await get(
    `redpay_raw_transactions?external_trxid=eq.${TID}&select=id,external_trxid,external_status,amount,tid,created_at&limit=20`
  );
  console.log(`\n[2] redpay_raw_transactions WHERE external_trxid=${TID} → ${byTrxid.length}행`);
  for (const r of byTrxid) {
    console.log(`   trxid=${r.external_trxid} status=${r.external_status} amount=${r.amount} tid=${r.tid} created=${r.created_at}`);
  }

  // 3) 폴러 heartbeat — 적재死 vs 거래없음 구분(get_redpay_feed_freshness 소스값)
  try {
    const st = await get(`redpay_poller_state?id=eq.1&select=*`);
    console.log(`\n[3] redpay_poller_state(id=1):`);
    console.log("   ", JSON.stringify(st[0] ?? null));
  } catch (e) {
    console.log(`\n[3] redpay_poller_state 조회 실패(비치명): ${e.message}`);
  }

  // 판정
  const present = byTid.length > 0 || byTrxid.length > 0;
  console.log(`\n[VERDICT] TID ${TID} raw_transactions 적재 = ${present ? "YES(적재됨)" : "NO(미적재)"}`);
  if (present) {
    console.log("   → self-heal 가능성(일시적 캡처 갭). 승인/취소 상쇄(net ₩0) 행 존재 시 정상.");
  } else {
    console.log("   → 이번 조회 시점 미적재. 다음 폴 사이클 후 재확인 필요.");
  }
})().catch((e) => { console.error("PROBE ERROR:", e.message); process.exit(1); });
