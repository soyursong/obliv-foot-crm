/**
 * T-20260703-foot-JONGNO-ANON-PHI-LEAK-RLS-LOCKDOWN — full 2b PROD APPLY (파괴적)
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠ dev 단독 실행 금지. supervisor DDL-diff GO + DB-GATE + 최종 apply confirm 후에만 실행.
 *   forward = supabase/migrations/20260615180000_rls_clinic_isolation_anon_revoke.sql
 *   rollback = 동 .rollback.sql (emergency-restore 전용, 러너 자동적용 금지).
 * ════════════════════════════════════════════════════════════════════════════
 * 적용 내용(DROP POLICY×3 + REVOKE SELECT×3 + REVOKE ALL payments):
 *   DROP anon_select_customer_self_checkin(customers) / anon_checkin_read(check_ins)
 *      / anon_reservation_read(reservations)
 *   REVOKE SELECT customers/check_ins/reservations FROM anon + REVOKE ALL payments FROM anon
 * BEFORE/AFTER 스냅샷 + 신규 연결 영속 확인 + anon SELECT 차단 PASS 게이트.
 * 실행: SUPABASE_DB_PASSWORD=... node scripts/T-20260703-foot-ANON-PHI-2B-FULLCLOSE_prod_apply.mjs
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) P = m[1].trim(); }
if (!P) { console.error('SUPABASE_DB_PASSWORD 미설정 — 중단'); process.exit(2); }
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: P, ssl: { rejectUnauthorized: false } });

const TABLES = ['customers', 'check_ins', 'reservations', 'payments'];
const POLQ = `SELECT tablename, policyname FROM pg_policies
  WHERE schemaname='public' AND tablename = ANY($1)
    AND policyname IN ('anon_select_customer_self_checkin','anon_checkin_read','anon_reservation_read')
  ORDER BY tablename, policyname`;
const GRANTQ = `SELECT table_name, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='anon' AND table_name = ANY($1) ORDER BY table_name, privilege_type`;
const snap = async (c, label) => {
  console.log(`\n──── ${label} ────`);
  const pol = await c.query(POLQ, [TABLES]);
  console.log('  [anon SELECT 정책]', pol.rows.length ? pol.rows.map(r => `${r.tablename}.${r.policyname}`).join(', ') : '(없음)');
  const gr = await c.query(GRANTQ, [TABLES]);
  const bytab = {}; for (const r of gr.rows) (bytab[r.table_name] ??= []).push(r.privilege_type);
  for (const t of TABLES) console.log(`  [anon grant] ${t}: ${(bytab[t] || []).join(',') || '∅'}`);
  return { policies: pol.rows.map(r => `${r.tablename}.${r.policyname}`), grants: bytab };
};

const FWD = 'supabase/migrations/20260615180000_rls_clinic_isolation_anon_revoke.sql';
const sql = fs.readFileSync(FWD, 'utf8');

const c1 = conn();
try { await c1.connect(); } catch (e) { console.error('연결 실패', e.message); process.exit(2); }
console.log('연결 OK', new Date().toISOString());
const before = await snap(c1, 'BEFORE');

console.log(`\n──── APPLY forward (${FWD}) ────`);
try { await c1.query(sql); console.log('  ✅ forward 적용 완료 (파일 내장 COMMIT)'); }
catch (e) { console.error('  ❌ forward 실패:', e.message, '— 파일 BEGIN/COMMIT 트랜잭션 자동 롤백됨'); await c1.end(); process.exit(1); }
await c1.end();

// 신규 연결로 영속 검증
const c2 = conn(); await c2.connect();
const after = await snap(c2, 'AFTER (신규 연결, 영속 확인)');
await c2.end();

// PASS 게이트: 3 정책 소거 + anon SELECT grant 소거(customers/check_ins/reservations) + payments anon grant ∅
const polGone = after.policies.length === 0;
const selGone = ['customers', 'check_ins', 'reservations'].every(t => !(after.grants[t] || []).includes('SELECT'));
const payGone = (after.grants['payments'] || []).length === 0;
console.log('\n════ PASS 게이트 ════');
console.log(`  정책 3종 소거: ${polGone ? 'PASS' : 'FAIL — 잔존:' + after.policies.join(',')}`);
console.log(`  anon SELECT 소거(cust/ci/resv): ${selGone ? 'PASS' : 'FAIL'}`);
console.log(`  payments anon grant ∅: ${payGone ? 'PASS' : 'FAIL — 잔존:' + (after.grants['payments'] || []).join(',')}`);
const ok = polGone && selGone && payGone;
console.log(`\n결과: ${ok ? '✅ ALL PASS — anon PHI read 차단 영속' : '❌ FAIL — rollback.sql 검토'}`);
console.log('※ 후속: supervisor anon-key 재현 덤프 POSTCHECK(check_ins/reservations 403|0건) + 키오스크 실기기 회귀0.');
process.exit(ok ? 0 : 1);
