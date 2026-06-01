/**
 * T-20260601-foot-HEALTHQ-SELFLINK-FAIL (REOPEN-1 / FIELD-REJECT)
 * prod(rxlomoozakkjesdqjtvd) 실상태 진단.
 *  1) 토큰 발급 함수 3종 proconfig(search_path) 실제 적용 여부
 *  2) health_q_tokens.token 컬럼 DEFAULT
 *  3) authenticated 실역할(김주연 staff)로 fn_health_q_create_token 호출 (ROLLBACK)
 *  4) health_q_tokens RLS / GRANT 점검
 *  데이터 변경 없음 (모든 write는 ROLLBACK).
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const log = (...a) => console.log(...a);

try {
  await client.connect();
  log('✅ prod DB 연결 (rxlomoozakkjesdqjtvd)\n');

  // 1) 함수 proconfig
  log('── [1] 토큰 발급 함수 proconfig (search_path) ──');
  const fns = await client.query(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.proconfig,
           p.prosecdef AS security_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('fn_health_q_create_token','fn_selfcheckin_create_health_q_token','fn_dashboard_reissue_health_q_token')
    ORDER BY p.proname;`);
  for (const r of fns.rows) {
    log(`  ${r.proname}(${r.args})`);
    log(`     secdef=${r.security_definer}  proconfig=${JSON.stringify(r.proconfig)}`);
  }

  // 2) 컬럼 DEFAULT
  log('\n── [2] health_q_tokens.token 컬럼 DEFAULT ──');
  const def = await client.query(`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='health_q_tokens' AND column_name='token';`);
  log('  ', def.rows[0]?.column_default ?? '(none)');

  // 2b) pgcrypto/gen_random_bytes 위치
  const ext = await client.query(`
    SELECT n.nspname AS schema, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.proname='gen_random_bytes';`);
  log('   gen_random_bytes 위치:', ext.rows.map(r => `${r.schema}.${r.proname}`).join(', ') || '(없음!)');

  // 3) RLS / GRANT
  log('\n── [3] health_q_tokens RLS & GRANT ──');
  const rls = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='health_q_tokens';`);
  log('  RLS enabled=', rls.rows[0]?.relrowsecurity, ' forced=', rls.rows[0]?.relforcerowsecurity);
  const pol = await client.query(`
    SELECT polname, polcmd, pg_get_expr(polqual,polrelid) AS using_expr, pg_get_expr(polwithcheck,polrelid) AS check_expr
    FROM pg_policy WHERE polrelid='public.health_q_tokens'::regclass;`);
  for (const r of pol.rows) log(`  policy ${r.polname} cmd=${r.polcmd} using=${r.using_expr} check=${r.check_expr}`);
  const grants = await client.query(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='health_q_tokens' ORDER BY grantee, privilege_type;`);
  log('  GRANTs:', grants.rows.map(r => `${r.grantee}:${r.privilege_type}`).join(', '));
  const fgrants = await client.query(`
    SELECT r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_exec
    FROM pg_proc p, (VALUES ('authenticated'),('anon'),('service_role')) r(rolname)
    WHERE p.proname='fn_health_q_create_token'
      AND p.pronamespace='public'::regnamespace;`);
  log('  fn_health_q_create_token EXECUTE:', fgrants.rows.map(r=>`${r.rolname}:${r.can_exec}`).join(', '));

  // 4) authenticated 실세션 호출 (ROLLBACK)
  log('\n── [4] authenticated 실세션 fn_health_q_create_token 호출 (ROLLBACK) ──');
  // 김주연 staff + 그가 속한 clinic + 임의 고객 1명 확보
  const staff = await client.query(`
    SELECT s.id AS staff_id, s.auth_user_id, s.clinic_id, s.name
    FROM staff s WHERE s.name LIKE '%김주연%' AND s.auth_user_id IS NOT NULL LIMIT 1;`);
  if (!staff.rows.length) { log('  ⚠️ 김주연 staff(auth_user_id) 미발견 — 다른 staff로 대체'); }
  const st = staff.rows[0] || (await client.query(`
    SELECT id AS staff_id, auth_user_id, clinic_id, name FROM staff WHERE auth_user_id IS NOT NULL LIMIT 1;`)).rows[0];
  log(`  테스트 staff: ${st.name} (auth=${st.auth_user_id}, clinic=${st.clinic_id})`);
  const cust = (await client.query(`SELECT id FROM customers WHERE clinic_id=$1 LIMIT 1;`, [st.clinic_id])).rows[0];
  log(`  테스트 고객: ${cust?.id}`);

  await client.query('BEGIN');
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true);`, [st.auth_user_id]);
  await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: st.auth_user_id, role: 'authenticated' })]);
  await client.query(`SET LOCAL ROLE authenticated;`);
  try {
    const call = await client.query(
      `SELECT public.fn_health_q_create_token($1,$2,$3,$4,$5) AS r;`,
      [cust?.id, st.clinic_id, 'general', null, 7]
    );
    log('  ✅ 호출 결과:', JSON.stringify(call.rows[0].r));
  } catch (e) {
    log('  ❌ 호출 에러:', e.message);
  }
  await client.query('ROLLBACK');
  log('  (ROLLBACK 완료 — 데이터 변경 없음)');

  log('\n진단 완료.');
} catch (e) {
  console.error('진단 실패:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
