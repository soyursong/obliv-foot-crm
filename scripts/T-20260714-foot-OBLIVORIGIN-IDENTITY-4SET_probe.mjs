/**
 * T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — READ-ONLY Stage1 진단 probe.
 * clinics 스키마(company_name/representative_name 저장처 존재 여부) + jongno-foot/songdo 현재값.
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
out.clinic_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clinics'
  ORDER BY ordinal_position;`);
out.clinic_rows = await q(`
  SELECT id, slug, name, business_no, nhis_code, address
  FROM clinics ORDER BY slug;`);
// representative_name / company_name 존재 시 값도 조회
const cols = out.clinic_cols.map(c=>c.column_name);
const extra = ['company_name','representative_name','ceo_name','owner_name','stamp_url','seal_url'].filter(c=>cols.includes(c));
if (extra.length) {
  out.extra_vals = await q(`SELECT slug, ${extra.join(', ')} FROM clinics ORDER BY slug;`);
} else {
  out.extra_vals = 'NONE of company_name/representative_name/ceo_name/owner_name/stamp_url/seal_url exist on clinics';
}
console.log(JSON.stringify(out, null, 2));

// --- AC-4/AC-6: 원장직인 leaf (clinic_doctors.seal_image_url) 상태 — 미접촉 대상 ---
const doc = await q(`
  SELECT d.name, d.is_default, (d.seal_image_url IS NOT NULL) AS has_seal, d.seal_image_url
  FROM clinic_doctors d JOIN clinics c ON c.id=d.clinic_id
  WHERE c.slug='jongno-foot' ORDER BY d.name;`);
console.log('\n=== clinic_doctors seal (원장직인 leaf — DO NOT TOUCH) ===');
console.log(JSON.stringify(doc, null, 2));
