/**
 * T-20260806-foot-ASSIGNLIST-PATIENT-VANISH-DIAG — READ-ONLY 진단 probe
 * 인증컨텍스트: service_role (RLS 우회) → 0-row = 진짜 부재(RLS 필터 아님).
 * write/DDL 없음. SELECT only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const log = (...a) => console.log(...a);
const J = (o) => JSON.stringify(o);

const TODAY = '2026-08-06';
const dayStart = `${TODAY}T00:00:00+09:00`;
const dayEnd = `${TODAY}T23:59:59+09:00`;

// ── 0) 고객 #F-5345 / 이돈우 식별 ──────────────────────────────
let cust = null;
{
  const byChart = await sb.from('customers').select('id,name,chart_number,clinic_id')
    .or('chart_number.eq.F-5345,chart_number.eq.5345,chart_number.eq.F5345');
  const byName = await sb.from('customers').select('id,name,chart_number,clinic_id')
    .eq('name', '이돈우');
  log('== [0] 고객 식별 ==');
  log('  by chart_number:', J(byChart.data), byChart.error ? `ERR ${byChart.error.message}` : '');
  log('  by name 이돈우 :', J(byName.data), byName.error ? `ERR ${byName.error.message}` : '');
  const cands = [...(byChart.data ?? []), ...(byName.data ?? [])];
  cust = cands.find((c) => c.name?.includes('이돈우')) ?? cands[0] ?? null;
  log('  → 선택 고객:', J(cust));
}

// ── 진이서 실장 staff 식별 ──────────────────────────────
{
  const st = await sb.from('staff').select('id,name,display_name,role,clinic_id,is_active')
    .or('name.ilike.%진이서%,display_name.ilike.%진이서%');
  log('\n== [staff] 진이서 실장 ==');
  log('  ', J(st.data), st.error ? `ERR ${st.error.message}` : '');
}

if (!cust) { log('\n[ABORT] 고객 미식별 — 이하 스킵'); process.exit(0); }

// ── 1) 저장 여부: 해당 고객 오늘 check_ins 전체 컬럼 ──────────────────────────────
{
  const ci = await sb.from('check_ins')
    .select('id,customer_id,customer_name,clinic_id,status,consultant_id,therapist_id,deleted_at,checked_in_at,consult_notify_status,visit_type,assignment_consult_type')
    .eq('customer_id', cust.id)
    .gte('checked_in_at', dayStart).lte('checked_in_at', dayEnd)
    .order('checked_in_at', { ascending: true });
  log('\n== [1] 저장여부 — #F-5345 오늘 check_ins (service_role, RLS 우회) ==');
  log('  rows:', ci.data?.length ?? 0, ci.error ? `ERR ${ci.error.message}` : '');
  for (const r of ci.data ?? []) log('  ', J(r));

  // 최근(오늘 아님 포함) 5건도 — 혹시 checked_in_at 밖에 있을 수 있음
  const recent = await sb.from('check_ins')
    .select('id,status,consultant_id,therapist_id,deleted_at,checked_in_at,consult_notify_status')
    .eq('customer_id', cust.id).order('checked_in_at', { ascending: false }).limit(5);
  log('  [최근 5건 참고]');
  for (const r of recent.data ?? []) log('  ', J(r));
}

// ── 2) 명단 조회 쿼리 재현 (FE '오늘 배정 현황' load 쿼리 라인 533~) ──
//     .not status in (done,cancelled) + deleted_at IS NULL. 이돈우가 배제되는지 + 어느 술어인지.
{
  const clinicId = cust.clinic_id;
  const listQ = await sb.from('check_ins')
    .select('id,customer_id,customer_name,status,consultant_id,therapist_id,deleted_at')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .gte('checked_in_at', dayStart)
    .not('status', 'in', '(done,cancelled)')
    .order('checked_in_at', { ascending: true });
  log('\n== [2] 명단 조회 재현 (오늘 배정 현황 load 쿼리) ==');
  log('  clinic_id:', clinicId, '· 반환 rows:', listQ.data?.length ?? 0, listQ.error ? `ERR ${listQ.error.message}` : '');
  const hit = (listQ.data ?? []).find((r) => r.customer_id === cust.id);
  log('  → #F-5345 명단 포함 여부:', hit ? `포함됨 ${J(hit)}` : '★배제됨(미노출)★');
}

// ── 3) 다수 여부 — 오늘 배정됐으나 명단 소실(cancelled/done/deleted) 건 스캔 ──
{
  const clinicId = cust.clinic_id;
  const assigned = await sb.from('check_ins')
    .select('id,customer_name,status,consultant_id,therapist_id,deleted_at,checked_in_at')
    .eq('clinic_id', clinicId)
    .gte('checked_in_at', dayStart).lte('checked_in_at', dayEnd)
    .or('consultant_id.not.is.null,therapist_id.not.is.null');
  const rows = assigned.data ?? [];
  const vanished = rows.filter((r) => r.deleted_at !== null || r.status === 'cancelled' || r.status === 'done');
  log('\n== [3] 다수 여부 — 오늘 배정된 건 중 명단 소실 조건(cancelled/done/deleted) ==');
  log('  오늘 배정건 총:', rows.length, '· 소실조건 해당:', vanished.length, assigned.error ? `ERR ${assigned.error.message}` : '');
  for (const r of vanished) log('  ', J(r));
  // status 분포
  const dist = {};
  for (const r of rows) dist[r.status] = (dist[r.status] ?? 0) + 1;
  log('  [오늘 배정건 status 분포]', J(dist));
  log('  [deleted_at set 건수]', rows.filter((r) => r.deleted_at !== null).length);
}

log('\n[DONE] read-only 진단 완료 — write/DDL 없음');
process.exit(0);
