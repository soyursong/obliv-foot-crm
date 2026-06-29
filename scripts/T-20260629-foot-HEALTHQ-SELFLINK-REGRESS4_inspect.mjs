/**
 * T-20260629-foot-HEALTHQ-SELFLINK-REGRESS4 — PROD 실측 (READ-ONLY, NO WRITE)
 *
 * 목적(AC-4 근본원인 확정): fn_health_q_create_token 의 prod 실제 상태를 SELECT 로만 확인.
 *   1) 현재 존재하는 모든 시그니처(identity args) — 6-arg 존재 여부
 *   2) 각 함수의 proconfig (search_path 설정) — extensions 포함 여부 = 회귀 원인
 *   3) 함수 본문(prosrc)에서 gen_random_bytes 가 schema-qualified 인지
 *   4) 토큰 발급 함수 3종 동시 점검 (selfcheckin / dashboard_reissue)
 *   5) gen_random_bytes 가 어느 스키마에 있는지
 *
 *   *** SELECT/pg_catalog 조회만. write/DDL 없음. ***
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const c = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const FNS = [
  'fn_health_q_create_token',
  'fn_selfcheckin_create_health_q_token',
  'fn_dashboard_reissue_health_q_token',
];

async function main() {
  await c.connect();

  console.log('=== 1) gen_random_bytes 소재 스키마 ===');
  const grb = await c.query(`
    SELECT n.nspname AS schema, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'gen_random_bytes'
    ORDER BY 1;`);
  console.table(grb.rows);

  for (const fn of FNS) {
    console.log(`\n=== 함수: ${fn} ===`);
    const r = await c.query(
      `SELECT
         p.oid,
         pg_get_function_identity_arguments(p.oid) AS identity_args,
         p.proconfig,
         p.prosecdef AS security_definer,
         (p.prosrc ILIKE '%extensions.gen_random_bytes%') AS body_schema_qualified,
         (p.prosrc ILIKE '%gen_random_bytes%') AS body_uses_grb
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
       ORDER BY p.oid;`,
      [fn]
    );
    if (!r.rows.length) {
      console.log('  ⚠ 함수 없음!');
      continue;
    }
    for (const row of r.rows) {
      console.log(`  signature : ${fn}(${row.identity_args})`);
      console.log(`  proconfig : ${JSON.stringify(row.proconfig)}`);
      console.log(`  secdef    : ${row.security_definer}`);
      console.log(`  body uses gen_random_bytes        : ${row.body_uses_grb}`);
      console.log(`  body schema-qualified(extensions.) : ${row.body_schema_qualified}`);
      const sp = (row.proconfig || []).find((x) => x.startsWith('search_path='));
      const hasExt = sp && /extensions/.test(sp);
      if (row.body_uses_grb && !row.body_schema_qualified && !hasExt) {
        console.log(`  🔴 회귀 조건 충족: bare gen_random_bytes + search_path 에 extensions 없음 → 호출 실패`);
      } else if (row.body_uses_grb && (hasExt || row.body_schema_qualified)) {
        console.log(`  🟢 정상: gen_random_bytes 해석 가능 (${row.body_schema_qualified ? 'body qualified' : 'search_path extensions'})`);
      }
    }
  }

  await c.end();
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
