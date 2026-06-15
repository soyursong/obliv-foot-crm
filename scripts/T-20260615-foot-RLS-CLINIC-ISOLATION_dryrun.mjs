/**
 * T-20260615-foot-RLS-CLINIC-ISOLATION — Phase 1 DRY-RUN (ROLLBACK, 영속변경 0)
 * Phase1 마이그를 트랜잭션 내 적용 → role 임퍼스네이트로 clinic 격리 + rrn_decrypt 게이트 실증 → ROLLBACK.
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P=process.env.SUPABASE_DB_PASSWORD; if(!P)for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const c=new Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();
console.log(`✅ PROD 연결 (DRY-RUN, 끝에서 ROLLBACK)  ${new Date().toISOString()}\n`);

const J='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const ADMIN='a36bc2cc-1fb1-46c5-83cf-84210a02ac93';   // jongno admin
const STAFF='44cab5cb-44e1-4813-83c3-338325fd0c83';   // jongno therapist
const CUST_J='3da2d8ef-97bc-4bc7-a55f-cd9bf8bc4251';  // jongno, rrn_enc 보유
const CUST_S='79c5321b-a874-4438-a1e2-eb1993aa4ab6';  // songdo
let pass=true; const chk=(n,ok,d='')=>{ if(!ok)pass=false; console.log(`  ${ok?'✅':'❌'} ${n}${d?'  '+d:''}`); };

async function asUser(uid, fn){
  await c.query('SAVEPOINT u');
  await c.query(`SET LOCAL ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`,[uid]);
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`,[uid]);
  try { return await fn(); }
  finally { await c.query('RESET ROLE'); await c.query('ROLLBACK TO SAVEPOINT u'); }
}

let sql = fs.readFileSync('supabase/migrations/20260615160000_rls_clinic_isolation_patient_tables.sql','utf8')
  .split('\n').filter(l=>!/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

try {
  await c.query('BEGIN');
  console.log('── [1] 마이그 적용 (DO 검증 블록 포함) ──');
  await c.query(sql);
  chk('Phase1 적용 + AC1 검증 DO 통과', true);

  console.log('\n── [2] clinic 격리 (jongno admin 세션) ──');
  await asUser(ADMIN, async()=>{
    for (const t of ['customers','check_ins','reservations','payments']){
      const all=await c.query(`SELECT count(*)::int n FROM ${t}`);
      const other=await c.query(`SELECT count(*)::int n FROM ${t} WHERE clinic_id <> $1`,[J]);
      chk(`${t}: 타 clinic row 0건 가시`, other.rows[0].n===0, `보이는 총 ${all.rows[0].n}건, 타clinic ${other.rows[0].n}건`);
    }
    // songdo 고객 직접 조회 불가
    const s=await c.query(`SELECT count(*)::int n FROM customers WHERE id=$1`,[CUST_S]);
    chk('songdo 고객 직접 조회 0건', s.rows[0].n===0);
    // 본인 clinic 고객 정상 가시
    const j=await c.query(`SELECT count(*)::int n FROM customers WHERE clinic_id=$1`,[J]);
    chk('jongno 고객 정상 가시(>0)', j.rows[0].n>0, `${j.rows[0].n}건`);
  });

  console.log('\n── [3] rrn_decrypt 게이트 (§16-4) ──');
  await asUser(ADMIN, async()=>{
    const r1=await c.query(`SELECT rrn_decrypt($1) v`,[CUST_J]);
    chk('admin@jongno → jongno 고객 RRN 복호 성공', r1.rows[0].v!==null, `len=${(r1.rows[0].v||'').length}`);
    const r2=await c.query(`SELECT rrn_decrypt($1) v`,[CUST_S]);
    chk('admin@jongno → songdo 고객 RRN = NULL (clinic 불일치 차단)', r2.rows[0].v===null);
  });
  await asUser(STAFF, async()=>{
    const r3=await c.query(`SELECT rrn_decrypt($1) v`,[CUST_J]);
    chk('therapist@jongno → RRN = NULL (admin/manager 아님 차단)', r3.rows[0].v===null);
  });

  console.log('\n── [4] anon 동선 무변경 확인 (Phase1은 anon 정책 미접촉) ──');
  const anonpol=await c.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename IN('customers','check_ins','reservations') AND 'anon'=ANY(roles) ORDER BY policyname`);
  const names=anonpol.rows.map(r=>r.policyname);
  chk('anon 셀프체크인 정책 보존', names.includes('anon_insert_customer_self_checkin')&&names.includes('anon_checkin_read')&&names.includes('anon_reservation_read'), names.join(','));

} catch(e){ pass=false; console.log(`\n❌ 예외: code=${e.code} ${e.message}`); }
finally { await c.query('ROLLBACK'); await c.end(); console.log(`\n${pass?'✅ DRY-RUN PASS':'❌ DRY-RUN FAIL'} (ROLLBACK 완료, 영속변경 0)`); process.exit(pass?0:1); }
