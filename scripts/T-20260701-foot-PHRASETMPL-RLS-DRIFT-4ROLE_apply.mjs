/**
 * T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE — APPLY (drift 복구 · 영속)
 *
 * DA CONSULT-REPLY (MSG-20260701-102354-f5k2 / DA-20260701-PHRASETMPL-RLS-DRIFT, ref 3yo2):
 *   shape = (i) 계열 — 기존 staff_write_staffarea_phrases(마이그 20260620120000 / commit 92a95431) 를
 *   ★파일 그대로★ PROD 에 forward apply. 신규 정책 authoring 0. (ii) 통합신설 반려.
 *   이 정책 role set = {consultant,coordinator,therapist,part_lead,staff} = coordinator + 잔여 4역할 전부.
 *   sibling 20260701030000(coordinator 단일) = SUPERSEDED(apply 금지) — coordinator 를 본 5역할 정책에 흡수.
 *   ADDITIVE + DA GO → 대표 게이트 불요(autonomy §3.1). supervisor DDL-diff GO 만.
 *
 * Phase A 드리프트 RC (확정, phaseA_diag.mjs): 순수 미apply.
 *   92a95431 은 apply 스크립트가 없어 reconcile 경로 자체 부재(6/09 이후 schema_migrations 원장 미추적,
 *   개별 apply .mjs 로만 PROD 반영). revert 아님 / 20260624180000 덮음 아님(별개 정책명 admin_write 만 접촉).
 *   → 본 스크립트가 그 apply 경로를 제공한다.
 *
 * ⚠ APPLY 게이트: DA GO(✅) + supervisor DDL-diff GO 선행 후에만 실행. DDL-diff 전 PROD 실행 금지.
 *   본 스크립트는 pre-snapshot → apply → post-snapshot → 구조검증을 self-contained 로 수행(멱등: DROP IF EXISTS+CREATE).
 *
 * 롤백: supabase/migrations/20260620120000_phrase_templates_staff_write_staffarea.rollback.sql
 *   (DROP POLICY staff_write_staffarea_phrases → effective write = {admin,manager,director} 원복).
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

const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  phrase_templates.${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.using_expr) console.log(`      USING: ${(r.using_expr || '').replace(/\s+/g, ' ')}`);
    if (r.check_expr) console.log(`      WITH CHECK: ${(r.check_expr || '').replace(/\s+/g, ' ')}`);
  }
};

// ── 0) PRE-SNAP (DDL-diff before) ──────────────────────────────
console.log(`✅ APPLY  T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE  ${new Date().toISOString()}`);
const before = (await q(POL_SQL)).result ?? (await q(POL_SQL));
const beforeRows = Array.isArray(before) ? before : before.result ?? before;
dump(beforeRows, '적용 전 pg_policies (DDL-diff BEFORE)');
const hadStaff = beforeRows.some((r) => r.policyname === 'staff_write_staffarea_phrases');
console.log(`\n  적용 전 staff_write_staffarea_phrases 존재? ${hadStaff ? '있음(멱등 재적용)' : '없음(DRIFT 확인 = RC 일치)'}`);

// ── 1) APPLY — 마이그 파일 그대로 (DA: 파일 그대로 forward apply) ─
const MIG = 'supabase/migrations/20260620120000_phrase_templates_staff_write_staffarea.sql';
const sql = fs.readFileSync(MIG, 'utf8');
try {
  await q(sql);
  console.log(`\n✅ 마이그 실행 완료: ${MIG}`);
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  process.exit(1);
}

// ── 2) POST-SNAP + 구조 검증 (DDL-diff after / 영속) ───────────
const afterR = await q(POL_SQL);
const after = Array.isArray(afterR) ? afterR : afterR.result ?? afterR;
dump(after, '적용 후 pg_policies (DDL-diff AFTER, 영속)');

const staff = after.find((r) => r.policyname === 'staff_write_staffarea_phrases');
const admin = after.find((r) => r.policyname === 'admin_write_phrase_templates');
const cody = after.find((r) => r.policyname === 'coordinator_write_staffarea_phrases');
const guard = (s) => /pen_chart/.test(s || '') && /customer_chart/.test(s || '') && !/medical_chart/.test(s || '');
const has = (s, roles) => roles.every((x) => new RegExp(`'${x}'`).test(s || ''));

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 회귀가드 (DA GO 검증항목) ──');
chk('staff_write_staffarea_phrases 존재 + cmd=ALL', staff && staff.cmd === 'ALL');
chk('staff 정책 role set = {consultant,coordinator,therapist,part_lead,staff}',
  staff && has(staff.using_expr, ['consultant', 'coordinator', 'therapist', 'part_lead', 'staff']));
chk('staff USING phrase_type 가드 (pen/customer, no medical)', staff && guard(staff.using_expr));
chk('staff WITH CHECK phrase_type 가드 (pen/customer, no medical) — 변조 hole 차단', staff && guard(staff.check_expr));
chk('admin_write_phrase_templates 무변경 = {admin,manager,director}',
  admin && has(admin.using_expr, ['admin', 'manager', 'director']));
chk('★coordinator 이중정책 부재 — coordinator_write_staffarea_phrases 미존재(sibling SUPERSEDED)', !cody);

// FE↔서버 union parity: pen/customer write union = 7역할(= canEditStaffAreaPhrase)
console.log('\n  FE union = admin,manager + {5역할} = 7역할(canEditStaffAreaPhrase) / director=medical(admin_write) 보존');
console.log(`\n${pass ? '✅ ALL PASS — drift 복구 정합' : '❌ FAIL — 검증 항목 확인'}`);
process.exit(pass ? 0 : 1);
