// T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE — orphan 확인 (read-only)
// GO_WARN (a): 가열성레이저 슬롯 제거 시 현재 배정된 체크인/예약 orphan 점검
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1) 현재 체크인 중 laser_room='가열성레이저' (활성 동선)
const { data: ci, error: e1 } = await sb
  .from('check_ins')
  .select('id, status, laser_room, checked_in_at, customer_id')
  .eq('laser_room', '가열성레이저');
console.log('[1] check_ins.laser_room=가열성레이저:', e1?.message ?? `${ci.length}건`);
if (ci?.length) console.log('    상태분포:', ci.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), {}));

// 2) room_assignments room_type='heated_laser' (원장 배정)
const { data: ra, error: e2 } = await sb
  .from('room_assignments')
  .select('id, room_name, room_type, staff_name, assigned_date')
  .eq('room_type', 'heated_laser');
console.log('[2] room_assignments.room_type=heated_laser:', e2?.message ?? `${ra.length}건`);
if (ra?.length) console.log('    샘플:', ra.slice(0, 5));

// 3) check_in_room_logs room_type='heated_laser' (과거 동선 이력 — 차트 표시용)
const { data: rl, error: e3 } = await sb
  .from('check_in_room_logs')
  .select('id, room_type, assigned_room, logged_at')
  .eq('room_type', 'heated_laser');
console.log('[3] check_in_room_logs.room_type=heated_laser:', e3?.message ?? `${rl.length}건`);

// 4) reservations 중 가열성레이저 관련 (room/메모)
const { data: rv, error: e4 } = await sb
  .from('reservations')
  .select('id, room_type')
  .eq('room_type', 'heated_laser');
console.log('[4] reservations.room_type=heated_laser:', e4?.code === 'PGRST204' || e4?.message?.includes('column') ? 'N/A(컬럼없음)' : (e4?.message ?? `${rv?.length ?? 0}건`));

process.exit(0);
