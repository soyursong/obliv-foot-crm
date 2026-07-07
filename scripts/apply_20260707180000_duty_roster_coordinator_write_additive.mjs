/**
 * T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS — PROD 마이그 적용 (ADDITIVE RLS).
 * DA 가설 A 확정. db_change:true (diagnose: RLS 실재 coordinator 배제 + clinic_id 존재/다지점).
 *
 * 흐름: probe-before(회귀상태 캡처) → [DRY_RUN이면 여기서 멈춤] → apply → probe-after(coordinator 정책 실재 확인).
 * rollback: supabase/migrations/20260707180000_duty_roster_coordinator_write_additive.rollback.sql
 *
 * 실행:
 *   dry-run: DRY_RUN=1 node scripts/apply_20260707180000_duty_roster_coordinator_write_additive.mjs
 *   apply:            node scripts/apply_20260707180000_duty_roster_coordinator_write_additive.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dir, '../supabase/migrations/20260707180000_duty_roster_coordinator_write_additive.sql'), 'utf8');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const DRY_RUN = !!process.env.DRY_RUN;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌ query 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}

const PROBE = `
  SELECT policyname, cmd, roles::text AS roles, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename='duty_roster'
  ORDER BY cmd, policyname;`;
const LEDGER = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260707180000';`;

console.log('═══ T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS PROD 적용 ═══');
console.log('proj:', PROJ_REF, '(obliv-foot-crm)  mode:', DRY_RUN ? 'DRY-RUN(적용 안 함)' : 'APPLY', '\n');

console.log('── [1] probe-before: duty_roster 정책 현황 ──');
const before = await q(PROBE);
for (const r of before) console.log(`  [${r.cmd}] ${r.policyname}  roles=${r.roles}`);
console.log(`  → ${before.length} 정책 (coordinator 정책 ${before.filter(r=>/coordinator/.test(r.policyname)).length}건)\n`);

if (DRY_RUN) {
  console.log('── [DRY-RUN] 적용 예정 SQL ──');
  console.log(SQL);
  console.log('\n예상 결과: coordinator INSERT/UPDATE/DELETE 정책 3건 신규 추가(기존 admin/manager 3건 + select 1건 불변). 총 4→7 정책.');
  console.log('DRY_RUN=1 — 실제 적용하지 않고 종료.');
  process.exit(0);
}

console.log('── [2] apply: 마이그 20260707180000 실행 ──');
await q(SQL);
console.log('✅ apply 완료\n');

console.log('── [3] probe-after: coordinator 정책 실재 확인 ──');
const after = await q(PROBE);
for (const r of after) {
  const isNew = /coordinator/.test(r.policyname);
  console.log(`  [${r.cmd}] ${r.policyname}  roles=${r.roles}${isNew ? '  ← NEW' : ''}`);
}
const coordPols = after.filter(r=>/coordinator/.test(r.policyname));
console.log(`  → 총 ${after.length} 정책 / coordinator write 정책 ${coordPols.length}건 (기대 3건: insert/update/delete)`);

console.log('\n── [4] 원장(ledger) 기록 확인 ──');
console.log(JSON.stringify(await q(LEDGER), null, 2));

if (after.length === 7 && coordPols.length === 3) {
  console.log('\n✅ ADDITIVE 적용 성공 — coordinator write 3정책 추가, 기존 admin/manager + select 불변.');
} else {
  console.log('\n⚠ 정책 수 예상과 불일치 — 수동 확인 요망.');
}
