import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const log=(...a)=>console.log(...a);
log(`✅ DB READ-ONLY  ${new Date().toISOString()}\n`);
for (const prefix of ['83ab4fe1','16434582']) {
  // resolve full customer id by prefix
  const cust = await c.query(`SELECT id, name FROM customers WHERE id::text LIKE $1 LIMIT 1`, [prefix+'%']);
  if (!cust.rowCount){ log(`❌ cust ${prefix}: NOT FOUND`); continue; }
  const cid = cust.rows[0].id;
  log(`── cust=${prefix} (${cust.rows[0].name ?? '?'}) id=${cid}`);
  // 새 컴포넌트 쿼리 동치: non-cancelled 내원의 KOH service, created_at DESC
  const q = await c.query(`
    SELECT cis.id, cis.service_name, cis.koh_requested, cis.check_in_id, cis.created_at,
           ci.status, ci.checked_in_at::date AS d
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
    WHERE ci.customer_id = $1 AND ci.status <> 'cancelled'
      AND (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
    ORDER BY cis.created_at DESC`, [cid]);
  if (!q.rowCount){ log(`   ❌ KOH service in non-cancelled check_in: 0건 → 토글 미노출(정상: KOH 이력 없음)\n`); continue; }
  const target = q.rows[0].check_in_id;
  const grouped = q.rows.filter(r=>r.check_in_id===target);
  log(`   ✅ KOH service ${q.rowCount}건 발견 → 타겟 내원=${target.slice(0,8)} (${q.rows[0].d}, ${q.rows[0].status})`);
  log(`   → 토글 렌더 O. 타겟 내원 묶음 ${grouped.length}건:`);
  for (const r of grouped) log(`       "${r.service_name}"  koh_requested=${r.koh_requested}`);
  // 전체 내원 최근순 (재방문 케이스 확인)
  const all = await c.query(`SELECT id, status, checked_in_at::date AS d FROM check_ins WHERE customer_id=$1 ORDER BY checked_in_at DESC LIMIT 5`,[cid]);
  log(`   최근 내원 5건: ${all.rows.map(r=>`${r.d}(${r.status})${r.id===target?'←KOH타겟':''}`).join(', ')}\n`);
}
await c.end(); log('✅ done');
