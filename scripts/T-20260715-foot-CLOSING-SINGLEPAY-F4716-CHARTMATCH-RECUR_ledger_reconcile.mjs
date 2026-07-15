/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — MIGRATION LEDGER RECONCILIATION (READ-ONLY)
 *
 * supervisor DB-GATE(FIX-REQUEST uydo) 보강: migration_ledger_reconciliation 3자 정합 증빙.
 * migration_ledger_reconciliation 단일표준 준수 — 정본(prod 실재) 기준 3자 대조:
 *   (A) 파일선언  : supabase/migrations/*.sql (로컬 파일 = 선언)
 *   (B) 원장      : supabase_migrations.schema_migrations (prod 원장)
 *   (C) prod 실재 : information_schema / pg_catalog (실제 오브젝트 존재)
 *
 * 본 티켓 대상 마이그 = 20260715180000_foot_payments_archive_singlepay_move
 *   (payments_archive CREATE TABLE / ADDITIVE / apply 미실행 HOLD).
 * ★ apply 前 baseline 상태 = 파일선언 O / 원장 X / prod 실재 X  → 3자 CONSISTENT(not-yet-applied).
 *   apply 後(gate3 GO) = 3자 모두 O 로 전환됨을 supervisor 가 재확인.
 *
 * 실행 경로 = Supabase Management API /database/query (SELECT only, write/DDL 0).
 *   supabase_migrations schema + information_schema 는 PostgREST 미노출 → Management API 로 조회.
 */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'rxlomoozakkjesdqjtvd';
let TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOK = m[1].trim();
  }
}
if (!TOK) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (.env.local)'); process.exit(1); }

const TARGET_VERSION = '20260715180000';
const MIG_DIR = path.join(process.cwd(), 'supabase', 'migrations');

