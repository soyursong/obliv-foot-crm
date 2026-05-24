/**
 * T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3/AC-5
 * daily_room_status.carry_over 컬럼 추가 + 인덱스
 * Supabase Management API (service_role) 경유 직접 실행
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const PROJ_REF = 'rxlomoozakkjesdqjtvd';

const SQL = `ALTER TABLE daily_room_status
  ADD COLUMN IF NOT EXISTS carry_over BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN daily_room_status.carry_over IS
  'T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3: false=당일 한정, true=활성화 전까지 유지';
CREATE INDEX IF NOT EXISTS daily_room_status_carry_over_idx
  ON daily_room_status (clinic_id, carry_over, is_active)
  WHERE carry_over = true;`;

console.log('🚀 carry_over 컬럼 추가 (T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3/AC-5)');

// Supabase Management API — /v1/projects/{ref}/database/query
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

if (!resp.ok) {
  const text = await resp.text();
  console.log(`⚠️  Management API 응답 ${resp.status}: ${text}`);
} else {
  const body = await resp.json();
  console.log('✅ Management API SQL 실행 결과:', JSON.stringify(body).slice(0, 200));
}

// 검증: carry_over 컬럼 존재 확인 (daily_room_status select)
const { data: sample, error: sampleErr } = await supabase
  .from('daily_room_status')
  .select('id, carry_over')
  .limit(1);

if (sampleErr) {
  console.error('❌ carry_over 컬럼 select 오류:', sampleErr.message);
  console.log('\n→ Supabase SQL Editor에서 수동 적용 필요:');
  console.log(SQL);
  process.exit(1);
}

console.log('✅ carry_over 컬럼 존재 확인 OK (sample rows:', sample?.length ?? 0, ')');
console.log('→ sample:', JSON.stringify(sample));
