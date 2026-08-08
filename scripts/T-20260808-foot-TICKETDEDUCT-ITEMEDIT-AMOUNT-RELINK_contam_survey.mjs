// T-20260808-foot-TICKETDEDUCT-ITEMEDIT-AMOUNT-RELINK — 소급 오염 점검 (AC5)
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
//
// 목적: 차감항목(session_type) 수기정정 시 unit_price 미재연동 버그(pre-fix a224c81d)로
//   오염된 기존 package_sessions 행의 규모를 실측한다. forward-fix(a224c81d, deployed 21:57)는
//   이미 이 write-path 를 교정했으므로, 여기서는 과거 잔존 오염만 조사(백필은 별건 SOP).
//
// 버그 지문(fingerprint) — Data-Correction Backfill SOP §지문 교집합:
//   used 세션의 unit_price 가 (a) 현재 session_type 의 package 단가와 불일치 AND
//   (b) 같은 package 의 '다른' session_type 단가와는 정확히 일치.
//   → session_type 만 바뀌고 unit_price 는 옛 유형 값에 stale 고정된 상태(정정연동 끊김).
//   (단순 수기 단가조정과 구분: 다른 유형 단가와 정확히 일치해야 item-edit 지문으로 카운트.)
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
const env = { ...loadEnv(".env.local"), ...process.env };
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("NO SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// SSOT 매핑 (fn_fill_session_unit_price 트리거 + sessionTypeUnitPrice() 동일)
const COL = {
  heated_laser: "heated_unit_price",
  unheated_laser: "unheated_unit_price",
  iv: "iv_unit_price",
  podologue: "podologe_unit_price",
  podologe: "podologe_unit_price",
  trial: "trial_unit_price",
  reborn: "reborn_unit_price",
};
const TYPES = ["heated_laser", "unheated_laser", "iv", "podologue", "podologe", "trial", "reborn"];
function priceFor(pkg, t) {
  const c = COL[t];
  if (!c) return null;
  const v = pkg[c];
  return v == null ? null : Number(v);
}

async function main() {
  console.log("════ TICKETDEDUCT-ITEMEDIT 소급 오염 점검 (READ-ONLY, write 0) ════\n");

  // 패키지 단가 맵
  const { data: pkgs, error: pe } = await db
    .from("packages")
    .select("id, heated_unit_price, unheated_unit_price, iv_unit_price, podologe_unit_price, trial_unit_price, reborn_unit_price");
  if (pe) { console.error("packages err:", pe.message); process.exit(1); }
  const pkgMap = new Map((pkgs ?? []).map((p) => [p.id, p]));
  console.log(`packages: ${pkgs?.length ?? 0}건`);

  // used 세션 전수 (페이지네이션)
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("package_sessions")
      .select("id, package_id, session_type, unit_price, performed_by, session_date, status")
      .eq("status", "used")
      .range(from, from + 999);
    if (error) { console.error("sessions err:", error.message); process.exit(1); }
    all = all.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }
  console.log(`used package_sessions: ${all.length}건\n`);

  const flagged = [];
  for (const s of all) {
    const pkg = pkgMap.get(s.package_id);
    if (!pkg) continue;
    const cur = s.unit_price == null ? null : Number(s.unit_price);
    const expected = priceFor(pkg, s.session_type);
    if (cur == null) continue;                       // NULL은 별개(2026-06-05 backfill 대상축)
    if (expected != null && cur === expected) continue; // 정상 = 현재 유형과 일치

    // 다른 유형 단가와 정확히 일치하는지(지문)
    const matchOther = [...new Set(TYPES)]
      .filter((t) => t !== s.session_type && !(s.session_type === "podologue" && t === "podologe") && !(s.session_type === "podologe" && t === "podologue"))
      .filter((t) => { const pv = priceFor(pkg, t); return pv != null && pv > 0 && pv === cur; });
    if (matchOther.length > 0) {
      flagged.push({
        id: s.id, package_id: s.package_id, session_type: s.session_type,
        unit_price: cur, expected, matches_type: matchOther.join("|"),
        performed_by: s.performed_by, session_date: s.session_date,
      });
    }
  }

  console.log(`════ 지문 일치(item-edit 오염 후보): ${flagged.length}건 ════`);
  for (const f of flagged) {
    console.log(`  · ps=${f.id} pkg=${f.package_id} type=${f.session_type} unit_price=${f.unit_price} (기대=${f.expected}) → 옛유형매치=${f.matches_type} date=${f.session_date} by=${f.performed_by}`);
  }

  // 참고: 현재유형 단가와 불일치하지만 다른유형과도 불일치(수기조정/구형단가 등) — 오염 아님, 규모만
  let mismatchNonFingerprint = 0;
  for (const s of all) {
    const pkg = pkgMap.get(s.package_id);
    if (!pkg) continue;
    const cur = s.unit_price == null ? null : Number(s.unit_price);
    if (cur == null) continue;
    const expected = priceFor(pkg, s.session_type);
    if (expected != null && cur === expected) continue;
    const matchOther = [...new Set(TYPES)].filter((t) => t !== s.session_type).filter((t) => { const pv = priceFor(pkg, t); return pv != null && pv > 0 && pv === cur; });
    if (matchOther.length === 0) mismatchNonFingerprint++;
  }
  console.log(`\n참고) 현재유형 불일치이나 지문 미해당(수기조정/구형단가 등, 오염 아님): ${mismatchNonFingerprint}건`);
  console.log("\n※ 지문 일치 건이 있으면 규모 보고 후 Data-Correction Backfill SOP 별건으로 소급. 이 티켓=forward(a224c81d deployed) 확인 + 조사까지.");
}
main().catch((e) => { console.error(e); process.exit(1); });
