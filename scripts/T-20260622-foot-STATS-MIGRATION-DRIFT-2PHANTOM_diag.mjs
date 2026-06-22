/**
 * T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM — AC1 진단
 * LIVE RPC 시그니처(반환 컬럼) + 측정창 정의 + 명단 출처를 확인해
 * phantom 파일(0609 designated_ratio / 0612 treatment_exit)과의 드리프트를 검증한다.
 * node-pg read-only. dev-foot DB 직접 실행 정책 준수.
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
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log('✅ DB 연결 성공\n');

  // 1) summary RPC 반환 시그니처 (pg_get_function_result)
  const { rows: sig } = await client.query(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('foot_stats_therapist_summary','foot_stats_therapist_services')
    ORDER BY p.proname;`);
  for (const r of sig) {
    console.log(`── ${r.proname}(${r.args})`);
    console.log(r.result);
    console.log();
  }

  // 2) 측정창 정의 grep — 함수 본문에서 종료조건(to_status='laser' vs from_status='preconditioning')
  const { rows: src } = await client.query(`
    SELECT proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='foot_stats_therapist_summary';`);
  const def = src[0]?.def || '';
  console.log('── 측정창 종료조건 검출');
  console.log("  to_status='laser' (레이저 진입 종료):       ", def.includes("to_status = 'laser'") || def.includes("to_status='laser'"));
  console.log("  from_status='preconditioning' (치료실 퇴실):", def.includes("from_status = 'preconditioning'") || def.includes("from_status='preconditioning'"));
  console.log('── 명단 출처(roster) 검출');
  console.log("  roster AS / role='therapist' anchor:        ", def.includes("role = 'therapist'") || def.includes("role='therapist'"));
  console.log("  designated 컬럼 존재:                        ", def.includes('designated_rate'));
  console.log();

  // 3) 실제 호출 — 컬럼 수 확인 (이번 달, 첫 클리닉)
  const { rows: smoke, fields } = await client.query(`
    SELECT s.* FROM clinics cl
    CROSS JOIN LATERAL foot_stats_therapist_summary(cl.id, date_trunc('month', now())::date, now()::date) s
    LIMIT 3;`);
  console.log(`── summary 실호출 반환 컬럼(${fields.length}): ${fields.map(f => f.name).join(', ')}`);
  console.log(`   행수(LIMIT3): ${smoke.length}`);
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
} finally {
  await client.end();
}
