// DRY-RUN ONLY (read-only) — 테스트픽스처 정리 범위/cascade 정밀 산정. 삭제 안 함.
import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

// 테스트 픽스처 판별식: epoch(10+자리 숫자) 포함명. 실제 한글명은 매칭 안 됨.
const TESTPAT = `name ~ '[0-9]{10}'`;

console.log('═══ [DRY-RUN] 삭제대상 customers (전 clinic, epoch명) ═══');
const {rows:a}=await c.query(`SELECT clinic_id, count(*) FROM customers WHERE ${TESTPAT} GROUP BY clinic_id`);
console.table(a);

console.log('\n═══ 오탐 안전성: epoch명인데 한글이름 동시포함(실데이터 의심) ═══');
const {rows:fp}=await c.query(`SELECT count(*) suspect FROM customers WHERE ${TESTPAT} AND name ~ '[가-힣]{2,}'`);
console.table(fp);
const {rows:fpEx}=await c.query(`SELECT left(name,40) name FROM customers WHERE ${TESTPAT} AND name ~ '[가-힣]{2,}' LIMIT 10`);
if(fpEx.length) console.log('  의심샘플:', fpEx.map(r=>r.name));

console.log('\n═══ customers 를 FK로 참조하는 테이블 (cascade 영향) ═══');
const {rows:fk}=await c.query(`
  SELECT tc.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND tc.table_schema='public'
  ORDER BY rc.delete_rule, tc.table_name`);
console.table(fk);

console.log('\n═══ 삭제대상 customer 가 참조된 행 수 (주요 자식테이블) ═══');
for(const t of ['packages','payments','check_ins','reservations','medical_charts','package_sessions','package_payments','form_submissions','consultations']){
  try{
    const {rows}=await c.query(`SELECT count(*) FROM ${t} WHERE customer_id IN (SELECT id FROM customers WHERE ${TESTPAT})`);
    console.log(`  ${t}: ${rows[0].count}`);
  }catch(e){ console.log(`  ${t}: (skip ${e.code||e.message})`); }
}
await c.end();
console.log('\n[DRY-RUN done — 삭제 미수행]');
