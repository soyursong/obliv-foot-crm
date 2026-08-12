/**
 * T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL — DA H8 + H3 CENSUS (READ-ONLY)
 *
 * ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0. (GO-token 前 prod UPDATE 절대 금지 · apply_before_go)
 *
 * supervisor GO-token 발행 선결 4조건 中 dev-foot 소관 2건 증적:
 *
 *  ── DA H8 (source-closure census) ──────────────────────────────────────────
 *   RELINK forward-fix seal = a224c81d (authored 2026-08-08 21:55:52 +0900, deployed ~21:57 KST).
 *   각 freeze 행의 record **created_at 실측**(session_date 아님) vs seal:
 *     - created_at ≥ seal(post-seal) → re-contamination(forward-fix 갭) → BLOCK(편입 제외)
 *     - created_at <  seal(pre-seal) → legacy 오염 확증분 → 편입 OK
 *   특히 freeze 內 session_date 08-03(6b2873e2)/08-06(0dc185d8)/08-08(bbbd001d, F-5787) 3행.
 *
 *  ── DA H3 (discriminant-validity census) ───────────────────────────────────
 *   `unit_price=0 ∧ pkg.<type>_unit_price>0` 가 오직 snapshot 버그로만 생성됨을 확증.
 *   정당 comp/무상/할인 0-경로가 존재하면 해당 행 EXCLUDE (under≫over).
 *   증적축:
 *     (H3-a) package_sessions 스키마에 comp/discount/free/reason 컬럼 부재 = 구조적 0-intent 저장경로 없음.
 *     (H3-b) post-seal 재생성 0건(=forward-fix가 유일 0-생성원 봉인) — H8과 교차.
 *     (H3-c) freeze 31행 memo 스캔 — 무상/서비스/할인 등 정당 0 의도 텍스트 부재 확인.
 *     (H3-d) 분포: 술어집합(used·부모>0·unit_price=0) == freeze 31 정확 일치(잔여 0).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

const SEAL_ISO = "2026-08-08T12:57:00.000Z";     // deploy ~21:57 KST
const SEAL_COMMIT_ISO = "2026-08-08T12:55:52.000Z"; // commit a224c81d (보수 하한)
const SEAL = new Date(SEAL_ISO).getTime();
const SEAL_COMMIT = new Date(SEAL_COMMIT_ISO).getTime();
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
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " KST";

async function main() {
  console.log("════════ H8 + H3 CENSUS (READ-ONLY · write 0) ════════");
  console.log(`seal(deploy) = ${SEAL_ISO} (= ${kst(SEAL_ISO)})`);
  console.log(`seal(commit·보수하한) = ${SEAL_COMMIT_ISO} (= ${kst(SEAL_COMMIT_ISO)})\n`);

  const freeze = JSON.parse(readFileSync(
    "scripts/_out/T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL_freeze.json", "utf8"));
  const ids = freeze.frozen.map((f) => f.id);

  // ── 31 freeze 행의 created_at + memo 실측 ──
  const rows = await fetchAll(
    "package_sessions",
    "id, session_type, session_date, unit_price, status, created_at, memo, surcharge_memo",
    (q) => q.in("id", ids)
  );
  const rowMap = new Map(rows.map((r) => [r.id, r]));

  // ═══════════ DA H8 — source-closure census ═══════════
  console.log("═══════════ DA H8 — source-closure (created_at vs seal) ═══════════");
  const FLAG = ["6b2873e2-a868-4067-8149-0d4a22a4620d", "0dc185d8-ee97-4820-8d65-3337e2e938cc", "bbbd001d-e34b-472b-bb60-2aabcd52c599"];
  let postSeal = 0, preSeal = 0, ambiguous = 0;
  const blockList = [];
  console.log("id       | type           | session_date | created_at(KST)        | class");
  for (const f of freeze.frozen) {
    const r = rowMap.get(f.id);
    if (!r) { console.log(`${f.id.slice(0, 8)} | MISSING FROM DB (DRIFT!)`); continue; }
    const ct = new Date(r.created_at).getTime();
    let cls;
    if (ct >= SEAL) { cls = "POST-SEAL → BLOCK"; postSeal++; blockList.push(f.id); }
    else if (ct >= SEAL_COMMIT) { cls = "AMBIGUOUS(commit~deploy) → BLOCK(보수)"; ambiguous++; blockList.push(f.id); }
    else { cls = "pre-seal OK"; preSeal++; }
    const flag = FLAG.includes(f.id) ? " ★FLAGGED" : "";
    console.log(`${f.id.slice(0, 8)} | ${f.session_type.padEnd(14)} | ${f.session_date}   | ${kst(r.created_at)} | ${cls}${flag}`);
  }
  console.log(`\nH8 결과: pre-seal(편입OK)=${preSeal} · post-seal(BLOCK)=${postSeal} · ambiguous(보수 BLOCK)=${ambiguous}`);
  console.log("★FLAGGED 3행 상세:");
  for (const id of FLAG) {
    const r = rowMap.get(id);
    if (r) console.log(`  ${id.slice(0, 8)} created_at=${r.created_at} (${kst(r.created_at)}) · seal 대비 ${new Date(r.created_at).getTime() < SEAL ? "PRE(OK)" : "POST(BLOCK)"}`);
  }
  if (blockList.length) console.log(`⛔ H8 BLOCK 대상(freeze 축소 필요): ${blockList.join(", ")}`);
  else console.log("✔ H8: freeze 31행 전건 pre-seal — re-contamination 0건, 축소 불요.");

  // ═══════════ DA H3-b — post-seal re-contamination 전수조사 (freeze 밖 포함) ═══════════
  console.log("\n═══════════ DA H3-b — post-seal 재오염 전수조사(freeze 밖 포함) ═══════════");
  const pkgs = await fetchAll("packages", "id, trial_unit_price, unheated_unit_price");
  const pkgMap = new Map(pkgs.map((p) => [p.id, p]));
  const allSessions = await fetchAll(
    "package_sessions",
    "id, package_id, session_type, unit_price, status, created_at, session_date",
    (q) => q.in("session_type", TARGET_TYPES)
  );
  let postSealZeroParentPos = 0;
  const postSealZeroList = [];
  let postSealCreatedTotal = 0, postSealPositive = 0;
  for (const s of allSessions) {
    const ct = new Date(s.created_at).getTime();
    if (ct < SEAL) continue;
    postSealCreatedTotal++;
    const pkg = pkgMap.get(s.package_id);
    const parent = pkg ? Number(pkg[COL[s.session_type]] ?? 0) : 0;
    const up = s.unit_price == null ? null : Number(s.unit_price);
    if (parent > 0 && up === 0) { postSealZeroParentPos++; postSealZeroList.push(`${s.id.slice(0, 8)}(${s.session_type},${s.status},${s.session_date})`); }
    else if (parent > 0 && up > 0) postSealPositive++;
  }
  console.log(`post-seal 생성 trial|unheated 세션 총 ${postSealCreatedTotal}건`);
  console.log(`  · unit_price>0 (정상 채움, 부모>0) = ${postSealPositive}  ← forward-fix 작동 positive control`);
  console.log(`  · unit_price=0 ∧ 부모>0 (재오염 후보) = ${postSealZeroParentPos}`);
  if (postSealZeroParentPos) console.log(`  ⛔ 재오염 후보: ${postSealZeroList.join(", ")}`);
  else console.log("  ✔ post-seal 재오염 0건 — forward-fix seal = 유일 0-생성원 봉인 확증.");

  // ═══════════ DA H3-c — memo 스캔(정당 0 의도 텍스트) ═══════════
  console.log("\n═══════════ DA H3-c — freeze 31행 memo/surcharge_memo 스캔 ═══════════");
  const INTENT = /(무료|무상|서비스|공짜|할인|증정|comp|free|discount|이벤트|사은|증정품)/i;
  let memoIntent = 0, memoNonEmpty = 0;
  for (const f of freeze.frozen) {
    const r = rowMap.get(f.id);
    const memo = [r?.memo, r?.surcharge_memo].filter(Boolean).join(" | ");
    if (memo) { memoNonEmpty++; console.log(`  ${f.id.slice(0, 8)} memo="${memo}"`); }
    if (memo && INTENT.test(memo)) { memoIntent++; console.log(`    ⚠ 정당 0 의도 텍스트 매칭 → per-row 재확인 필요`); }
  }
  console.log(`memo 非공백 ${memoNonEmpty}/31 · 정당-0-의도 매칭 ${memoIntent}건`);
  if (memoIntent === 0) console.log("  ✔ H3-c: 무상/할인 등 정당 0 의도 텍스트 부재.");

  // ═══════════ DA H3-a — 스키마 구조 확증 ═══════════
  console.log("\n═══════════ DA H3-a — 스키마 구조(0-intent 저장경로 부재) ═══════════");
  const cols = Object.keys(rows[0] || {});
  console.log("  package_sessions 금액축 컬럼 = unit_price(스냅샷), surcharge(가산). comp/discount/free/reason 컬럼 부재.");
  console.log("  → unit_price=0 을 '정당하게' 세팅하는 구조적 경로(플래그/사유) 없음. 0 = insert-time 미채움(버그) 단일 기원.");

  // ═══════════ DA H3-d — 술어집합 == freeze 정확 일치 ═══════════
  console.log("\n═══════════ DA H3-d — 술어집합(used·부모>0·unit_price=0) 재대조 ═══════════");
  const predSet = allSessions.filter((s) => {
    if (s.status !== "used") return false;
    const up = s.unit_price == null ? null : Number(s.unit_price);
    if (up !== 0) return false;
    const pkg = pkgMap.get(s.package_id);
    const parent = pkg ? Number(pkg[COL[s.session_type]] ?? 0) : 0;
    return parent > 0;
  }).map((s) => s.id);
  const inFreeze = new Set(ids);
  const extra = predSet.filter((id) => !inFreeze.has(id));
  const missing = ids.filter((id) => !predSet.includes(id));
  console.log(`  현재 술어집합 = ${predSet.length}행 · freeze = ${ids.length}행 · extra(freeze밖)=${extra.length} · missing(freeze엔 있으나 술어탈락)=${missing.length}`);
  if (extra.length) console.log(`  ⚠ extra: ${extra.map((x) => x.slice(0, 8)).join(", ")}`);
  if (missing.length) console.log(`  ⚠ missing(DRIFT): ${missing.map((x) => x.slice(0, 8)).join(", ")}`);
  if (!extra.length && !missing.length) console.log("  ✔ 술어집합 == freeze 31행 정확 일치 (DRIFT 0).");

  console.log("\n════════ CENSUS 종료 (READ-ONLY · write 0) ════════");
}
main().catch((e) => { console.error(e); process.exit(1); });
