/**
 * T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP — RLS 회귀 가드 (read-only 검증)
 *  Phase2 daily_room_status ADDITIVE 정책 apply 전/후 정합 검증.
 *  - apply 전: 기존 2 write 정책 무손상 + 신규 정책 부재 확인.
 *  - apply 후: 신규 staff_unlock 정책 존재 + 기존 정책 그대로(파괴변경 0) 확인.
 *  실행: SUPABASE_ACCESS_TOKEN=... node scripts/T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP_rls_guard.mjs
 */
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const b = await r.json();
  if (!r.ok) { throw new Error('query failed: ' + JSON.stringify(b)); }
  return b;
};

const pols = await q(`select policyname, cmd from pg_policies where schemaname='public' and tablename='daily_room_status' order by policyname`);
const names = pols.map(p => p.policyname);
console.log('daily_room_status write/all/select policies:', JSON.stringify(names));

// 파괴변경 가드: 기존 2 write 정책은 항상 존재해야 함 (apply 전후 불변).
const mustExist = ['daily_room_status_admin_manager_write', 'daily_room_status_staff_own_write'];
const missing = mustExist.filter(n => !names.includes(n));
if (missing.length) { console.error('❌ 파괴변경 감지 — 기존 정책 소실:', missing); process.exit(1); }
console.log('✅ 기존 2 write 정책 무손상(파괴변경 0)');

// ADDITIVE 정책 상태(존재 = apply 완료, 부재 = HOLD 상태).
const additive = 'daily_room_status_staff_unlock_6menu';
if (names.includes(additive)) {
  console.log('✅ ADDITIVE 정책 적용됨:', additive, '(coordinator/consultant/therapist clinic-격리 토글 허용)');
} else {
  console.log('ℹ️ ADDITIVE 정책 미적용(.DA_CONSULT_HOLD 대기 중):', additive);
}

// 음성 가드(제외3): 통계/매출/계정관리 surface 무회귀 — daily_room_status 와 무관, 토글 정책이
// user_profiles/payments/통계 테이블에 누출 안 됐는지 sanity (정책명 패리티만 확인).
const leak = await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename in ('user_profiles','payments') and policyname like '%room_status%'`);
if (leak[0].n !== 0) { console.error('❌ 토글 정책이 user_profiles/payments 로 누출'); process.exit(1); }
console.log('✅ 제외 surface(user_profiles/payments) 누출 0');
