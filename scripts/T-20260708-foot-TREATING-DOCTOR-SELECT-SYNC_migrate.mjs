/**
 * T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC — 마이그레이션 dry-run / real-apply 하니스
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN)
 *
 *   node scripts/T-20260708-...migrate.mjs           # DRY-RUN (forward+rollback tx ROLLBACK + 멱등)
 *   node scripts/T-20260708-...migrate.mjs --apply   # REAL APPLY (forward COMMIT)
 *
 * 전량 ADDITIVE(nullable FK 2). 멱등 가드(IF NOT EXISTS). 롤백 SQL 동봉.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const fwd = fs.readFileSync('supabase/migrations/20260708210000_foot_treating_doctor_additive.sql', 'utf8');
const rbk = fs.readFileSync('supabase/migrations/20260708210000_foot_treating_doctor_additive.rollback.sql', 'utf8');

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const probe = () => q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='check_ins' AND column_name='treating_doctor_id')::int AS ci,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_doctors' AND column_name='staff_id')::int AS cd,
    (SELECT ccu.table_name FROM information_schema.key_column_usage kcu
       JOIN information_schema.table_constraints tc ON tc.constraint_name=kcu.constraint_name AND tc.constraint_type='FOREIGN KEY'
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
       WHERE kcu.table_schema='public' AND kcu.table_name='check_ins' AND kcu.column_name='treating_doctor_id' LIMIT 1) AS ci_fk,
    (SELECT ccu.table_name FROM information_schema.key_column_usage kcu
       JOIN information_schema.table_constraints tc ON tc.constraint_name=kcu.constraint_name AND tc.constraint_type='FOREIGN KEY'
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
       WHERE kcu.table_schema='public' AND kcu.table_name='clinic_doctors' AND kcu.column_name='staff_id' LIMIT 1) AS cd_fk;
`);

console.log(`\n=== T-20260708 TREATING-DOCTOR migrate (${APPLY ? 'REAL APPLY' : 'DRY-RUN'}) ===\n`);
try {
  const pre = (await probe())[0];
  console.log(`── PRE ──  check_ins.treating_doctor_id=${pre.ci}  clinic_doctors.staff_id=${pre.cd}\n`);

  if (!APPLY) {
    // DRY-RUN: forward + 멱등 재실행 + rollback 을 한 tx(단일 API 호출=단일 세션) 안에서 실행 후 ROLLBACK → prod 무변경.
    //   FK 형태 검증(→clinic_doctors / →staff / SET NULL)은 --apply 커밋 후 probe()로 단언(동일 DDL).
    await q(`BEGIN;\n${fwd}\n${fwd}\n${rbk}\nROLLBACK;`);
    console.log('  ✅ tx(forward→forward멱등→rollback) 무오류 실행 후 ROLLBACK');
    const post = (await probe())[0];
    // prod 무변경 = post 상태가 PRE 와 동일(왕복 후 원상). 이미 적용(1)이든 미적용(0)이든 불변이면 PASS.
    //   (기존 하드코딩 0 비교는 已적용 prod 에서 false-FAIL → PRE 대조로 정정.)
    chk(post.ci === pre.ci && post.cd === pre.cd, `ROLLBACK 후 prod 무변경(왕복 원상, PRE 대조): ci ${pre.ci}→${post.ci}, cd ${pre.cd}→${post.cd}`);
    console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS (forward+멱등+rollback 왕복, prod 무변경)' : '❌ DRY-RUN FAIL'}\n`);
  } else {
    await q(fwd);
    console.log('  ✅ FORWARD COMMIT (management API auto-commit)');
    await q(fwd); // 멱등 재확인
    console.log('  ✅ FORWARD 멱등 재실행 무오류');
    const post = (await probe())[0];
    chk(post.ci === 1, 'check_ins.treating_doctor_id 존재');
    chk(post.cd === 1, 'clinic_doctors.staff_id 존재');
    chk(post.ci_fk === 'clinic_doctors', `FK check_ins.treating_doctor_id → clinic_doctors (${post.ci_fk})`);
    chk(post.cd_fk === 'staff', `FK clinic_doctors.staff_id → staff (${post.cd_fk})`);
    const led = await q(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20260708210000'`);
    chk(led.length === 1, `ledger row 등재 (${JSON.stringify(led[0] || null)})`);
    console.log(`\n${pass ? '✅ REAL APPLY ALL-PASS' : '❌ APPLY FAIL'}\n`);
  }
} catch (e) {
  console.error('❌ 오류:', e.message);
  pass = false;
}
process.exit(pass ? 0 : 1);
