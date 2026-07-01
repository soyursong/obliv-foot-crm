/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track 1 (READ-ONLY)
 *
 * 목적: foot supabase_migrations 원장이 20260609234500(118행)에서 정지 → 6/09 이후 마이그는
 *   원장 미추적·개별 apply.mjs 로만 PROD 반영. apply 누락 시 PROD 조용히 미반영(drift).
 *   확정 casualty = staff_write_staffarea_phrases(20260620120000 / 92a95431).
 *   → 20260609234500 이후 forward 마이그 전수를 PROD 실적용 상태와 대조, 92a95431-class 추가 casualty 목록화.
 *
 * 방법(precedent T-20260615-PROD-MIGRATION-PARITY-AUDIT AC1 재사용 + RLS 정책 probe 추가):
 *   - PROD 쓰기 절대 금지. Management API /database/query read-only 쿼리만.
 *   - PROD 상태를 6개 bulk 쿼리로 1회 스냅샷 후 in-memory 대조(객체 존재 = ground-truth).
 *   - ★precedent 는 RLS/GRANT 를 UNKNOWN 으로 흘렸음 → 92a95431-class(RLS 정책) casualty 가 바로 거기 숨음.
 *     본 sweep 은 CREATE POLICY 를 pg_policies 로 직접 probe(핵심 개선).
 *
 * 판정:
 *   APPLIED — 선언 probe 객체가 PROD 에 모두 존재
 *   MISSING — probe 객체 전부 PROD 부재 (= casualty 후보)
 *   DRIFT   — 일부만 존재 (부분 적용/덮어쓰기)
 *   UNKNOWN — probe 대상 객체 미추출(순수 GRANT/REVOKE/data-only) — 수기 검토 플래그
 *
 * security_priority: 파일에 CREATE POLICY / GRANT / REVOKE / RLS 포함 시 true (신뢰성·보안 리스크 우선표시).
 *
 * 게이트대기 제외(by-design pending, casualty 아님): 20260701030000(coordinator_write_staffarea, .SUPERSEDED).
 *
 * author: dev-foot / 2026-07-01
 */
import fs from 'node:fs';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../supabase/migrations');
const OUT_DIR = join(__dirname, 'audit_out');
const REF = 'rxlomoozakkjesdqjtvd';
const CUTOFF = '20260609234500';            // 원장 정지 지점 (이 버전 이후 ~ 현재)
const GATE_PENDING = new Set(['20260701030000']); // by-design pending(coordinator_write_staffarea), casualty 제외

