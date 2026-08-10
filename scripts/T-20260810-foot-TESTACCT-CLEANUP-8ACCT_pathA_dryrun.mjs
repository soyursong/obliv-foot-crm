// T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Path-A dry-run (no-persistence)
// GOAL (item 4): with F-4427(printed) REMOVED from delete set, probe whether the
//   draft(F-4425) + voided(F-4692) form_submissions DELETE through WITHOUT trigger DISABLE.
//   If both pass  -> Path-A clean (no CEO gate). If either blocked -> Path-B (scoped DISABLE, CEO light sign-off).
// NO-PERSISTENCE: every probe wrapped in a plpgsql sub-block that rolls back to implicit
//   savepoint on exception; the outer DO ends with a sentinel RAISE that aborts the whole txn.
//   Results are encoded INTO the final RAISE message so they survive the Management API error channel.
// DELETE 0 (net) / WRITE 0 (net) / DDL 0.
import { q } from './dryrun_lib.mjs';

const DRAFT  = 'b0edd82a-0d86-4a80-af21-04391d0f1b92'; // F-4425 풋테스트3 draft  doc_serial_seq NULL
const VOIDED = '755ac489-a262-48a8-bad0-2f03142c992a'; // F-4692 송지현2 voided draft doc_serial_seq NULL
const PRINTED= 'b4a36c4e-f5a8-4afb-8f87-b581f152050e'; // F-4427 풋테스트1 printed doc_serial_seq 74 (EXCLUDED from Leg A)

// One no-persist DO block. Each DELETE is in its own sub-block that traps SQLSTATE and rolls back.
// The block NEVER commits: final RAISE aborts the txn -> nothing persists (verified by post-probe below).
const probeSql = `
DO $$
DECLARE msg text := 'PATHA_PROBE ';
BEGIN
  BEGIN
    DELETE FROM form_submissions WHERE id = '${DRAFT}';
    msg := msg || 'DRAFT(F-4425,draft)=DELETE_OK ';
  EXCEPTION WHEN OTHERS THEN
    msg := msg || 'DRAFT(F-4425,draft)=BLOCKED[' || SQLSTATE || '] ';
  END;
  BEGIN
    DELETE FROM form_submissions WHERE id = '${VOIDED}';
    msg := msg || 'VOIDED(F-4692,voided)=DELETE_OK ';
  EXCEPTION WHEN OTHERS THEN
    msg := msg || 'VOIDED(F-4692,voided)=BLOCKED[' || SQLSTATE || '] ';
  END;
  BEGIN
    DELETE FROM form_submissions WHERE id = '${PRINTED}';
    msg := msg || 'PRINTED(F-4427,printed,EXCLUDED-control)=DELETE_OK ';
  EXCEPTION WHEN OTHERS THEN
    msg := msg || 'PRINTED(F-4427,printed,EXCLUDED-control)=BLOCKED[' || SQLSTATE || '] ';
  END;
  -- sentinel: abort whole txn -> NO PERSISTENCE. msg carried in error text.
  RAISE EXCEPTION 'DRYRUN_SENTINEL_ABORT :: %', msg;
END $$;
`;

let probeResult = null;
try {
  await q(probeSql);
  probeResult = 'UNEXPECTED: DO block did not raise (sentinel missing?)';
} catch (e) {
  // sentinel RAISE surfaces as HTTP error text -> extract our encoded msg
  const m = e.message.match(/DRYRUN_SENTINEL_ABORT :: (.*?)(?:"|\\n|$)/);
  probeResult = m ? m[1].trim() : e.message.slice(0, 400);
}
console.log('PROBE_RESULT:', probeResult);

// ── post-probe: confirm NO PERSISTENCE (all 3 form_submissions rows still present) ──
const run = async (sql) => { const r = await q(sql); return r.result || r; };
const post = await run(`SELECT id::text, status, doc_serial_seq FROM form_submissions
  WHERE id IN ('${DRAFT}','${VOIDED}','${PRINTED}') ORDER BY status;`);
console.log('POST_PROBE_ROWS_STILL_PRESENT (must be 3 = no persistence):', JSON.stringify(post));
console.log('NO_PERSISTENCE:', post.length === 3 ? 'PASS' : 'FAIL');

// ── verdict ──
const draftBlocked  = /DRAFT\(F-4425,draft\)=BLOCKED/.test(probeResult);
const voidedBlocked = /VOIDED\(F-4692,voided\)=BLOCKED/.test(probeResult);
const anyBlanketBlock = draftBlocked || voidedBlocked;
console.log('VERDICT:', anyBlanketBlock
  ? 'PATH-B REQUIRED — draft/voided DELETE blocked by trigger even WITHOUT F-4427 (blanket DELETE guard). scoped txn-local DISABLE needed -> CEO light sign-off (H6).'
  : 'PATH-A CLEAN — draft/voided DELETE through without DISABLE. No CEO gate needed.');
