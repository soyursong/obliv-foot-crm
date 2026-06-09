/** 진단: authenticated 역할 + 실제 승인 사용자 JWT 클레임으로 RLS 경로 재현 (READ-ONLY) */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno
(async () => {
  await client.connect();
  try {
    // 승인 사용자 1명 찾기 (is_approved_user 가 참조하는 테이블 추정: profiles/staff)
    const helper = await client.query(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_approved_user';`);
    console.log('=== is_approved_user 정의 ===\n', helper.rows[0]?.def || '(없음)');

    // auth.users 중 한 명
    const u = await client.query(`SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;`);
    console.log('\n=== auth.users 샘플 ==='); u.rows.forEach(r=>console.log(' ', r.id, r.email));

    for (const usr of u.rows) {
      const claims = JSON.stringify({ sub: usr.id, role: 'authenticated', email: usr.email });
      for (const fn of ['foot_stats_therapist_summary','foot_stats_therapist_services']) {
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [claims]);
          await client.query(`SET LOCAL ROLE authenticated;`);
          const r = await client.query(`SELECT COUNT(*)::int n FROM ${fn}($1,$2,$3);`, [CLINIC,'2026-06-01','2026-06-09']);
          await client.query('ROLLBACK');
          console.log(`  ✅ ${fn} [user=${usr.email}] rows=${r.rows[0].n}`);
        } catch (e) {
          await client.query('ROLLBACK').catch(()=>{});
          console.log(`  ❌ ${fn} [user=${usr.email}] THROW: ${e.message} (code=${e.code})`);
        }
      }
    }
  } catch (e) { console.error('진단 실패:', e.message, e.code); process.exitCode=1; }
  finally { await client.end(); }
})();
