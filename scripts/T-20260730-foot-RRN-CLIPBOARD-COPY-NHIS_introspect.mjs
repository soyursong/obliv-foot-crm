#!/usr/bin/env node
/**
 * T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS — prod introspection (READ-ONLY).
 * 목적(§16-5 supervisor 종료게이트 evidence): AC-4 log_rrn_clipboard_copy 적용 전 실재 확인
 *   ① phi_access_log 실재 + 컬럼(accessed_by/accessed_role/access_type/customer_id/clinic_id)
 *   ② 헬퍼 3종 실재: current_user_role() / current_user_clinic_id() / is_admin_or_manager()
 *   ③ 형제 log_nhis_eligibility_lookup 실재(형상 대조 기준)
 *   ④ log_rrn_clipboard_copy 사전 부재(신규 CREATE 전제)
 * 무영속: 전부 SELECT introspection.
 */
import { q } from './dryrun_lib.mjs';

const out = {};

async function main() {
  // ① phi_access_log 컬럼
  out.phi_access_log_cols = await q(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='phi_access_log'
    ORDER BY ordinal_position;`);

  // ② 헬퍼 3종
  out.helpers = await q(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_catalog.format_type(p.prorettype, NULL) AS rettype
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('current_user_role','current_user_clinic_id','is_admin_or_manager')
    ORDER BY p.proname;`);

  // ③ 형제 함수(형상 대조 기준)
  out.sibling_lookup_fn = await q(`
    SELECT p.proname, p.prosecdef, p.proconfig,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_catalog.format_type(p.prorettype, NULL) AS rettype
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='log_nhis_eligibility_lookup';`);

  // ④ 신규 함수 사전 부재
  out.target_fn_preexist = await q(`
    SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='log_rrn_clipboard_copy';`);

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
