/**
 * T-20260729-foot-ASSIGN-DUPASSIGN-NAMETRUNC — diagnosis probe (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT/GET 만. UPDATE/DELETE/ALTER 없음.
 *
 * 목적:
 *  Bug B(중복배정): F-5247(장홍석) 오늘 KST 배정 상태 — active check_ins 몇 건 / 각 consultant_id 누구 / customer_name 스냅샷.
 *  Bug A(성 누락): customers 성명 컬럼 실제 값(name/full_name/first_name) + check_ins.customer_name 값 대조.
 *
 * 실행: node scripts/T-20260729-foot-ASSIGN-DUPASSIGN-NAMETRUNC_diag.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env.local 파싱 (service_role)
const envTxt = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const line of envTxt.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('missing url/service key');
const sb = createClient(url, key, { auth: { persistSession: false } });

const CHART = 'F-5247';
const todayIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function log(t, o) { console.log(`\n=== ${t} ===`); console.log(JSON.stringify(o, null, 2)); }

// 0) customers 컬럼 실측 — F-5247 로 조회, 어떤 성명필드가 있는지
const { data: custAll, error: cErr } = await sb
  .from('customers')
  .select('*')
  .eq('chart_number', CHART);
if (cErr) { console.error('customers err', cErr); }
if (custAll?.length) {
  const c = custAll[0];
  log('0) customers row keys (성명 관련 필드 탐지)', Object.keys(c).filter(k => /name/i.test(k)));
  const nameFields = {};
  for (const k of Object.keys(c)) if (/name/i.test(k)) nameFields[k] = c[k];
  log('0b) F-5247 customers 성명필드 값', { id: c.id, chart_number: c.chart_number, ...nameFields, visit_type: c.visit_type, assigned_staff_id: c.assigned_staff_id });
}
const custId = custAll?.[0]?.id ?? null;

// 1) F-5247 오늘 KST active check_ins (Assignments 로직과 동일: deleted_at null, status not in done/cancelled)
const startKst = `${todayIso}T00:00:00+09:00`;
const { data: ciToday } = await sb
  .from('check_ins')
  .select('id, customer_id, customer_name, consultant_id, therapist_id, status, visit_type, checked_in_at, deleted_at')
  .eq('customer_id', custId)
  .gte('checked_in_at', startKst)
  .order('checked_in_at', { ascending: true });
log('1) F-5247 오늘 전체 check_ins (deleted 포함)', ciToday);

const activeToday = (ciToday ?? []).filter(c => c.deleted_at === null && !['done', 'cancelled'].includes(c.status));
log('1b) F-5247 오늘 ACTIVE(deleted_at null & status∉done/cancelled) — 배정팝업 후보', activeToday.map(c => ({
  id: c.id, customer_name: c.customer_name, consultant_id: c.consultant_id, therapist_id: c.therapist_id, status: c.status, visit_type: c.visit_type, checked_in_at: c.checked_in_at,
})));

// 1c) 당월 전체 (staffStats 는 monthCheckIns 기준 — 팝업의 실제 소스)
const monthStart = `${todayIso.slice(0, 7)}-01T00:00:00+09:00`;
const { data: ciMonth } = await sb
  .from('check_ins')
  .select('id, customer_name, consultant_id, therapist_id, status, visit_type, checked_in_at, deleted_at')
  .eq('customer_id', custId)
  .is('deleted_at', null)
  .gte('checked_in_at', monthStart)
  .order('checked_in_at', { ascending: true });
log('1c) F-5247 당월 check_ins (deleted_at null) — staffStats 소스', ciMonth);

// 2) 관련 staff 이름 매핑 (consultant_id → name)
const staffIds = [...new Set((ciMonth ?? []).flatMap(c => [c.consultant_id, c.therapist_id]).filter(Boolean))];
if (staffIds.length) {
  const { data: staffRows } = await sb.from('staff').select('id, name, role, active').in('id', staffIds);
  log('2) 관련 staff', staffRows);
}

// 3) 다른 오늘 초진 환자들의 customer_name 도 성 누락인지 표본 대조 (Bug A 국소성 판정)
const { data: sample } = await sb
  .from('check_ins')
  .select('customer_id, customer_name')
  .gte('checked_in_at', startKst)
  .is('deleted_at', null)
  .not('customer_name', 'is', null)
  .limit(20);
if (sample?.length) {
  const ids = [...new Set(sample.map(s => s.customer_id).filter(Boolean))];
  const { data: cs } = await sb.from('customers').select('id, name, chart_number').in('id', ids);
  const nmeMap = new Map((cs ?? []).map(c => [c.id, c.name]));
  log('3) 오늘 check_ins.customer_name vs customers.name 대조 (성누락 국소성)', sample.map(s => ({
    ci_customer_name: s.customer_name,
    customers_name: nmeMap.get(s.customer_id) ?? '(no cust)',
    mismatch: nmeMap.get(s.customer_id) && nmeMap.get(s.customer_id) !== s.customer_name,
  })));
}
console.log('\n=== DONE ===');
