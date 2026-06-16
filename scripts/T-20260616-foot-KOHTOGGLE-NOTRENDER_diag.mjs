/**
 * T-20260616-foot-KOHTOGGLE-NOTRENDER  진단 (READ-ONLY, SELECT only)
 * 가설: KohRequestToggle 미노출 RC = 조건부렌더(svcs.length===0).
 *   line88: if (!checkInId || isLoading || svcs.length === 0) return null;
 *   svcs = check_in_services WHERE check_in_id=latest AND (name ILIKE %KOH% OR %진균검사%)
 * 검증:
 *   1) check_in_services.service_name 중 '균검사/진균/KOH/곰팡이' 류 실제 표기 수집
 *   2) 현행 ILIKE 패턴(%KOH%, %진균검사%)이 실제 표기를 잡는지
 *   3) koh_requested 컬럼 존재 여부(마이그 적용)
 *   4) 최근 KOH류 service 가진 check_in 샘플 → latestCheckIn 매칭 가능성
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
const log = (...a) => console.log(...a);
log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 1) koh_requested 컬럼 존재?
const colq = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='check_in_services' AND column_name='koh_requested'`);
log(`[1] check_in_services.koh_requested 컬럼: ${colq.rowCount ? '존재 ✅(마이그 적용됨)' : '부재 ❌(폴백→미노출)'}\n`);

// 2) 균검사/진균/KOH/곰팡이 류 service_name 전수 (대소문자·표기 변이 포착)
const names = await client.query(
  `SELECT service_name, count(*) AS n,
          max(created_at) AS last_seen
   FROM check_in_services
   WHERE service_name ILIKE '%균%' OR service_name ILIKE '%KOH%'
      OR service_name ILIKE '%진균%' OR service_name ILIKE '%곰팡이%'
      OR service_name ILIKE '%fungal%' OR service_name ILIKE '%검사%'
   GROUP BY service_name ORDER BY n DESC`);
log(`[2] '균/검사/KOH/진균/곰팡이' 류 service_name 표기 (${names.rowCount}종):`);
for (const r of names.rows) {
  const hitsPattern = /KOH/i.test(r.service_name) || /진균검사/.test(r.service_name);
  log(`   ${hitsPattern ? '✅매칭' : '❌누락'}  "${r.service_name}"  (n=${r.n}, last=${r.last_seen?.toISOString?.().slice(0,10) ?? r.last_seen})`);
}
log('');

// 3) 현행 패턴(%KOH%,%진균검사%)으로 잡히는 service 총건
const matched = await client.query(
  `SELECT count(*) AS n, count(DISTINCT check_in_id) AS checkins
   FROM check_in_services
   WHERE service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%'`);
log(`[3] 현행 ILIKE(%KOH%,%진균검사%) 매칭: service ${matched.rows[0].n}건 / 내원 ${matched.rows[0].checkins}건\n`);

// 4) 최근 30일 KOH류 service 가진 check_in 샘플 5건 (toggle 떠야 하는 환자)
const sample = await client.query(
  `SELECT ci.id AS check_in_id, ci.customer_id, ci.checked_in_at::date AS d,
          array_agg(cis.service_name) AS svcs
   FROM check_ins ci
   JOIN check_in_services cis ON cis.check_in_id = ci.id
   WHERE (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
     AND ci.checked_in_at > now() - interval '45 days'
   GROUP BY ci.id, ci.customer_id, ci.checked_in_at::date
   ORDER BY ci.checked_in_at DESC LIMIT 8`);
log(`[4] 최근 45일 KOH류 service 보유 내원 (toggle 떠야 함) — ${sample.rowCount}건:`);
for (const r of sample.rows) {
  log(`   ${r.d}  cust=${r.customer_id?.slice(0,8)}  check_in=${r.check_in_id?.slice(0,8)}  svcs=${JSON.stringify(r.svcs)}`);
}
log('');

await client.end();
log('✅ 진단 완료 (영속 변경 없음)');
