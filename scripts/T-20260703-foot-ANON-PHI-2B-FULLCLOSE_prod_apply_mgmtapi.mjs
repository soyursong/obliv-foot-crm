/**
 * T-20260703-foot-JONGNO-ANON-PHI-LEAK-RLS-LOCKDOWN — full 2b PROD APPLY (파괴적) · Management API 변형
 * ════════════════════════════════════════════════════════════════════════════
 * 원본 scripts/T-20260703-foot-ANON-PHI-2B-FULLCLOSE_prod_apply.mjs 는 pg 직결(SUPABASE_DB_PASSWORD).
 * 6/28 머신 이관 후 prod DB_PASSWORD 미보유 → Supabase Management API(/database/query,
 * SUPABASE_ACCESS_TOKEN)로 동일 로직 수행. forward SQL 파일·BEFORE/AFTER 스냅샷·PASS 게이트
 * 로직은 원본과 1:1 동치(전송 계층만 교체, 러너 아님). MEDCHART mgmtapi 변형 precedent 동일.
 * ⚠ supervisor DDL-diff GO + DB-GATE + 최종 apply confirm 후에만 실행(MSG-20260723-025217-8c5j GO).
 *   forward  = supabase/migrations/20260615180000_rls_clinic_isolation_anon_revoke.sql
 *   rollback = 동 .rollback.sql (emergency-restore 전용, 러너 자동적용 금지).
 * 적용 내용: DROP POLICY×3 + REVOKE SELECT×3(customers/check_ins/reservations) + REVOKE ALL payments.
 * BEFORE/AFTER 스냅샷 + 신규 mgmt 호출(=fresh conn) 영속 확인 + PASS 게이트 + anon-key POSTCHECK①.
 * 실행: node scripts/T-20260703-foot-ANON-PHI-2B-FULLCLOSE_prod_apply_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const readEnv = (f, k) => { if (!fs.existsSync(f)) return null; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(new RegExp('^' + k + '=(.*)$')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } return null; };
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN || readEnv('.env.local', 'SUPABASE_ACCESS_TOKEN');
const ANON = readEnv('.env.local', 'VITE_SUPABASE_ANON_KEY');
const URL = readEnv('.env.local', 'VITE_SUPABASE_URL') || `https://${REF}.supabase.co`;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미설정 — 중단'); process.exit(2); }
if (!ANON) { console.error('❌ VITE_SUPABASE_ANON_KEY 미설정 — POSTCHECK 불가·중단'); process.exit(2); }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

const TABLES = ['customers', 'check_ins', 'reservations', 'payments'];
const POLQ = `SELECT tablename, policyname FROM pg_policies
  WHERE schemaname='public' AND tablename = ANY(ARRAY['customers','check_ins','reservations','payments'])
    AND policyname IN ('anon_select_customer_self_checkin','anon_checkin_read','anon_reservation_read')
  ORDER BY tablename, policyname`;
const GRANTQ = `SELECT table_name, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='anon'
    AND table_name = ANY(ARRAY['customers','check_ins','reservations','payments'])
  ORDER BY table_name, privilege_type`;

const snap = async (label) => {
  console.log(`\n──── ${label} ────`);
  const pol = await q(POLQ);
  console.log('  [anon SELECT 정책]', pol.length ? pol.map(r => `${r.tablename}.${r.policyname}`).join(', ') : '(없음)');
  const gr = await q(GRANTQ);
  const bytab = {}; for (const r of gr) (bytab[r.table_name] ??= []).push(r.privilege_type);
  for (const t of TABLES) console.log(`  [anon grant] ${t}: ${(bytab[t] || []).join(',') || '∅'}`);
  return { policies: pol.map(r => `${r.tablename}.${r.policyname}`), grants: bytab };
};

// anon-key 재현 프로브 (count-only, PHI 미덤프) — POSTCHECK①
const anonProbe = async (tab) => {
  const rr = await fetch(`${URL}/rest/v1/${tab}?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact', Range: '0-0' },
  });
  return { tab, status: rr.status, cr: rr.headers.get('content-range') || '-' };
};
const anonDump = async (label) => {
  console.log(`\n──── anon-key 재현 (${label}) ────`);
  const out = {};
  for (const t of TABLES) { const p = await anonProbe(t); out[t] = p; console.log(`  ${t}: HTTP=${p.status} content-range=${p.cr}`); }
  return out;
};

const FWD = 'supabase/migrations/20260615180000_rls_clinic_isolation_anon_revoke.sql';
const sql = fs.readFileSync(FWD, 'utf8');

console.log('✅ Management API 연결 OK', new Date().toISOString());
const before = await snap('BEFORE');
const anonBefore = await anonDump('BEFORE');

console.log(`\n──── APPLY forward (${FWD}) ────`);
try { await q(sql); console.log('  ✅ forward 적용 완료 (파일 내장 BEGIN/COMMIT 원자 실행)'); }
catch (e) { console.error('  ❌ forward 실패:', e.message, '— 파일 BEGIN/COMMIT 트랜잭션 자동 롤백됨'); process.exit(1); }

// 신규 mgmt 호출(= fresh conn)로 영속 검증
const after = await snap('AFTER (신규 호출, 영속 확인)');

// PASS 게이트: 3 정책 소거 + anon SELECT grant 소거(cust/ci/resv) + payments anon grant ∅
const polGone = after.policies.length === 0;
const selGone = ['customers', 'check_ins', 'reservations'].every(t => !(after.grants[t] || []).includes('SELECT'));
const payGone = (after.grants['payments'] || []).length === 0;
console.log('\n════ PASS 게이트 (DDL) ════');
console.log(`  정책 3종 소거: ${polGone ? 'PASS' : 'FAIL — 잔존:' + after.policies.join(',')}`);
console.log(`  anon SELECT 소거(cust/ci/resv): ${selGone ? 'PASS' : 'FAIL'}`);
console.log(`  payments anon grant ∅: ${payGone ? 'PASS' : 'FAIL — 잔존:' + (after.grants['payments'] || []).join(',')}`);
const ddlOk = polGone && selGone && payGone;

// POSTCHECK① — anon-key 재현덤프: check_ins/reservations 차단(401/403 or 0건) + customers/payments 유지
const anonAfter = await anonDump('AFTER · POSTCHECK①');
const blocked = (p) => p.status === 401 || p.status === 403 || (p.cr && p.cr.endsWith('/0'));
const ciBlocked = blocked(anonAfter.check_ins);
const resvBlocked = blocked(anonAfter.reservations);
const custKept = anonAfter.customers.status === 401 || anonAfter.customers.status === 403;
const payKept = anonAfter.payments.status === 401 || anonAfter.payments.status === 403;
console.log('\n════ POSTCHECK① (anon-key 재현) ════');
console.log(`  check_ins 차단: ${ciBlocked ? 'PASS' : 'FAIL'} (${anonAfter.check_ins.status}/${anonAfter.check_ins.cr})`);
console.log(`  reservations 차단: ${resvBlocked ? 'PASS' : 'FAIL'} (${anonAfter.reservations.status}/${anonAfter.reservations.cr})`);
console.log(`  customers 유지차단: ${custKept ? 'PASS' : 'FAIL'} (${anonAfter.customers.status})`);
console.log(`  payments 유지차단: ${payKept ? 'PASS' : 'FAIL'} (${anonAfter.payments.status})`);
const postOk = ciBlocked && resvBlocked && custKept && payKept;

const ok = ddlOk && postOk;
console.log(`\n결과: ${ok ? '✅ ALL PASS — anon PHI read 차단 영속 + POSTCHECK① PASS' : '❌ FAIL — rollback.sql 검토'}`);
console.log('※ 잔여 POSTCHECK: ② LIVE 키오스크 실기기 실체크인 무회귀(write RPC primary) ③ admin/native 회귀0 — 현장/supervisor sufweb.');
process.exit(ok ? 0 : 1);
