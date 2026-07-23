/**
 * T-20260724-foot-DUMMY-NORMALIZE-OOB-HOLD-GUARD — ① OOB corrective 진원 pin (READ-ONLY)
 *
 * 목적: 07-18/21/22 dummy-normalize batch(masked phone → 'DUMMY-'||uuid, git ledger 무접점)의
 *       operator/경로/cadence 를 특정하기 위한 prod-side 잔여 브랜치 close.
 *   - Q(scheduled?): pg_cron 잡이 phone-normalize 를 돌리는가? (cron.job 조회)
 *   - Q(server-gen?): 트리거 trg_customers_set_phone_dummy 外에 'DUMMY-' 를 write 하는 함수가 있는가?
 *   - Q(cadence):     DUMMY-% 코호트의 updated_at batch 지문(동일 마이크로초 그룹) 재확인.
 *
 * ★★★ READ-ONLY. SELECT only. UPDATE/DELETE/INSERT/DDL 절대 없음. ★★★
 * PHI 위생: phone 평문 미출력 — updated_at·행수·PK8(prefix 8)·구조지문만.
 * author: dev-foot / 2026-07-24
 */
import { query } from './lib/foot_migration_ledger.mjs';

const guard = (sql) => {
  if (/\b(update|delete|insert|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
    throw new Error('READ-ONLY 위반: mutation/DDL 감지 — ' + sql.slice(0, 80));
  }
  return sql;
};
const run = async (label, sql) => {
  const res = await query(guard(sql));
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(res, null, 2));
  return res;
};

async function main() {
  console.log('=== T-20260724 DUMMY-NORMALIZE OOB 진원 probe (READ-ONLY) ===');

  // (1) pg_cron 존재 + 스케줄 잡 목록 (phone-normalize 스케줄 여부)
  await run('pg_cron 확장 설치 여부', `
    SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';`);
  await run('cron.job 목록 (있으면)', `
    SELECT jobid, schedule, jobname,
           left(command, 120) AS command_head, active, username
      FROM cron.job
     ORDER BY jobid;`).catch(e => console.log('  (cron.job 없음/미설치: ' + e.message.slice(0,80) + ')'));

  // (2) 'DUMMY-' 리터럴을 본문에 담은 함수/프로시저 (트리거 파생 外 server-side generator)
  //     prokind='f'(일반 함수)만 — aggregate/window 는 pg_get_functiondef 불가.
  await run("pg_proc 중 본문에 'DUMMY-' 포함", `
    SELECT n.nspname AS schema, p.proname AS fn,
           (pg_get_functiondef(p.oid) LIKE '%SET phone%DUMMY-%') AS writes_phone_dummy,
           (pg_get_functiondef(p.oid) LIKE '%gen_random_uuid%') AS uses_uuid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND p.prokind = 'f'
       AND p.proname NOT LIKE '%agg%'
       AND pg_get_functiondef(p.oid) LIKE '%DUMMY-%'
     ORDER BY 1,2;`).catch(e => console.log('  (pg_proc 조회 부분실패: ' + e.message.slice(0,120) + ')'));

  // (3) customers 에 UPDATE 를 거는 트리거 전체 (batch UPDATE 주체 후보)
  await run('customers 테이블 트리거 목록', `
    SELECT t.tgname, p.proname AS fn, t.tgenabled,
           CASE t.tgtype::int & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.customers'::regclass AND NOT t.tgisinternal
     ORDER BY t.tgname;`);

  // (4) DUMMY-% 코호트 cadence 재확인 (updated_at batch 지문, PHI-free)
  await run('DUMMY-% 코호트 updated_at batch 지문', `
    SELECT date_trunc('second', updated_at) AS batch_sec,
           count(*) AS rows,
           count(*) FILTER (WHERE rrn_enc IS NOT NULL) AS with_rrn,
           min(left(id::text,8)) AS sample_pk8,
           count(DISTINCT date_trunc('microsecond', updated_at)) AS distinct_us_groups
      FROM public.customers
     WHERE phone LIKE 'DUMMY-%'
     GROUP BY 1 ORDER BY 1;`);

  // (5) phi_access_log / audit 에 07-18 batch actor 흔적이 있는가 (operator pin 시도)
  await run('phi_access_log 07-18 batch 창(11:00~11:30 UTC) actor', `
    SELECT to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS ts, actor_id, action, table_name
      FROM public.phi_access_log
     WHERE created_at BETWEEN '2026-07-18T11:00:00Z' AND '2026-07-18T11:30:00Z'
     ORDER BY created_at LIMIT 50;`).catch(e => console.log('  (phi_access_log 조회 불가: ' + e.message.slice(0,80) + ')'));

  console.log('\n=== probe 완료 (READ-ONLY) ===');
}
main().catch(e => { console.error('probe 실패:', e.message); process.exit(1); });
