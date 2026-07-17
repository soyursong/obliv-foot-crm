#!/usr/bin/env node
/**
 * T-20260717-foot-MIG-LEDGER-RECONCILE-ANONSWEEP — prod introspection + 3-way ledger reconcile.
 *
 * Migration Ledger Reconciliation 단일표준 적용: schema_migrations 원장 ↔ 마이그 파일 ↔
 * prod 실체 3자 대조. 정본 = prod 실체.
 *
 * 수집 항목:
 *   [A pre-state] anon-writable base 테이블 수(INS/UPD/DEL/TRUNCATE) + 4 admin/secret 함수 anon EXECUTE
 *   [B drift]     public 함수 total / anon-exec / KEEP-32 제외 revoke-eligible 목록 + 예상(93) 대비 초과분
 *   [ledger A]    20260715130000 / 20260716180000 schema_migrations 기록 여부
 *   [ledger B]    20260716230000 / 20260717120000 schema_migrations 기록 여부 + selfcheckin RPC 3종 pg_proc
 *
 * 무영속: 전부 SELECT introspection (읽기 전용). prod 상태 변경 없음.
 */
import { q } from './dryrun_lib.mjs';

const KEEP = [
  'fn_health_q_validate_token','fn_health_q_submit',
  'fn_prescreen_start','fn_complete_prescreen_checklist',
  'self_checkin_create','self_checkin_lookup','self_checkin_with_reservation_link',
  'fn_selfcheckin_create_check_in','fn_selfcheckin_create_health_q_token',
  'fn_selfcheckin_dup_guard','fn_selfcheckin_existing_checkin_today',
  'fn_selfcheckin_find_customer','fn_selfcheckin_linked_checkin',
  'fn_selfcheckin_match_reservation','fn_selfcheckin_reservation_banner',
  'fn_selfcheckin_rrn_match','fn_selfcheckin_today_reservations',
  'fn_selfcheckin_update_personal_info','fn_selfcheckin_upsert_customer',
  'fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3',
  'fn_health_q_create_token','fn_dashboard_reissue_health_q_token',
  'upsert_reservation_from_source',
  'batch_checkin','reservation_to_checkin','fn_reservation_dup_guard',
  'next_queue_number','get_today_reservations','find_customer_by_phone',
  'get_or_create_unified_customer_id','fn_check_in_slot_dwell',
];
const keepLit = KEEP.map((n) => `'${n}'`).join(',');

const out = {};

async function main() {
  // ── [A pre-state] anon-writable base 테이블 (INS/UPD/DEL 중 하나라도) ──
  out.A_anon_write_tables = await q(`
    SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND (has_table_privilege('anon',c.oid,'INSERT')
        OR has_table_privilege('anon',c.oid,'UPDATE')
        OR has_table_privilege('anon',c.oid,'DELETE'));`);
  out.A_anon_truncate_tables = await q(`
    SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon',c.oid,'TRUNCATE');`);
  out.A_public_base_total = await q(`
    SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r';`);

  // ── [A pre-state] 4 admin/secret 함수 anon EXECUTE ──
  out.A_admin_secret_fns = await q(`
    SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('admin_register_user','admin_reset_user_password','get_vault_secret','foot_stats_revenue')
    ORDER BY p.proname;`);

  // ── [B] 함수 total / anon-exec / revoke-eligible ──
  out.B_fn_total = await q(`SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';`);
  out.B_anon_exec_total = await q(`
    SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE');`);
  // revoke-eligible = anon-exec AND NOT keep. 마이그 VERIFY 는 이게 93 이길 기대.
  out.B_revoke_eligible = await q(`
    SELECT p.proname, p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')
      AND p.proname NOT IN (${keepLit})
    ORDER BY p.proname;`);
  // KEEP 중 실제 anon-exec 보유 수 (32 이어야 정상)
  out.B_keep_anon_exec = await q(`
    SELECT count(DISTINCT p.proname) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (${keepLit}) AND has_function_privilege('anon',p.oid,'EXECUTE');`);

  // ── [ledger A] schema_migrations 기록 ──
  out.ledger_A = await q(`
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260715130000','20260716180000') ORDER BY version;`);
  // ── [ledger B] SELFCHECKIN parent+child ──
  out.ledger_B = await q(`
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260716230000','20260717120000') ORDER BY version;`);
  // 원장 최신 20건 (전체 정합 파악용)
  out.ledger_recent = await q(`
    SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;`);

  // ── [B evidence] SELFCHECKIN RPC 3종 pg_proc 실재/시그니처/secdef ──
  out.B_selfcheckin_rpcs = await q(`
    SELECT p.proname, p.oid::regprocedure::text AS sig, p.prosecdef AS secdef,
           has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3')
    ORDER BY p.proname;`);

  console.log(JSON.stringify(out, null, 2));

  // ── 요약 판정 ──
  const revEl = out.B_revoke_eligible.length;
  const drift = revEl - 93;
  console.log('\n================ RECONCILE SUMMARY ================');
  console.log(`[A] anon-writable base tables (INS/UPD/DEL) = ${out.A_anon_write_tables[0].n} (sweep 성공 시 0)`);
  console.log(`[A] anon-TRUNCATE base tables               = ${out.A_anon_truncate_tables[0].n} (sweep 성공 시 0)`);
  console.log(`[A] public base total                       = ${out.A_public_base_total[0].n}`);
  for (const f of out.A_admin_secret_fns) console.log(`[A] ${f.proname}: anon EXECUTE = ${f.anon_exec}`);
  console.log(`[B] public fn total = ${out.B_fn_total[0].n} · anon-exec = ${out.B_anon_exec_total[0].n} · KEEP anon-exec = ${out.B_keep_anon_exec[0].n}/32`);
  console.log(`[B] revoke-eligible (anon-exec ∧ ¬KEEP) = ${revEl} (마이그 VERIFY 기대=93 · DRIFT=${drift >= 0 ? '+' : ''}${drift})`);
  if (drift !== 0) {
    console.log(`[B] ⚠ DRIFT ${drift > 0 ? '초과' : '부족'} → 마이그 B VERIFY(n_revoked<>93) abort. DA 재-CONSULT 필요.`);
  }
  console.log(`[ledger A] 20260715130000 / 20260716180000 기록: ${JSON.stringify(out.ledger_A.map((r) => r.version))} (부재=미착지)`);
  console.log(`[ledger B] 20260716230000 / 20260717120000 기록: ${JSON.stringify(out.ledger_B.map((r) => r.version))}`);
  console.log(`[B] selfcheckin RPC 3종: ${out.B_selfcheckin_rpcs.map((r) => r.proname + '(secdef=' + r.secdef + ')').join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
