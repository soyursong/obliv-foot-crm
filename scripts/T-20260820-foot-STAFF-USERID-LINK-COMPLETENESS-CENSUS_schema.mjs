import { q } from './dryrun_lib.mjs';
const r = async (label, sql) => { try { const rows = await q(sql); console.log(`\n== ${label} ==`); console.log(JSON.stringify(rows, null, 1)); } catch(e){ console.log(`\n== ${label} ERR: ${e.message}`);} };
await r('staff-like tables', `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%staff%' OR table_name ILIKE '%user_profile%' OR table_name ILIKE '%employee%') ORDER BY 1;`);
await r('staff columns', `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='staff' ORDER BY ordinal_position;`);
await r('clinics', `SELECT id, slug, name FROM clinics ORDER BY 1;`);
