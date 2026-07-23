/**
 * T-20260723-foot-PMW-BENEFIT-FLAG-COPAY-REFLECT — READ-ONLY 조사 probe.
 * 목적(INFO MSG-20260723-161751 core ask): 기본 4항목(AA154/AA254/AA222/M0111)이
 *   실제 services.is_insurance_covered=TRUE 로 SET 되어 있는지 실측. 미설정이면 급여 세팅이 스코프.
 * 부수: 선결 B(clinics.hira_unit_value=95.6 stale 여부), hira_score/hira_category 동반값.
 * READ-ONLY (SELECT only). 원장 무접점.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 1) ★ 핵심: 4항목 급여 flag 실측 (service_code 기준). id 도 DA CONSULT 실측치와 대조.
out.four_items = await q(`
  SELECT id, service_code, name, is_insurance_covered, hira_code, hira_score, hira_category,
         vat_type, price, copayment_rate_override, active
  FROM services
  WHERE service_code IN ('AA154','AA254','AA222','M0111')
  ORDER BY service_code;
`);

// 2) 혹시 service_code 미일치(코드가 hira_code 컬럼에 있는 경우 등) 대비 — hira_code 로도 조회.
out.by_hira = await q(`
  SELECT id, service_code, name, is_insurance_covered, hira_code
  FROM services
  WHERE hira_code IN ('AA154','AA254','AA222','M0111')
  ORDER BY hira_code;
`);

// 3) 선결 B: clinics.hira_unit_value (95.6 canon vs 89.4 stale)
out.clinics_unit = await q(`
  SELECT id, name, slug, hira_unit_value
  FROM clinics
  ORDER BY name;
`);

// 4) is_insurance_covered 컬럼 실재/기본값 확인(no-DDL 재확인)
out.col = await q(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='services'
    AND column_name IN ('is_insurance_covered','hira_code','hira_score','hira_category','copayment_rate_override','vat_type');
`);

console.log(JSON.stringify(out, null, 2));
