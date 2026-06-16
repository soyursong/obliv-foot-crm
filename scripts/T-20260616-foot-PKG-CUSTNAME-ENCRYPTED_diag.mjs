// T-20260616-foot-PKG-CUSTNAME-ENCRYPTED — read-only 진단
// 목적: 패키지 탭 고객성함 "암호문" 노출의 RC 격리.
//  Q1) customers.name at-rest 값이 암호문인가 평문인가?
//  Q2) 패키지가 참조하는 customer 의 name 실제값 + clinic_id 정합성
//  Q3) name 컬럼 타입/암호화 흔적
import pg from 'pg'; import { readFileSync } from 'node:fs';
let P=process.env.SUPABASE_DB_PASSWORD;
for(const l of readFileSync(process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

console.log('═══ Q3) customers.name 컬럼 타입 ═══');
const {rows:colT}=await c.query(`SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name IN ('name','phone','rrn_enc') ORDER BY column_name`);
console.table(colT);

console.log('\n═══ Q1) customers.name at-rest 샘플 (RLS 우회 직접조회, 최근 20명) ═══');
const {rows:nm}=await c.query(`SELECT id, left(name,40) AS name_sample, length(name) AS name_len, phone, clinic_id, created_at FROM customers ORDER BY created_at DESC LIMIT 20`);
console.table(nm.map(r=>({id:r.id.slice(0,8),name:r.name_sample,len:r.name_len,phone:r.phone?String(r.phone).slice(0,6):null,clinic:r.clinic_id?.slice(0,8),created:r.created_at?.toISOString?.().slice(0,10)})));

console.log('\n═══ Q2) packages → customer name JOIN (RLS 우회, 최근 25건) ═══');
const {rows:pk}=await c.query(`
  SELECT p.id pid, p.clinic_id p_clinic, p.package_name, p.contract_date,
         cu.id cid, left(cu.name,40) cname, length(cu.name) clen, cu.clinic_id c_clinic
  FROM packages p LEFT JOIN customers cu ON cu.id=p.customer_id
  ORDER BY p.contract_date DESC NULLS LAST LIMIT 25`);
console.table(pk.map(r=>({pkg:r.package_name?.slice(0,16),cname:r.cname,clen:r.clen,p_clinic:r.p_clinic?.slice(0,8),c_clinic:r.c_clinic?.slice(0,8),clinic_match:r.p_clinic===r.c_clinic})));

console.log('\n═══ name 이 비-한글/비정상 패턴인 행 카운트 (암호문 의심) ═══');
const {rows:weird}=await c.query(`
  SELECT count(*) total,
         count(*) FILTER (WHERE name ~ '[가-힣]') AS has_hangul,
         count(*) FILTER (WHERE name !~ '[가-힣a-zA-Z]' ) AS no_letter,
         count(*) FILTER (WHERE length(name) > 30) AS very_long
  FROM customers`);
console.table(weird);

console.log('\n═══ jongno-foot clinic_id 확인 ═══');
const {rows:cl}=await c.query(`SELECT id,slug,name FROM clinics WHERE slug LIKE '%foot%' OR slug LIKE '%jongno%'`);
console.table(cl.map(r=>({id:r.id.slice(0,8),slug:r.slug,name:r.name})));

await c.end();
console.log('\n[done]');
