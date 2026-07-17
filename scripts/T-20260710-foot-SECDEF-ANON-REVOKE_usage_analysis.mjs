#!/usr/bin/env node
/**
 * T-20260710-foot-SECDEF-ANON-REVOKE — anon 실사용 함수 정밀 대조 (READ-ONLY).
 * 현 prod anon-EXECUTE 33개 각각에 대해 pg_stat_statements(rolname=anon) 호출수 대조.
 * 회수 안전 여부 판정용. prod 무변경.
 */
import { q } from './dryrun_lib.mjs';

// 현 prod anon-EXECUTE 33개 함수명 (proname)
const anonFuncs = await q(`
  SELECT DISTINCT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY p.proname;`);
const names = anonFuncs.map(r => r.proname);

// pg_stat_statements 에서 anon 이 각 함수명을 참조한 총 호출수 (query text LIKE 매칭)
const results = [];
for (const name of names) {
  const rows = await q(`
    SELECT COALESCE(sum(s.calls),0)::bigint AS calls,
           count(*) AS stmt_variants
    FROM pg_stat_statements s
    JOIN pg_roles r ON r.oid = s.userid
    WHERE r.rolname = 'anon' AND s.query ILIKE '%${name}%';`);
  results.push({ name, calls: Number(rows[0].calls), variants: Number(rows[0].stmt_variants) });
}

results.sort((a, b) => b.calls - a.calls);
console.log('===== anon-EXECUTE 33개 함수 × anon 실호출 (pg_stat_statements, ~89d) =====');
console.log('name'.padEnd(52), 'anon_calls', 'variants');
for (const r of results) {
  const flag = r.calls > 0 ? ' ★LIVE' : '';
  console.log(r.name.padEnd(52), String(r.calls).padStart(9), String(r.variants).padStart(6), flag);
}

const live = results.filter(r => r.calls > 0);
const idle = results.filter(r => r.calls === 0);
console.log('\nLIVE(anon 호출>0):', live.length, '| IDLE(호출 0):', idle.length);
console.log('LIVE 목록:', live.map(r => `${r.name}(${r.calls})`).join(', '));

// self-checkin/reservation 구조적 필수 함수 (앱 흐름 의존, 호출은 definer-chain 이라 stat 0 가능)
const structural = names.filter(n =>
  /^(fn_selfcheckin|self_checkin|reservation_to_checkin|batch_checkin|find_customer_by_phone|upsert_reservation_from_source|fn_reservation_dup_guard|fn_health_q|fn_dashboard_reissue|fn_check_in_slot_dwell|get_or_create_unified_customer_id|enqueue_dopamine_reschedule|get_today_reservations|next_queue_number|fn_prescreen_start|fn_complete_prescreen_checklist)/.test(n));
console.log('\n구조적 self-checkin/reservation/intake 관련 함수:', structural.length);
