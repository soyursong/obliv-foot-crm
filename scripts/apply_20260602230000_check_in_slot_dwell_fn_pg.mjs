/**
 * T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP AC-6 — 누락 마이그레이션 복구
 *
 * RC(하드 증거): prod(rxlomoozakkjesdqjtvd) pg_proc 에 fn_check_in_slot_dwell 전무
 *   → FE가 존재하지 않는 RPC 호출 → PGRST202 → "체류시간 조회 실패" 에러.
 *   원본 마이그 20260602230000_check_in_slot_dwell_fn.sql 이 prod 에 미적용이었음.
 *
 * dev-foot 직접 적용(_pg): pooler 직결(SUPABASE_DB_PASSWORD)로 누락 마이그 실행.
 * read-only SQL 함수(SECURITY INVOKER, GRANT authenticated) — 테이블/스키마 변경 0.
 * (정책: dev-foot DB 마이그레이션 직접 실행)
 *
 * 사용:
 *   node scripts/apply_20260602230000_check_in_slot_dwell_fn_pg.mjs            # dry-run(존재여부 검증만)
 *   node scripts/apply_20260602230000_check_in_slot_dwell_fn_pg.mjs --apply    # 적용 + 스키마캐시 reload
 *   node scripts/apply_20260602230000_check_in_slot_dwell_fn_pg.mjs --rollback # DROP FUNCTION 원복
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
  ? '../supabase/migrations/20260602230000_check_in_slot_dwell_fn.rollback.sql'
  : '../supabase/migrations/20260602230000_check_in_slot_dwell_fn.sql';
const SQL = readFileSync(join(__dirname, SQL_FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const mode = ROLLBACK ? '롤백(DROP)' : APPLY ? '적용(CREATE)' : 'DRY-RUN(검증만)';
console.log(`🚀 fn_check_in_slot_dwell 누락 마이그 복구 — ${mode}`);

async function existsFn() {
  const { rows } = await client.query(
    `SELECT to_regprocedure('public.fn_check_in_slot_dwell(uuid[])') AS reg;`
  );
  return rows[0].reg !== null;
}

try {
  await client.connect();
  const before = await existsFn();
  console.log(`📊 [적용 전] fn_check_in_slot_dwell(uuid[]) 존재: ${before ? '✅ 있음' : '❌ 없음'}`);

  if (!APPLY) {
    console.log(`ℹ️ DRY-RUN — 실제 변경 없음. 적용하려면 --apply`);
  } else {
    await client.query(SQL);
    // PostgREST 스키마 캐시 reload (RPC 즉시 인지)
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    const after = await existsFn();
    console.log(`📊 [적용 후] fn_check_in_slot_dwell(uuid[]) 존재: ${after ? '✅ 있음' : '❌ 없음'}`);

    if (ROLLBACK) {
      if (after) throw new Error('롤백 검증 실패: 함수 잔존');
      console.log('✅ 롤백 확인: 함수 제거됨');
    } else {
      if (!after) throw new Error('적용 검증 실패: 함수 미생성');
      // GRANT 확인
      const { rows: g } = await client.query(`
        SELECT has_function_privilege('authenticated','public.fn_check_in_slot_dwell(uuid[])','EXECUTE') AS auth_exec;`);
      console.log(`🔎 authenticated EXECUTE 권한: ${g[0].auth_exec ? '✅' : '❌'}`);
      // 실제 호출 스모크 (빈 배열 — 0행 정상)
      const { rows: smoke } = await client.query(
        `SELECT count(*)::int AS n FROM public.fn_check_in_slot_dwell(ARRAY[]::uuid[]);`);
      console.log(`🔎 스모크 호출(빈배열) rows=${smoke[0].n} (0 정상)`);
      console.log('✅ 적용 완료: RPC 생성 + GRANT + 스키마캐시 reload');
    }
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
