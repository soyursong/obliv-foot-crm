/**
 * T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — READ-ONLY prod probe (MIG-GATE ledger check).
 * clinics.hira_institution_name 컬럼 실재 + jongno-foot populate + songdo 무영향 + ledger 등재 확인.
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
out.column = await q(`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clinics' AND column_name='hira_institution_name';`);
out.rows = await q(`
  SELECT slug, name, hira_institution_name, nhis_code FROM clinics ORDER BY slug;`);
out.ledger = await q(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version = '20260714180000';`).catch(e => ({ error: String(e) }));
console.log(JSON.stringify(out, null, 2));
