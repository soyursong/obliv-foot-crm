// T-20260805-foot-EXAMFEE-FLAT-GOSIA-CARVEOUT — READ-ONLY prod probe
// AUTH CONTEXT: service_role (RLS bypass) — cross_crm_diag_auth_context_standard 준수: SELECT only.
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0.
//   목적: 진찰료(초진/재진) services 행의 amount source 필드 실재 확인.
//     - services.price == 공표 flat 고시액(초진 18,840 / 재진 13,370) 인지 (DA §10-2 "stored=CORRECT" 검증)
//     - hira_score(197.12/139.85) provenance 유지 확인
//     - isConsultationFeeItem 술어 매칭 필드(hira_category / category_label / name) 실재 확인
//     - clinics.hira_unit_value(95.60) 로 score×unit → 18,845 재현 확인 (defect 재현)
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
const J = (o) => JSON.stringify(o, null, 2);

async function main() {
  console.log("=== AUTH CONTEXT: service_role (RLS bypass), prod rxlomoozakkjesdqjtvd, READ-ONLY ===\n");

  // 1) 진찰료성 services 행 (초진/재진/진찰/상담)
  const { data: svcs, error: e1 } = await db
    .from("services")
    .select("id, name, service_code, hira_code, hira_category, hira_score, category_label, price, is_insurance_covered, vat_type")
    .or("name.ilike.%초진%,name.ilike.%재진%,name.ilike.%진찰%,name.ilike.%상담%");
  if (e1) { console.error("svc query err", e1); }
  console.log("── 진찰료성 services 행 ──");
  for (const s of svcs ?? []) {
    console.log(J(s));
  }
  console.log(`\n총 ${svcs?.length ?? 0} 행\n`);

  // 2) clinics.hira_unit_value (환산지수, 95.60 예상)
  const { data: clinics, error: e2 } = await db
    .from("clinics")
    .select("id, name, hira_unit_value");
  if (e2) { console.error("clinics query err", e2); }
  console.log("── clinics.hira_unit_value ──");
  for (const c of clinics ?? []) console.log(J(c));

  // 3) defect 재현: score×unit round vs stored price
  console.log("\n── defect 재현 (score × hira_unit_value → ROUND) vs stored price ──");
  const uv = (clinics ?? []).map((c) => c.hira_unit_value).find((v) => v != null);
  for (const s of svcs ?? []) {
    if (s.hira_score != null && uv != null) {
      const computed = Math.round(s.hira_score * uv);
      const flag = computed !== s.price ? "  <== DIVERGENCE (score×unit ≠ stored price)" : "";
      console.log(`${s.name}: score=${s.hira_score} × unit=${uv} = ROUND ${computed} | stored price=${s.price}${flag}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
