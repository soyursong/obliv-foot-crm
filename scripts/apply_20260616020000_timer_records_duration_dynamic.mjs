/**
 * T-20260616-foot-LASER-TIMER-SETTING-CONNECT
 * timer_records.duration_minutes CHECK 완화: IN (5,15,20) → BETWEEN 1 AND 180
 * (비가열 레이저 타이머 시작 버튼을 클리닉 설정값으로 동적화하면서 비-기본값 삽입 거부 해소)
 *
 * 비파괴: 기존 행은 모두 5/15/20 (신규 범위 부분집합) → dry-run 으로 위반 행 0 확인 후 적용.
 * 실행: SUPABASE_ACCESS_TOKEN=xxx node scripts/apply_20260616020000_timer_records_duration_dynamic.mjs
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

const SQL_DRYRUN = `
SELECT COUNT(*) AS violating_rows
FROM public.timer_records
WHERE duration_minutes < 1 OR duration_minutes > 180;
`;

const SQL_DROP = `
ALTER TABLE public.timer_records
  DROP CONSTRAINT IF EXISTS timer_records_duration_minutes_check;
`;

const SQL_ADD = `
ALTER TABLE public.timer_records
  ADD CONSTRAINT timer_records_duration_minutes_check
  CHECK (duration_minutes BETWEEN 1 AND 180);
`;

const SQL_VERIFY = `
SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname = 'timer_records_duration_minutes_check'
  AND conrelid = 'public.timer_records'::regclass;
`;

async function run() {
  console.log('🚀 T-20260616 timer_records duration CHECK 완화 시작...');

  console.log('\n[1/4] dry-run — 신규 범위(1~180) 위반 행 확인...');
  const dry = await runQuery(SQL_DRYRUN, 'dryrun');
  const violating = Number(dry[0]?.violating_rows ?? 0);
  console.log(`  위반 행: ${violating}`);
  if (violating > 0) throw new Error(`❌ 위반 행 ${violating}건 — 데이터 정합 확인 후 재시도`);

  console.log('\n[2/4] 기존 CHECK 제약 제거...');
  await runQuery(SQL_DROP, 'drop');
  console.log('✅ 완료');

  console.log('\n[3/4] 신규 CHECK (BETWEEN 1 AND 180) 추가...');
  await runQuery(SQL_ADD, 'add');
  console.log('✅ 완료');

  console.log('\n[4/4] 검증...');
  const result = await runQuery(SQL_VERIFY, 'verify');
  const def = result[0]?.def ?? '(없음)';
  console.log(`  제약 정의: ${def}`);
  if (!/1 AND 180|>= 1.*<= 180/.test(def)) throw new Error('❌ 검증 실패 — 신규 제약 미반영');

  console.log('\n🎉 T-20260616 timer_records CHECK 완화 완료');
}

run().catch(err => {
  console.error('❌ 예외:', err.message);
  process.exit(1);
});