// ── READ-ONLY 가드: SELECT/WITH 로 시작하는 쿼리만 허용 ──
async function q(label, sql) {
  const head = sql.trim().slice(0, 6).toLowerCase();
  if (!head.startsWith('select') && !head.startsWith('with')) {
    throw new Error(`READ-ONLY 위반 차단: "${label}" 는 SELECT/WITH 가 아님`);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const txt = await res.text();
  if (!res.ok) { console.log(`\n### ${label}\n  QUERY ERROR ${res.status}: ${txt.slice(0, 200)}`); return null; }
  const data = JSON.parse(txt);
  console.log(`\n### ${label}`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

console.log('══════════════════════════════════════════════════════════════════');
console.log(' MIGRATION LEDGER RECONCILIATION — T-20260715 F4716 archive-first MOVE');
console.log('  (READ-ONLY via Management API / apply 미실행 baseline / write=0)');
console.log('══════════════════════════════════════════════════════════════════');

// ── (A) 파일선언 ──
console.log('\n═══ (A) 파일선언 (supabase/migrations) ═══');
const files = fs.readdirSync(MIG_DIR)
  .filter(f => /^\d{14}.*\.sql$/.test(f) && !f.endsWith('.rollback.sql'))
  .sort();
const fileVersions = files.map(f => f.slice(0, 14));
console.log(`  파일 마이그 총 ${files.length}건. tail 5:`);
for (const f of files.slice(-5)) console.log(`    ${f}`);
const targetFile = files.find(f => f.startsWith(TARGET_VERSION));
console.log(`  ★대상 ${TARGET_VERSION} 파일선언 = ${targetFile ? 'O (' + targetFile + ')' : 'X'}`);
const rbFile = fs.existsSync(path.join(MIG_DIR, `${TARGET_VERSION}_foot_payments_archive_singlepay_move.rollback.sql`));
console.log(`  ★대상 rollback 파일 = ${rbFile ? 'O' : 'X'}`);

// ── (B) 원장 ──
await q('(B) 원장 schema_migrations tail 10 (cols: version,name)',
  `select version, name from supabase_migrations.schema_migrations order by version desc limit 10`);
await q('(B) 원장 총 건수',
  `select count(*)::int as ledger_count from supabase_migrations.schema_migrations`);
const targetInLedger = await q(`(B) 원장에 대상 ${TARGET_VERSION} 존재?`,
  `select version, name from supabase_migrations.schema_migrations where version = '${TARGET_VERSION}'`);

// ── (C) prod 실재 ──
const tableReal = await q('(C) prod 실재 payments_archive 테이블 존재?',
  `select table_schema, table_name from information_schema.tables where table_schema='public' and table_name='payments_archive'`);
await q('(C) prod 실재 payments_archive 컬럼 (있으면)',
  `select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='payments_archive' order by ordinal_position`);
await q('(C) prod 실재 payments_archive PK/인덱스 (있으면)',
  `select indexname, indexdef from pg_indexes where schemaname='public' and tablename='payments_archive'`);

// ── (C-ref) 대상 오브젝트 = payments 원본 테이블 실재 확인 (MOVE 대상 정본) ──
await q('(C-ref) payments 원본 테이블 실재 + 대상 컬럼 존재 (MOVE 정본)',
  `select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='payments' and column_name in ('id','amount','payment_type','check_in_id','memo','customer_id','tax_type')
    order by column_name`);

// ── (D) file↔ledger 전수 divergence 스캔 (OOB drift) ──
const ledgerAll = await q('(D) file↔ledger 전수 대조용 원장 version 전량',
  `select version from supabase_migrations.schema_migrations order by version`);
const ledgerVersions = new Set((ledgerAll ?? []).map(r => String(r.version)));
const fileSet = new Set(fileVersions);
const fileNotInLedger = fileVersions.filter(v => !ledgerVersions.has(v));
const ledgerNotInFile = [...ledgerVersions].filter(v => !fileSet.has(v));

console.log('\n═══ (D) file ↔ ledger 전수 divergence 스캔 ═══');
console.log(`  파일 총 ${fileVersions.length} · 원장 총 ${ledgerVersions.size}`);
console.log(`  파일에만 있고 원장에 없음 (미적용/대기): ${fileNotInLedger.length}건`);
for (const v of fileNotInLedger.slice(-15)) console.log(`    + ${v}  ${files.find(f => f.startsWith(v))}`);
if (fileNotInLedger.length > 15) console.log(`    …(그 외 ${fileNotInLedger.length - 15}건, 위는 최신 15건)`);
console.log(`  원장에만 있고 파일에 없음 (OOB/대시보드 직접): ${ledgerNotInFile.length}건`);
for (const v of ledgerNotInFile.slice(0, 30)) console.log(`    - ${v}`);

// ── 3자 정합 판정 ──
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' 3자 정합 판정 (정본=prod 실재 기준)');
console.log('══════════════════════════════════════════════════════════════════');
const A = !!targetFile;
const B = (targetInLedger ?? []).length > 0;
const C = (tableReal ?? []).length > 0;
console.log(`  (A) 파일선언 payments_archive migration : ${A ? 'O' : 'X'}`);
console.log(`  (B) 원장(schema_migrations) 등재        : ${B ? 'O' : 'X'}`);
console.log(`  (C) prod 실재(payments_archive 테이블)  : ${C ? 'O' : 'X'}`);

let verdict;
if (!A && !B && !C) verdict = 'ERROR — 파일선언조차 없음 (마이그 파일 유실)';
else if (A && !B && !C) verdict = 'CONSISTENT (not-yet-applied) — 파일 O / 원장 X / prod X. apply 前 정상 baseline. gate3 GO 후 apply 시 3자 모두 O 로 전환.';
else if (A && B && C) verdict = 'CONSISTENT (applied) — 3자 모두 O. apply 완료·정합.';
else verdict = `DIVERGENCE — A=${A} B=${B} C=${C}. 정본(prod C) 기준 재수렴 필요(forward-doc / ADDITIVE 재수렴 / 삭제-정정).`;
console.log(`\n  ▶ 대상 마이그 3자 정합 = ${verdict}`);
console.log(`  ▶ 전수 file↔ledger divergence: file-only ${fileNotInLedger.length} / ledger-only ${ledgerNotInFile.length}`);
console.log('\n(READ-ONLY 완료 · write/DDL 0 · Management API read_only:true)');
