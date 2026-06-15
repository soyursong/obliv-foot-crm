/**
 * T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — AC-2 적용+검증 (#A insurance_claims + #7 컬럼)
 *
 * planner 판정(AC-2):
 *   #A insurance_claims_schema — GO 최우선(live 42P01). PHI/금융+RLS → DA CONSULT GO + supervisor DDL-diff 후 적용.
 *   #7 is_healer_intent — 컬럼 ADD 만(backfill 분리). #A DA CONSULT 동봉.
 *   ★ prod 쓰기는 DA GO + supervisor DDL-diff 통과 전까지 HOLD. 그 전엔 dry-run(read-only)만.
 *
 * DWELLSWAP(AC-6) 패턴: pooler 직결 + 적용 전/후 ground-truth probe + ANON 경로 검증 + 스키마캐시 reload.
 *
 * 사용:
 *   node apply_parity_ac2_pg.mjs            # dry-run — read-only ground-truth(현 prod 상태) + ANON 프로브
 *   node apply_parity_ac2_pg.mjs --apply    # [게이트 통과 후만] #A apply → #7 컬럼 apply → 검증 → 캐시 reload
 *   node apply_parity_ac2_pg.mjs --rollback # #7 컬럼 rollback → #A scoped_rollback (claim_diagnoses 보존)
 *
 * author: dev-foot / 2026-06-15
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
try {
  for (const line of readFileSync(join(repoRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
} catch { /* env optional */ }
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const ROLLBACK = process.argv.includes('--rollback');
const APPLY = process.argv.includes('--apply') || ROLLBACK;

const SQL = {
  aApply:    readFileSync(join(__dirname, 'A_insurance_claims.apply.sql'), 'utf8'),
  aRollback: readFileSync(join(__dirname, 'A_insurance_claims.scoped_rollback.sql'), 'utf8'),
  h7Apply:   readFileSync(join(__dirname, 'H7_is_healer_intent_column.apply.sql'), 'utf8'),
  h7Rollback:readFileSync(join(__dirname, 'H7_is_healer_intent_column.rollback.sql'), 'utf8'),
};

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const TABLES = ['insurance_claims', 'claim_items', 'edi_submissions', 'claim_diagnoses'];

async function groundTruth(label) {
  console.log(`\n===== Ground-truth (${label}) =====`);
  // 1) 테이블 존재 + RLS 활성
  for (const t of TABLES) {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='r';`, [t]);
    if (rows.length === 0) { console.log(`  [table] ${t}: ❌ 없음`); continue; }
    console.log(`  [table] ${t}: ✅ 존재  RLS=${rows[0].rls ? 'ON' : 'OFF'}`);
  }
  // 2) is_healer_intent 컬럼
  const { rows: col } = await client.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='reservations' AND column_name='is_healer_intent';`);
  console.log(`  [column] reservations.is_healer_intent: ${col.length ? `✅ ${col[0].data_type} null=${col[0].is_nullable} def=${col[0].column_default}` : '❌ 없음'}`);
  // 3) 정책 — TO authenticated 만? anon 정책 0건이어야(no-read-up)
  const { rows: pol } = await client.query(
    `SELECT tablename, policyname, cmd, roles FROM pg_policies
      WHERE schemaname='public' AND tablename = ANY($1) ORDER BY tablename, cmd;`, [TABLES]);
  console.log(`  [policies] ${pol.length}건`);
  for (const p of pol) console.log(`      ${p.tablename} :: ${p.policyname} (${p.cmd}) roles=${p.roles}`);
  // 4) ANON 권한 프로브 (table privilege — 존재 시에만)
  for (const t of ['insurance_claims', 'claim_items', 'edi_submissions']) {
    const ex = await client.query(`SELECT to_regclass($1) AS r;`, [`public.${t}`]);
    if (!ex.rows[0].r) { console.log(`  [anon] ${t}: (table 부재 — 프로브 skip)`); continue; }
    const { rows: g } = await client.query(
      `SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_sel,
              has_table_privilege('anon', $1, 'INSERT') AS anon_ins,
              has_table_privilege('authenticated', $1, 'SELECT') AS auth_sel;`, [`public.${t}`]);
    console.log(`  [anon] ${t}: anon SELECT=${g.rows[0].anon_sel} INSERT=${g.rows[0].anon_ins} | authenticated SELECT=${g.rows[0].auth_sel}`);
  }
  // 5) claim_diagnoses → insurance_claims FK 존재 여부 (rollback CASCADE 안전성 판단)
  const { rows: fk } = await client.query(
    `SELECT con.conname FROM pg_constraint con
       JOIN pg_class src ON src.oid=con.conrelid
       JOIN pg_class tgt ON tgt.oid=con.confrelid
      WHERE con.contype='f' AND src.relname='claim_diagnoses' AND tgt.relname='insurance_claims';`);
  console.log(`  [fk] claim_diagnoses → insurance_claims: ${fk.length ? `존재(${fk[0].conname}) — rollback CASCADE 시 이 FK만 제거됨` : '없음 — scoped rollback 안전'}`);
}

const mode = ROLLBACK ? '롤백' : APPLY ? '적용' : 'DRY-RUN(read-only)';
console.log(`🚀 AC-2 parity 복구 — ${mode}  (prod rxlomoozakkjesdqjtvd)`);

try {
  await client.connect();
  await groundTruth('적용 전');

  if (!APPLY) {
    console.log(`\nℹ️ DRY-RUN — 실제 변경 0건. 적용은 DA GO + supervisor DDL-diff 통과 후 --apply.`);
  } else if (ROLLBACK) {
    console.log('\n⏪ 롤백 실행: #7 컬럼 → #A scoped(claim_diagnoses 보존)');
    await client.query(SQL.h7Rollback);
    await client.query(SQL.aRollback);
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    await groundTruth('롤백 후');
  } else {
    console.log('\n▶️ 적용 실행: #A insurance_claims → #7 is_healer_intent 컬럼');
    await client.query(SQL.aApply);
    await client.query(SQL.h7Apply);
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    await groundTruth('적용 후');
    // 스모크: 빈 테이블 count
    for (const t of ['insurance_claims', 'claim_items', 'edi_submissions']) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM public.${t};`);
      console.log(`  [smoke] ${t} rows=${rows[0].n}`);
    }
    console.log('✅ 적용 완료 + 스키마캐시 reload');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
