/**
 * T-20260525-foot-RESV-CHANGE-REASON
 * reservation_logs.change_reason TEXT NULL 컬럼 추가
 * Supabase Management API (service_role) 경유 직접 실행
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const PROJ_REF = 'rxlomoozakkjesdqjtvd';

const SQL = `
ALTER TABLE reservation_logs
  ADD COLUMN IF NOT EXISTS change_reason TEXT NULL;

COMMENT ON COLUMN reservation_logs.change_reason IS
  '예약 변경 사유 (optional) — T-20260525-foot-RESV-CHANGE-REASON';
`;

async function main() {
  console.log('▶ reservation_logs.change_reason 컬럼 추가 시작');

  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: SQL }),
    },
  );

  if (!resp.ok) {
    // Management API 미지원 시 supabase-js rpc fallback
    const { error } = await supabase.rpc('exec_sql', { sql: SQL }).maybeSingle();
    if (error) {
      // rpc 없으면 직접 raw query (service role)
      const res = await supabase
        .from('reservation_logs')
        .select('id')
        .limit(1);
      if (res.error) {
        console.error('❌ 연결 실패:', res.error.message);
        process.exit(1);
      }
      // 컬럼 추가는 Supabase SQL editor에서 수동 실행 필요
      console.warn('⚠️  Management API 미지원. 아래 SQL을 Supabase SQL Editor에서 실행하세요:');
      console.log(SQL);
      process.exit(0);
    }
  }

  const body = await resp.json().catch(() => null);
  console.log('응답:', JSON.stringify(body, null, 2));
  console.log('✅ 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
