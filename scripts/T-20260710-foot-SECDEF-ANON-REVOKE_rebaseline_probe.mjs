#!/usr/bin/env node
/**
 * T-20260710-foot-SECDEF-ANON-REVOKE — FIX-REQUEST re-baseline probe (READ-ONLY).
 * supervisor NO-GO(2026-07-18): 07-10 증거 stale + prod drift(anon 119→33). 재측정.
 * 전 쿼리 SELECT/introspection only — prod 무변경.
 */
import { q } from './dryrun_lib.mjs';

const WHITELIST_14 = [
  'fn_health_q_submit(text, jsonb, text)',
  'fn_health_q_validate_token(text)',
  'fn_prescreen_start(uuid)',
  'fn_complete_prescreen_checklist(uuid, jsonb, text)',
  'fn_selfcheckin_create_health_q_token(uuid, uuid, text)',
  'fn_selfcheckin_dup_guard(uuid, uuid, text, date)',
  'fn_selfcheckin_reservation_banner(uuid, text)',
  'fn_selfcheckin_rrn_match(uuid, uuid)',
  'fn_selfcheckin_today_reservations(uuid, date)',
  'fn_selfcheckin_update_personal_info(uuid, uuid, text, text, text, text, boolean, boolean, text, text, boolean, timestamp with time zone, text)',
  'self_checkin_with_reservation_link(uuid, jsonb, date)',
  'next_queue_number(uuid, date)',
  'is_approved_user()',
  'current_user_is_admin_or_manager()',
];

const out = {};

// 1) proacl 3자 대조 — role별 anon/authenticated/service_role/postgres EXECUTE 함수 수
out.counts = await q(`
  SELECT
    count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))          AS anon,
    count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS authenticated,
    count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS service_role,
    count(*) FILTER (WHERE has_function_privilege('postgres', p.oid, 'EXECUTE'))      AS postgres,
    count(*)                                                                          AS total_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';`);

// 2) 현 anon-EXECUTE 함수 전체 목록 (정확 sig)
out.anon_funcs = await q(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY p.proname;`);

// 3) pg_stat_statements — anon(rolname='anon') 호출 함수 집계
out.stat_meta = await q(`
  SELECT stats_reset, now() AS now,
         EXTRACT(day FROM now() - stats_reset)::int AS days
  FROM pg_stat_statements_info;`);

// anon roleid 로 필터. query 텍스트에서 함수 호출 추출 대신 rolname='anon' 전 쿼리 계수
out.anon_calls = await q(`
  SELECT s.query, s.calls
  FROM pg_stat_statements s
  JOIN pg_roles r ON r.oid = s.userid
  WHERE r.rolname = 'anon'
  ORDER BY s.calls DESC
  LIMIT 200;`);

// 4) Tier-A 돈-함수 anon 상태
out.tierA = await q(`
  SELECT
    has_function_privilege('anon','public.transfer_package_atomic(uuid,uuid)','EXECUTE') AS transfer_anon,
    has_function_privilege('authenticated','public.transfer_package_atomic(uuid,uuid)','EXECUTE') AS transfer_authed,
    has_function_privilege('service_role','public.transfer_package_atomic(uuid,uuid)','EXECUTE') AS transfer_svc;`);

// 5) pg_default_acl — default privileges (신규 상속 경로)
out.default_acl = await q(`
  SELECT r.rolname AS grantor, n.nspname AS schema, d.defaclobjtype AS objtype,
         d.defaclacl::text AS acl
  FROM pg_default_acl d
  JOIN pg_roles r ON r.oid = d.defaclrole
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclobjtype = 'f' AND (n.nspname = 'public' OR n.nspname IS NULL)
  ORDER BY r.rolname;`);

console.log(JSON.stringify(out, null, 2));

// ── 파생 분석 ────────────────────────────────────────────────────────────────
const anonSigs = new Set(out.anon_funcs.map(r => r.sig));
const wlSet = new Set(WHITELIST_14.map(s => s.replace(/\s+/g, ' ')));
const normAnon = new Set([...anonSigs].map(s => s.replace(/\s+/g, ' ')));

// 현재 anon 보유인데 whitelist 14 에 없음 = 마이그 적용 시 회수될 함수
const wouldRevoke = [...anonSigs].filter(s => !wlSet.has(s.replace(/\s+/g, ' ')));
// whitelist 14 중 현 prod anon 미보유 = 마이그가 새로 부여하려는 함수
const wlNotGranted = [...wlSet].filter(s => !normAnon.has(s));

console.log('\n===== 파생 분석 =====');
console.log('현 anon-EXECUTE 함수 수:', out.anon_funcs.length);
console.log('\n[A] 마이그 적용 시 anon EXECUTE 상실(회수)될 함수 (현 anon − whitelist14):', wouldRevoke.length);
wouldRevoke.forEach(s => console.log('   -', s));
console.log('\n[B] whitelist14 중 현 prod anon 미보유(마이그가 신규 부여):', wlNotGranted.length);
wlNotGranted.forEach(s => console.log('   +', s));
