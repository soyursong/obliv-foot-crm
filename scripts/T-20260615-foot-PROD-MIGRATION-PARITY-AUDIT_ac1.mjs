/**
 * T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT AC-1 (READ-ONLY)
 *
 * 목적: obliv-foot-crm 로컬 forward 마이그 전체 vs prod(rxlomoozakkjesdqjtvd) 실제 적용분 대조.
 *   - prod 쓰기 절대 금지(read-only 쿼리만).
 *   - schema_migrations 기록은 불완전(다수 apply_*.mjs 수동적용) → 객체 존재로 ground-truth 판정.
 *
 * 판정:
 *   APPLIED  — 마이그가 선언한 핵심 객체가 prod 에 모두 존재
 *   MISSING  — 선언 객체가 prod 에 전무 (= 미적용 의심, PGRST202/42P01 류 사고 후보)
 *   DRIFT    — 일부만 존재 (부분 적용/덮어쓰기 의심)
 *   UNKNOWN  — 파싱으로 probe 대상 객체를 못 뽑음 (RLS/GRANT/seed/data-only 등)
 *
 * 출력: scripts/audit_out/parity_audit_ac1.json + 콘솔 요약
 *
 * author: dev-foot / 2026-06-15
 */
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../supabase/migrations');
const OUT_DIR = join(__dirname, 'audit_out');
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const DB_PASSWORD = (env.match(/^SUPABASE_DB_PASSWORD=(.*)$/m) || [])[1].trim();
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

// ---- forward 마이그 파일만 추림 ----
const isForward = (f) =>
  f.endsWith('.sql') &&
  !/\.(down|rollback)\.sql$/.test(f) &&
  !/_down\.sql$/.test(f) &&
  !/_rollback\.sql$/.test(f) &&
  !/^rollback_/.test(f) &&
  !/^dedupe_/.test(f) &&
  !/^dummy_/.test(f) &&
  !/^migrate_hfq/.test(f) &&
  !/^visittype_/.test(f);

const files = readdirSync(MIG_DIR).filter(isForward).sort();

