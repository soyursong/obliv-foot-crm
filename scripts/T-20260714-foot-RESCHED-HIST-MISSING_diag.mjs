/**
 * T-20260714-foot-RESCHED-HIST-MISSING — 1차 진단 (READ-ONLY)
 *
 * 목적: 풋 자체 CRM 예약 날짜변경 시 reservation_logs 에 'reschedule' 이 남는지 재현/확인.
 * write 0. select 만 수행.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== T-20260714-foot-RESCHED-HIST-MISSING 진단 (READ-ONLY) ===');
console.log('실행시각:', new Date().toISOString());
console.log('URL:', env.VITE_SUPABASE_URL);

// 1) reservation_logs action 분포 (전체)
{
  const { data, error } = await sb.from('reservation_logs').select('action');
  if (error) { console.log('[1] action 분포 조회 오류:', error.message); }
  else {
    const dist = {};
    for (const r of data) dist[r.action] = (dist[r.action] ?? 0) + 1;
    console.log('\n[1] reservation_logs action 분포 (전체 %d건):', data.length, dist);
  }
}

// 2) 최근 reschedule 로그 15건 (최신순)
{
  const { data, error } = await sb.from('reservation_logs')
    .select('id, reservation_id, action, old_data, new_data, changed_by, created_at, change_reason')
    .eq('action', 'reschedule')
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) { console.log('[2] reschedule 로그 조회 오류:', error.message); }
  else {
    console.log('\n[2] 최근 reschedule 로그 %d건:', data.length);
    for (const r of data) {
      const od = r.old_data ?? {}, nd = r.new_data ?? {};
      const dateChanged = od.date !== nd.date;
      console.log(`  ${r.created_at} | resv=${String(r.reservation_id).slice(0,8)} | ${od.date} ${od.time} -> ${nd.date} ${nd.time} | 날짜변경=${dateChanged} | by=${r.changed_by ? String(r.changed_by).slice(0,8) : 'NULL'}`);
    }
  }
}

// 3) 최근 7일 reschedule 로그 중 실제 '날짜' 변경 건수 vs 시간만 변경
{
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data, error } = await sb.from('reservation_logs')
    .select('old_data, new_data, created_at')
    .eq('action', 'reschedule')
    .gte('created_at', since);
  if (error) { console.log('[3] 오류:', error.message); }
  else {
    let dateCh = 0, timeOnly = 0;
    for (const r of data) {
      const od = r.old_data ?? {}, nd = r.new_data ?? {};
      if (od.date !== nd.date) dateCh++; else timeOnly++;
    }
    console.log('\n[3] 최근 7일 reschedule %d건: 날짜변경 %d / 시간만 %d', data.length, dateCh, timeOnly);
  }
}

// 4) 최근 생성된 reservation_logs 20건 전체(액션 무관) — 로그 자체가 쌓이는지
{
  const { data, error } = await sb.from('reservation_logs')
    .select('action, created_at, changed_by')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.log('[4] 오류:', error.message); }
  else {
    console.log('\n[4] 최근 로그 20건(액션무관):');
    for (const r of data) console.log(`  ${r.created_at} | ${r.action} | by=${r.changed_by ? 'set' : 'NULL'}`);
  }
}

// 5) changed_by NULL 비율 (RLS/권한 힌트)
{
  const { count: total } = await sb.from('reservation_logs').select('id', { count: 'exact', head: true });
  const { count: nullBy } = await sb.from('reservation_logs').select('id', { count: 'exact', head: true }).is('changed_by', null);
  console.log('\n[5] changed_by NULL: %d / %d', nullBy, total);
}

console.log('\n=== 진단 종료 ===');
