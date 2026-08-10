// T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A — before-snapshot (off-git full rows) + loose-ref completeness scan.
// READ-ONLY. no-snapshot-no-delete: full JSON dump of every row in the delete closure, written OFF-GIT.
import { q } from './dryrun_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const run = async (sql) => { const r = await q(sql); return r.result || r; };

const ROOTS = ['21a82994-b231-4bcc-94ff-dd9e6c3a4951','e72022d0-7cf5-4f42-b5e3-b5162005b454','c074025b-cd27-443c-93a9-151d6d4214d4','d7faae9b-8e0b-421a-b68b-483ede6834a3','a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d'];
const R = ROOTS.map(i=>`'${i}'`).join(',');
const CI = `(SELECT id FROM check_ins WHERE customer_id IN (${R}) OR reservation_id IN (SELECT id FROM reservations WHERE customer_id IN (${R})))`;
const RE = `(SELECT id FROM reservations WHERE customer_id IN (${R}))`;
const PK = `(SELECT id FROM packages WHERE customer_id IN (${R}))`;

// table -> WHERE predicate (matches the closure)
const specs = {
  customers:                 `id IN (${R})`,
  reservations:              `customer_id IN (${R})`,
  packages:                  `customer_id IN (${R})`,
  check_ins:                 `customer_id IN (${R}) OR reservation_id IN ${RE}`,
  assignment_actions:        `check_in_id IN ${CI}`,
  chart_treatment_requests:  `customer_id IN (${R}) OR check_in_id IN ${CI}`,
  check_in_room_logs:        `check_in_id IN ${CI}`,
  check_in_services:         `check_in_id IN ${CI}`,
  customer_reservation_memos:`customer_id IN (${R})`,
  customer_treatment_memos:  `customer_id IN (${R})`,
  form_submissions:          `customer_id IN (${R}) OR check_in_id IN ${CI}`,
  health_q_results:          `customer_id IN (${R})`,
  health_q_tokens:           `customer_id IN (${R})`,
  reservation_logs:          `reservation_id IN ${RE}`,
  reservation_memo_history:  `reservation_id IN ${RE} OR check_in_id IN ${CI}`,
  status_transitions:        `check_in_id IN ${CI}`,
  package_sessions:          `check_in_id IN ${CI} OR package_id IN ${PK}`,
  notification_logs:         `customer_id IN (${R})`,
  phi_access_log:            `customer_id IN (${R})`,
};

const snapshot = { ticket:'T-20260810-foot-TESTACCT-CLEANUP-8ACCT', leg:'A', db:'foot prod rxlomoozakkjesdqjtvd', roots:ROOTS, captured:'off-git', tables:{} };
const counts = {};
for (const [t, pred] of Object.entries(specs)) {
  const rows = await run(`SELECT * FROM ${t} WHERE ${pred}`);
  snapshot.tables[t] = rows;
  counts[t] = rows.length;
}

// loose-ref completeness scan: ANY base table with customer_id/patient_id NOT covered above, holding target rows
const cols = await run(`SELECT c.table_name AS t, c.column_name AS col FROM information_schema.columns c
  JOIN information_schema.tables tb ON tb.table_schema='public' AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name IN ('customer_id','patient_id') ORDER BY c.table_name;`);
const covered = new Set(Object.keys(specs));
console.log('=== LOOSE-REF COMPLETENESS SCAN (uncovered tables with target rows) ===');
let uncoveredHits=0;
for (const {t,col} of cols){
  if (covered.has(t)) continue;
  const r = await run(`SELECT count(*) n FROM ${t} WHERE ${col} IN (${R})`);
  const n = Number((r[0]||{}).n||0);
  if (n>0){ uncoveredHits+=n; console.log(`  ★ UNCOVERED ${t}.${col}: ${n} rows — MUST ADD to migration`); }
}
console.log(uncoveredHits===0 ? '  ✓ NO uncovered tables — closure complete' : `  ✗ ${uncoveredHits} uncovered rows`);

// write off-git snapshot
const dir = join(homedir(),'medibuilder-offgit-snapshots');
mkdirSync(dir,{recursive:true});
const path = join(dir,'foot-TESTACCT8-legA-before-snapshot-20260810.json');
const json = JSON.stringify(snapshot,null,2);
writeFileSync(path, json);
const sha = createHash('sha256').update(json).digest('hex');

console.log('\n=== SNAPSHOT WRITTEN (OFF-GIT) ===');
console.log('  path   :', path);
console.log('  sha256 :', sha);
console.log('  bytes  :', json.length);
console.log('\n=== PER-TABLE ROW COUNTS ===');
let total=0; for (const [t,n] of Object.entries(counts)){ total+=n; console.log(`  ${t}: ${n}`); }
console.log(`  TOTAL = ${total} rows across ${Object.keys(counts).length} tables`);
