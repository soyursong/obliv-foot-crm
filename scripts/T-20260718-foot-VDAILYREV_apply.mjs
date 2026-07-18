/**
 * T-20260718-foot-VDAILYREV-UNFILTERED-XCRM-APPLY — supervisor DDL-diff gate apply + POSTCHECK.
 * modes: (default) READ-ONLY probe. `--apply` = forward migration + ledger insert. `--post` = POSTCHECK only.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const anon = (env.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m) || env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.*)$/m) || [])[1]?.trim();
const url = (env.match(/^VITE_SUPABASE_URL=(.*)$/m) || [])[1]?.trim();
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
  return t ? JSON.parse(t) : [];
}
const V = "public.v_daily_revenue";
async function snapshot(label) {
  const def = await q(`SELECT pg_get_viewdef('${V}'::regclass, true) AS def;`);
  const relopt = await q(`SELECT reloptions FROM pg_class WHERE oid='${V}'::regclass;`);
  const grants = await q(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='v_daily_revenue' ORDER BY grantee, privilege_type;`);
  const ledger = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260718200000';`);
  console.log(`\n===== ${label} =====`);
  console.log('--- viewdef ---\n' + def[0].def);
  console.log('--- reloptions ---', JSON.stringify(relopt[0].reloptions));
  console.log('--- grants ---', JSON.stringify(grants));
  console.log('--- ledger 20260718200000 ---', JSON.stringify(ledger));
  return { def: def[0].def, relopt: relopt[0].reloptions, grants, ledger };
}
async function anonRest() {
  if (!anon || !url) { console.log('--- anon REST: skip (no anon key/url in env) ---'); return null; }
  const r = await fetch(`${url}/rest/v1/v_daily_revenue?limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  const body = await r.text();
  console.log(`--- anon GET /rest/v1/v_daily_revenue → HTTP ${r.status} ${body.slice(0,120)}`);
  return r.status;
}
async function net14() {
  const rows = await q(`SELECT dt, clinic_id, net_revenue FROM v_daily_revenue WHERE dt >= (now() AT TIME ZONE 'Asia/Seoul')::date - 14 ORDER BY dt, clinic_id;`);
  console.log('--- net_revenue last 14d rows:', rows.length);
  return rows;
}

const mode = process.argv[2];
(async () => {
  if (mode === '--apply') {
    const fwd = readFileSync('supabase/migrations/20260718200000_foot_vdailyrev_active_filter_anon_revoke.sql', 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('NOTIFY')).join('\n');
    // append ledger insert inside same run
    const sql = fwd + `\nINSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20260718200000','foot_vdailyrev_active_filter_anon_revoke') ON CONFLICT (version) DO NOTHING;`;
    console.log('=== APPLYING forward migration + ledger ===');
    await q(sql);
    console.log('APPLIED OK');
    await q(`NOTIFY pgrst, 'reload schema';`).catch(()=>{});
  }
  await snapshot(mode === '--apply' ? 'POST-APPLY' : 'CURRENT');
  await anonRest();
  await net14();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
