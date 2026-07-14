/**
 * DRY-RUN + FORENSIC: T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE — Step2
 * READ-ONLY. No mutation. Supabase Management API (/database/query), foot ref rxlomoozakkjesdqjtvd.
 *
 * Produces (per data_correction_backfill_sop):
 *   §0-2 source-closure forensic : created_at distribution of suspect rows (are new bad rows still landing?)
 *   §1     count reconcile       : category counts (customers.phone + reservations.customer_phone)
 *   §2     target freeze set     : deterministic KR-mobile-normalizable rows (candidate matches KR E.164)
 *   §2-F   residual/fallback set  : allzero / malformed / foreign-no-plus → NOT force-changed, reported
 *
 * PHI hygiene (§4): row-level output (real phone values) written ONLY to off-git artifacts dir.
 *   git-tracked stdout shows COUNTS ONLY.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.HOME + '/foot-backfill-artifacts/T-20260713-PHONE-E164';
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const tok = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.text();
  if (!r.ok) { console.error(`HTTP ${r.status}: ${body}`); process.exit(1); }
  return JSON.parse(body);
}

// Canonical predicates (DA-final PIN, MSG-20260713-193142-xhdb)
const KR_E164 = `phone ~ '^\\+82(1[016789]\\d{7,8})$'`;
const FOREIGN_E164 = `phone ~ '^\\+(?!82)[1-9]\\d{6,14}$'`;

// suspect = not null, not DUMMY, not placeholder, not already-valid (KR or foreign) E.164
function suspectCTE(table, col) {
  return `
  WITH base AS (
    SELECT id, ${col} AS phone, created_at, updated_at,
           regexp_replace(${col}, '[^0-9]', '', 'g') AS digits
    FROM public.${table}
    WHERE ${col} IS NOT NULL
      AND ${col} NOT LIKE 'DUMMY-%'
      AND ${col} <> '+821000000000'
      AND ${col.replace(/^/, '')} !~ '^\\+82(1[016789]\\d{7,8})$'
      AND ${col} !~ '^\\+(?!82)[1-9]\\d{6,14}$'
  ),
  classified AS (
    SELECT *,
      CASE
        WHEN digits ~ '^01[016789]\\d{7,8}$'  THEN '+82' || substring(digits from 2)
        WHEN digits ~ '^821[016789]\\d{7,8}$' THEN '+'   || digits
        ELSE NULL
      END AS candidate
    FROM base
  ),
  verified AS (
    SELECT *,
      CASE WHEN candidate ~ '^\\+82(1[016789]\\d{7,8})$' THEN 'NORMALIZE' ELSE 'RESIDUAL' END AS disposition
    FROM classified
  )
  SELECT * FROM verified`;
}

async function analyze(table, col, label) {
  const rows = await q(`${suspectCTE(table, col)} ORDER BY disposition, created_at`);
  const norm = rows.filter(r => r.disposition === 'NORMALIZE');
  const resid = rows.filter(r => r.disposition === 'RESIDUAL');

  // integrity guard: candidate must be valid & deterministic
  const bad = norm.filter(r => !/^\+82(1[016789]\d{7,8})$/.test(r.candidate));
  const createdList = rows.map(r => r.created_at).filter(Boolean).sort();

  console.log(`\n===== ${label} (${table}.${col}) =====`);
  console.log(`suspect total        : ${rows.length}`);
  console.log(`  → NORMALIZE (det.)  : ${norm.length}`);
  console.log(`  → RESIDUAL (triage) : ${resid.length}`);
  console.log(`candidate-invalid bug: ${bad.length}  (must be 0)`);
  console.log(`§0-2 forensic — suspect created_at range: ${createdList[0] || 'n/a'}  ..  ${createdList[createdList.length - 1] || 'n/a'}`);

  // off-git PHI dump (freeze set + residual w/ judgment basis)
  const dump = {
    table, col, generated_note: 'OFF-GIT PHI ARTIFACT — do not commit',
    normalize_count: norm.length, residual_count: resid.length,
    freeze_pks: norm.map(r => r.id),
    normalize_rows: norm.map(r => ({ id: r.id, old: r.phone, new: r.candidate, created_at: r.created_at, updated_at: r.updated_at })),
    residual_rows: resid.map(r => ({ id: r.id, phone: r.phone, digits: r.digits, created_at: r.created_at, updated_at: r.updated_at, reason: classifyResidual(r) })),
  };
  writeFileSync(`${OUT}/${table}_${col}_dryrun.json`, JSON.stringify(dump, null, 2));
  return { table, col, total: rows.length, norm: norm.length, resid: resid.length, bad: bad.length, dump };
}

function classifyResidual(r) {
  const d = r.digits || '';
  if (/^0+$/.test(d) || /0{6,}/.test(d)) return 'allzero/placeholder-variant';
  if (r.phone && r.phone.startsWith('+')) return 'foreign-or-malformed-e164';
  if (/^0[2-9]/.test(d)) return 'kr-landline';
  return 'unclassified/malformed';
}

console.log('=== T-20260713 PHONE-E164 BACKFILL — DRY-RUN + FORENSIC (READ-ONLY) ===');
const c = await analyze('customers', 'phone', 'CUSTOMERS');
const r = await analyze('reservations', 'customer_phone', 'RESERVATIONS');

console.log('\n===== SUMMARY =====');
console.log(`customers    : ${c.total} suspect → ${c.norm} normalize / ${c.resid} residual`);
console.log(`reservations : ${r.total} suspect → ${r.norm} normalize / ${r.resid} residual`);
console.log(`candidate-invalid (both, must be 0): ${c.bad + r.bad}`);
console.log(`\noff-git PHI dumps written to: ${OUT}/`);
console.log('(git-tracked output = counts only; freeze PKs + before-image in off-git json)');
