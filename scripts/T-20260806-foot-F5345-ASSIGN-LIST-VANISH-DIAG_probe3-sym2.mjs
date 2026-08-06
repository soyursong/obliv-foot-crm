/**
 * T-20260806-foot-F5345-ASSIGN-LIST-VANISH-DIAG — 증상2 fold-in READ-ONLY probe
 * 목적: 증상2(2번 차트 담당자 등록 → 배정명단 미반영)가 증상1과 same-vs-distinct 인지
 *       코드경로 판정을 실데이터로 확증. write/DDL 없음. SELECT only. service_role(RLS 우회).
 *
 * 판정축:
 *   - 배정명단 membership = check_ins(deleted_at IS NULL, status NOT IN done/cancelled, today) 뿐.
 *   - 차트 '담당자 등록' 하향전파(updateTodayOpenCheckInConsultant)는
 *     당일-open check_in 이 있어야만 consultant_id 를 명단행에 실는다. 없으면 'none' → 명단 미반영.
 *   - 그러므로 증상2 = (2a) 당일 check_in 이 cancelled/soft-deleted 된 상태(=증상1과 동일 부패) 이거나
 *                     (2b) 당일-open check_in 이 애초에 없음(설계상 gap, P0 무관).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const J = (o) => JSON.stringify(o);
const TODAY = '2026-08-06';
const dayStart = `${TODAY}T00:00:00+09:00`;
const dayEnd = `${TODAY}T23:59:59+09:00`;

// 소실 클러스터(증상1) 고객들. 각 고객의 '현재' 당일 check_in 상태를 봐서
// 차트 담당자등록 하향전파가 명단에 실릴 수 있는지(=2a vs 2b) 판정.
const CLUSTER_CI = [
  'd68a3b77-e73e-4ce5-b5c6-8ff42e97cd45', // 이돈우
  'ae388cbb-bebb-4f4c-bbd0-0b5cb02899bf', // 지부환
  '604ab212-0c8f-4ea0-8cc2-44ca4ea850c5', // 신미수
  'dc572df0-1ab1-44cb-af6c-ce485ac0848c', // 정진아
];

// 1) 소실 클러스터 check_in → customer_id 매핑
const base = await sb.from('check_ins')
  .select('id,customer_id,customer_name,status,deleted_at,consultant_id')
  .in('id', CLUSTER_CI);
log('== [1] 소실 클러스터 check_in ==');
for (const r of base.data ?? []) log('  ', J(r));

const custIds = Array.from(new Set((base.data ?? []).map((r) => r.customer_id)));

// 2) 각 고객의 당일 최신 check_in (latestCheckIn 재현) + open 여부
log('\n== [2] 고객별 당일 최신 check_in 상태 (차트 담당자등록 하향전파 대상 판정) ==');
for (const cid of custIds) {
  const q = await sb.from('check_ins')
    .select('id,customer_name,status,deleted_at,consultant_id,checked_in_at')
    .eq('customer_id', cid)
    .gte('checked_in_at', dayStart).lte('checked_in_at', dayEnd)
    .order('checked_in_at', { ascending: false }).limit(3);
  const rows = q.data ?? [];
  const latest = rows[0] ?? null;
  // 하향전파 가능 = latest 가 today+open(status≠done,≠cancelled) → 그때만 명단행에 consultant 실림
  let verdict;
  if (!latest) verdict = '2b-DISTINCT: 당일 check_in 없음 → 차트 담당자등록 명단반영 불가(설계 gap, P0무관)';
  else if (latest.status === 'cancelled') verdict = '2a-SAME: 당일 최신 check_in=cancelled → 하향전파 none(증상1과 동일 부패)';
  else if (latest.status === 'done') verdict = '2b/보존: done → 하향전파 none(RED LINE 보존)';
  else if (latest.deleted_at) verdict = '2a-SAME: soft-deleted → 명단 read 배제(증상1과 동일)';
  else verdict = 'OK: 당일-open 존재 → 하향전파 명단반영 정상(미반영이면 별개 원인)';
  log(`  cust ${cid}: latest=${latest ? J(latest) : 'NONE'}`);
  log(`     → ${verdict}`);
}

log('\n[DONE] 증상2 fold-in read-only 판정 완료 — write/DDL 없음');
process.exit(0);
