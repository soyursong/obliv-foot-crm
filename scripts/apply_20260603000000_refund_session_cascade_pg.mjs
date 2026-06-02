/**
 * T-20260602-foot-REFUND-SESSION-CLEANUP  AC-1 / AC-2
 * refund_package_atomic 함수에 package_sessions cascade(used→refunded) 추가.
 *
 * dev-foot 직접 적용 변형(_pg): Management API(SUPABASE_ACCESS_TOKEN) 대신
 * pooler 직결(SUPABASE_DB_PASSWORD)로 dev-foot 이 직접 마이그레이션을 실행한다.
 * (정책: dev-foot DB 마이그레이션 직접 실행)
 *
 * 사용:
 *   node scripts/apply_20260603000000_refund_session_cascade_pg.mjs            # dry-run(검증만)
 *   node scripts/apply_20260603000000_refund_session_cascade_pg.mjs --apply    # 적용
 *   node scripts/apply_20260603000000_refund_session_cascade_pg.mjs --rollback # 롤백
 *
 * author: dev-foot / 2026-06-03
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 로드 (SUPABASE_DB_PASSWORD)
const envPath = join(__dirname, '../.env');
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
} catch { /* env optional */ }

if (!DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)');
  process.exit(1);
}

const ROLLBACK = process.argv.includes('--rollback');
const APPLY = process.argv.includes('--apply') || ROLLBACK;

const SQL_FILE = ROLLBACK
  ? '../supabase/migrations/20260603000000_refund_session_cascade.rollback.sql'
  : '../supabase/migrations/20260603000000_refund_session_cascade.sql';
const SQL = readFileSync(join(__dirname, SQL_FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const mode = ROLLBACK ? '롤백' : APPLY ? '적용' : 'DRY-RUN(검증만)';
console.log(`🚀 refund_package_atomic cascade — ${mode}`);

try {
  await client.connect();

  // --- 사전 진단: 환불된 패키지의 잔존 used 세션(유령) 수 ---
  const { rows: ghost } = await client.query(`
    SELECT count(*)::int AS ghost_used_sessions
      FROM package_sessions ps
      JOIN packages p ON p.id = ps.package_id
     WHERE p.status = 'refunded' AND ps.status = 'used';
  `);
  console.log('🔎 환불패키지 잔존 used(유령) 세션:', ghost[0].ghost_used_sessions);

  const { rows: before } = await client.query(`
    SELECT (pg_get_functiondef(oid) ILIKE '%package_sessions%') AS has_cascade
      FROM pg_proc WHERE proname = 'refund_package_atomic' LIMIT 1;
  `);
  console.log('🔎 적용 전 cascade 포함 여부:', before[0]?.has_cascade ?? 'N/A');

  if (!APPLY) {
    console.log('ℹ️ DRY-RUN 종료 — 실제 변경 없음. 적용하려면 --apply');
  } else {
    await client.query(SQL);
    const { rows: after } = await client.query(`
      SELECT (pg_get_functiondef(oid) ILIKE '%package_sessions%') AS has_cascade
        FROM pg_proc WHERE proname = 'refund_package_atomic' LIMIT 1;
    `);
    if (ROLLBACK) {
      console.log(after[0]?.has_cascade ? '⚠️ 롤백 후에도 cascade 잔존 — 확인 필요' : '✅ 롤백 확인: cascade 제거됨');
      if (after[0]?.has_cascade) throw new Error('롤백 검증 실패');
    } else {
      console.log(after[0]?.has_cascade ? '✅ 적용 확인: package_sessions cascade 포함' : '⚠️ cascade 미포함 — 확인 필요');
      if (!after[0]?.has_cascade) throw new Error('적용 검증 실패');
    }
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
