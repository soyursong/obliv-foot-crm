/**
 * T-20260713-foot-CHECKIN-FAIL-REGRESSION-TRIAGE — PROD READ-ONLY 진단 프로브
 * 16:04 "다시 체크인도 안됨" 회귀 신호 재현. 쓰기 0 (SELECT/introspection only).
 */
import { query } from './lib/foot_migration_ledger.mjs';

const out = (h, v) => console.log(`\n── ${h} ──\n${JSON.stringify(v, null, 2)}`);

// (1) 두 함수 현재 정의 지문 + anon/authenticated EXECUTE ACL
const fns = await query(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) LIKE '%unlinked_masking_hold%') AS wsa_fp_present,
         (pg_get_functiondef(p.oid) LIKE '%홍*동%' OR pg_get_functiondef(p.oid) LIKE '%mask%' OR pg_get_functiondef(p.oid) LIKE '%substring%') AS masking_hint,
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         md5(pg_get_functiondef(p.oid))                            AS def_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('self_checkin_with_reservation_link','fn_selfcheckin_today_reservations','next_queue_number')
   ORDER BY p.proname;`);
out('(1) 함수 지문 + anon/auth EXECUTE ACL', fns);

// (2) 오늘(KST) check_ins 실적 — 체크인이 실제로 들어오고 있나 / 가드 발화(미확인·미연결) 비율
const ci = await query(`
  SELECT count(*)                                               AS total_today,
         count(*) FILTER (WHERE customer_id IS NULL)            AS unlinked,
         count(*) FILTER (WHERE customer_name='미확인')         AS sentinel_name,
         count(*) FILTER (WHERE reservation_id IS NULL)         AS no_resv_link,
         min(created_at)                                        AS first_ci,
         max(created_at)                                        AS last_ci
    FROM check_ins
   WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date;`);
out('(2) 오늘 check_ins 실적(KST)', ci);

// (2b) 최근 12건 타임라인 (13:00 이후 유입 확인)
const recent = await query(`
  SELECT (created_at AT TIME ZONE 'Asia/Seoul') AS kst, customer_name, (customer_id IS NOT NULL) AS linked,
         (reservation_id IS NOT NULL) AS resv_linked, status, visit_type
    FROM check_ins
   ORDER BY created_at DESC LIMIT 12;`);
out('(2b) 최근 12 check_ins', recent);

// (3) 오늘 예약 상태 분포 (checked_in 전이가 일어나는지)
const resv = await query(`
  SELECT status, count(*) FROM reservations
   WHERE reservation_date=(now() AT TIME ZONE 'Asia/Seoul')::date
   GROUP BY status ORDER BY 2 DESC;`);
out('(3) 오늘 예약 상태 분포', resv);

// (4) 원장 최근 10건 — WS-A(20260713120000)/WS-C(20260713140000) 등재 여부
const led = await query(`
  SELECT version, name, created_by FROM supabase_migrations.schema_migrations
   ORDER BY version DESC LIMIT 10;`);
out('(4) schema_migrations 최근 10', led);

// (5) anon 이 실제 셀프체크인/명단조회 RPC EXECUTE 가능한지 종합(2)에서 커버. 추가로 customers 최근 신규(마스킹 오염 재발?)
const cust = await query(`
  SELECT count(*) FILTER (WHERE name LIKE '%*%')               AS masked_name_rows,
         count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date=(now() AT TIME ZONE 'Asia/Seoul')::date) AS new_today
    FROM customers;`);
out('(5) customers 마스킹오염/오늘신규', cust);

console.log('\n===== PROBE DONE (read-only, 쓰기 0) =====');
