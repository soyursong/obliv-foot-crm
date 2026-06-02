/**
 * T-20260602-foot-REFUND-SESSION-CLEANUP  AC-1 / AC-2
 * refund_package_atomic 함수에 package_sessions cascade(used→refunded) 추가.
 *
 * 사용:
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260603000000_refund_session_cascade.mjs
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply_20260603000000_refund_session_cascade.mjs --rollback
 *
 * author: dev-foot / 2026-06-03
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ROLLBACK = process.argv.includes('--rollback');

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const SQL_FILE = ROLLBACK
  ? '../supabase/migrations/20260603000000_refund_session_cascade.rollback.sql'
  : '../supabase/migrations/20260603000000_refund_session_cascade.sql';

const MIGRATION_SQL = readFileSync(join(__dirname, SQL_FILE), 'utf8');

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

async function run() {
  console.log(`🚀 refund_package_atomic ${ROLLBACK ? '롤백' : '적용'} 중...`);
  await runQuery(MIGRATION_SQL, ROLLBACK ? 'rollback' : 'migration');
  console.log('✅ 실행 완료');

  const def = await runQuery(
    `SELECT pg_get_functiondef(oid) AS def
       FROM pg_proc
      WHERE proname = 'refund_package_atomic'
      LIMIT 1;`,
    'verify'
  );
  const hasCascade = JSON.stringify(def).includes('package_sessions');
  if (ROLLBACK) {
    console.log(hasCascade ? '⚠️ 롤백 후에도 package_sessions 참조 — 확인 필요' : '✅ 롤백 확인: cascade 제거됨');
  } else {
    console.log(hasCascade ? '✅ 적용 확인: package_sessions cascade 포함' : '⚠️ cascade 미포함 — 확인 필요');
  }
}

run().catch((err) => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
