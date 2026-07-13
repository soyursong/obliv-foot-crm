/**
 * Phase 1c — (a) 16:32 이후 잔존 masked check_in 1건 provenance, (b) 가드 behavioral post-probe (dry-run, rollback)
 * READ-ONLY (probe 는 BEGIN..ROLLBACK 무영속 — mutation 0).
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const main=async()=>{
  // (a) 16:32:46 이후 name-masked check_in 전수 (self_checkin 여부 포함)
  console.log('── (a) 16:32:46 이후 name-masked check_in 전수 + 경로마커 ──');
  console.table(await q(`
    SELECT left(ci.id::text,8) AS ci8, left(ci.customer_id::text,8) AS cust8,
      to_char(ci.created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS kst,
      length(ci.customer_name) AS nlen, ci.status,
      (SELECT string_agg(DISTINCT st.changed_by,',') FROM status_transitions st WHERE st.check_in_id=ci.id) AS markers
    FROM check_ins ci
    WHERE position('*' in coalesce(ci.customer_name,''))>0
      AND ci.created_at > timestamptz '2026-07-13 16:32:46+09'
    ORDER BY ci.created_at;`));

  // (a2) 그 행이 fn_sync_customer_name 트리거로 갱신된 것인지 — 참조 customer 의 name 마스킹 여부
  console.log('\n── (a2) 위 check_in 이 가리키는 customer 의 현재 name 마스킹 여부 (트리거 denorm 원인 추적) ──');
  console.table(await q(`
    SELECT left(c.id::text,8) AS cust8, (position('*' in c.name)>0) AS cust_name_masked,
      to_char(c.created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS cust_created_kst,
      to_char(c.updated_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS cust_updated_kst
    FROM customers c WHERE c.id IN (
      SELECT ci.customer_id FROM check_ins ci
      WHERE position('*' in coalesce(ci.customer_name,''))>0
        AND ci.created_at > timestamptz '2026-07-13 16:32:46+09');`));

  // (b) 가드 behavioral post-probe — 단일쿼리 DO블록 + RAISE EXCEPTION 로 원자적 롤백(무영속).
  //   Management API 는 HTTP 호출마다 autocommit → BEGIN/ROLLBACK 분리호출 금지.
  //   대신 DO 블록 내부에서 가드함수 호출 → 결과/부작용 캡처 → RAISE EXCEPTION 로 전체 롤백.
  //   에러 메시지에 결과를 실어 반환. (DO 블록 부작용은 예외로 전부 원복 = mutation 0)
  //   기대: unlinked_masking_hold=true + customer_id NULL + check_ins.customer_name='미확인'(sentinel)
  //         + customers count 불변(마스킹 신규 INSERT 거부).
  console.log('\n── (b) 가드 behavioral post-probe (마스킹 payload, resolve불가) — 단일쿼리 DO+RAISE 원자롤백 ──');
  const cl = await q(`SELECT id FROM clinics WHERE id::text LIKE '74967aea%' LIMIT 1`);
  const clinicId = cl[0]?.id;
  console.log('  probe clinic:', clinicId?.slice(0,8));
  const doSql = `DO $probe$
    DECLARE v jsonb; c_before int; c_after int; ci_name text; ci_null boolean;
    BEGIN
      SELECT count(*) INTO c_before FROM customers WHERE clinic_id='${clinicId}';
      v := public.self_checkin_with_reservation_link(
        '${clinicId}'::uuid,
        jsonb_build_object('name','최***트','phone','5453','visit_type','new','ci_status','receiving'),
        (now() AT TIME ZONE 'Asia/Seoul')::date);
      SELECT count(*) INTO c_after FROM customers WHERE clinic_id='${clinicId}';
      SELECT customer_name, (customer_id IS NULL) INTO ci_name, ci_null
        FROM check_ins WHERE clinic_id='${clinicId}' ORDER BY created_at DESC LIMIT 1;
      RAISE EXCEPTION 'PROBE|hold=%|ret=%|cust_before=%|cust_after=%|ci_name=%|ci_custnull=%',
        v->>'unlinked_masking_hold', v, c_before, c_after, ci_name, ci_null;
    END $probe$;`;
  const probeRes = await q(doSql).then(() => ({ ok: true })).catch(e => ({ err: e.message }));
  const m = (probeRes.err || '').match(/PROBE\|(.+)$/);
  console.log('  probe 캡처:', m ? m[1].replace(/\\n.*/s, '') : JSON.stringify(probeRes).slice(0, 400));

  // 무영속 확인: probe 전후 customers 총건수 동일해야 함
  const after = await q(`SELECT count(*) AS n FROM customers WHERE clinic_id='${clinicId}'`);
  console.log('  probe 후 실제 customers count:', after[0].n, '(DO 부작용은 RAISE 로 롤백 → 불변이어야 정상)');
};
main().catch(e=>{console.error('[FATAL]',e.message);process.exit(1);});
