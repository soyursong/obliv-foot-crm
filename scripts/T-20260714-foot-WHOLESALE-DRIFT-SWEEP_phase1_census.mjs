/**
 * T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP — Phase 1 census reconstruction (READ-ONLY)
 *
 * Rebuilds the Phase 0 census enumeration (raw JSON lost from repo) as the foundation
 * for the 4 Phase-1 tracks (T-A F-198 / T-B X-16 / T-C U-56 / T-D collision-20).
 *
 * HARD GUARDS (planner MSG-20260715-035809 / DA Case C3):
 *   - ledger/DDL write = 0. Management API /database/query with SELECT/introspection ONLY.
 *   - WRITE_RE guard blocks any mutating SQL before dispatch.
 *   - NO `supabase db push` / `db repair`. NO destructive apply.
 *
 * Output: scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json
 * author: dev-foot / 2026-07-15
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no token'); process.exit(1); }

// ---- HARD write guard: SELECT/introspection only -------------------------
const WRITE_RE = /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|comment\s+on|do\s*\$|call\s|repair|refresh\s+materialized|reindex|vacuum|cluster)\b/i;
async function q(sql) {
  if (WRITE_RE.test(sql)) throw new Error('WRITE_RE guard: refusing non-read SQL:\n' + sql.slice(0, 200));
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// ---- forward-file filter (§5 census definition, incl. underscore legacy) --
const MIG_DIR = 'supabase/migrations';
function isForward(f) {
  if (!f.endsWith('.sql')) return false;
  if (/\.(rollback|down|dryrun|datafix)\.sql$/i.test(f)) return false;
  if (/_(down|dryrun|rollback)\.sql$/i.test(f)) return false;              // legacy underscore variants
  if (/^(rollback_|dedupe_|dummy_|migrate_hfq|visittype_)/i.test(f)) return false;
  return true;
}
function versionOf(f) {
  const m14 = f.match(/^(\d{14})/);
  if (m14) return m14[1];
  const m8 = f.match(/^(\d{8})/);
  if (m8) return m8[1];
  return null;
}

// ---- object + statement-type extraction ----------------------------------
function extract(sql) {
  const s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const objs = { functions: [], policies: [], tables: [], columns: [], views: [], indexes: [], types: [], triggers: [] };
  const seen = new Set();
  const push = (arr, v) => { const k = arr + '::' + v; if (!seen.has(k)) { seen.add(k); objs[arr].push(v); } };
  let m;
  // functions: CREATE [OR REPLACE] FUNCTION [schema.]name(
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(/gi;
  while ((m = fnRe.exec(s))) push('functions', `${m[1] || 'public'}.${m[2]}`);
  // policies: CREATE|ALTER POLICY "name" ON [schema.]table
  const polRe = /(?:create|alter)\s+policy\s+"?([^"\s]+)"?\s+on\s+(?:(\w+)\.)?(\w+)/gi;
  while ((m = polRe.exec(s))) push('policies', `${m[3]}::${m[1]}`);
  // tables: CREATE TABLE [IF NOT EXISTS] [schema.]name
  const tblRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)/gi;
  while ((m = tblRe.exec(s))) push('tables', m[2]);
  // columns: ALTER TABLE [schema.]t ADD COLUMN [IF NOT EXISTS] col
  const colRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:(\w+)\.)?(\w+)[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
  while ((m = colRe.exec(s))) push('columns', `${m[2]}.${m[3]}`);
  // views (incl materialized)
  const vwRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)/gi;
  while ((m = vwRe.exec(s))) push('views', m[2]);
  // indexes
  const idxRe = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(\w+)/gi;
  while ((m = idxRe.exec(s))) push('indexes', m[1]);
  // types / enums
  const typRe = /create\s+type\s+(?:(\w+)\.)?(\w+)/gi;
  while ((m = typRe.exec(s))) push('types', m[2]);
  // triggers
  const trgRe = /create\s+(?:or\s+replace\s+)?trigger\s+(\w+)/gi;
  while ((m = trgRe.exec(s))) push('triggers', m[1]);

  // statement-type tags
  const tags = [];
  if (/\bgrant\b/i.test(s) || /\brevoke\b/i.test(s)) tags.push('GRANT/REVOKE');
  if (/comment\s+on\b/i.test(s)) tags.push('COMMENT');
  if (/\bdo\s*\$\$|\bdo\s+\$/i.test(s)) tags.push('DO-block');
  if (/\binsert\s+into\b/i.test(s)) tags.push('INSERT');
  if (/\bupdate\s+\w+\s+set\b/i.test(s)) tags.push('UPDATE');
  if (/\bdelete\s+from\b/i.test(s)) tags.push('DELETE');
  if (/\bdrop\s+table\b/i.test(s)) tags.push('DROP TABLE');
  if (/\bdrop\s+constraint\b|drop\s+constraint\s+if\s+exists/i.test(s)) tags.push('DROP CONSTRAINT');
  if (/on\s+conflict\s+do\s+nothing/i.test(s)) tags.push('ON-CONFLICT-DO-NOTHING');
  if (/on\s+conflict[\s\S]*?do\s+update/i.test(s)) tags.push('ON-CONFLICT-DO-UPDATE');
  const destructive = tags.some(t => ['DELETE', 'DROP TABLE', 'DROP CONSTRAINT'].includes(t));
  const probeableCount = Object.values(objs).reduce((a, b) => a + b.length, 0);
  return { objs, tags, destructive, probeableCount };
}

// ---- load files -----------------------------------------------------------
const files = readdirSync(MIG_DIR).filter(isForward).sort();
const byVersion = new Map();
for (const f of files) {
  const v = versionOf(f);
  const sql = readFileSync(path.join(MIG_DIR, f), 'utf8');
  const ex = extract(sql);
  if (!byVersion.has(v)) byVersion.set(v, []);
  byVersion.get(v).push({ file: f, version: v, ...ex, bytes: sql.length });
}

// ---- ledger ---------------------------------------------------------------
const ledgerRows = await q(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;`);
const ledgerSet = new Set(ledgerRows.map(r => r.version));

// ---- prod introspection snapshots (batched, read-only) --------------------
const P = {};
P.functions = new Set((await q(`SELECT n.nspname||'.'||p.proname AS o FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage');`)).map(r => r.o));
P.policies = new Set((await q(`SELECT tablename||'::'||policyname AS o FROM pg_policies WHERE schemaname='public';`)).map(r => r.o));
P.tables = new Set((await q(`SELECT table_name AS o FROM information_schema.tables WHERE table_schema='public';`)).map(r => r.o));
P.columns = new Set((await q(`SELECT table_name||'.'||column_name AS o FROM information_schema.columns WHERE table_schema='public';`)).map(r => r.o));
P.views = new Set((await q(`SELECT table_name AS o FROM information_schema.views WHERE table_schema='public' UNION SELECT matviewname FROM pg_matviews WHERE schemaname='public';`)).map(r => r.o));
P.indexes = new Set((await q(`SELECT indexname AS o FROM pg_indexes WHERE schemaname='public';`)).map(r => r.o));
P.types = new Set((await q(`SELECT t.typname AS o FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public';`)).map(r => r.o));
P.triggers = new Set((await q(`SELECT tgname AS o FROM pg_trigger WHERE NOT tgisinternal;`)).map(r => r.o));

function probeVerdict(entry) {
  const { objs, probeableCount, destructive } = entry;
  if (probeableCount === 0) return { verdict: 'UNKNOWN', present: 0, absent: 0, absentList: [] };
  let present = 0, absent = 0; const absentList = [];
  for (const kind of Object.keys(objs)) {
    for (const o of objs[kind]) {
      if (P[kind]?.has(o)) present++; else { absent++; absentList.push(`${kind}:${o}`); }
    }
  }
  let verdict;
  if (absent === 0) verdict = 'APPLIED';
  else if (present === 0) verdict = destructive ? 'MISSING-DESTRUCTIVE' : 'MISSING';
  else verdict = 'DRIFT';
  return { verdict, present, absent, absentList };
}

// ---- classify per version -------------------------------------------------
const versions = [];
const collisions = [];
for (const [v, entries] of [...byVersion.entries()].sort()) {
  const inLedger = ledgerSet.has(v);
  const probes = entries.map(e => ({ file: e.file, tags: e.tags, destructive: e.destructive,
    objCount: e.probeableCount, ...probeVerdict(e), objs: e.objs }));
  if (entries.length > 1) collisions.push({ version: v, count: entries.length, inLedger, members: probes.map(p => ({ file: p.file, verdict: p.verdict, tags: p.tags })) });
  versions.push({ version: v, inLedger, fileCount: entries.length, entries: probes });
}

// pending = version not in ledger
const pending = versions.filter(x => !x.inLedger);

// classify pending into F/A/X/U (per-version: use aggregate over its files)
function classifyPending(x) {
  // aggregate verdicts across files under this version
  const vs = x.entries.map(e => e.verdict);
  const anyDestructiveMissing = x.entries.some(e => e.verdict === 'MISSING-DESTRUCTIVE');
  const allApplied = vs.every(v => v === 'APPLIED');
  const anyDrift = vs.some(v => v === 'DRIFT');
  const allUnknown = vs.every(v => v === 'UNKNOWN');
  const anyMissing = vs.some(v => v === 'MISSING' || v === 'MISSING-DESTRUCTIVE');
  if (allUnknown) return 'U';
  if (allApplied) return 'F';
  if (anyDestructiveMissing) return 'X';       // destructive → X (delete-correct)
  if (anyDrift) return 'X';                     // under-materialized → X (DDL-diff gate)
  if (anyMissing) return 'A';                   // non-destructive missing → ADDITIVE
  // mixed applied+unknown → treat as F (probeable objs all present)
  return 'F';
}
for (const x of pending) x.class = classifyPending(x);

const summary = {
  forwardFiles: files.length,
  distinctVersions: versions.length,
  ledgerRows: ledgerRows.length,
  pending: pending.length,
  collisions: collisions.length,
  classCounts: pending.reduce((a, x) => (a[x.class] = (a[x.class] || 0) + 1, a), {}),
};

const out = { ticket: 'T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP', phase: 1,
  generated: 'runtime', prod: REF, ledger_write: 0, summary,
  pending, collisions, ledgerVersions: [...ledgerSet].sort() };
writeFileSync('scripts/audit_out/T-20260714-foot-WHOLESALE-DRIFT-SWEEP_phase1_census.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(summary, null, 2));
