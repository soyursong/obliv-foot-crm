#!/usr/bin/env node
/**
 * T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED — Task C: 재처리 backlog + 실발송 evidence (READ-ONLY)
 *
 * 확인: (1) 최근 7일/48h/24h notification_logs 상태분포(지점별) — pending 적체 실측.
 *       (2) notify_retry_failed() cron 이 실제로 집을 대상 = status IN (failed,pending) AND created_at>48h, LIMIT 50/run.
 *          → 48h 밖 pending 은 자동 재처리 대상이 아님(스트랜드). 재처리는 이미 스로틀(50건/30분).
 *       (3) 충전 후 실발송 성공 evidence = 최근 sent 카운트/시각(응답 solapi_message_id 有).
 * DB write 0 / 발송 0.
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
const fileEnv = { ...loadEnvFile(join(homedir(), ".env.redpay-foot")), ...loadEnvFile(join(process.cwd(), ".env.local")) };
const cfg = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).toString().trim();
const SUPABASE_URL = (cfg("SUPABASE_URL") || cfg("VITE_SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co")).replace(/\/$/, "");
const SRK = cfg("SUPABASE_SERVICE_ROLE_KEY");
const H = () => ({ apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" });

async function get(pq) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pq}`, { headers: { ...H(), Prefer: "count=exact" } });
  const cr = res.headers.get("content-range");
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  return { rows: body ? JSON.parse(body) : [], total: cr ? Number(cr.split("/")[1]) : null };
}

const CLINICS = { "74967aea": "종로", "b4dc0de5": "송도" };
async function countBy(iso, status, clinicShort) {
  // clinic_id 는 full uuid 필요 → prefix 매칭 불가. capability 에서 full id 확보.
  return null;
}

async function main() {
  if (!SRK) { console.error("SERVICE_ROLE_KEY 미설정"); process.exit(1); }
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600 * 1000).toISOString();
  console.log(`[REPROCESS-BACKLOG-VERIFY] READ-ONLY @ ${new Date().toISOString()} (KST ${new Date(now + 9 * 3600e3).toISOString()})\n`);

  // clinic full id 매핑
  const caps = (await get("clinic_messaging_capability?select=clinic_id,clinics(name)")).rows;
  const idByShort = {};
  for (const c of caps) for (const s of Object.keys(CLINICS)) if (String(c.clinic_id).startsWith(s)) idByShort[s] = c.clinic_id;

  for (const [label, hours] of [["7일", 168], ["48h(재처리창)", 48], ["24h", 24]]) {
    console.log(`── 최근 ${label} notification_logs 상태분포 ──`);
    for (const st of ["sent", "failed", "pending", "skipped", "opt_out"]) {
      const { total } = await get(`notification_logs?created_at=gte.${encodeURIComponent(iso(hours))}&status=eq.${st}&select=id`);
      if (total) console.log(`   ${st.padEnd(8)}: ${total}`);
    }
    console.log("");
  }

  // 지점별 pending (재처리 대상 후보) — 7일 vs 48h
  console.log("── 지점별 pending 적체 (7일 vs 48h 재처리창) ──");
  for (const s of Object.keys(CLINICS)) {
    const fid = idByShort[s];
    if (!fid) { console.log(`   ${CLINICS[s]}: capability 매핑 실패`); continue; }
    const p7 = (await get(`notification_logs?clinic_id=eq.${fid}&status=eq.pending&created_at=gte.${encodeURIComponent(iso(168))}&select=id`)).total;
    const p48 = (await get(`notification_logs?clinic_id=eq.${fid}&status=eq.pending&created_at=gte.${encodeURIComponent(iso(48))}&select=id`)).total;
    const f7 = (await get(`notification_logs?clinic_id=eq.${fid}&status=eq.failed&created_at=gte.${encodeURIComponent(iso(168))}&select=id`)).total;
    const f48 = (await get(`notification_logs?clinic_id=eq.${fid}&status=eq.failed&created_at=gte.${encodeURIComponent(iso(48))}&select=id`)).total;
    console.log(`   ${CLINICS[s]}: pending 7일=${p7} / 48h(재처리대상)=${p48} · failed 7일=${f7} / 48h=${f48}`);
    console.log(`         → 48h 밖 pending ${p7 - p48}건 = notify_retry_failed 자동 재처리 대상 아님(스트랜드)`);
  }
  console.log("");

  // 실발송 성공 evidence — 최근 sent (solapi_message_id 有) 표본
  console.log("── 실발송 성공 evidence (최근 sent, solapi_message_id 有) ──");
  const sent = (await get(`notification_logs?status=eq.sent&solapi_message_id=not.is.null&select=clinic_id,event_type,sent_at,solapi_message_id&order=sent_at.desc&limit=8`)).rows;
  if (!sent.length) console.log("   ⚠ 최근 실발송 성공(sent+msgId) 레코드 없음 — 정상화 미확인.");
  for (const r of sent) {
    const s = Object.keys(CLINICS).find((k) => String(r.clinic_id).startsWith(k));
    console.log(`   [${s ? CLINICS[s] : "?"}] ${r.event_type} sent_at=${r.sent_at} msgId=${String(r.solapi_message_id).slice(0, 12)}…`);
  }
  const lastSentAll = (await get(`notification_logs?status=eq.sent&select=sent_at&order=sent_at.desc&limit=1`)).rows[0];
  console.log(`\n   최종 sent 시각(전체): ${lastSentAll?.sent_at ?? "없음"}`);

  // no-template 별건 잔존
  console.log("\n── no-template 실패(별건 T-20260725-...-NO-TEMPLATE-RESOLVE-FAIL) 최근 7일 ──");
  const nt = (await get(`notification_logs?status=eq.failed&error_message=like.*template*&created_at=gte.${encodeURIComponent(iso(168))}&select=id`)).total;
  console.log(`   no-template 실패: ${nt}건 (충전 무관 — 충전해도 계속 실패, 정상화 보고 시 함께 명시)`);
}
main().catch((e) => { console.error(`오류: ${e.stack || e.message}`); process.exit(1); });
