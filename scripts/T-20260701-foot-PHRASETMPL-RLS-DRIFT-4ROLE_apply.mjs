/**
 * T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE — APPLY (shape ii · 단일 통합정책 · 영속)
 *
 * ★정본 = DA CONSULT-REPLY MSG-20260701-102953-2k2i (DA-20260701-PHRASETMPL-RLS-4ROLE, shape ii).
 *   앞선 f5k2(10:23:54, shape i=20260620120000 재적용)는 2k2i가 명시 반려 + staff_write 재apply 금지.
 *   → shape(i) 아티팩트 deploy VOID. 본 스크립트는 신규 통합 마이그를 forward apply.
 *
 * 대상 마이그 = 20260701040000_phrase_templates_staffarea_write_7role_unified.sql
 *   정책 staffarea_write_phrases (7역할 {admin,manager,consultant,coordinator,therapist,part_lead,staff},
 *   FOR ALL, phrase_type IN(pen_chart,customer_chart) USING+WITH CHECK 가드).
 *   ★20260620120000(shape i staff_write) / 20260701030000(coordinator sibling) 재apply 불사용·흡수·폐기.
 *   admin_write_phrase_templates {admin,manager,director} 무접촉(ADDITIVE).
 *
 * ⚠ APPLY 게이트: DA GO(✅) + supervisor DDL-diff 5-check GO 선행 후에만 실행.
 *   5-check: ①role=7 정확 ②USING+WITH CHECK 양쪽 phrase_type 가드 ③admin_write 무변경
 *            ④sibling 20260701030000 미포함 ⑤staff역할 medical_chart 쓰기 불가.
 *   본 스크립트는 pre-snapshot → apply → post-snapshot → 5-check 구조검증을 self-contained 수행
 *   (멱등: superseded DROP IF EXISTS + staffarea_write_phrases DROP IF EXISTS+CREATE).
 *
 * 롤백: supabase/migrations/20260701040000_phrase_templates_staffarea_write_7role_unified.rollback.sql
 *   (DROP POLICY staffarea_write_phrases → effective write = {admin,manager,director} 원복).
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
  SELECT policyname, cmd, roles::text AS roles, qual AS using_expr, with_check AS check_expr
  FROM pg_policies WHERE schemaname='public' AND tablename='phrase_templates'
  ORDER BY policyname;`;

const norm = (r) => (Array.isArray(r) ? r : r.result ?? r);
const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  phrase_templates.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.using_expr) console.log(`      USING: ${(r.using_expr || '').replace(/\s+/g, ' ')}`);
    if (r.check_expr) console.log(`      WITH CHECK: ${(r.check_expr || '').replace(/\s+/g, ' ')}`);
  }
};

// ── 0) PRE-SNAP (DDL-diff before) ──────────────────────────────
console.log(`✅ APPLY  T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE shape(ii)  ${new Date().toISOString()}`);
const beforeRows = norm(await q(POL_SQL));
dump(beforeRows, '적용 전 pg_policies (DDL-diff BEFORE)');
const hadUnified = beforeRows.some((r) => r.policyname === 'staffarea_write_phrases');
const hadStaffShapeI = beforeRows.some((r) => r.policyname === 'staff_write_staffarea_phrases');
const hadCodySibling = beforeRows.some((r) => r.policyname === 'coordinator_write_staffarea_phrases');
console.log(`\n  적용 전: staffarea_write_phrases ${hadUnified ? '있음(멱등 재적용)' : '없음(신규)'} / ` +
  `staff_write_staffarea_phrases(shape i) ${hadStaffShapeI ? '있음(DROP 예정)' : '없음(DRIFT 정상)'} / ` +
  `coordinator sibling ${hadCodySibling ? '있음(DROP 예정)' : '없음(미apply 정상)'}`);

// ── 1) APPLY — 신규 통합 마이그 파일 그대로 ────────────────────
const MIG = 'supabase/migrations/20260701040000_phrase_templates_staffarea_write_7role_unified.sql';
try {
  await q(fs.readFileSync(MIG, 'utf8'));
  console.log(`\n✅ 마이그 실행 완료: ${MIG}`);
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  process.exit(1);
}

// ── 2) POST-SNAP + supervisor 5-check 구조검증 (DDL-diff after / 영속) ─
const after = norm(await q(POL_SQL));
dump(after, '적용 후 pg_policies (DDL-diff AFTER, 영속)');

const uni = after.find((r) => r.policyname === 'staffarea_write_phrases');
const admin = after.find((r) => r.policyname === 'admin_write_phrase_templates');
const staffI = after.find((r) => r.policyname === 'staff_write_staffarea_phrases');
const cody = after.find((r) => r.policyname === 'coordinator_write_staffarea_phrases');
const ROLE7 = ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'];
const guard = (s) => /pen_chart/.test(s || '') && /customer_chart/.test(s || '') && !/medical_chart/.test(s || '');
const hasAll = (s, roles) => roles.every((x) => new RegExp(`'${x}'`).test(s || ''));
// role=7 정확 = 7역할 전부 존재 + director 부재(의사영역 격리)
const exactly7 = (s) => hasAll(s, ROLE7) && !/'director'/.test(s || '');

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── supervisor DDL-diff 5-check (영속 회귀가드) ──');
chk('staffarea_write_phrases 존재 + cmd=ALL', uni && uni.cmd === 'ALL');
chk('①role=7 정확 = {admin,manager,consultant,coordinator,therapist,part_lead,staff} + director 부재',
  uni && exactly7(uni.using_expr) && exactly7(uni.check_expr));
chk('②USING 양쪽 phrase_type 가드 (pen/customer, no medical)', uni && guard(uni.using_expr));
chk('②WITH CHECK 양쪽 phrase_type 가드 (pen/customer, no medical) — 변조 hole 차단', uni && guard(uni.check_expr));
chk('③admin_write_phrase_templates 무변경 = {admin,manager,director}',
  admin && hasAll(admin.using_expr, ['admin', 'manager', 'director']));
chk('④sibling 20260701030000 미포함 — coordinator_write_staffarea_phrases 부재(흡수·폐기)', !cody);
chk('★shape(i) staff_write_staffarea_phrases 부재(재apply 불사용·흡수)', !staffI);
chk('★coordinator 이중정책 부재 — coordinator는 staffarea_write_phrases 단일정책에만 등장', !cody);

console.log('\n  ⑤staff역할 medical_chart 쓰기 불가 = phrase_type 가드(USING+WITH CHECK)로 구조 보장 → 침투테스트(AC-4)에서 토큰 재현.');
console.log('  FE parity: PHRASE_STAFFAREA_EDIT_ROLES(7역할) = staffarea_write_phrases role set 1:1. director medical write = admin_write 보존.');
console.log(`\n${pass ? '✅ ALL PASS — shape(ii) 통합정책 정합 (drift 복구 + 7역할 FE 정합)' : '❌ FAIL — 검증 항목 확인'}`);
process.exit(pass ? 0 : 1);
