// RC 진단 probe (READ-ONLY) — T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL
// service_role 컨텍스트(진단 인증컨텍스트 표준: introspection = service_role, RLS 0-row 오독 방지).
// 어떤 write 도 하지 않음. F-5294 3지점 대조 + 구조적 폴백 영향범위 count.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
console.log('[ctx] url=', URL_, ' key=service_role(len ' + (KEY?.length ?? 0) + ')');
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

// deriveConsultAxis 복제(src/lib/autoAssign.ts:131 현행)
const CONSULT_AXES = ['TM', '인바운드', '워크인'];
function deriveConsultAxis(c) {
  if (c.visit_type === 'returning') return 'returning';
  const raw = (c.visit_route ?? c.lead_source ?? '').trim();
  if (CONSULT_AXES.includes(raw)) return raw;
  return '워크인';
}

// ── 1) F-5294 3지점 대조 ─────────────────────────────────────────
console.log('\n===== [1] F-5294 SSOT 원본 대조 =====');
const { data: cust, error: cErr } = await db
  .from('customers')
  .select('id, name, chart_number, visit_type, lead_source, visit_route, assigned_staff_id, clinic_id')
  .eq('chart_number', 'F-5294');
if (cErr) console.log('customers err:', cErr.message);
console.log('customers rows:', JSON.stringify(cust, null, 2));

let target = (cust ?? [])[0];
// chart_number 형식이 다를 수 있어 5294 부분매칭도 시도
if (!target) {
  const { data: alt } = await db
    .from('customers')
    .select('id, name, chart_number, visit_type, lead_source, visit_route, clinic_id')
    .ilike('chart_number', '%5294%');
  console.log('ilike %5294% rows:', JSON.stringify(alt, null, 2));
  target = (alt ?? [])[0];
}
// 이름 권선제로도 조회
const { data: byName } = await db
  .from('customers')
  .select('id, name, chart_number, visit_type, lead_source, visit_route, clinic_id')
  .eq('name', '권선제');
console.log('name=권선제 rows:', JSON.stringify(byName, null, 2));

const cand = target ?? (byName ?? [])[0];
if (cand) {
  console.log('\n[F-5294 파생 시뮬]');
  console.log('  DB SSOT  visit_route=', JSON.stringify(cand.visit_route),
    ' lead_source=', JSON.stringify(cand.lead_source),
    ' visit_type=', JSON.stringify(cand.visit_type));
  const axis = deriveConsultAxis(cand);
  console.log('  → deriveConsultAxis =', JSON.stringify(axis), ' (Slack 발송 라벨)');
  // 관련 check_ins
  const { data: cis } = await db
    .from('check_ins')
    .select('id, customer_name, status, consultant_id, consult_notify_status, checked_in_at, visit_type')
    .eq('customer_id', cand.id)
    .order('checked_in_at', { ascending: false })
    .limit(5);
  console.log('  최근 check_ins:', JSON.stringify(cis, null, 2));
}

// ── 2) 구조적 폴백 영향범위 (visit_route/lead_source distinct) ──────
console.log('\n===== [2] 유입경로 원본값 분포 (전체 customers) =====');
const { data: allCust, error: aErr } = await db
  .from('customers')
  .select('visit_route, lead_source, visit_type')
  .limit(50000);
if (aErr) { console.log('allCust err:', aErr.message); }
else {
  const total = allCust.length;
  const dist = {};
  let miscoded = 0, returningN = 0, correct = 0;
  const miscodedByRaw = {};
  for (const c of allCust) {
    const raw = (c.visit_route ?? c.lead_source ?? '').trim() || '(빈값)';
    dist[raw] = (dist[raw] ?? 0) + 1;
    if (c.visit_type === 'returning') { returningN++; continue; }
    const axis = deriveConsultAxis(c);
    const realRaw = (c.visit_route ?? c.lead_source ?? '').trim();
    if (axis === '워크인' && realRaw !== '워크인') {
      // 워크인이 아닌데 워크인으로 접힌 케이스 = 오표기 후보
      miscoded++;
      miscodedByRaw[realRaw || '(빈값)'] = (miscodedByRaw[realRaw || '(빈값)'] ?? 0) + 1;
    } else if (CONSULT_AXES.includes(realRaw)) correct++;
  }
  console.log('total customers:', total);
  console.log('visit_type=returning:', returningN);
  console.log('\n원본 유입경로값 분포(desc):');
  Object.entries(dist).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log('\n>>> 구조적 오표기(비-워크인 원본 → "워크인" 발송) 후보 총:', miscoded);
  console.log('오표기 원본값별 count(desc):');
  Object.entries(miscodedByRaw).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
}
console.log('\n[done] READ-ONLY. no writes performed.');
