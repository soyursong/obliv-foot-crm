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
 *   node apply_parity_ac2_pg.mjs --rollback # #7 컬럼 rollback → #A scoped_rollback (신규 4테이블만, live claim_diagnoses 보존)
 *
 * ★ 옵션 A 개명(2026-06-15, DA-20260615-foot-INSURANCE-CLAIM-NAMING):
 *   #A 가 생성하는 건보 child = insurance_claim_diagnoses (고유명). prod live claim_diagnoses
 *   (결제연계, disease_code)는 apply/rollback 모두 미접촉 — ground-truth 에 무변경 프로브로 검증.
 *
 * author: dev-foot / 2026-06-15 (개명 수정)
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

// #A 가 생성하는 4 신규 테이블 (옵션 A 개명: 건보 child = insurance_claim_diagnoses)
const TABLES = ['insurance_claims', 'claim_items', 'edi_submissions', 'insurance_claim_diagnoses'];
// live 결제연계 — #A 가 절대 접촉하면 안 되는 대상 (무변경 프로브용)
const LIVE_UNTOUCHED = 'claim_diagnoses';

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
  for (const t of ['insurance_claims', 'claim_items', 'edi_submissions', 'insurance_claim_diagnoses']) {
    const ex = await client.query(`SELECT to_regclass($1) AS r;`, [`public.${t}`]);
    if (!ex.rows[0].r) { console.log(`  [anon] ${t}: (table 부재 — 프로브 skip)`); continue; }
    const { rows: g } = await client.query(
      `SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_sel,
              has_table_privilege('anon', $1, 'INSERT') AS anon_ins,
              has_table_privilege('authenticated', $1, 'SELECT') AS auth_sel;`, [`public.${t}`]);
    console.log(`  [anon] ${t}: anon SELECT=${g.rows[0].anon_sel} INSERT=${g.rows[0].anon_ins} | authenticated SELECT=${g.rows[0].auth_sel}`);
  }
  // 5) live claim_diagnoses (결제연계, disease_code) 무변경 지문 — 옵션 A 후 #A 가 미접촉해야 함.
  const liveReg = (await client.query(`SELECT to_regclass($1) AS r;`, [`public.${LIVE_UNTOUCHED}`])).rows[0].r;
  if (!liveReg) {
    console.log(`  [live] ${LIVE_UNTOUCHED}: (테이블 없음)`);
  } else {
    const livePol = (await client.query(
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname;`,
      [LIVE_UNTOUCHED])).rows.map(r => r.policyname);
    const liveCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY column_name;`,
      [LIVE_UNTOUCHED])).rows.map(r => r.column_name);
    let liveRows = null;
    try { liveRows = (await client.query(`SELECT count(*)::int AS n FROM public.${LIVE_UNTOUCHED};`)).rows[0].n; } catch { /* RLS/perm */ }
    const hasDisease = liveCols.includes('disease_code');
    console.log(`  [live] ${LIVE_UNTOUCHED}(결제연계, 미접촉 대상): 정책[${livePol.join(',')}] disease_code=${hasDisease ? '✅' : '❌'} 행수=${liveRows ?? '?'}`);
  }
}

const mode = ROLLBACK ? '롤백' : APPLY ? '적용' : 'DRY-RUN(read-only)';
console.log(`🚀 AC-2 parity 복구 — ${mode}  (prod rxlomoozakkjesdqjtvd)`);

try {
  await client.connect();
  await groundTruth('적용 전');

  if (!APPLY) {
    console.log(`\nℹ️ DRY-RUN — 실제 변경 0건. 적용은 DA GO + supervisor DDL-diff 통과 후 --apply.`);
  } else if (ROLLBACK) {
    console.log('\n⏪ 롤백 실행: #7 컬럼 → #A scoped(신규 4테이블만, live claim_diagnoses 보존)');
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
    for (const t of ['insurance_claims', 'claim_items', 'edi_submissions', 'insurance_claim_diagnoses']) {
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