const env = readFileSync(join(__dirname, '../.env.local'), 'utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요(.env.local)'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ── forward 마이그만 (rollback/down/seed-script 제외) ──
const isForward = (f) =>
  f.endsWith('.sql') &&
  !/\.(down|rollback)\.sql$/.test(f) &&
  !/_down\.sql$/.test(f) && !/_rollback\.sql$/.test(f) &&
  !/^rollback_/.test(f) && !/^dedupe_/.test(f) && !/^dummy_/.test(f) &&
  !/^migrate_hfq/.test(f) && !/^visittype_/.test(f) && !/\.datafix\.sql$/.test(f);

const files = readdirSync(MIG_DIR)
  .filter(isForward)
  .filter(f => { const v = (f.match(/^(\d{14})/) || [])[1]; return v && v >= CUTOFF; })
  .filter(f => { const v = (f.match(/^(\d{14})/) || [])[1]; return !GATE_PENDING.has(v); })
  .sort();

// ── 객체 추출 ──
function extractObjects(sql) {
  const clean = sql.replace(/--[^\n]*/g, '');
  const objs = [];
  let m;
  const push = (o) => objs.push(o);

  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[a-z0-9_]+"?)\s*\(/gi;
  while ((m = fnRe.exec(clean))) push({ kind: 'function', name: m[1].replace(/"/g, '') });

  const tblRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = tblRe.exec(clean))) push({ kind: 'table', name: m[1].replace(/"/g, '') });

  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = viewRe.exec(clean))) push({ kind: 'view', name: m[1].replace(/"/g, '') });

  const typeRe = /create\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+as\s+enum/gi;
  while ((m = typeRe.exec(clean))) push({ kind: 'enum_type', name: m[1].replace(/"/g, '') });

  const colRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?[a-z0-9_]+"?)/gi;
  while ((m = colRe.exec(clean))) push({ kind: 'column', table: m[1].replace(/"/g, ''), name: m[2].replace(/"/g, '') });

  const enumValRe = /alter\s+type\s+(?:public\.)?("?[a-z0-9_]+"?)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;
  while ((m = enumValRe.exec(clean))) push({ kind: 'enum_value', type: m[1].replace(/"/g, ''), name: m[2] });

  // ★ RLS 정책 (precedent 미probe 영역 — casualty 핵심)
  const polRe = /create\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?("?[a-z0-9_]+"?)/gi;
  while ((m = polRe.exec(clean))) push({ kind: 'policy', name: m[1], table: m[2].replace(/"/g, '') });

  const idxRe = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?("?[a-z0-9_]+"?)\s+on/gi;
  while ((m = idxRe.exec(clean))) push({ kind: 'index', name: m[1].replace(/"/g, '') });

  const trigRe = /create\s+(?:or\s+replace\s+)?trigger\s+("?[a-z0-9_]+"?)/gi;
  while ((m = trigRe.exec(clean))) push({ kind: 'trigger', name: m[1].replace(/"/g, '') });

  // dedupe
  const seen = new Set();
  return objs.filter(o => { const k = JSON.stringify(o); if (seen.has(k)) return false; seen.add(k); return true; });
}

const isSecurity = (sql) => /create\s+policy|drop\s+policy|\bgrant\b|\brevoke\b|enable\s+row\s+level\s+security|alter\s+.*\s+force\s+row\s+level/i.test(sql.replace(/--[^\n]*/g, ''));

(async () => {
  console.log(`Track1 sweep — cutoff>${CUTOFF}, forward files: ${files.length}`);

  // ── PROD 스냅샷 (6 bulk read-only 쿼리) ──
  const [smRows, procRows, relRows, colRows, enumRows, polRows, idxRows, trigRows] = await Promise.all([
    q(`SELECT version FROM supabase_migrations.schema_migrations;`).catch(() => []),
    q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';`),
    q(`SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';`),
    q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public';`),
    q(`SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid;`),
    q(`SELECT tablename, policyname FROM pg_policies WHERE schemaname='public';`),
    q(`SELECT indexname FROM pg_indexes WHERE schemaname='public';`),
    q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`),
  ]);

  const smSet = new Set((smRows || []).map(r => r.version));
  const procSet = new Set(procRows.map(r => r.proname));
  const relSet = new Set(relRows.map(r => r.relname));
  const colSet = new Set(colRows.map(r => `${r.table_name}.${r.column_name}`));
  const enumSet = new Set(enumRows.map(r => `${r.typname}.${r.enumlabel}`));
  const polSet = new Set(polRows.map(r => `${r.tablename}.${r.policyname}`));
  const idxSet = new Set(idxRows.map(r => r.indexname));
  const trigSet = new Set(trigRows.map(r => r.tgname));

  const exists = (o) => {
    switch (o.kind) {
      case 'function': return procSet.has(o.name);
      case 'table': case 'view': return relSet.has(o.name);
      case 'enum_type': return relSet.has(o.name) || [...enumSet].some(k => k.startsWith(o.name + '.'));
      case 'column': return colSet.has(`${o.table}.${o.name}`);
      case 'enum_value': return enumSet.has(`${o.type}.${o.name}`);
      case 'policy': return polSet.has(`${o.table}.${o.name}`);
      case 'index': return idxSet.has(o.name);
      case 'trigger': return trigSet.has(o.name);
      default: return null;
    }
  };

  const results = [];
  for (const f of files) {
    const version = (f.match(/^(\d{14})/) || [])[1] || null;
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    const objs = extractObjects(sql);
    const checks = objs.map(o => ({ ...o, exists: exists(o) }));
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
      in_ledger: version ? smSet.has(version) : null,
      security: isSecurity(sql),
      verdict, present, absent,
      objects: checks,
    });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track1.json'), JSON.stringify(results, null, 2));

  const by = (v) => results.filter(r => r.verdict === v);
  console.log(`\n===== TRACK1 PARITY SWEEP (read-only) =====`);
  console.log(`대상 forward 마이그: ${files.length}  /  ledger(schema_migrations) 총: ${smSet.size}`);
  const inLedger = results.filter(r => r.in_ledger).length;
  console.log(`대상 중 ledger 기록: ${inLedger}/${files.length} (원장 정지 확인: ${CUTOFF} 이후 미추적)`);
  for (const v of ['MISSING', 'DRIFT', 'APPLIED', 'UNKNOWN']) console.log(`  ${v}: ${by(v).length}`);

  const casualties = [...by('MISSING'), ...by('DRIFT')].sort((a, b) => (b.security - a.security) || a.version.localeCompare(b.version));
  console.log(`\n----- CASUALTY 후보 (MISSING+DRIFT), 보안우선 정렬 -----`);
  for (const r of casualties) {
    const tag = r.security ? '🔒SEC' : '     ';
    console.log(`  ${tag} [${r.verdict}] ${r.file}  (ledger:${r.in_ledger ? 'Y' : 'N'} present=${r.present} absent=${r.absent})`);
    for (const o of r.objects.filter(c => c.exists === false))
      console.log(`         ✗ ${o.kind} ${o.name || ''}${o.table ? ' on ' + o.table : ''}`);
  }
  console.log(`\n----- UNKNOWN 중 security(순수 GRANT/REVOKE 등, 수기검토) -----`);
  for (const r of by('UNKNOWN').filter(r => r.security))
    console.log(`  🔒 ${r.file} (ledger:${r.in_ledger ? 'Y' : 'N'})`);

  console.log(`\n📄 상세: scripts/audit_out/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track1.json`);
})();
