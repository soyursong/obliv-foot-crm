/**
 * T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT AC-2 #A — insurance_claims 누락 마이그 복구
 *
 * RC(하드 증거): prod(rxlomoozakkjesdqjtvd) 에 insurance_claims/claim_items/insurance_claim_diagnoses/edi_submissions
 *   4 테이블 전무 → FE 보험 청구 화면 호출 시 42P01(relation does not exist) live 버그.
 *   원본 마이그 20260520000010_insurance_claims_schema.sql 이 prod 에 미적용이었음.
 *
 * ★ 옵션 A 개명(2026-06-15, DA-20260615-foot-INSURANCE-CLAIM-NAMING):
 *   claim_diagnoses → insurance_claim_diagnoses. prod live claim_diagnoses(결제연계, disease_code)는
 *   본 스크립트가 apply/rollback 모두에서 절대 미접촉. dry-run 시 live claim_diagnoses 무변경 프로브 출력.
 *
 * 게이트: DA CONSULT GO(expedite) + supervisor DDL-diff GO(ADDITIVE/RLS add-only, rollback 존재).
 *   autonomy §3.1 (ADDITIVE+DA GO → 대표게이트 면제).
 * 성질: 4 CREATE TABLE IF NOT EXISTS + RLS clinic-scoped(authenticated only, anon 차단) + 트리거.
 *   기존 ALTER/DROP 0. 파괴적 변경 0.
 * dev-foot 직접 적용(_pg): pooler 직결(SUPABASE_DB_PASSWORD). (정책: dev-foot DB 마이그레이션 직접 실행)
 *
 * 사용:
 *   node scripts/apply_20260520000010_insurance_claims_schema_pg.mjs            # dry-run(존재여부 검증만)
 *   node scripts/apply_20260520000010_insurance_claims_schema_pg.mjs --apply    # 적용 + 스키마캐시 reload
 *   node scripts/apply_20260520000010_insurance_claims_schema_pg.mjs --rollback # down.sql 원복
 *
 * author: dev-foot / 2026-06-15
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env');
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
} catch { /* env optional */ }
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const ROLLBACK = process.argv.includes('--rollback');
const APPLY = process.argv.includes('--apply') || ROLLBACK;

const SQL_FILE = ROLLBACK
  ? '../supabase/migrations/20260520000010_insurance_claims_schema.down.sql'
  : '../supabase/migrations/20260520000010_insurance_claims_schema.sql';
const SQL = readFileSync(join(__dirname, SQL_FILE), 'utf8');

const TABLES = ['insurance_claims', 'claim_items', 'insurance_claim_diagnoses', 'edi_submissions'];
// live 결제연계 테이블 — 본 마이그가 절대 접촉하면 안 되는 대상(무변경 프로브용).
const LIVE_UNTOUCHED = 'claim_diagnoses';

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const mode = ROLLBACK ? '롤백(DROP)' : APPLY ? '적용(CREATE)' : 'DRY-RUN(검증만)';
console.log(`🚀 insurance_claims 스키마 누락 마이그 복구 — ${mode}`);

async function tableState() {
  const out = {};
  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT to_regclass($1) AS reg;`, [`public.${t}`]);
    out[t] = rows[0].reg !== null;
  }
  return out;
}

function printState(label, st) {
  console.log(`📊 [${label}]`);
  for (const t of TABLES) console.log(`   ${st[t] ? '✅ 있음' : '❌ 없음'}  ${t}`);
}

// live 결제연계 claim_diagnoses 의 무변경 지문(존재/정책/컬럼/행수) — apply 전후 비교용.
async function liveFingerprint() {
  const reg = (await client.query(`SELECT to_regclass($1) AS reg;`, [`public.${LIVE_UNTOUCHED}`])).rows[0].reg;
  if (!reg) return { exists: false };
  const policies = (await client.query(
    `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname;`,
    [LIVE_UNTOUCHED])).rows.map(r => r.policyname);
  const cols = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY column_name;`,
    [LIVE_UNTOUCHED])).rows.map(r => r.column_name);
  let rowCount = null;
  try { rowCount = (await client.query(`SELECT count(*)::int AS n FROM public.${LIVE_UNTOUCHED};`)).rows[0].n; } catch { /* RLS/perm */ }
  return { exists: true, policies, cols, rowCount };
}

function printLive(label, fp) {
  console.log(`🛡️ [${label}] live ${LIVE_UNTOUCHED} (결제연계, 미접촉 대상):`);
  if (!fp.exists) { console.log('   (테이블 없음)'); return; }
  console.log(`   정책: ${fp.policies.join(', ') || '(없음)'}`);
  console.log(`   컬럼: ${fp.cols.join(', ')}`);
  console.log(`   행수: ${fp.rowCount ?? '(조회불가)'}`);
}

try {
  await client.connect();
  const before = await tableState();
  printState('적용 전', before);
  const liveBefore = await liveFingerprint();
  printLive('적용 전', liveBefore);

  if (!APPLY) {
    console.log(`ℹ️ DRY-RUN — 실제 변경 없음. 적용하려면 --apply`);
    console.log(`ℹ️ 위 live ${LIVE_UNTOUCHED} 지문은 적용 후 동일해야 함(disease_code 컬럼·정책·행수 불변).`);
  } else {
    await client.query(SQL);
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    const after = await tableState();
    printState('적용 후', after);

    // live claim_diagnoses 무변경 검증 (직전 DRIFT 재발 차단)
    const liveAfter = await liveFingerprint();
    printLive('적용 후', liveAfter);
    const liveSame = JSON.stringify(liveBefore) === JSON.stringify(liveAfter);
    if (!liveSame) throw new Error(`live ${LIVE_UNTOUCHED} 변경 감지 — 적용 중단. DRIFT 재발(옵션 A 위반).`);
    console.log(`🛡️ live ${LIVE_UNTOUCHED} 무변경 확인 (정책/컬럼/행수 동일) ✅`);

    if (ROLLBACK) {
      if (TABLES.some(t => after[t])) throw new Error('롤백 검증 실패: 테이블 잔존');
      console.log('✅ 롤백 확인: 4 테이블 제거됨');
    } else {
      if (TABLES.some(t => !after[t])) throw new Error('적용 검증 실패: 테이블 미생성');
      // RLS enabled 확인
      const { rows: rls } = await client.query(`
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname = ANY($1) ORDER BY c.relname;`, [TABLES]);
      console.log('🔎 RLS enabled:');
      rls.forEach(r => console.log(`   ${r.relrowsecurity ? '✅' : '❌'}  ${r.relname}`));
      // 정책 개수(테이블당 1 FOR ALL authenticated)
      const { rows: pol } = await client.query(`
        SELECT tablename, count(*)::int AS n FROM pg_policies
        WHERE schemaname='public' AND tablename = ANY($1) GROUP BY tablename ORDER BY tablename;`, [TABLES]);
      console.log('🔎 정책 수:');
      pol.forEach(p => console.log(`   ${p.tablename}: ${p.n}`));
      // anon 차단 확인 — anon 에 GRANT 없어야 함(RLS + GRANT 둘 다)
      const { rows: anonG } = await client.query(`
        SELECT has_table_privilege('anon','public.insurance_claims','SELECT') AS anon_select;`);
      console.log(`🔎 anon SELECT 권한(insurance_claims): ${anonG[0].anon_select ? '⚠ 있음(검토필요)' : '✅ 없음(차단)'}`);
      console.log('✅ 적용 완료: 4 테이블 + RLS + 트리거 + 스키마캐시 reload (42P01 소멸)');
    }
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
