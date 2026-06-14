/**
 * T-20260610-foot-RXSET-NAMEDESC-MODEL — Q3 A-1 자동이관 audit + gated apply
 *
 * supervisor DB게이트 option(b) 승인(MSG-20260615-085451-8uyv): audit + apply 둘 다 dev-foot 위임.
 *
 * 흐름:
 *   [A] read-only audit (3 SELECT) — supabase/ops/rxset_namedesc_dryrun_audit_20260613.sql 로직
 *   [GATE] 기대값 total=19 single=19 will_migrate=19 multi=0 already=0 일치 여부.
 *          불일치 → apply 멈추고 exit 2 (보고).
 *   [B] migrate.sql 직접 apply (BEGIN/COMMIT 내장, verify DO 블록 RAISE on fail).
 *   [C] post-verify: backup 19행 / mismatch 0 / items[0].name=name single 19.
 *
 * 실행: node scripts/apply_20260613120000_rxset_namedesc_migrate.mjs
 *   --audit-only  → audit + gate 만, apply 안 함
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const AUDIT_ONLY = process.argv.includes('--audit-only');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const MIG_SQL = readFileSync(
  join(REPO, 'supabase/migrations/20260613120000_rxset_namedesc_migrate.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260610-foot-RXSET-NAMEDESC-MODEL_evidence.md');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };

const EXPECT = { total: 19, single: 19, multi: 0, will_migrate: 19, already: 0 };

(async () => {
  await client.connect();
  out('# T-20260610-foot-RXSET-NAMEDESC-MODEL — DB-gate evidence (audit + apply)');
  out('');
  out(`- prod: rxlomoozakkjesdqjtvd`);
  out(`- 실행: ${new Date().toISOString()}`);
  out(`- audit: supabase/ops/rxset_namedesc_dryrun_audit_20260613.sql`);
  out(`- migrate: supabase/migrations/20260613120000_rxset_namedesc_migrate.sql`);
  out(`- mode: ${AUDIT_ONLY ? 'AUDIT-ONLY' : 'AUDIT + APPLY'}`);
  out('');

  // ───────── [A] read-only audit ─────────
  out('## [A] read-only audit (3 SELECT, 쓰기 없음)');
  const { rows: aRows } = await client.query(`
    SELECT
      count(*)                                                          AS total_sets,
      count(*) FILTER (WHERE jsonb_array_length(items) = 1)             AS single_item,
      count(*) FILTER (WHERE jsonb_array_length(items) > 1)             AS multi_item,
      count(*) FILTER (WHERE jsonb_array_length(items) = 1
                        AND (items->0->>'name') IS DISTINCT FROM name)  AS will_migrate,
      count(*) FILTER (WHERE jsonb_array_length(items) = 1
                        AND (items->0->>'name') = name)                 AS already_migrated
    FROM prescription_sets;`);
  const a = aRows[0];
  const got = {
    total: +a.total_sets, single: +a.single_item, multi: +a.multi_item,
    will_migrate: +a.will_migrate, already: +a.already_migrated,
  };
  out('```');
  out(`(1) 분포: total=${got.total} single=${got.single} multi=${got.multi} will_migrate=${got.will_migrate} already=${got.already}`);
  out(`    기대: total=19 single=19 multi=0 will_migrate=19 already=0`);
  out('```');

  // (2) before→after preview
  const { rows: prev } = await client.query(`
    SELECT ps.id, ps.name AS set_name,
      ps.items->0->>'name' AS cur_item_name,
      ps.name AS new_item_name,
      ps.items->0->>'notes' AS cur_notes,
      CASE WHEN COALESCE(NULLIF(TRIM(ps.items->0->>'notes'), ''), '') = ''
        THEN COALESCE(ps.items->0->>'name', '') ELSE ps.items->0->>'notes' END AS new_notes
    FROM prescription_sets ps
    WHERE jsonb_array_length(ps.items) = 1
      AND (ps.items->0->>'name') IS DISTINCT FROM ps.name
    ORDER BY ps.sort_order NULLS LAST, ps.name;`);
  out('');
  out(`(2) before→after 미리보기 (${prev.length}건):`);
  out('```');
  for (const r of prev) {
    out(`  • set="${r.set_name}" | item.name "${r.cur_item_name}"→"${r.new_item_name}" | notes "${r.cur_notes ?? ''}"→"${r.new_notes}"`);
  }
  out('```');

  // (3) multi-item
  const { rows: multi } = await client.query(`
    SELECT id, name, jsonb_array_length(items) AS item_count
    FROM prescription_sets WHERE jsonb_array_length(items) <> 1;`);
  out('');
  out(`(3) multi-item 세트 (${multi.length}건, 0 기대):`);
  out('```');
  if (multi.length === 0) out('  (없음)');
  for (const r of multi) out(`  • ${r.name} (items=${r.item_count})`);
  out('```');
  out('');

  // ───────── [GATE] ─────────
  const gateOk =
    got.total === EXPECT.total && got.single === EXPECT.single &&
    got.multi === EXPECT.multi && got.will_migrate === EXPECT.will_migrate &&
    got.already === EXPECT.already;
  out('## [GATE] 기대값 대조');
  out('```');
  for (const k of Object.keys(EXPECT)) {
    out(`  ${got[k] === EXPECT[k] ? 'PASS' : 'FAIL'}  ${k}: got=${got[k]} expect=${EXPECT[k]}`);
  }
  out(`  gate = ${gateOk ? 'PASS ✅' : 'FAIL ❌'}`);
  out('```');
  out('');

  if (!gateOk) {
    out('⛔ 기대값 불일치 → apply 중단. supervisor 보고 필요.');
    await client.end();
    flush();
    process.exit(2);
  }
  if (AUDIT_ONLY) {
    out('✋ --audit-only: gate PASS 확인. apply 미실행.');
    await client.end();
    flush();
    process.exit(0);
  }

  // ───────── [B] apply migrate.sql ─────────
  out('## [B] migrate.sql 직접 apply');
  await client.query(MIG_SQL);
  out('✅ 적용 완료 (BEGIN/COMMIT 내장, verify DO 블록 통과 — RAISE 없음)');
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out('');

  // ───────── [C] post-verify ─────────
  out('## [C] post-verify');
  const { rows: bRows } = await client.query(
    `SELECT count(*) AS n FROM prescription_sets_namedesc_backup_20260613;`);
  const backupN = +bRows[0].n;
  const { rows: mRows } = await client.query(`
    SELECT count(*) AS n FROM prescription_sets
    WHERE jsonb_array_length(items) = 1 AND (items->0->>'name') IS DISTINCT FROM name;`);
  const mismatchN = +mRows[0].n;
  const { rows: okRows } = await client.query(`
    SELECT count(*) AS n FROM prescription_sets
    WHERE jsonb_array_length(items) = 1 AND (items->0->>'name') = name;`);
  const alignedN = +okRows[0].n;
  out('```');
  out(`  backup 스냅샷 행수: ${backupN} (19 기대)`);
  out(`  잔여 mismatch(single, item.name≠set.name): ${mismatchN} (0 기대)`);
  out(`  정렬 완료(single, item.name=set.name): ${alignedN} (19 기대)`);
  out('```');

  const verifyOk = backupN === 19 && mismatchN === 0 && alignedN === 19;
  out('');
  out('## [결과]');
  out(`  UPDATE 대상: ${prev.length}건 → backup ${backupN} / aligned ${alignedN} / mismatch ${mismatchN}`);
  out(`  db_gate + apply = ${verifyOk ? 'PASS ✅ (UPDATE 19, verify PASS)' : 'FAIL ❌'}`);
  out('');
  out('- 신규 컬럼/테이블/enum 0 (백업 테이블만 생성, 데이터계약 비변경). data-architect 게이트 비해당.');
  out('- rollback 원천: prescription_sets_namedesc_backup_20260613 (id/name/items 스냅샷).');
  out('- 멱등: 재실행 시 WHERE 절에서 이미 이관 제외 → no-op.');

  await client.end();
  flush();
  process.exit(verifyOk ? 0 : 3);
})().catch((e) => {
  out(`❌ 실패: ${e.message}`);
  flush();
  process.exit(1);
});

function flush() {
  try {
    mkdirSync(EVID_DIR, { recursive: true });
    writeFileSync(EVID_FILE, log.join('\n') + '\n', 'utf8');
    console.log(`\n📄 evidence → ${EVID_FILE}`);
  } catch (e) { console.error('evidence write fail:', e.message); }
}
