/**
 * T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN AC3 정정 PREFLIGHT (READ-ONLY).
 * 목적: clinics.representative_name 컬럼 存/값(기대 박영진, jongno-foot) 확정.
 *   존재+박영진 => pure print-rebind(db_change 불변). 부재 => ADDITIVE nullable mig 분기.
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
out.col_exists = await q(`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clinics' AND column_name='representative_name';
`);
out.rows = await q(`
  SELECT id, slug, name, representative_name, business_no, nhis_code
  FROM public.clinics ORDER BY slug;
`);
console.log(JSON.stringify(out, null, 2));
