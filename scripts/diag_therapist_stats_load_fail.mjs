/**
 * T-20260609-foot-THERAPIST-STATS-LOAD-FAIL — 진단 (READ-ONLY)
 * prod DB 에 V2 RPC 2종이 실제 존재하는지(시그니처), 기간 2026-06-01~09 호출 시 throw 여부.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  try {
    // 1) 함수 시그니처 + 반환컬럼
    const sig = await client.query(`
      SELECT p.proname, pg_get_function_arguments(p.oid) AS args,
             pg_get_function_result(p.oid) AS result, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('foot_stats_therapist_summary','foot_stats_therapist_services')
      ORDER BY p.proname;`);
    console.log('=== 1) 함수 시그니처 ===');
    sig.rows.forEach(r => {
      console.log(`\n${r.proname}(${r.args}) secdef=${r.prosecdef}`);
      console.log(`  RETURNS ${r.result}`);
    });
    if (sig.rows.length < 2) console.log('⚠️ 함수 누락! count=' + sig.rows.length);

    // 2) function COMMENT (버전 식별)
    const cm = await client.query(`
      SELECT p.proname, obj_description(p.oid) AS comment
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('foot_stats_therapist_summary','foot_stats_therapist_services');`);
    console.log('\n=== 2) 함수 COMMENT (버전) ===');
    cm.rows.forEach(r => console.log(`  ${r.proname}: ${r.comment}`));

    // 3) clinic 목록
    const cl = await client.query(`SELECT id, name, slug FROM clinics ORDER BY name;`);
    console.log('\n=== 3) clinics ===');
    cl.rows.forEach(r => console.log(`  ${r.id} | ${r.name} | ${r.slug}`));

    // 4) 기간 호출 — 각 clinic 마다 summary/services throw 여부
    console.log('\n=== 4) 런타임 호출 (2026-06-01 ~ 2026-06-09) ===');
    for (const c of cl.rows) {
      for (const fn of ['foot_stats_therapist_summary','foot_stats_therapist_services']) {
        try {
          const r = await client.query(
            `SELECT COUNT(*)::int AS n FROM ${fn}($1,$2,$3);`,
            [c.id, '2026-06-01', '2026-06-09']);
          console.log(`  ✅ ${fn} [${c.name}] rows=${r.rows[0].n}`);
        } catch (e) {
          console.log(`  ❌ ${fn} [${c.name}] THROW: ${e.message} (code=${e.code})`);
        }
      }
    }
  } catch (e) {
    console.error('❌ 진단 실패:', e.message, e.code);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
