#!/usr/bin/env node
// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — C8 실 dispatch 증거 harness (supervisor FIX-REQUEST 재작업).
//   목적: digest 발송 경로(proven path slack_send.sh)가 실제 Slack 로 도달함을 end-to-end 로 증명.
//         prod redpay_unregistered_line_seen 조회 → partitionByRegistry(AC3) → buildDigestText(AC4) →
//         slack_send.sh 실발송(ok:true) → AC7 에스컬레이션 → (호출측이 seed/cleanup).
//   ⚠ 발송 채널은 CHANNEL env 로 주입(증거는 team-test C05QX8H16N7 로 — 현장 채널 노이즈 방지).
//      운영 발송 채널 = C0ATE5P6JTH(폴러 dispatchUnregDigest 기본), 이 경로가 현장 도달함은 prod log(폴러
//      [TID-ALARM-REALTIME] slack_send.sh→C0ATE5P6JTH 52256)로 이미 실증(동일 발송 규약).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  partitionByRegistry, buildDigestText, buildEscalationText, selectLongUnprocessed,
} from "./lib/redpay_unreg_digest_lib.mjs";

function loadEnvFile(p) { const o = {}; try { for (const l of readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); o[m[1]] = v; } } catch { /* */ } return o; }
const fileEnv = loadEnvFile(join(homedir(), ".env.redpay-foot"));
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).trim();
const U = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const K = cfg("SUPABASE_SERVICE_ROLE_KEY");
const CHANNEL = cfg("CHANNEL", "C05QX8H16N7"); // team-test (증거 전용)
const SLACK_SEND_SH = cfg("SLACK_SEND_SH", join(homedir(), "scripts", "slack_send.sh"));
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

function sendSlack(channel, text) {
  if (!existsSync(SLACK_SEND_SH)) { console.error(`slack_send.sh 없음: ${SLACK_SEND_SH}`); return false; }
  try { execFileSync("/bin/bash", [SLACK_SEND_SH, channel, text], { stdio: "pipe", timeout: 20000 }); return true; }
  catch (e) { console.error(`슬랙 발송 실패: ${e instanceof Error ? e.message : String(e)}`); return false; }
}

(async () => {
  const rows = await (await fetch(`${U}/rest/v1/redpay_unregistered_line_seen?resolved_at=is.null&select=id,merchant_id,merchant_name,tid,first_seen_at,hit_count&order=first_seen_at.asc`, { headers: H })).json();
  const reg = await (await fetch(`${U}/rest/v1/redpay_terminal_registry?domain=eq.foot&active=eq.true&select=merchant_id`, { headers: H })).json();
  const activeSet = new Set((reg || []).map((r) => r.merchant_id && String(r.merchant_id).trim()).filter(Boolean));
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, activeSet);
  const nowKST = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  console.log(`[C8] unresolved=${rows.length} registry_active_foot=${activeSet.size} stillUnreg=${stillUnreg.length} resolved(전이)=${resolvedIds.length}`);

  if (stillUnreg.length === 0) { console.log(`[C8] 미등록 0건 → no-send(정상). (positive send 는 seed 후 재실행)`); return; }
  const digestText = buildDigestText(stillUnreg, nowKST);
  console.log(`\n──── DIGEST 본문 (실제 발송 문안) ────\n${digestText}\n────────────────────────────`);
  const sent = sendSlack(CHANNEL, digestText);
  console.log(`[C8] digest slack_send.sh → channel=${CHANNEL} sent(ok)=${sent}`);

  const nowMs = Date.now();
  const longRows = selectLongUnprocessed(stillUnreg, nowMs);
  if (longRows.length > 0) {
    const escText = buildEscalationText(longRows, nowKST, nowMs);
    console.log(`\n──── AC7 에스컬레이션 본문 ────\n${escText}\n────────────────────────────`);
    const eSent = sendSlack(CHANNEL, escText);
    console.log(`[C8] AC7 escalation slack_send.sh → channel=${CHANNEL} sent(ok)=${eSent} long=${longRows.length}`);
  } else {
    console.log(`[C8] AC7 장기미처리 0건 → escalation no-send.`);
  }
})();
