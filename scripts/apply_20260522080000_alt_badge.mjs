/**
 * T-20260522-foot-ALT-BADGE
 * ALT 배지 시스템 DB 마이그레이션:
 *   (1) customers: alt_status, alt_detail, alt_activated_at
 *   (2) reservation_memo_history: is_pinned, pinned_at
 * 멱등: ADD COLUMN IF NOT EXISTS
 * 실행: SUPABASE_ACCESS_TOKEN=xxx node scripts/apply_20260522080000_alt_badge.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

const SQL_CUSTOMERS = `
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS alt_status        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alt_detail        text,
  ADD COLUMN IF NOT EXISTS alt_activated_at  timestamptz;
`;

const SQL_CUSTOMERS_COMMENT = `
COMMENT ON COLUMN customers.alt_status IS 'ALT(올트) 활성 여부 — 보험 반려 후 포돌로게+레이저 병행 대상자';
COMMENT ON COLUMN customers.alt_detail IS 'ALT 상세 설명';
COMMENT ON COLUMN customers.alt_activated_at IS 'ALT 최초 활성화 일시';
`;

const SQL_CUSTOMERS_IDX = `
CREATE INDEX IF NOT EXISTS idx_customers_alt_status
  ON customers(id)
  WHERE alt_status = true;
`;

const SQL_RMH = `
ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS is_pinned  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at  timestamptz;
`;

const SQL_RMH_COMMENT = `
COMMENT ON COLUMN reservation_memo_history.is_pinned IS '고객메모 상단 고정 여부';
COMMENT ON COLUMN reservation_memo_history.pinned_at IS '고정 설정 일시 (고정 해제 시 NULL)';
`;

const SQL_RMH_IDX = `
CREATE INDEX IF NOT EXISTS idx_rmh_customer_pinned
  ON reservation_memo_history(customer_id, is_pinned, created_at DESC)
  WHERE customer_id IS NOT NULL;
`;

const SQL_VERIFY = `
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='customers' AND column_name='alt_status') AS customers_alt_status,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='customers' AND column_name='alt_detail') AS customers_alt_detail,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='reservation_memo_history' AND column_name='is_pinned') AS rmh_is_pinned,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='reservation_memo_history' AND column_name='pinned_at') AS rmh_pinned_at;
`;

async function run() {
  console.log('🚀 T-20260522-foot-ALT-BADGE: DB 마이그레이션 시작...');

  console.log('\n[1/6] customers ALT 컬럼 추가...');
  await runQuery(SQL_CUSTOMERS, 'customers-alter');
  console.log('✅ customers ALT 컬럼 추가 완료');

  console.log('\n[2/6] customers 코멘트...');
  await runQuery(SQL_CUSTOMERS_COMMENT, 'customers-comment');
  console.log('✅ 코멘트 완료');

  console.log('\n[3/6] customers 인덱스...');
  await runQuery(SQL_CUSTOMERS_IDX, 'customers-idx');
  console.log('✅ 인덱스 완료');

  console.log('\n[4/6] reservation_memo_history is_pinned 컬럼 추가...');
  await runQuery(SQL_RMH, 'rmh-alter');
  console.log('✅ reservation_memo_history 컬럼 추가 완료');

  console.log('\n[5/6] reservation_memo_history 코멘트+인덱스...');
  await runQuery(SQL_RMH_COMMENT, 'rmh-comment');
  await runQuery(SQL_RMH_IDX, 'rmh-idx');
  console.log('✅ 완료');

  console.log('\n[6/6] 검증...');
  const result = await runQuery(SQL_VERIFY, 'verify');
  const r = result[0];
  const ac1 = r.customers_alt_status === '1';
  const ac2 = r.customers_alt_detail === '1';
  const ac3 = r.rmh_is_pinned === '1';
  const ac4 = r.rmh_pinned_at === '1';

  console.log(`  customers.alt_status: ${ac1 ? '✅' : '❌'}`);
  console.log(`  customers.alt_detail: ${ac2 ? '✅' : '❌'}`);
  console.log(`  reservation_memo_history.is_pinned: ${ac3 ? '✅' : '❌'}`);
  console.log(`  reservation_memo_history.pinned_at: ${ac4 ? '✅' : '❌'}`);

  if (!ac1 || !ac2 || !ac3 || !ac4) {
    throw new Error('❌ 검증 실패');
  }

  console.log('\n🎉 T-20260522-foot-ALT-BADGE: 마이그레이션 완료');
}

run().catch(err => {
  console.error('❌ 예외:', err.message);
  process.exit(1);
});
