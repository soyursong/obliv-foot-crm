/**
 * T-20260629-foot-NOSHOW-CANONICAL — reservations.status 'noshow' → 'no_show' 단일화
 *
 * 적용:  node scripts/apply_20260629150000_foot_resv_status_noshow_to_no_show.mjs
 * 롤백:  node scripts/apply_20260629150000_foot_resv_status_noshow_to_no_show.mjs --rollback
 *
 * 원자성: 마이그 본문이 단일 BEGIN/COMMIT + DO 블록 잔존검증(noshow<>0 → EXCEPTION).
 *   백필 중 trg_dopamine_cb_resv 비활성(과거 노쇼 콜백 재적재 차단).
 * ⚠️ supervisor 배포게이트 전용. dev/prod 분리 — 운영 DB 반영은 게이트 승인 후.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLLBACK = process.argv.includes('--rollback');
const FILE = ROLLBACK
  ? '20260629150000_foot_resv_status_noshow_to_no_show.rollback.sql'
  : '20260629150000_foot_resv_status_noshow_to_no_show.sql';
const SQL = readFileSync(join(__dirname, '../supabase/migrations/', FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const TARGET = ROLLBACK ? 'noshow' : 'no_show';
const LEGACY = ROLLBACK ? 'no_show' : 'noshow';

console.log(`🚀 NOSHOW-CANONICAL ${ROLLBACK ? '롤백' : '적용'} (${FILE})`);
try {
  await client.connect();

  // 사전 baseline
  const { rows: pre } = await client.query(
    `SELECT status, count(*)::int n FROM public.reservations WHERE status IN ('noshow','no_show') GROUP BY status ORDER BY status`,
  );
  console.log('  pre :', JSON.stringify(pre));

  // 마이그 본문 실행 (자체 BEGIN/COMMIT + 잔존검증 DO 블록)
  await client.query(SQL);

  // 사후 검증
  const { rows: post } = await client.query(
    `SELECT status, count(*)::int n FROM public.reservations WHERE status IN ('noshow','no_show') GROUP BY status ORDER BY status`,
  );
  console.log('  post:', JSON.stringify(post));

  const { rows: cdef } = await client.query(
    `SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.reservations'::regclass AND conname='reservations_status_check'`,
  );
  const constraintDef = cdef[0]?.def ?? '';
  console.log('  constraint:', constraintDef);

  const { rows: fdefRows } = await client.query(
    `SELECT pg_get_functiondef('foot_stats_noshow_returning(uuid,date,date)'::regprocedure) def`,
  );
  const rpcDef = fdefRows[0].def;

  // 검증 규칙
  const residual = post.find((r) => r.status === LEGACY)?.n ?? 0;
  const constraintAllowsTarget = constraintDef.includes(`'${TARGET}'`);
  const constraintForbidsLegacy = !constraintDef.includes(`'${LEGACY}'`);
  const rpcUsesTarget = rpcDef.includes(`status = '${TARGET}'`);

  console.log(
    `  residual(${LEGACY})=${residual}  constraint(+${TARGET})=${constraintAllowsTarget}  ` +
      `constraint(-${LEGACY})=${constraintForbidsLegacy}  rpc(${TARGET})=${rpcUsesTarget}`,
  );

  const ok = residual === 0 && constraintAllowsTarget && constraintForbidsLegacy && rpcUsesTarget;
  console.log(`  ${ok ? '✅' : '❌'} ${ROLLBACK ? '롤백' : '적용'} 검증 ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) throw new Error('검증 실패');
  console.log(`✅ NOSHOW-CANONICAL ${ROLLBACK ? '롤백' : '적용'} 완료`);
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
