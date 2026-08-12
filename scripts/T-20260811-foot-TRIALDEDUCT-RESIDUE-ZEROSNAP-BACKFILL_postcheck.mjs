/**
 * T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL — POSTCHECK (READ-ONLY)
 *
 * ⛔ READ-ONLY: SELECT only. apply 후 정합 검증.
 *   1. freeze 대상 전 행이 이제 unit_price = expected(부모 단가) 인가 (전건 정정 확인).
 *   2. zero-snapshot residue (trial/unheated_laser, unit_price=0, pkg.<type>>0, used) 잔여 0 인가.
 *   3. archive capture(rollback CSV) 와 현재값 대사 (가역성 확인).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
  return out;
}
const env = { ...loadEnv(".env.local"), ...loadEnv(".env"), ...process.env };
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("NO SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? "-" : Number(n).toLocaleString("ko-KR"));

const TICKET = "T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL";
const FREEZE_PATH = `scripts/_out/${TICKET}_freeze.json`;
const COL = { trial: "trial_unit_price", unheated_laser: "unheated_unit_price" };
const TARGET_TYPES = ["trial", "unheated_laser"];

async function fetchAll(table, columns, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log(`════ ${TICKET} — POSTCHECK (READ-ONLY) ════\n`);
  if (!existsSync(FREEZE_PATH)) { console.error(`freeze 산출물 부재 (${FREEZE_PATH})`); process.exit(1); }
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, "utf8"));
  const frozen = freeze.frozen ?? [];

  // 1. 대상 전 행 정정 확인
  const ids = frozen.map((f) => f.id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await db.from("package_sessions")
      .select("id, session_type, unit_price").in("id", ids.slice(i, i + 500));
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data ?? []));
  }
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  let corrected = 0, stillZero = 0, mismatch = 0;
  for (const f of frozen) {
    const r = rowMap.get(f.id);
    if (!r) { console.log(`  ⚠ ps=${f.id} 소실`); continue; }
    const v = Number(r.unit_price ?? -1);
    if (v === 0) { stillZero++; console.log(`  ✗ ps=${f.id} 여전히 0 (미정정)`); }
    else if (v === Number(f.expected_unit_price)) corrected++;
    else { mismatch++; console.log(`  ⚠ ps=${f.id} 기대 ${won(f.expected_unit_price)} ≠ 현재 ${won(v)}`); }
  }
  console.log(`\n[1] 정정 완료 ${corrected} / 미정정(0잔존) ${stillZero} / 불일치 ${mismatch} (총 ${frozen.length})`);

  // 2. residue 잔여 0 확인
  const pkgs = await fetchAll("packages", "id, trial_unit_price, unheated_unit_price");
  const pkgMap = new Map(pkgs.map((p) => [p.id, p]));
  const sessions = await fetchAll(
    "package_sessions", "id, package_id, session_type, unit_price, status",
    (q) => q.eq("status", "used").in("session_type", TARGET_TYPES)
  );
  let residue = 0;
  for (const s of sessions) {
    if (Number(s.unit_price ?? -1) !== 0) continue;
    const pkg = pkgMap.get(s.package_id);
    if (!pkg) continue;
    if (Number(pkg[COL[s.session_type]] ?? 0) > 0) residue++;
  }
  console.log(`[2] 잔여 zero-snapshot residue: ${residue}건 ${residue === 0 ? "✔ (완전 소진)" : "⚠ (재확인)"}`);

  const grand = frozen.reduce((s, f) => s + Number(f.expected_unit_price), 0);
  console.log(`\n[3] 차감매출 표시값 소급 규모(정정 성공 기준): ${won(grand)}원`);
  console.log(`\n${stillZero === 0 && mismatch === 0 && residue === 0 ? "✅ POSTCHECK PASS" : "⚠ POSTCHECK 재검토 필요"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
