/**
 * T-20260630-foot-STAFFCRUD-CODY-PERM — APPLY (staff 로스터 write-RLS coordinator ADDITIVE)
 *
 * ★게이트 통과: data-architect CONSULT GO (DA-20260701-STAFFCRUD-CODY, ADDITIVE 저위험, 대표게이트 불요)
 *   + supervisor FIX-REQUEST MSG-20260710-120837-0upo ("PROD RLS 적용은 dev 책임 범위" 위임).
 *
 * 대상 마이그 = 20260630220000_staff_coordinator_crud_rls_additive.sql
 *   ADDITIVE 정책 2개 신규:
 *     staff_coordinator_insert_staffcrud [INSERT] / staff_coordinator_update_staffcrud [UPDATE]
 *     role=coordinator, clinic-scoped(clinic_id=current_user_clinic_id()), 권한상승 가드(role<>'director').
 *   기존 정책 무변경(DROP 0, 회수 0). staff_admin_all / staff_approved_read 등 그대로.
 *
 * 롤백: supabase/migrations/20260630220000_staff_coordinator_crud_rls_additive.rollback.sql
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

const POL_SQL = `
  SELECT tablename, policyname, cmd, roles::text AS roles, qual AS using_expr, with_check AS check_expr
  FROM pg_policies
  WHERE schemaname='public' AND tablename='staff'
  ORDER BY policyname;`;

const norm = (r) => (Array.isArray(r) ? r : r.result ?? r);
const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.using_expr) console.log(`      USING:      ${(r.using_expr || '').replace(/\s+/g, ' ')}`);
    if (r.check_expr) console.log(`      WITH CHECK: ${(r.check_expr || '').replace(/\s+/g, ' ')}`);
  }
};

const NEW_POLS = ['staff_coordinator_insert_staffcrud', 'staff_coordinator_update_staffcrud'];

// ── 0) PRE-SNAP (DDL-diff BEFORE) ──────────────────────────────
console.log(`✅ APPLY  T-20260630-foot-STAFFCRUD-CODY-PERM  ${new Date().toISOString()}`);
const before = norm(await q(POL_SQL));
dump(before, '적용 전 pg_policies (DDL-diff BEFORE)');
console.log(`\n  적용 전 staff 정책 총 ${before.length}개. 신규 대상 존재여부: ` +
  NEW_POLS.map((p) => `${p}=${before.some((r) => r.policyname === p) ? '있음(멱등)' : '없음(신규)'}`).join(' / '));

// ── 1) APPLY — 마이그 파일 그대로 ──────────────────────────────
const MIG = 'supabase/migrations/20260630220000_staff_coordinator_crud_rls_additive.sql';
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

const coordGuard = (s) => /current_user_role\(\)\s*=\s*'coordinator'/.test(s || '');
const clinicGuard = (s) => /clinic_id\s*=\s*current_user_clinic_id\(\)/.test(s || '');
const dirGuard = (s) => /role\s*<>\s*'director'/.test(s || '');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 구조검증 (DDL-diff AFTER / ADDITIVE 정합) ──');

const ins = after.find((r) => r.policyname === 'staff_coordinator_insert_staffcrud');
chk('staff_coordinator_insert_staffcrud 존재 + cmd=INSERT', ins && ins.cmd === 'INSERT');
chk('  INSERT coordinator role gate', ins && coordGuard(ins.check_expr));
chk('  INSERT clinic isolation (clinic_id=current_user_clinic_id())', ins && clinicGuard(ins.check_expr));
chk('  INSERT 권한상승 가드 (role<>director)', ins && dirGuard(ins.check_expr));

const upd = after.find((r) => r.policyname === 'staff_coordinator_update_staffcrud');
chk('staff_coordinator_update_staffcrud 존재 + cmd=UPDATE', upd && upd.cmd === 'UPDATE');
chk('  UPDATE coordinator role gate (USING+CHECK)', upd && coordGuard(upd.using_expr) && coordGuard(upd.check_expr));
chk('  UPDATE clinic isolation (USING+CHECK)', upd && clinicGuard(upd.using_expr) && clinicGuard(upd.check_expr));
chk('  UPDATE 권한상승 가드 (role<>director, USING+CHECK)', upd && dirGuard(upd.using_expr) && dirGuard(upd.check_expr));

// ── 3) 무회귀: 기존 정책 보존 (ADDITIVE 불변식) ─────────────────
console.log('\n── 무회귀 (기존 정책 보존, ADDITIVE) ──');
const preNonTarget = before.filter((r) => !NEW_POLS.includes(r.policyname)).map((r) => r.policyname).sort();
const postNonTarget = after.filter((r) => !NEW_POLS.includes(r.policyname)).map((r) => r.policyname).sort();
chk('기존(비대상) 정책 집합 무변경 (DROP 0, 회수 0)',
  JSON.stringify(preNonTarget) === JSON.stringify(postNonTarget));
chk('staff_admin_all 보존', postNonTarget.includes('staff_admin_all'));
chk(`정책 총수 = before(${before.length}) + 2 = ${before.length + 2}`, after.length === before.length + 2);

console.log(`\n${pass ? '✅ ALL PASS — coordinator INSERT/UPDATE 2정책 ADDITIVE 실재 확인, 기존 무회귀.' : '❌ FAIL — 위 항목 점검'}`);
process.exit(pass ? 0 : 1);
