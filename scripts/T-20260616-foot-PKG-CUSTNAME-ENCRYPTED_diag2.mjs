import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows:cl}=await c.query(`SELECT id FROM clinics WHERE slug='jongno-foot'`);
const JID=cl[0].id; const q=`'${JID}'`;

console.log('═══ active 패키지 200건(화면 limit) 중 고객명 패턴 분류 ═══');
const {rows:cls}=await c.query(`
  WITH v AS (SELECT cu.name FROM packages p LEFT JOIN customers cu ON cu.id=p.customer_id
    WHERE p.clinic_id=${q} AND p.status='active' ORDER BY p.contract_date DESC NULLS LAST LIMIT 200)
  SELECT count(*) total,
    count(*) FILTER (WHERE name ~ '^(cf[0-9]|e2e|test|dummy|smoke|qa-|pingpong)') AS testfix_prefix,
    count(*) FILTER (WHERE name ~ '[0-9]{10}') AS has_epoch,
    count(*) FILTER (WHERE name ~ '^[가-힣]{2,5}') AS hangul_name FROM v`);
console.table(cls);

console.log('\n═══ active 패키지 화면 상위 30건 실제 표시 이름 ═══');
const {rows:top}=await c.query(`SELECT left(cu.name,40) cname, p.contract_date
  FROM packages p LEFT JOIN customers cu ON cu.id=p.customer_id
  WHERE p.clinic_id=${q} AND p.status='active' ORDER BY p.contract_date DESC NULLS LAST LIMIT 30`);
top.forEach((r,i)=>console.log(`  ${String(i+1).padStart(2)}. ${r.cname}  (${r.contract_date})`));

console.log('\n═══ 테스트픽스처 customer prefix별 분포(jongno-foot, epoch포함명) ═══');
const {rows:pat}=await c.query(`SELECT split_part(name,'-',1) AS prefix, count(*), min(created_at)::date AS first, max(created_at)::date AS last
  FROM customers WHERE clinic_id=${q} AND name ~ '[0-9]{10}' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
console.table(pat);

console.log('\n═══ 전체 jongno-foot customers 중 epoch명(테스트) vs 정상 ═══');
const {rows:tot}=await c.query(`SELECT count(*) total, count(*) FILTER(WHERE name ~ '[0-9]{10}') epoch_test,
  count(*) FILTER(WHERE name ~ '^[가-힣]') hangul FROM customers WHERE clinic_id=${q}`);
console.table(tot);
await c.end();