// ---- 객체 추출(regex) ----
function extractObjects(sql) {
  const objs = [];
  const s = sql;
  // strip line comments to reduce false hits
  const clean = s.replace(/--[^\n]*/g, '');

  // CREATE [OR REPLACE] FUNCTION public.name(args)
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[a-z0-9_]+"?)\s*\(([^)]*)\)/gi;
  let m;
  while ((m = fnRe.exec(clean))) {
    const name = m[1].replace(/"/g, '');
    // arg types: take type tokens roughly (last word of each comma-segment, strip defaults)
    const argsRaw = m[2].trim();
    objs.push({ kind: 'function', name, argsRaw });
  }
  // CREATE TABLE [IF NOT EXISTS] public.name
  const tblRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = tblRe.exec(clean))) {
    objs.push({ kind: 'table', name: m[1].replace(/"/g, '') });
  }
  // CREATE [MATERIALIZED] VIEW [IF NOT EXISTS] public.name
  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = viewRe.exec(clean))) {
    objs.push({ kind: 'view', name: m[1].replace(/"/g, '') });
  }
  // CREATE TYPE name AS ENUM
  const typeRe = /create\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+as\s+enum/gi;
  while ((m = typeRe.exec(clean))) {
    objs.push({ kind: 'enum_type', name: m[1].replace(/"/g, '') });
  }
  // ALTER TABLE x ADD COLUMN [IF NOT EXISTS] col
  const colRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?[a-z0-9_]+"?)/gi;
  while ((m = colRe.exec(clean))) {
    objs.push({ kind: 'column', table: m[1].replace(/"/g, ''), name: m[2].replace(/"/g, '') });
  }
  // ALTER TYPE x ADD VALUE 'v'
  const enumValRe = /alter\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;
  while ((m = enumValRe.exec(clean))) {
    objs.push({ kind: 'enum_value', type: m[1].replace(/"/g, ''), name: m[2] });
  }
  return objs;
}

// dedupe objects within a migration
function dedupe(objs) {
  const seen = new Set();
  return objs.filter(o => {
    const k = JSON.stringify(o);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function existsObj(o) {
  try {
    if (o.kind === 'function') {
      // try match by name (any signature) — proname in public
      const { rows } = await client.query(
        `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=$1;`, [o.name]);
      return rows[0].n > 0;
    }
    if (o.kind === 'table') {
      const { rows } = await client.query(`SELECT to_regclass('public.'||$1) IS NOT NULL AS e;`, [o.name]);
      return rows[0].e;
    }
    if (o.kind === 'view') {
      const { rows } = await client.query(`SELECT to_regclass('public.'||$1) IS NOT NULL AS e;`, [o.name]);
      return rows[0].e;
    }
    if (o.kind === 'enum_type') {
      const { rows } = await client.query(`SELECT count(*)::int n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public' AND t.typname=$1;`, [o.name]);
      return rows[0].n > 0;
    }
    if (o.kind === 'column') {
      const { rows } = await client.query(
        `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2;`, [o.table, o.name]);
      return rows[0].n > 0;
    }
    if (o.kind === 'enum_value') {
      const { rows } = await client.query(
        `SELECT count(*)::int n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname=$1 AND e.enumlabel=$2;`, [o.type, o.name]);
      return rows[0].n > 0;
    }
  } catch (e) { return { error: e.message }; }
  return null;
}

(async () => {
  await client.connect();
  // schema_migrations set
  let smSet = new Set();
  try {
    const { rows } = await client.query(`SELECT version FROM supabase_migrations.schema_migrations;`);
    smSet = new Set(rows.map(r => r.version));
  } catch { /* ignore */ }

  const results = [];
  for (const f of files) {
    const version = (f.match(/^(\d{14})/) || [])[1] || null;
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    const objs = dedupe(extractObjects(sql));
    const checks = [];
    for (const o of objs) {
      const e = await existsObj(o);
      checks.push({ ...o, exists: e });
    }
    const probeable = checks.filter(c => c.exists === true || c.exists === false);
    const present = probeable.filter(c => c.exists === true).length;
    const absent = probeable.filter(c => c.exists === false).length;
    let verdict;
    if (probeable.length === 0) verdict = 'UNKNOWN';
    else if (absent === 0) verdict = 'APPLIED';
    else if (present === 0) verdict = 'MISSING';
    else verdict = 'DRIFT';

    results.push({
      file: f, version,
      in_schema_migrations: version ? smSet.has(version) : null,
      verdict, present, absent,
      objects: checks,
    });
  }
  await client.end();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'parity_audit_ac1.json'), JSON.stringify(results, null, 2));

  // summary
  const by = (v) => results.filter(r => r.verdict === v);
  console.log(`\n===== PARITY AUDIT AC-1 (read-only) =====`);
  console.log(`forward 마이그 파일: ${files.length}  /  schema_migrations 기록: ${smSet.size}`);
  for (const v of ['MISSING', 'DRIFT', 'APPLIED', 'UNKNOWN']) {
    console.log(`  ${v}: ${by(v).length}`);
  }
  console.log(`\n----- MISSING (probe 객체 전부 prod 부재) -----`);
  for (const r of by('MISSING')) {
    console.log(`  ❌ ${r.file}  [sm:${r.in_schema_migrations?'Y':'N'}]`);
    for (const o of r.objects) console.log(`        - ${o.kind} ${o.name || o.table+'.'+o.name || ''}`);
  }
  console.log(`\n----- DRIFT (부분 적용) -----`);
  for (const r of by('DRIFT')) {
    console.log(`  ⚠️  ${r.file}  [sm:${r.in_schema_migrations?'Y':'N'}] present=${r.present} absent=${r.absent}`);
    for (const o of r.objects) console.log(`        - ${o.exists===false?'✗':'✓'} ${o.kind} ${o.name || (o.table+'.'+o.name) || ''}`);
  }
  console.log(`\n📄 상세: scripts/audit_out/parity_audit_ac1.json`);
})();
