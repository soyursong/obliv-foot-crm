/**
 * T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL — FREEZE / DRY-RUN (READ-ONLY)
 *
 * ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
 *   Data-Correction Backfill SOP §2(G-gate READ-ONLY SELECT로 정확 행수 확정·PK VALUES freeze).
 *   실제 백필은 apply_gate(박민지 comp-transparency ack + supervisor DB-GATE GO-token) 해소 후
 *   별도 _apply.mjs 로만 집행한다. GO-token 前 prod UPDATE 금지(apply_before_go 금지).
 *
 * ── zero-snapshot genuine-residue 술어 (DA j54p carveout) ─────────────────────
 *   session_type IN ('trial','unheated_laser')
 *   AND unit_price = 0                              (zero-snapshot)
 *   AND pkg.<session_type>_unit_price > 0           (진성 미연동 — 부모 단가는 존재)
 *   AND status = 'used'                             (실소진·차감매출 유입 대상)
 *   EXCLUDE heated_laser (heated_unit_price=0 = legit-0, 진성 미연동 아님)
 *   EXCLUDE nonzero-diff/strong-fingerprint class (stored=옛 nonzero) — 방화벽(per-row 필수)
 *   NOTE: red-box 4행(자식 CHARTEDIT-TRIAL-PRICE-BACKFILL 소관)은 sibling 이 이미 unit_price>0
 *         정정 완료 → unit_price=0 술어에 자연 disjoint(자동 제외). freeze 결과에 잔존 시 경고.
 *
 * ── 재구성 규칙 (권위소스 read·합성 금지·하드코딩 금지) ────────────────────────
 *   각 행 correct unit_price = 부모 package 의 type-matched <session_type>_unit_price.
 *   SSOT = sessionTypeUnitPrice()(CustomerChartPage.tsx) + fn_fill_session_unit_price 트리거 parity.
 *
 * 산출물: scripts/_out/T-20260811-...-RESIDUE_freeze.json (frozen PK VALUES + before-image + expected)
 *   → _apply.mjs 가 이 파일을 읽어 predicate 가 아닌 explicit PK VALUES 로만 UPDATE (blanket 금지).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

// SSOT 매핑 (sessionTypeUnitPrice() + fn_fill_session_unit_price 트리거 동일)
const COL = {
  trial: "trial_unit_price",
  unheated_laser: "unheated_unit_price",
};
const TARGET_TYPES = ["trial", "unheated_laser"];
// 방화벽: 다른 유형 단가와 정확히 일치하면 nonzero-diff/item-edit 지문 → 본 술어(unit_price=0)와
// 애초 겹치지 않으나(0 vs >0), 재확인용으로 전 유형 단가맵을 보관.
const ALL_COL = {
  heated_laser: "heated_unit_price", unheated_laser: "unheated_unit_price",
  iv: "iv_unit_price", podologue: "podologe_unit_price", podologe: "podologe_unit_price",
  trial: "trial_unit_price", reborn: "reborn_unit_price",
};

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
  console.log("════ TRIALDEDUCT-RESIDUE-ZEROSNAP FREEZE / DRY-RUN (READ-ONLY, write 0) ════\n");

  const pkgs = await fetchAll(
    "packages",
    "id, package_name, heated_unit_price, unheated_unit_price, iv_unit_price, podologe_unit_price, trial_unit_price, reborn_unit_price"
  );
  const pkgMap = new Map(pkgs.map((p) => [p.id, p]));
  console.log(`packages: ${pkgs.length}건`);

  const sessions = await fetchAll(
    "package_sessions",
    "id, package_id, session_type, unit_price, performed_by, session_date, status",
    (q) => q.eq("status", "used").in("session_type", TARGET_TYPES)
  );
  console.log(`used package_sessions (trial|unheated_laser): ${sessions.length}건\n`);

  const frozen = [];
  const skipped = { no_pkg: 0, pkg_price_zero: 0, unit_price_nonzero: 0 };
  const fingerprintWarn = [];

  for (const s of sessions) {
    const cur = s.unit_price == null ? null : Number(s.unit_price);
    if (cur == null || cur !== 0) { skipped.unit_price_nonzero++; continue; }  // zero-snapshot 만
    const pkg = pkgMap.get(s.package_id);
    if (!pkg) { skipped.no_pkg++; continue; }
    const expected = pkg[COL[s.session_type]];
    const exp = expected == null ? null : Number(expected);
    if (exp == null || exp <= 0) { skipped.pkg_price_zero++; continue; }        // 부모 단가 0 = legit-0 제외

    // 방화벽 재확인: 0 은 어떤 유형의 >0 단가와도 일치하지 않음 → 순수 zero-snapshot 확정.
    const otherPositive = [...new Set(Object.keys(ALL_COL))]
      .filter((t) => t !== s.session_type)
      .some((t) => { const v = pkg[ALL_COL[t]]; return v != null && Number(v) === cur && cur > 0; });
    if (otherPositive) fingerprintWarn.push(s.id);  // cur=0 이면 발생 불가(방어)

    frozen.push({
      id: s.id,
      package_id: s.package_id,
      package_name: pkg.package_name ?? null,
      session_type: s.session_type,
      before_unit_price: cur,      // archive-first before-image (=0)
      expected_unit_price: exp,    // 재구성값 = 부모 type-matched 단가
      performed_by: s.performed_by,
      session_date: s.session_date,
    });
  }

  // 리포트
  const byType = {};
  for (const f of frozen) {
    byType[f.session_type] ??= { n: 0, sum: 0 };
    byType[f.session_type].n++;
    byType[f.session_type].sum += f.expected_unit_price;
  }
  console.log(`════ FROZEN SET (진성 zero-snapshot residue): ${frozen.length}행 ════`);
  for (const [t, v] of Object.entries(byType)) {
    console.log(`  · ${t}: ${v.n}행, 재구성 매출합 ${won(v.sum)}원`);
  }
  const grand = frozen.reduce((s, f) => s + f.expected_unit_price, 0);
  console.log(`  ── 총 재구성 매출(차감매출 표시값 소급): ${won(grand)}원 ──\n`);

  console.log("행별 상세 (id | pkg | type | 0 → 재구성단가 | date):");
  for (const f of frozen) {
    console.log(`  ps=${f.id} pkg=${f.package_id?.slice(0, 8)}[${f.package_name ?? "?"}] ${f.session_type} | ${won(f.before_unit_price)} → ${won(f.expected_unit_price)} | ${f.session_date}`);
  }

  console.log(`\n스킵 집계: unit_price≠0=${skipped.unit_price_nonzero} · 부모없음=${skipped.no_pkg} · 부모단가0(legit-0)=${skipped.pkg_price_zero}`);
  if (fingerprintWarn.length) console.log(`⚠ 방화벽 경고(예상외 nonzero-fingerprint): ${fingerprintWarn.join(", ")} — per-row 재확인 필요`);

  // freeze 산출물 영속 (PK VALUES + before-image + expected)
  mkdirSync("scripts/_out", { recursive: true });
  const outPath = "scripts/_out/T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL_freeze.json";
  writeFileSync(outPath, JSON.stringify({
    ticket: "T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL",
    predicate: "session_type IN (trial,unheated_laser) AND unit_price=0 AND pkg.<type>_unit_price>0 AND status=used",
    frozen_count: frozen.length,
    grand_total_reconstruction_won: grand,
    frozen,
  }, null, 2));
  console.log(`\n✔ freeze 산출물 저장: ${outPath} (${frozen.length}행)`);
  console.log("⚠ 실제 UPDATE 없음 — apply_gate(박민지 ack + supervisor GO-token) 해소 후 _apply.mjs 로만 집행.");
}
main().catch((e) => { console.error(e); process.exit(1); });
