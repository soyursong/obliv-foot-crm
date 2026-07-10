/**
 * T-20260617-foot-RXCODES-READ-TIGHTEN — prescription_codes READ RLS 조이기 (dry-run / apply)
 * foot prod: rxlomoozakkjesdqjtvd. Supabase Management API(/database/query) 경유.
 *
 *   dry-run(기본): node scripts/T-20260617-foot-RXCODES-READ-TIGHTEN_apply.mjs
 *     → PRE 스냅 + forward body 를 BEGIN..ROLLBACK 셰도 실행(무변경) + 셰도 after-state 검증
 *       + post-rollback 라이브 무변경 확인 + 8-role 정합 그라운딩.
 *   apply:        APPLY=1 node scripts/T-20260617-foot-RXCODES-READ-TIGHTEN_apply.mjs
 *     → ★supervisor DDL-diff + 8-role 전후검증 GO 후에만 (운영 DB 스키마 변경 = supervisor 사전 승인, standard §5). blind apply 금지.
 *       forward 마이그(자체 BEGIN/COMMIT) 실적용 + 영속검증 + ledger(schema_migrations) 기록.
 *   rollback:     ROLLBACK=1 node scripts/T-20260617-foot-RXCODES-READ-TIGHTEN_apply.mjs   (긴급 회복용)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const APPLY = !!process.env.APPLY;
const DO_ROLLBACK = !!process.env.ROLLBACK;
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required');

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const b = await r.json();
  if (!r.ok) throw new Error(`API ${r.status}: ${JSON.stringify(b)}`);
  return b;
}

const VERSION = '20260710163000';
const MIG_FWD = join(__dir, `../supabase/migrations/${VERSION}_prescription_codes_read_rls_canonical.sql`);
const MIG_RBK = join(__dir, `../supabase/migrations/${VERSION}_prescription_codes_read_rls_canonical.rollback.sql`);
const fwdRaw = readFileSync(MIG_FWD, 'utf8');
const rbkRaw = readFileSync(MIG_RBK, 'utf8');
// BEGIN/COMMIT 제거(셰도 래핑 위해). 주석은 유지해도 무방.
const strip = (s) => s.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
const fwdBody = strip(fwdRaw);

const POL = `SELECT policyname, cmd, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname`;
const dump = (rows, label) => {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(`  ${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.qual) console.log(`      USING: ${(r.qual || '').replace(/\s+/g, ' ')}`);
    if (r.with_check) console.log(`      CHECK: ${(r.with_check || '').replace(/\s+/g, ' ')}`);
  }
};
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// ─────────────────────────────────────────── ROLLBACK ───────────────────────
if (DO_ROLLBACK) {
  console.log(`⚠ ROLLBACK 모드 — read_all(roles=public USING true) 과개방 복귀. ${new Date().toISOString()}`);
  dump((await q(POL)), 'rollback 전');
  await q(rbkRaw);
  const after = await q(POL);
  dump(after, 'rollback 후');
  const readAll = after.find(r => r.policyname === 'prescription_codes_read_all');
  const ok = readAll && readAll.cmd === 'SELECT' && /^\s*true\s*$/i.test((readAll.qual || '').trim());
  console.log(`\n${ok ? '✅ ROLLBACK 완료 (read_all 복원)' : '❌ ROLLBACK 검증 실패'}`);
  process.exit(ok ? 0 : 1);
}

// ─────────────────────────────────────────── PRE-SNAP ───────────────────────
console.log(`RXCODES-READ-TIGHTEN — ${APPLY ? 'APPLY' : 'DRY-RUN'}  ${new Date().toISOString()}`);
const before = await q(POL);
dump(before, 'PRE (라이브)');
const hadReadAll = before.some(r => r.policyname === 'prescription_codes_read_all');
const hadApprovedRead = before.some(r => r.policyname === 'prescription_codes_approved_read');
console.log(`\n  read_all(과개방) 존재? ${hadReadAll ? '있음 = RC 일치' : '없음'}  |  approved_read 이미? ${hadApprovedRead ? '있음(멱등 재적용)' : '없음'}`);

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };

// ─────────────────────────────────────────── 8-ROLE 정합 그라운딩 (정적) ─────
// runtime per-role SELECT 는 supervisor 8-role 전후검증 + 실브라우저 게이트가 담당.
// dev-foot 제공: (a) predicate 가 role-agnostic(is_approved_user) 임을 확인 → 8역할 approved+active 전원 통과 근거.
//               (b) is_approved_user 정의 = approved+active only (role 무관).
console.log('\n── 8-role 정합 그라운딩 (정적, supervisor runtime 검증 보조) ──');
const roles = await q(`SELECT unnest(enum_range(NULL::user_role))::text AS role`).catch(() => null);
if (roles) console.log(`  user_role enum(${roles.length}): ${roles.map(r => r.role).join(', ')}`);
const fn = await q(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='is_approved_user' LIMIT 1`);
const fnDef = fn[0]?.def || '';
chk('is_approved_user() = approved+active only (role-agnostic, 특정 role 참조 없음)',
  /approved/.test(fnDef) && /active/.test(fnDef) && !/user_role|current_user_role|role\s*=/.test(fnDef));
console.log(`  → approved+active 인 8역할(admin/manager/director/doctor/consultant/nurse/therapist/coordinator 등) 전원 SELECT 통과.`);
console.log(`     미승인(approved=false)·비활성(active=false)·anon 은 SELECT 차단(=의도된 축소).`);

// ─────────────────────────────────────────── DRY-RUN 셰도 ───────────────────
if (!APPLY) {
  console.log('\n── DRY-RUN 셰도 (BEGIN..ROLLBACK, 무변경) ──');
  const shadowQ = `BEGIN;\n${fwdBody}\n${POL};\nROLLBACK;`;
  let shadow;
  try {
    shadow = await q(shadowQ); // ROLLBACK 전 SELECT 결과 반환됨(API 검증 완료)
    console.log('  ✅ 셰도 apply 무에러 (SQL 클린).');
  } catch (e) {
    console.error('  ❌ 셰도 apply 에러:', e.message);
    process.exit(1);
  }
  dump(shadow, '셰도 after-state (트랜잭션 내, 롤백됨)');
  const ar = shadow.find(r => r.policyname === 'prescription_codes_approved_read');
  const ra = shadow.find(r => r.policyname === 'prescription_codes_read_all');
  const aa = shadow.find(r => r.policyname === 'prescription_codes_admin_all');
  console.log('\n── 셰도 after-state 검증 (canonical 정합) ──');
  chk('approved_read 생성 [SELECT] roles={authenticated}', ar && ar.cmd === 'SELECT' && /authenticated/.test(ar.roles) && !/public/.test(ar.roles));
  chk('approved_read USING = is_approved_user()', ar && norm(ar.qual) === 'is_approved_user()');
  chk('read_all(과개방) 제거됨', !ra);
  chk('admin_all(WRITE) 미접촉 — [ALL] is_admin_or_manager() 유지', aa && aa.cmd === 'ALL' && /is_admin_or_manager\(\)/.test(aa.qual || ''));
  chk('blanket-open READ 미발생 (approved_read USING ≠ true)', ar && !/^\s*true\s*$/i.test((ar.qual || '').trim()));

  // post-rollback: 라이브 무변경 확인
  const post = await q(POL);
  dump(post, 'POST-ROLLBACK (라이브, 무변경 확인)');
  chk('라이브 무변경 — read_all 여전히 존재(셰도 롤백 정상)', post.some(r => r.policyname === 'prescription_codes_read_all'));
  chk('라이브 무변경 — approved_read 미생성(셰도 롤백 정상)', !post.some(r => r.policyname === 'prescription_codes_approved_read'));

  console.log(`\n${pass ? '✅ DRY-RUN PASS — supervisor DDL-diff+8-role GO 후 APPLY=1 로 실적용' : '❌ DRY-RUN FAIL'}`);
  process.exit(pass ? 0 : 1);
}

// ─────────────────────────────────────────── APPLY (post-GO) ────────────────
console.log('\n── APPLY (forward 마이그 실적용) ──');
if (!pass) { console.error('❌ 그라운딩 실패 — apply 중단'); process.exit(1); }
try {
  await q(fwdRaw); // 자체 BEGIN/COMMIT
  console.log('  ✅ forward 마이그 COMMIT.');
} catch (e) {
  console.error('  ❌ APPLY 실패:', e.message, '\n  → rollback 마이그로 회복 가능.');
  process.exit(1);
}
// 영속검증 (신규 요청)
const after = await q(POL);
dump(after, '적용 후 pg_policies (영속 확인)');
const ar = after.find(r => r.policyname === 'prescription_codes_approved_read');
const ra = after.find(r => r.policyname === 'prescription_codes_read_all');
const aa = after.find(r => r.policyname === 'prescription_codes_admin_all');
console.log('\n── 영속 회귀가드 ──');
chk('approved_read [SELECT] roles={authenticated} USING is_approved_user()',
  ar && ar.cmd === 'SELECT' && /authenticated/.test(ar.roles) && !/public/.test(ar.roles) && norm(ar.qual) === 'is_approved_user()');
chk('read_all(과개방) 제거됨', !ra);
chk('admin_all(WRITE) 미접촉', aa && aa.cmd === 'ALL' && /is_admin_or_manager\(\)/.test(aa.qual || ''));

// ledger 기록
try {
  await q(`INSERT INTO supabase_migrations.schema_migrations(version, name)
    VALUES ('${VERSION}', 'prescription_codes_read_rls_canonical')
    ON CONFLICT (version) DO NOTHING`);
  const led = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
  chk('ledger(schema_migrations) 기록됨', led.length === 1);
} catch (e) { console.error('  ⚠ ledger 기록 경고:', e.message); }

console.log(`\n${pass ? '✅ APPLY + 영속검증 + ledger PASS' : '❌ APPLY 검증 FAIL'}`);
process.exit(pass ? 0 : 1);
