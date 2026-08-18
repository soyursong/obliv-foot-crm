#!/usr/bin/env node
/**
 * T-20260818-foot-STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT — READ-ONLY 진단
 *
 * 목적:
 *  (1) TmAggregate 3쿼리(registered/scheduled/visited) 실측 timing (17d + 30d 범위)
 *  (2) 스캔 대상 규모(clinic 별 reservations/check_ins 총행수)
 *  (3) created_at / created_date 인덱스 커버리지 (pg_indexes)
 *  (4) EXPLAIN (ANALYZE OFF) 플랜 — seq scan vs index scan 판별
 *  (5) 현 시점 DB compute 포화 상태 (pg_stat_statements storage.search top)
 *
 * PHI 미조회 — count/plan/index 메타만. 파괴적 조치 0.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_ = g('VITE_SUPABASE_URL');
const SR = g('SUPABASE_SERVICE_ROLE_KEY');
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const admin = createClient(URL_, SR, { auth: { persistSession: false } });
console.log('=== project ref:', REF, '(expect rxlomoozakkjesdqjtvd) ===\n');

const ro = async (q) => {
  const { data, error } = await admin.rpc('exec_sql_readonly', { q });
  if (error) return { err: error.message || String(error) };
  return { data };
};

// clinic = 종로 풋
const { data: clinics } = await admin.from('clinics').select('id, slug, name');
console.log('[clinics]', JSON.stringify(clinics));
const clinic = (clinics || []).find(c => /jongno|종로|foot/i.test(`${c.slug} ${c.name}`)) || (clinics || [])[0];
const CLINIC = clinic?.id;
console.log('→ target clinic:', CLINIC, clinic?.slug, clinic?.name, '\n');

const resSelect = 'id, reservation_date, reservation_time, created_at, created_by, status, referral_source, source_system, registrar_name, customers(name, phone)';

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const { data, error } = await fn();
    const ms = Date.now() - t0;
    if (error) { console.log(`  ${label}: ERROR ${ms}ms — code=${error.code} ${error.message}`); return; }
    console.log(`  ${label}: ${ms}ms rows=${(data||[]).length}`);
  } catch (e) {
    console.log(`  ${label}: THROW ${Date.now()-t0}ms — ${e.message}`);
  }
}

async function runRange(from, to) {
  console.log(`\n=== RANGE ${from} ~ ${to} (client PostgREST 실측) ===`);
  await timed('A registered(created_at)+customers embed', () => admin.from('reservations')
    .select(resSelect).eq('clinic_id', CLINIC)
    .gte('created_at', `${from}T00:00:00+09:00`).lte('created_at', `${to}T23:59:59+09:00`).range(0, 999));
  await timed('A2 registered NO-embed (lean)', () => admin.from('reservations')
    .select('id, reservation_date, reservation_time, created_at, created_by, status, referral_source, source_system, registrar_name')
    .eq('clinic_id', CLINIC)
    .gte('created_at', `${from}T00:00:00+09:00`).lte('created_at', `${to}T23:59:59+09:00`).range(0, 999));
  await timed('B scheduled(reservation_date)+embed', () => admin.from('reservations')
    .select(resSelect).eq('clinic_id', CLINIC)
    .gte('reservation_date', from).lte('reservation_date', to).range(0, 999));
  await timed('C visited(check_ins created_date)+embed', () => admin.from('check_ins')
    .select('id, reservation_id, created_date, checked_in_at, status, customers(name)')
    .eq('clinic_id', CLINIC).is('deleted_at', null).neq('status', 'cancelled')
    .gte('created_date', from).lte('created_date', to).range(0, 999));
}

await runRange('2026-08-01', '2026-08-17'); // 17d (보고 재현)
await runRange('2026-07-01', '2026-08-17'); // ~48d 회귀

// 스캔 규모
console.log('\n=== 스캔 규모 (clinic 총행수) ===');
for (const [t] of [['reservations'], ['check_ins']]) {
  const { count } = await admin.from(t).select('id', { count: 'exact', head: true }).eq('clinic_id', CLINIC);
  console.log(`  ${t}: clinic 행수 = ${count}`);
}

// 인덱스 커버리지
console.log('\n=== 인덱스 (reservations / check_ins) ===');
const idx = await ro(`select tablename, indexname, indexdef from pg_indexes where tablename in ('reservations','check_ins') order by tablename, indexname`);
if (idx.err) console.log('  idx err:', idx.err);
else (idx.data || []).forEach(r => console.log(`  ${r.tablename}.${r.indexname}: ${r.indexdef}`));

// EXPLAIN 플랜 (ANALYZE OFF — 비파괴)
console.log('\n=== EXPLAIN (registered created_at 필터) ===');
const ex1 = await ro(`explain select id from reservations where clinic_id='${CLINIC}' and created_at >= '2026-08-01T00:00:00+09:00' and created_at <= '2026-08-17T23:59:59+09:00'`);
console.log(ex1.err ? '  '+ex1.err : (ex1.data||[]).map(r=>'  '+Object.values(r)[0]).join('\n'));
console.log('\n=== EXPLAIN (visited created_date 필터) ===');
const ex2 = await ro(`explain select id from check_ins where clinic_id='${CLINIC}' and deleted_at is null and status <> 'cancelled' and created_date >= '2026-08-01' and created_date <= '2026-08-17'`);
console.log(ex2.err ? '  '+ex2.err : (ex2.data||[]).map(r=>'  '+Object.values(r)[0]).join('\n'));

// DB compute 포화 상태 (NEWRESV RC 재확인)
console.log('\n=== DB compute 포화 재확인 (pg_stat_statements top by total_exec_time) ===');
const pss = await ro(`select left(query,60) q, calls, round(total_exec_time/1000.0) tot_s, round(mean_exec_time) mean_ms from pg_stat_statements order by total_exec_time desc limit 8`);
console.log(pss.err ? '  '+pss.err : (pss.data||[]).map(r=>`  ${r.tot_s}s tot | ${r.calls} calls | ${r.mean_ms}ms mean | ${r.q}`).join('\n'));

console.log('\n=== 현재 statement_timeout 설정 ===');
const st = await ro(`select rolname, rolconfig from pg_roles where rolname in ('authenticated','anon','service_role')`);
console.log(st.err ? '  '+st.err : JSON.stringify(st.data));

console.log('\nDONE.');
