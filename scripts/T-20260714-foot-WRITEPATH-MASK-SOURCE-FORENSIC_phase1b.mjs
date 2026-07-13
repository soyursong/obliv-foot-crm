/**
 * Phase 1b — 소스 닫힘 확정시각 정밀 규명 (READ-ONLY)
 *   가드 signature = check_ins.customer_name='미확인'(sentinel) + self_checkin 경로.
 *   가드 flip 시각 = (마지막 name-masked self_checkin write) < flip <= (첫 '미확인' sentinel write).
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const main = async () => {
  // 1) 마지막 name-masked check_in (self_checkin 경로) — 가드 미발효 최종 증거
  console.log('── 1) 마지막 name-masked check_in (전체) ──');
  console.table(await q(`
    SELECT left(id::text,8) AS ci8, length(customer_name) AS nlen,
      (position('*' in coalesce(customer_name,''))>0) AS name_masked,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS kst
    FROM check_ins
    WHERE position('*' in coalesce(customer_name,''))>0
    ORDER BY created_at DESC LIMIT 3;`));

  // 2) 첫 '미확인' sentinel check_in — 가드 발효 하한
  console.log('\n── 2) 가드 sentinel 미확인 check_in 시각 분포 (가드 발효 증거) ──');
  console.table(await q(`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS kst,
      left(id::text,8) AS ci8, (customer_id IS NULL) AS cust_null,
      (reservation_id IS NULL) AS resv_null
    FROM check_ins
    WHERE customer_name='미확인'
    ORDER BY created_at ASC LIMIT 10;`));
  console.log('   미확인 총건수:');
  console.table(await q(`SELECT count(*) AS n_sentinel,
    to_char(min(created_at) AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS first_kst,
    to_char(max(created_at) AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS last_kst
    FROM check_ins WHERE customer_name='미확인';`));

  // 3) 07-13 오후 self_checkin check_ins 타임라인 — masked→sentinel 전환점 육안 확인
  console.log('\n── 3) 07-13 13:00~24:00 self_checkin check_ins 타임라인 (denorm name 형태) ──');
  console.table(await q(`
    SELECT to_char(ci.created_at AT TIME ZONE 'Asia/Seoul','HH24:MI:SS') AS kst,
      left(ci.id::text,8) AS ci8,
      CASE WHEN ci.customer_name='미확인' THEN 'SENTINEL(guard)'
           WHEN position('*' in coalesce(ci.customer_name,''))>0 THEN 'MASKED(*)'
           ELSE 'name_len'||length(ci.customer_name) END AS name_form,
      (ci.customer_id IS NULL) AS cust_null, (ci.reservation_id IS NULL) AS resv_null
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id=ci.id AND st.changed_by='self_checkin'
    WHERE ci.created_at >= timestamptz '2026-07-13 13:00:00+09'
      AND ci.created_at <  timestamptz '2026-07-14 00:00:00+09'
    ORDER BY ci.created_at ASC;`));

  // 4) 최종: 마지막 name-masked write 이후 신규 마스킹 유입 0 재확인 (customers + check_ins)
  console.log('\n── 4) 16:32 이후 신규 name-masked 유입 0 확인 ──');
  console.table(await q(`
    SELECT 'customers name*' AS what, count(*) AS n FROM customers
      WHERE position('*' in name)>0 AND created_at > timestamptz '2026-07-13 16:32:46+09'
    UNION ALL SELECT 'check_ins name*', count(*) FROM check_ins
      WHERE position('*' in coalesce(customer_name,''))>0 AND created_at > timestamptz '2026-07-13 16:32:46+09';`));
  console.log('현재:', (await q(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS n`))[0].n);
};
main().catch(e=>{console.error('[FATAL]',e.message);process.exit(1);});
