// T-20260810-foot-TESTACCT-CLEANUP-8ACCT — off-git before-snapshot (no-snapshot-no-delete).
// READ-ONLY: SELECT * of each destructive leg's FK closure → off-git JSON + sha256.
// PHI 포함 → repo 밖(~/medibuilder-offgit-snapshots/) 에만 기록. apply 시 supervisor 가 GO-token 시점 재-스냅샷/대조.
import { q } from './dryrun_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=async s=>{ for(let a=0;a<6;a++){try{const r=await q(s);await sleep(400);return r.result||r;}catch(e){if(/429/.test(e.message)){await sleep(4000);continue;}throw e;}} throw new Error('retry-exhausted'); };

const OUT = join(homedir(), 'medibuilder-offgit-snapshots');
mkdirSync(OUT, { recursive: true });

// per-leg archive predicates (mirror the migration's _arch_* CREATE predicates)
const LEGS = {
  'legAa': {
    file: 'foot-TESTACCT8-legAa-before-snapshot-20260811.json',
    cust: "'a0f8c846-9f93-47bf-a79e-57d265d989b6','02594dfa-9428-4405-b640-95ab50ad5e5d','c074025b-cd27-443c-93a9-151d6d4214d4'",
    hasForm: false,
  },
  'legAb': {
    file: 'foot-TESTACCT8-legAb-before-snapshot-20260811.json',
    cust: "'21a82994-b231-4bcc-94ff-dd9e6c3a4951','d7faae9b-8e0b-421a-b68b-483ede6834a3'",
    hasForm: true,
  },
};

for (const [leg, cfg] of Object.entries(LEGS)){
  const c = cfg.cust;
  const resv = `(SELECT id FROM reservations WHERE customer_id IN (${c}))`;
  const chk  = `(SELECT id FROM check_ins WHERE customer_id IN (${c}) OR reservation_id IN ${resv})`;
  const pkg  = `(SELECT id FROM packages WHERE customer_id IN (${c}))`;
  const Q = {
    customers: `SELECT * FROM customers WHERE id IN (${c})`,
    reservations: `SELECT * FROM reservations WHERE customer_id IN (${c})`,
    packages: `SELECT * FROM packages WHERE customer_id IN (${c})`,
    check_ins: `SELECT * FROM check_ins WHERE customer_id IN (${c}) OR reservation_id IN ${resv}`,
    assignment_actions: `SELECT * FROM assignment_actions WHERE check_in_id IN ${chk}`,
    chart_treatment_requests: `SELECT * FROM chart_treatment_requests WHERE customer_id IN (${c}) OR check_in_id IN ${chk}`,
    check_in_room_logs: `SELECT * FROM check_in_room_logs WHERE check_in_id IN ${chk}`,
    check_in_services: `SELECT * FROM check_in_services WHERE check_in_id IN ${chk}`,
    customer_treatment_memos: `SELECT * FROM customer_treatment_memos WHERE customer_id IN (${c})`,
    health_q_results: `SELECT * FROM health_q_results WHERE customer_id IN (${c})`,
    health_q_tokens: `SELECT * FROM health_q_tokens WHERE customer_id IN (${c})`,
    reservation_logs: `SELECT * FROM reservation_logs WHERE reservation_id IN ${resv}`,
    reservation_memo_history: `SELECT * FROM reservation_memo_history WHERE reservation_id IN ${resv} OR check_in_id IN ${chk}`,
    status_transitions: `SELECT * FROM status_transitions WHERE check_in_id IN ${chk}`,
    package_sessions: `SELECT * FROM package_sessions WHERE check_in_id IN ${chk} OR package_id IN ${pkg}`,
    notification_logs: `SELECT * FROM notification_logs WHERE customer_id IN (${c}) OR reservation_id IN ${resv}`,
    phi_access_log: `SELECT * FROM phi_access_log WHERE customer_id IN (${c})`,
  };
  if (cfg.hasForm) Q.form_submissions = `SELECT * FROM form_submissions WHERE customer_id IN (${c}) OR check_in_id IN ${chk}`;

  const snap = { ticket:'T-20260810-foot-TESTACCT-CLEANUP-8ACCT', leg, captured_by:'dev-foot', prod:'rxlomoozakkjesdqjtvd', tables:{} };
  let total=0;
  for (const [t, sql] of Object.entries(Q)){
    const rows = await run(sql);
    snap.tables[t] = rows; total += rows.length;
  }
  snap.total_rows = total;
  const json = JSON.stringify(snap);
  const sha = createHash('sha256').update(json).digest('hex');
  const path = join(OUT, cfg.file);
  writeFileSync(path, JSON.stringify({ ...snap, _sha256_of_payload: sha }, null, 0));
  console.log(`${leg}: ${total} rows → ${path}`);
  console.log(`  sha256(payload) = ${sha}`);
  const perTable = Object.entries(snap.tables).map(([t,r])=>`${t}=${r.length}`).join(' ');
  console.log(`  per-table: ${perTable}`);
}
console.log('\nSNAPSHOT DONE (READ-ONLY · off-git · PHI not in repo)');
