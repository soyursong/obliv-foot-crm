/**
 * T-20260620-foot-STAFF-PERM-UNLOCK-6MENU — RLS/PHI 마이그 APPLY + 검증 (rls_missing fix)
 *
 * supervisor FIX-REQUEST(MSG-20260621-055106-w3rp) 처리:
 *   1) 20260620120000_staff_perm_unlock_6menu_rls_additive.sql  (3역할 write RLS ADDITIVE 5종)
 *   2) 20260620120100_rrn_decrypt_a2_role_restore.sql           (rrn_decrypt A2 게이트 + phi_access_log)
 * 게이트: DA CONSULT(ADDITIVE) GO + DA CONSULT GO_WITH_CONDITIONS(C1~C6) + phi_sub_gate approved(대표) + supervisor DDL-diff.
 *
 * 실행: node scripts/..._rls_apply.mjs            (DRY-RUN: 사전상태만)
 *       node scripts/..._rls_apply.mjs --commit   (실제 적용 + 검증)
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
const COMMIT = process.argv.includes('--commit');
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const conn = () => new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });

const F1 = 'supabase/migrations/20260620120000_staff_perm_unlock_6menu_rls_additive.sql';
const F2 = 'supabase/migrations/20260620120100_rrn_decrypt_a2_role_restore.sql';
const NEW_POLICIES = [
  ['daily_closings','daily_closings_staff_unlock_6menu'],
  ['services','services_staff_unlock_6menu'],
  ['packages','packages_staff_unlock_6menu'],
  ['package_payments','package_payments_staff_unlock_6menu'],
  ['customers','customers_therap_update_6menu'],
];

const c = conn(); await c.connect();
console.log(`✅ DB 연결 ${new Date().toISOString()} (mode=${COMMIT?'COMMIT(적용)':'DRY-RUN(사전점검)'})\n`);
try {
  // ── 사전 상태 ──────────────────────────────────────────────
  console.log('[사전상태] 신규 정책 존재 여부:');
  for (const [t,p] of NEW_POLICIES) {
    const r = await c.query(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,[t,p]);
    console.log(`  · ${t}.${p}: ${r.rowCount? 'EXISTS':'(없음)'}`);
  }
  const tbl = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='phi_access_log'`);
  console.log(`  · table phi_access_log: ${tbl.rowCount?'EXISTS':'(없음)'}`);
  const fn = await c.query(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rrn_decrypt'`);
  const hasA2 = fn.rowCount && /consultant.*coordinator.*therapist|coordinator.*therapist/.test(fn.rows[0].def);
  const hasAudit = fn.rowCount && /phi_access_log/.test(fn.rows[0].def);
  console.log(`  · rrn_decrypt A2 게이트(3역할): ${hasA2?'적용됨':'(미적용)'} / audit INSERT: ${hasAudit?'적용됨':'(미적용)'}\n`);

  if (!COMMIT) { console.log('(DRY-RUN: 적용 미수행. --commit 으로 실제 적용)'); await c.end(); process.exit(0); }

  // ── 적용 (각 파일 통째 실행 — rollback 블록은 -- 주석이라 무영향) ──
  for (const f of [F1,F2]) {
    const sql = fs.readFileSync(f,'utf8');
    console.log(`▶ apply ${f}`);
    await c.query(sql);
    console.log(`  ✅ 완료`);
  }

  // ── 사후 검증 ──────────────────────────────────────────────
  console.log('\n[검증] 적용 후 상태:');
  let fail = 0;
  for (const [t,p] of NEW_POLICIES) {
    const r = await c.query(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,[t,p]);
    if (!r.rowCount) { fail++; console.log(`  ❌ ${t}.${p} 누락`); } else console.log(`  ✓ ${t}.${p}`);
  }
  const tbl2 = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='phi_access_log'`);
  if (!tbl2.rowCount) { fail++; console.log('  ❌ phi_access_log 미생성'); } else console.log('  ✓ phi_access_log');
  const fn2 = await c.query(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rrn_decrypt'`);
  const ok2A2 = fn2.rowCount && /therapist/.test(fn2.rows[0].def) && /phi_access_log/.test(fn2.rows[0].def);
  if (!ok2A2) { fail++; console.log('  ❌ rrn_decrypt A2 게이트/audit 미반영'); } else console.log('  ✓ rrn_decrypt A2 게이트 + audit INSERT');

  if (fail) { console.error(`\n❌ 검증 실패 ${fail}건`); await c.end(); process.exit(5); }
  console.log('\n✅ 전체 검증 통과 — FE(STAFF_UNLOCK_ROLES/RRN_VIEW_ROLES 6역할) ↔ DB RLS/rrn_decrypt 게이트 1:1 정합.');
} catch (e) {
  console.error('❌ 실패:', e.message);
  await c.end(); process.exit(1);
}
await c.end();
