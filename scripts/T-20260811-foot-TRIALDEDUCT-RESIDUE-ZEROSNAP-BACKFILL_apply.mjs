/**
 * T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL — APPLY (GATED, DESTRUCTIVE-WRITE)
 *
 * ⛔⛔ apply_gate 2중 하드게이트 — 아래 둘 모두 충족 전 prod UPDATE 금지(apply_before_go 금지):
 *      (1) 박민지 치료사 comp-transparency ack
 *      (2) supervisor DB-GATE GO-token  →  db-gate/T-20260811-...-RESIDUE-ZEROSNAP-BACKFILL_GO.token.json
 *   GO-token 파일이 없으면 이 스크립트는 즉시 ABORT 한다(기본 safe).
 *
 * SOP 가드 (data_correction_backfill_sop):
 *   1. archive-first: UPDATE 전 대상행 before-image 아카이브(가역) → rollback/*_capture.csv
 *   2. per-row·freeze set: freeze.json 의 explicit PK VALUES 로만 UPDATE. blanket/predicate UPDATE 금지.
 *   3. apply−1 re-freeze DRIFT ABORT: 실행 직전 predicate 재조회 → freeze 집합과 불일치 시 ABORT.
 *   4. 원장(payments/purchase/service_charges) 무접점. package_sessions.unit_price 스냅샷만.
 *   5. materiality 게이트: expected != 부모 현재단가 이면 해당 행 ABORT(재확인).
 *   6. under-correct ≫ over-correct.
 *
 * 실행: node scripts/T-...-RESIDUE-ZEROSNAP-BACKFILL_apply.mjs
 *   (dry 확인만: APPLY_CONFIRM 미설정 시 write 직전에서 멈춤)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

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
const GO_TOKEN_PATH = `db-gate/${TICKET}_GO.token.json`;
const CAPTURE_PATH = `rollback/${TICKET}_capture.csv`;
const COL = { trial: "trial_unit_price", unheated_laser: "unheated_unit_price" };
const TARGET_TYPES = ["trial", "unheated_laser"];

function abort(msg) { console.error(`\n⛔ ABORT: ${msg}`); process.exit(1); }

async function main() {
  console.log(`════ ${TICKET} — APPLY (GATED) ════\n`);

  // ── GATE (2): supervisor DB-GATE GO-token ──────────────────────────────
  if (!existsSync(GO_TOKEN_PATH)) {
    abort(`GO-token 부재 (${GO_TOKEN_PATH}). supervisor DB-GATE GO-token + 박민지 comp-transparency ack 선행 필수. prod UPDATE 금지.`);
  }
  const goToken = JSON.parse(readFileSync(GO_TOKEN_PATH, "utf8"));
  if (goToken.ticket !== TICKET || goToken.decision !== "GO") {
    abort(`GO-token 불일치/미승인: ticket=${goToken.ticket} decision=${goToken.decision}`);
  }
  console.log(`✔ GATE(2) GO-token OK: issued_by=${goToken.issued_by ?? "?"} at=${goToken.issued_at ?? "?"}`);
  // GATE(1) 박민지 comp-transparency ack 는 티켓 apply_gate 필드로 확인 후 GO-token 에 반영됨(supervisor 책임).

  // ── freeze set 로드 ────────────────────────────────────────────────────
  if (!existsSync(FREEZE_PATH)) abort(`freeze 산출물 부재 (${FREEZE_PATH}). 먼저 _freeze.mjs 실행.`);
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, "utf8"));
  const frozen = freeze.frozen ?? [];
  if (frozen.length === 0) abort("freeze set 이 비어있음 — 정정 대상 0. (under-correct)");
  const frozenIds = new Set(frozen.map((f) => f.id));
  console.log(`✔ freeze set: ${frozen.length}행 (재구성 매출합 ${won(freeze.grand_total_reconstruction_won)}원)`);

  // ── 부모 packages 선적재 (DRIFT check + materiality 공용 pkgMap) ─────────
  //   ↑ freeze 술어 정렬(부모 type-matched 단가>0 판정)에 pkgMap 이 DRIFT check 이전에 필요.
  const { data: pkgs, error: pe } = await db.from("packages")
    .select("id, trial_unit_price, unheated_unit_price");
  if (pe) abort(`packages 조회 실패: ${pe.message}`);
  const pkgMap = new Map((pkgs ?? []).map((p) => [p.id, p]));

  // ── SOP §3: apply−1 re-freeze DRIFT ABORT ──────────────────────────────
  const live = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("package_sessions")
      .select("id, package_id, session_type, unit_price, status")
      .eq("status", "used").in("session_type", TARGET_TYPES).range(from, from + 999);
    if (error) abort(`re-freeze 조회 실패: ${error.message}`);
    live.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // freeze 술어(freeze.mjs L96 unit_price=0 + L101 부모 type-matched 단가>0 + L98 no_pkg skip)와 정렬.
  //   부모단가≤0/null(legit-0) 및 no_pkg(pp=0) 행은 진성 residue 아님 → DRIFT population 제외.
  const liveZero = new Set(
    live.filter((s) => {
      if (Number(s.unit_price ?? -1) !== 0) return false;        // zero-snapshot
      const pkg = pkgMap.get(s.package_id);
      const pp = pkg ? Number(pkg[COL[s.session_type]] ?? 0) : 0;
      return pp > 0;                                             // freeze 술어 정렬: 부모 type-matched 단가>0 (진성 residue만)
    }).map((s) => s.id)
  );
  const missing = [...frozenIds].filter((id) => !liveZero.has(id));   // freeze 이후 이미 값이 바뀐 행
  const extra = [...liveZero].filter((id) => !frozenIds.has(id));     // freeze 이후 새로 생긴 zero 행
  if (missing.length) abort(`DRIFT: freeze 행 ${missing.length}건이 더 이상 unit_price=0 아님 (id=${missing.slice(0,5).join(",")}...). freeze 재실행 필요.`);
  if (extra.length) abort(`DRIFT: freeze 이후 신규 zero-snapshot ${extra.length}건 등장 (id=${extra.slice(0,5).join(",")}...). freeze 재실행 필요.`);
  console.log(`✔ re-freeze DRIFT check OK (missing=0, extra=0)`);

  // ── SOP §5: materiality 게이트 (부모 현재단가 == freeze expected) ────────
  //   pkgMap 은 DRIFT check 이전에 선적재됨(위) — 재조회 없이 재사용.
  for (const f of frozen) {
    const pkg = pkgMap.get(f.package_id);
    if (!pkg) abort(`materiality: pkg 소실 ${f.package_id} (ps=${f.id})`);
    const nowExpected = Number(pkg[COL[f.session_type]] ?? 0);
    if (nowExpected !== Number(f.expected_unit_price)) {
      abort(`materiality: ps=${f.id} 부모단가 변동 (freeze=${f.expected_unit_price} → now=${nowExpected}). 재확인 필요.`);
    }
    if (!(nowExpected > 0)) abort(`materiality: ps=${f.id} 부모단가 0 이하 (${nowExpected}) — 정정 대상 아님.`);
  }
  console.log(`✔ materiality 게이트 OK (전 ${frozen.length}행 부모단가 == freeze expected & >0)`);

  // ── SOP §1: archive-first (before-image CSV) ────────────────────────────
  const csvLines = ["package_session_id,package_id,session_type,before_unit_price,expected_unit_price,session_date"];
  for (const f of frozen) {
    csvLines.push(`${f.id},${f.package_id},${f.session_type},${f.before_unit_price},${f.expected_unit_price},${f.session_date ?? ""}`);
  }
  writeFileSync(CAPTURE_PATH, csvLines.join("\n") + "\n");
  console.log(`✔ archive-first 저장: ${CAPTURE_PATH} (${frozen.length}행 before-image)`);

  // ── APPLY 확인 게이트 ───────────────────────────────────────────────────
  if (!process.env.APPLY_CONFIRM) {
    console.log(`\n⏸ APPLY_CONFIRM 미설정 — write 직전 정지. 전 게이트 통과 확인 후:`);
    console.log(`   APPLY_CONFIRM=1 node scripts/${TICKET}_apply.mjs`);
    process.exit(0);
  }

  // ── SOP §2: per-row explicit PK VALUES UPDATE (blanket predicate 금지) ──
  let ok = 0, fail = 0;
  for (const f of frozen) {
    const { data, error } = await db.from("package_sessions")
      .update({ unit_price: f.expected_unit_price })
      .eq("id", f.id)
      .eq("unit_price", 0)                 // 낙관적 락: 여전히 0일 때만 (per-row 안전)
      .eq("session_type", f.session_type)  // 유형 재확인
      .select("id");
    if (error) { console.error(`  ✗ ps=${f.id}: ${error.message}`); fail++; continue; }
    if (!data || data.length !== 1) { console.error(`  ✗ ps=${f.id}: rows-affected=${data?.length ?? 0} (기대 1) — silent-write 방지 ABORT-row`); fail++; continue; }
    ok++;
    console.log(`  ✔ ps=${f.id} ${f.session_type} 0 → ${won(f.expected_unit_price)}`);
  }
  console.log(`\n════ APPLY 완료: 성공 ${ok} / 실패 ${fail} / 총 ${frozen.length} ════`);
  if (fail) abort(`일부 실패(${fail}) — POSTCHECK + rollback 검토.`);
  console.log(`▶ 다음: _postcheck.mjs 실행 → planner FOLLOWUP(before/after·archive=${CAPTURE_PATH}).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
