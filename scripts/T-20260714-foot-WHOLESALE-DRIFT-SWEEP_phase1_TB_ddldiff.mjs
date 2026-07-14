/**
 * T-20260714 WHOLESALE-DRIFT-SWEEP Phase1 — T-B: X-16 개별 DDL-diff (READ-ONLY)
 *  - DRIFT 12: precise per-object introspection on census "absent" objects → F-promote / object-level A / X
 *  - destructive 4: target prod existence DDL-diff → CEO-gate / no-op supersede / additive-reclassify / backfill-SOP
 * SELECT-only. WRITE_RE guard. NO ledger write, NO apply.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, writeFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const WRITE_RE = /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment\s+on|do\s*\$|call\s|repair|refresh\s+materialized|reindex|vacuum|cluster)\b/i;
async function q(sql) {
  if (WRITE_RE.test(sql)) throw new Error('WRITE_RE guard: ' + sql.slice(0, 120));
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,200)}`); return JSON.parse(t);
}
const census = JSON.parse(readFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json', 'utf8'));
const pend = (pfx) => census.pending.find(v => v.entries.some(e => e.file.startsWith(pfx)));

const out = { drift12: [], destructive4: [] };

// ---- DRIFT 12 : precise per-object re-probe --------------------------------
const DRIFT = ['20260519000080','20260520000060','20260520000100','20260521000020','20260522050000',
  '20260524010000','20260606160000','20260609100000','20260609200000','20260622180000','20260703170000','20260711140000'];
async function probeObj(kind, name) {
  if (kind === 'functions') { const [s,n]=name.split('.'); const r=await q(`SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='${s}' AND p.proname='${n}' LIMIT 1;`); return r.length>0; }
  if (kind === 'policies') { const [t,pn]=name.split('::'); const r=await q(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${t}' AND policyname=$P$${pn}$P$ LIMIT 1;`); return r.length>0; }
  if (kind === 'tables') { const r=await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${name}' LIMIT 1;`); return r.length>0; }
  if (kind === 'columns') { const [t,c]=name.split('.'); const r=await q(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}' LIMIT 1;`); return r.length>0; }
  if (kind === 'views') { const r=await q(`SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='${name}' UNION SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='${name}' LIMIT 1;`); return r.length>0; }
  if (kind === 'indexes') { const r=await q(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='${name}' LIMIT 1;`); return r.length>0; }
  if (kind === 'types') { const r=await q(`SELECT 1 FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public' AND t.typname='${name}' LIMIT 1;`); return r.length>0; }
  if (kind === 'triggers') { const r=await q(`SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='${name}' LIMIT 1;`); return r.length>0; }
  return null;
}
for (const pfx of DRIFT) {
  const v = pend(pfx); if (!v) { out.drift12.push({ version: pfx, note: 'NOT-IN-PENDING (already applied?)' }); continue; }
  const rec = { version: pfx, files: v.entries.map(e=>e.file), reprobe: [] };
  for (const e of v.entries) {
    for (const kind of Object.keys(e.objs)) {
      for (const name of e.objs[kind]) {
        const exists = await probeObj(kind, name);
        rec.reprobe.push({ obj: `${kind}:${name}`, exists });
      }
    }
  }
  const absentReal = rec.reprobe.filter(r => r.exists === false);
  rec.absentReal = absentReal.map(r=>r.obj);
  rec.verdict = absentReal.length === 0 ? 'F-PROMOTE (all objs present — regex false-neg)'
    : `object-level split: ${absentReal.length} truly-absent → per-object A(additive)/X`;
  out.drift12.push(rec);
}

// ---- destructive 4 : target existence -------------------------------------
// 1) bundlerx — self-scratch DROPs; real work = data migration
out.destructive4.push({
  version: '20260616120000_bundlerx_drugname_migrate',
  drop_targets: ['prescription_codes_bundlerx_backup_20260616 (self-created snapshot)',
    'prescription_folders_bundlerx_backup_20260616 (self)', 'prescription_code_folders_bundlerx_backup_20260616 (self)',
    '_bundlerx_resolved_20260616 (TEMP)'],
  prod_check: {
    backup_tables: await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%bundlerx_backup_20260616';`),
    rxmig_codes: await q(`SELECT count(*)::int n FROM prescription_codes WHERE claim_code LIKE 'RXMIG-%';`),
    igwan_folder: await q(`SELECT id, name FROM prescription_folders WHERE name='이관약';`),
  },
});
// 2) medical_charts fk — idempotent DROP-IF-EXISTS+readd → ADDITIVE
out.destructive4.push({
  version: '20260629170000_medical_charts_check_in_id_fk',
  nature: 'ADDITIVE (DROP CONSTRAINT IF EXISTS = idempotent re-run guard, immediately re-added)',
  prod_check: {
    column: await q(`SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' AND column_name='check_in_id';`),
    fkey: await q(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='medical_charts_check_in_id_fkey';`),
    index: await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='idx_mc_check_in_id';`),
  },
});
// 3) mask_contam — genuine data DELETE, archive-first SOP, gated
out.destructive4.push({
  version: '20260714020000_foot_customers_mask_contam_backfill',
  nature: 'DATA-DELETE (phantom customers, frozen 5-set). Cross-CRM Orphan-Row Archive-First Cleanup SOP. NOT flat-apply.',
  prod_check: {
    note: 'frozen 5-set ids off-git (perrow_confirm.json). commit c9074f0a marked BLOCKED/DO-NOT-APPLY. per-row + supervisor gates incomplete.',
    customers_total: await q(`SELECT count(*)::int n FROM customers;`),
  },
});
// 4) paylog center — idempotent DROP-IF-EXISTS+readd → ADDITIVE (+ self-ledger OOB INSERT flag)
out.destructive4.push({
  version: '20260714170000_paylog_center_column',
  nature: 'ADDITIVE (DROP CONSTRAINT IF EXISTS = idempotent guard + re-add). ⚠ file contains self-ledger INSERT INTO schema_migrations ON CONFLICT (§1.4 OOB write — must strip before any apply).',
  prod_check: {
    column: await q(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_reconciliation_log' AND column_name='center';`),
    check_con: await q(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='payment_reconciliation_log_center_check';`),
    index: await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='recon_log_clinic_center_created_idx';`),
    table_exists: await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_reconciliation_log';`),
  },
});

writeFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_TB.json', JSON.stringify(out, null, 2));
console.log('=== DRIFT 12 verdicts ===');
for (const d of out.drift12) console.log(d.version, '→', d.verdict || d.note, d.absentReal?.length?`| absent: ${d.absentReal.join(', ')}`:'');
console.log('\n=== destructive 4 target existence ===');
for (const d of out.destructive4) console.log(d.version.slice(0,14), '→', JSON.stringify(d.prod_check).slice(0,240));
