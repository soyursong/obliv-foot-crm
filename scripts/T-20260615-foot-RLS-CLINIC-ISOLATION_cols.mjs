/** clinic_id 컬럼 존재 + 헬퍼 정의 검증 (READ-ONLY) */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) { for (const line of fs.readFileSync('.env','utf8').split('\n')){ const m=line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if(m)DB_PASSWORD=m[1].trim(); } }
const client = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });
await client.connect();
const cols = await client.query(
  `SELECT table_name, column_name, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1) AND column_name='clinic_id'
    ORDER BY table_name`, [['customers','check_ins','reservations','payments']]);
console.log('clinic_id 컬럼:'); for (const r of cols.rows) console.log(`  ${r.table_name}.clinic_id  nullable=${r.is_nullable}`);
const miss = ['customers','check_ins','reservations','payments'].filter(t=>!cols.rows.find(r=>r.table_name===t));
console.log(miss.length? `  ⚠ clinic_id 부재: ${miss.join(', ')}` : '  ✅ 4개 테이블 모두 clinic_id 보유');

for (const fn of ['is_approved_user','current_user_clinic_id','current_user_role']) {
  const d = await client.query(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1 LIMIT 1`,[fn]);
  console.log(`\n── ${fn} ──\n${d.rows[0]?.def ?? '(미존재)'}`);
}
// clinic_id NULL 인 환자 row 수 (격리 적용 시 락아웃 위험 진단)
for (const t of ['customers','check_ins','reservations','payments']) {
  const n = await client.query(`SELECT count(*)::int c, count(*) FILTER (WHERE clinic_id IS NULL)::int nullc FROM ${t}`);
  console.log(`  ${t}: rows=${n.rows[0].c}  clinic_id NULL=${n.rows[0].nullc}`);
}
// user_profiles clinic_id NULL 인 직원 (격리 후 자기지점 못 봄 위험)
const up = await client.query(`SELECT count(*)::int c, count(*) FILTER (WHERE clinic_id IS NULL)::int nullc FROM user_profiles`);
console.log(`  user_profiles: rows=${up.rows[0].c}  clinic_id NULL=${up.rows[0].nullc}`);
await client.end();
