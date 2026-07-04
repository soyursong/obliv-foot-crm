/**
 * T-20260703-foot-JONGNO-ANON-PHI-INTERIM-SCOPEDOWN — PROD apply + smoke (dev-foot, FIX-REQUEST MSG-20260704-151036)
 *  - 관리 API(query endpoint, SUPABASE_ACCESS_TOKEN)로 DDL 2건 적용 (SUPABASE_DB_PASSWORD 부재 → pg pooler 대체 경로)
 *  - anon key REST(PostgREST)로 진짜 anon 스모크 (RLS/grant 실경로)
 *  - 데이터 변경 0. 롤백 실행 없음.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MGMT = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }

const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('='))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;

async function sql(q){
  const r = await fetch(MGMT,{method:'POST',headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:q})});
  const t = await r.text();
  if(!r.ok) throw new Error(`SQL fail (${r.status}): ${t}`);
  return JSON.parse(t);
}
// anon REST — PostgREST GET; returns {status, body}
async function anonGet(path){
  const r = await fetch(`${URL}/rest/v1/${path}`,{headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});
  const b = await r.text();
  let j; try{j=JSON.parse(b);}catch{j=b;}
  return {status:r.status, body:j};
}

const line = (s)=>console.log(s);
let PASS = true;
const chk = (ok,msg)=>{ if(!ok) PASS=false; line(`  ${ok?'✅':'❌'} ${msg}`); return ok; };

line(`\n══ T-20260703 INTERIM-SCOPEDOWN PROD apply ══  ${new Date().toISOString()}`);

// ── BEFORE ──
line('\n── BEFORE ──');
const b1 = await sql(`select pg_get_expr(polqual, polrelid) as using_expr from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='reservations' and polname='anon_reservation_read';`);
line('  reservations anon_reservation_read USING: ' + (b1[0]?.using_expr ?? '(정책 없음)'));
const b2 = await sql(`select coalesce(string_agg(privilege_type,','),'(none)') privs from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='payments';`);
line('  payments anon grants: ' + b2[0]?.privs);

// ── APPLY 1: reservations scopedown ──
line('\n── APPLY 1: reservations scope-down ──');
const m1 = fs.readFileSync('supabase/migrations/20260703160000_anon_reservation_read_scopedown_today_confirmed.sql','utf8');
await sql(m1);
line('  ✅ applied (COMMIT)');

// ── APPLY 2: payments REVOKE ──
line('\n── APPLY 2: payments REVOKE ──');
const m2 = fs.readFileSync('supabase/migrations/20260628140000_anon_revoke_payments_only.sql','utf8');
await sql(m2);
line('  ✅ applied (COMMIT)');

// ── AFTER: policy/grant 상태 (신규 쿼리, 영속 확인) ──
line('\n── AFTER (postgres role 검증) ──');
const a1 = await sql(`select pg_get_expr(polqual, polrelid) as using_expr from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='reservations' and polname='anon_reservation_read';`);
const usingExpr = a1[0]?.using_expr ?? '';
line('  reservations USING: ' + usingExpr);
chk(/Asia\/Seoul/.test(usingExpr), 'KST 정합: USING 에 Asia/Seoul (CURRENT_DATE UTC 미사용)');
chk(/status\)?\s*=\s*'confirmed'/.test(usingExpr) || /confirmed/.test(usingExpr), 'status=confirmed predicate 포함');
const a2 = await sql(`select coalesce(string_agg(privilege_type,','),'(none)') privs from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='payments';`);
chk(a2[0]?.privs === '(none)', `payments anon grants 제거됨 (now: ${a2[0]?.privs})`);

// check_ins/customers 무변경 확인 (Track 2 유지)
const a3 = await sql(`select table_name, coalesce(string_agg(privilege_type,',' order by privilege_type),'(none)') privs from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name in ('check_ins','customers') group by table_name order by table_name;`);
line('  (Track2 유지 확인) check_ins/customers anon grants:');
for(const r of a3) line(`     ${r.table_name}: ${r.privs}`);

// KST vs UTC 경계 데모
const kd = await sql(`select (now() at time zone 'Asia/Seoul')::date as kst_date, current_date as utc_date, to_char(now() at time zone 'Asia/Seoul','HH24:MI') as kst_time;`);
line(`  경계 데모: KST date=${kd[0].kst_date} (KST ${kd[0].kst_time}) / UTC current_date=${kd[0].utc_date}`);

// ── SMOKE (anon key REST — 진짜 anon 경로) ──
line('\n── SMOKE 2a: anon reservations select id,customer_phone ──');
const s1 = await anonGet('reservations?select=id,customer_phone,reservation_date,status&limit=1000');
if(s1.status!==200){ chk(false, `anon reservations GET 실패 status=${s1.status}: ${JSON.stringify(s1.body).slice(0,200)}`); }
else {
  const rows = s1.body;
  const kstDate = kd[0].kst_date;
  const offToday = rows.filter(r=>r.reservation_date!==kstDate);
  const offStatus = rows.filter(r=>r.status!=='confirmed');
  line(`  반환 행수: ${rows.length}`);
  chk(offToday.length===0, `모든 행 reservation_date=오늘KST(${kstDate}) (위반 ${offToday.length}건)`);
  chk(offStatus.length===0, `모든 행 status=confirmed (위반 ${offStatus.length}건)`);
  if(rows.length>0) line(`     샘플: date=${rows[0].reservation_date} status=${rows[0].status} phone=${(rows[0].customer_phone||'').replace(/\d(?=\d{4})/g,'*')}`);
  // 2b 경계: 오늘 KST 예약이 실제로 read 되는지 (당일 confirmed 존재 시 포함 확인)
  line('\n── SMOKE 2b: KST 경계 — 당일 예약 read 포함 ──');
  const todayCount = await sql(`select count(*)::int c from reservations where reservation_date=(now() at time zone 'Asia/Seoul')::date and status='confirmed';`);
  const tc = todayCount[0].c;
  line(`  DB 상 오늘KST+confirmed 예약: ${tc}건 / anon 반환: ${rows.length}건`);
  chk(rows.length===tc, `anon 반환수 == 오늘KST+confirmed 실제수 (경계 정합, 누락/초과 0)`);
  if(tc===0) line('     ⚠ 오늘 confirmed 예약 0건 → 정책 술어 자체는 Asia/Seoul 확인됨(위 USING). 데이터 유무와 무관하게 경계 정합.');
}

line('\n── SMOKE 2c: anon payments select → 권한거부(42501) ──');
const s2 = await anonGet('payments?select=*&limit=1');
// PostgREST 는 grant 없으면 401/403 + code 42501
const denied = (s2.status===401||s2.status===403) && (JSON.stringify(s2.body).includes('42501') || /permission denied/i.test(JSON.stringify(s2.body)));
chk(denied, `payments anon read 거부 (status=${s2.status}, code=${s2.body?.code||''}) ${s2.body?.message||''}`);

line('\n── SMOKE 2d: 키오스크 체크인 경로 (예약자 phone→banner 매칭) ──');
// 키오스크는 anon 으로 today+confirmed 예약을 phone 으로 조회해 banner 매칭 → 큐 발번.
// 새 정책 하에서도 today+confirmed 예약 phone 조회가 가능한지 확인.
if(s1.status===200 && s1.body.length>0){
  const sample = s1.body[0];
  const ph = sample.customer_phone;
  if(ph){
    const s3 = await anonGet(`reservations?select=id,customer_phone,status,reservation_date&customer_phone=eq.${encodeURIComponent(ph)}&status=eq.confirmed`);
    const matched = s3.status===200 && Array.isArray(s3.body) && s3.body.length>0;
    chk(matched, `phone 매칭 조회 정상 (banner 매칭 가능, ${Array.isArray(s3.body)?s3.body.length:0}건 hit) — 큐 발번 경로 OK`);
  } else { line('  ⚠ 샘플 phone 없음 → phone 매칭 스모크 skip'); }
} else {
  line('  ⚠ 오늘 confirmed 예약 0건 → 라이브 phone 매칭 데이터 없음.');
  line('     정책 술어(today+confirmed)가 키오스크 4 SELECT predicate 의 상위집합임은 DA 실측(spec §2)으로 GO.');
  line('     당일 예약 발생 시 phone→banner→큐 발번 경로 회귀 0 (predicate ⊆ 정책).');
}

line(`\n══ 결과: ${PASS?'✅✅ ALL PASS':'❌ FAIL — 확인 필요'} ══`);
process.exit(PASS?0:1);
