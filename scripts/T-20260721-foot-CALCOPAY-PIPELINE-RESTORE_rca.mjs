#!/usr/bin/env node
/**
 * T-20260721-foot-CALCOPAY-PIPELINE-RESTORE — §2 RCA (READ-ONLY prod introspection).
 *
 * 목표: service_charges 가 왜 6/6 이후 미적재인지 근인 규명. 무영속(전부 SELECT).
 *  - 파괴 UPDATE/INSERT 금지. 전부 introspection.
 */
import { q } from './dryrun_lib.mjs';

const out = {};
async function probe(label, sql) {
  try {
    const rows = await q(sql);
    out[label] = rows;
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    out[label] = { error: String(e.message || e) };
    console.log(`\n=== ${label} (ERROR) ===\n${e.message || e}`);
  }
}

async function main() {
  // A. service_charges 적재 현황 (count, 최소/최대 시각, 최근행)
  await probe('A1_svc_charges_summary', `
    SELECT count(*) AS total,
           min(created_at) AS first_created,
           max(created_at) AS last_created,
           count(*) FILTER (WHERE created_at >= '2026-06-06') AS since_0606
    FROM service_charges;`);
  await probe('A2_svc_charges_by_month', `
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS ym, count(*)
    FROM service_charges GROUP BY 1 ORDER BY 1;`);
  await probe('A3_svc_charges_recent', `
    SELECT id, check_in_id, service_id, is_insurance_covered, base_amount,
           insurance_covered_amount, copayment_amount, customer_grade_at_charge,
           created_at
    FROM service_charges ORDER BY created_at DESC LIMIT 10;`);

  // B. 비교: 라이브 트랜잭션은 계속 발생하는가? (payments/check_ins 최근)
  await probe('B1_payments_by_month', `
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS ym, count(*)
    FROM payments WHERE created_at >= '2026-05-01' GROUP BY 1 ORDER BY 1;`);
  await probe('B2_checkins_by_month', `
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS ym, count(*)
    FROM check_ins WHERE created_at >= '2026-05-01' GROUP BY 1 ORDER BY 1;`);
  await probe('B3_insurance_claims_summary', `
    SELECT count(*) total, min(created_at) first, max(created_at) last FROM insurance_claims;`);
  // covered 급여 방문이 실제로 있었는가 (service_charges 가 채워졌어야 할 모집단)
  await probe('B4_covered_checkin_services_by_month', `
    SELECT to_char(date_trunc('month', cis.created_at),'YYYY-MM') AS ym,
           count(*) FILTER (WHERE s.is_insurance_covered) AS covered_svc,
           count(*) AS all_svc
    FROM check_in_services cis JOIN services s ON s.id = cis.service_id
    WHERE cis.created_at >= '2026-05-01' GROUP BY 1 ORDER BY 1;`);

  // C. calc_copayment / record_insurance_consult_payment RPC 실재 + 정의
  await probe('C1_rpc_exists', `
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           l.lanname, p.prosecdef AS security_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public'
      AND p.proname IN ('calc_copayment','record_insurance_consult_payment')
    ORDER BY p.proname;`);
  await probe('C2_calc_copayment_def', `
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='calc_copayment' LIMIT 1;`);
  await probe('C3_consultpay_def', `
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='record_insurance_consult_payment' LIMIT 1;`);

  // D. service_charges 테이블: RLS 정책 + 트리거 + insert 권한
  await probe('D1_svc_charges_rls', `
    SELECT polname, polcmd,
           pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS withcheck_expr
    FROM pg_policy WHERE polrelid = 'public.service_charges'::regclass;`);
  await probe('D2_svc_charges_rls_enabled', `
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid='public.service_charges'::regclass;`);
  await probe('D3_svc_charges_triggers', `
    SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
    FROM pg_trigger WHERE tgrelid='public.service_charges'::regclass AND NOT tgisinternal;`);
  await probe('D4_svc_charges_grants', `
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='service_charges' ORDER BY grantee, privilege_type;`);
  await probe('D5_svc_charges_columns', `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='service_charges' ORDER BY ordinal_position;`);

  // E. schema_migrations ledger — calc_copayment 계열 적용 시각
  await probe('E1_migrations_calc', `
    SELECT version, name, executed_at FROM supabase_migrations.schema_migrations
    WHERE version >= '20260601' ORDER BY version;`);

  // F. record_insurance_consult_payment 로 실제 service_charges 가 생성되는지
  //    (7/15 이후 covered consultation 수납이 service_charge 를 남겼는지)
  await probe('F1_svc_charges_source_split', `
    SELECT customer_grade_at_charge, copayment_rate_at_charge, is_insurance_covered, count(*)
    FROM service_charges GROUP BY 1,2,3 ORDER BY 4 DESC;`);

  console.log('\n\n===== RCA PROBE COMPLETE =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
