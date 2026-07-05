/**
 * T-20260630-foot-REGISTER-MENU-CODY-UNLOCK — APPLY (신규등록 write-RLS 3역할 ADDITIVE)
 *
 * ★게이트 통과: data-architect CONSULT GO + supervisor DDL-diff GO (MSG-20260705-220549-jfll).
 *   verdict: GO. next_steps = ①suffix 제거 ②apply ③QA(3역할 insert 성공 + admin/manager/director 무회귀).
 *
 * 대상 마이그 = 20260630210000_register_unlock_3roles_rls_additive.sql
 *   ADDITIVE INSERT 정책 3개 신규:
 *     customers_register_unlock_insert / reservations_register_unlock_insert / check_ins_register_unlock_insert
 *   role = {consultant, coordinator, therapist}, WITH CHECK = is_approved_user() AND clinic_id=current_user_clinic_id().
 *   기존 정책 무변경(DROP 0, 회수 0). therapist 가 실 net-new 수혜.
 *
 * 롤백: supabase/migrations/20260630210000_register_unlock_3roles_rls_additive.rollback.sql
 *
 * 본 스크립트: pre-snapshot(DDL-diff BEFORE) → apply → post-snapshot(AFTER) → 구조검증
 *   (멱등: 마이그 자체가 DROP IF EXISTS + CREATE).
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const TABLES = ['customers', 'reservations', 'check_ins'];
const POL_SQL = `
  SELECT tablename, policyname, cmd, roles::text AS roles, with_check AS check_expr
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('customers','reservations','check_ins')
  ORDER BY tablename, policyname;`;

const norm = (r) => (Array.isArray(r) ? r : r.result ?? r);
const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.check_expr) console.log(`      WITH CHECK: ${(r.check_expr || '').replace(/\s+/g, ' ')}`);
  }
};

// ── 0) PRE-SNAP (DDL-diff BEFORE) ──────────────────────────────
console.log(`✅ APPLY  T-20260630-foot-REGISTER-MENU-CODY-UNLOCK  ${new Date().toISOString()}`);
const before = norm(await q(POL_SQL));
dump(before, '적용 전 pg_policies (DDL-diff BEFORE)');
const NEW_POLS = [
  'customers_register_unlock_insert',
  'reservations_register_unlock_insert',
  'check_ins_register_unlock_insert',
];
const beforeCount = before.length;
console.log(`\n  적용 전 정책 총 ${beforeCount}개. 신규 대상 존재여부: ` +
  NEW_POLS.map((p) => `${p}=${before.some((r) => r.policyname === p) ? '있음(멱등)' : '없음(신규)'}`).join(' / '));

// ── 1) APPLY — 마이그 파일 그대로 ──────────────────────────────
const MIG = 'supabase/migrations/20260630210000_register_unlock_3roles_rls_additive.sql';
try {
  await q(fs.readFileSync(MIG, 'utf8'));
  console.log(`\n✅ 마이그 실행 완료: ${MIG}`);
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  process.exit(1);
}

// ── 2) POST-SNAP + 구조검증 (DDL-diff AFTER) ───────────────────
const after = norm(await q(POL_SQL));
dump(after, '적용 후 pg_policies (DDL-diff AFTER)');

const ROLE3 = ['consultant', 'coordinator', 'therapist'];
const hasAll = (s, roles) => roles.every((x) => new RegExp(`'${x}'`).test(s || ''));
const clinicGuard = (s) => /clinic_id\s*=\s*current_user_clinic_id\(\)/.test(s || '');
const approvedGuard = (s) => /is_approved_user\(\)/.test(s || '');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 구조검증 (DDL-diff AFTER / ADDITIVE 정합) ──');

for (const pol of NEW_POLS) {
  const p = after.find((r) => r.policyname === pol);
  chk(`${pol} 존재 + cmd=INSERT`, p && p.cmd === 'INSERT');
  chk(`  ${pol} role={consultant,coordinator,therapist} 정확`, p && hasAll(p.check_expr, ROLE3));
  chk(`  ${pol} clinic isolation 유지 (clinic_id=current_user_clinic_id())`, p && clinicGuard(p.check_expr));
  chk(`  ${pol} is_approved_user() 게이트 유지`, p && approvedGuard(p.check_expr));
}

// ADDITIVE 무회귀: 적용 전 정책이 하나도 사라지지 않았는지 (기존 admin/manager/director/coordinator write 보존)
const removed = before.filter((b) => !after.some((a) => a.tablename === b.tablename && a.policyname === b.policyname));
chk(`★ADDITIVE 무회귀 — 적용 전 정책 삭제 0건 (삭제=${removed.length}건)`, removed.length === 0);
if (removed.length) removed.forEach((r) => console.log(`      ⚠ 삭제됨: ${r.tablename}.${r.policyname}`));
chk(`★신규 정책 3개 정확히 추가 (before ${beforeCount} → after ${after.length})`, after.length === beforeCount + NEW_POLS.filter((p) => !before.some((r) => r.policyname === p)).length);

console.log(`\n${pass ? '✅ ALL PASS — 3역할 신규등록 write-RLS ADDITIVE 정합 (therapist net-new, clinic isolation 유지)' : '❌ FAIL — 검증 항목 확인'}`);
process.exit(pass ? 0 : 1);
