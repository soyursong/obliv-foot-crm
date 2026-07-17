/**
 * T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — READ-ONLY 신원조회 (WRITE 0)
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/ALTER 일절 없음.
 *    AC-3(SET NULL) 재집행 절대 금지 — prod frozen 유지. freeze-divergence ABORT 승인됨.
 *    본 스크립트는 총괄 A/B 재confirm actionable화를 위한 신원 데이터만 산출.
 *
 * 조회 (planner FIX-REQUEST MSG-20260716-025610-btlp 원문 SELECT):
 *   clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' 에서
 *   designated_therapist_id NOT NULL 인 customers 전량
 *   → customer name + chart_number + therapist name + designated_therapist_id + updated_at
 *   (df380b13 포함, updated_at DESC)
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... node scripts/T-20260714-..._identity_readonly.mjs
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 1) designated_therapist_id NOT NULL 행 전량 (READ-ONLY)
const { data: custs, error: e1 } = await sb.from('customers')
  .select('id, name, chart_number, designated_therapist_id, updated_at')
  .eq('clinic_id', CLINIC)
  .not('designated_therapist_id', 'is', null)
  .order('updated_at', { ascending: false });

if (e1) { console.error('customers query error:', e1); process.exit(1); }

// 2) therapist(staff) 이름 조인 (READ-ONLY)
const tids = [...new Set((custs || []).map(c => c.designated_therapist_id))];
let staffMap = {};
if (tids.length) {
  const { data: staff, error: e2 } = await sb.from('staff')
    .select('id, name').in('id', tids);
  if (e2) { console.error('staff query error:', e2); process.exit(1); }
  staffMap = Object.fromEntries((staff || []).map(s => [s.id, s.name]));
}

const rows = (custs || []).map(c => ({
  customer_name: c.name,
  chart_number: c.chart_number,
  therapist_name: staffMap[c.designated_therapist_id] || '(staff not found)',
  designated_therapist_id: c.designated_therapist_id,
  customer_id: c.id,
  updated_at: c.updated_at,
}));

console.log('=== designated_therapist_id NOT NULL @ clinic 74967aea (READ-ONLY) ===');
console.log('실측 count:', rows.length);
console.log(JSON.stringify(rows, null, 2));

// df380b13 포커스
const focus = rows.find(r => (r.customer_id || '').startsWith('df380b13'));
console.log('\n=== df380b13 focus ===');
console.log(focus ? JSON.stringify(focus, null, 2) : '(df380b13 미발견)');
