/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 1b 벡터 특정 (READ-ONLY)
 *
 * Phase 1 발견: 09:27:45 masked customer b1b5f6f7 신규(가드 live인데도) + 동일인(phone 7754)
 * raw customer e8ed0df6 별개 존재 → 2차 벡터. self_checkin_with_reservation_link 가드가
 * masking_seen 시 INSERT 를 막는데도 masked customer 가 생성됨 = self_checkin 이 아닌
 * 다른 anon RPC(fn_selfcheckin_upsert_customer_resolve_v2/v3 등)가 만들고, self_checkin 은
 * customer_id 로 그 masked row 에 그대로 link(denorm=raw=masked) 했다는 가설 검증.
 *
 * ★★★ READ-ONLY. SELECT + pg_get_functiondef 만. ★★★
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

async function main(){
  console.log('=== Phase 1b 벡터 특정 (READ-ONLY) ===\n');

  // Q1) b1b5f6f7(masked 신규) vs e8ed0df6(raw dup) 동일인 여부 — name 구조/phone tail 대조
  console.log('── Q1) 중복쌍 b1b5f6f7(masked) vs e8ed0df6(raw) 대조 ──');
  const pair = await q(`
    SELECT left(id::text,8) AS id8,
      length(name) AS name_len, (position('*' in name)>0) AS name_masked,
      left(name,1) AS name_first, right(name,1) AS name_last,
      length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) AS phone_digits,
      right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS phone_tail,
      visit_type,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS created_kst
    FROM customers WHERE left(id::text,8) IN ('b1b5f6f7','e8ed0df6') ORDER BY created_at;`);
  console.table(pair);

  // Q2) 오늘 phone tail 7754 예약 존재 여부 (reservation_id 미전달 원인 추적)
  console.log('\n── Q2) 오늘 phone tail 7754 관련 reservations ──');
  const resv = await q(`
    SELECT left(id::text,8) AS resv_id8, left(customer_id::text,8) AS cust_id8,
      status, (position('*' in coalesce(customer_name,''))>0) AS name_masked,
      right(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g'),4) AS phone_tail,
      length(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g')) AS phone_digits,
      to_char(reservation_time,'HH24:MI') AS resv_time,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS created_kst
    FROM reservations
    WHERE reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
      AND right(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g'),4)='7754'
    ORDER BY created_at;`);
  console.table(resv);

  // Q3) 모든 anon-executable customers-INSERT 함수 + 마스킹 가드 보유 여부 (미가드 벡터 열거)
  console.log('\n── Q3) anon-exec customers INSERT 함수 + 마스킹 가드 보유 여부 ──');
  const fns = await q(`
    SELECT p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
      (position('unlinked_masking_hold' in pg_get_functiondef(p.oid))>0
        OR position('v_masking_seen' in pg_get_functiondef(p.oid))>0
        OR position('v_name_masked' in pg_get_functiondef(p.oid))>0) AS has_masking_guard,
      p.prosecdef AS sec_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p')
      AND pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public\\.)?customers'
    ORDER BY anon_exec DESC, has_masking_guard, p.proname;`);
  console.table(fns);

  // Q4) upsert_customer_resolve 계열 함수 signature (키오스크 호출 후보) 존재 확인
  console.log('\n── Q4) fn_selfcheckin_upsert_customer* 계열 signature ──');
  const up = await q(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
      length(pg_get_functiondef(p.oid)) AS def_len
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname ILIKE 'fn_selfcheckin%'
    ORDER BY p.proname;`);
  console.table(up);

  console.log('\n=== Phase 1b 완료 (READ-ONLY, mutation 0) ===');
}
main().catch(e=>{console.error('\n[FATAL]',e.message);process.exit(1);});
