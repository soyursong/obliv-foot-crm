/**
 * T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY — payment_items 신규 테이블 (ADDITIVE).
 * DA GO + ADDITIVE (MSG-20260707-232108-u1zh). autonomy §3.1 대표게이트 면제, supervisor DDL-diff만.
 *
 * 흐름: probe-before → [DRY_RUN이면 BEGIN→apply→ROLLBACK 셰도 검증 후 멈춤] → apply → probe-after → ledger.
 * rollback: supabase/migrations/20260708000000_foot_payment_items_additive.rollback.sql
 *
 * 실행:
 *   dry-run: DRY_RUN=1 node scripts/apply_20260708000000_foot_payment_items_additive.mjs
 *   apply:            node scripts/apply_20260708000000_foot_payment_items_additive.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const VERSION = '20260708000000';
const SQL = readFileSync(join(__dir, `../supabase/migrations/${VERSION}_foot_payment_items_additive.sql`), 'utf8');
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

const PROBE_TABLE = `SELECT to_regclass('public.payment_items') AS tbl;`;
const PROBE_POLICIES = `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='payment_items' ORDER BY policyname;`;
const PROBE_COLS = `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_items' ORDER BY ordinal_position;`;
const LEDGER = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`;
const HELPERS = `SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user','current_user_clinic_id');`;

console.log('═══ T-20260707-foot-PAYMENT-ITEMIZED payment_items 적용 ═══');
console.log('proj:', PROJ_REF, '(obliv-foot-crm)  mode:', DRY_RUN ? 'DRY-RUN(셰도 검증, 미persist)' : 'APPLY', '\n');

console.log('── [1] probe-before ──');
console.log('  payment_items 존재:', (await q(PROBE_TABLE))[0]?.tbl ?? '(없음)');
const helpers = await q(HELPERS);
console.log('  RLS 헬퍼:', helpers.map(h => h.proname).join(', ') || '(없음 — RLS 조인 대상 확인 필요)');

if (DRY_RUN) {
  console.log('\n── [DRY-RUN] BEGIN→apply→ROLLBACK 셰도 검증 (prod 미persist) ──');
  // 마이그의 COMMIT 을 ROLLBACK 으로 치환 → 전체 DDL 을 트랜잭션 내 실행 후 되돌림(문법·FK·의존 검증).
  const shadow = SQL.replace(/\bCOMMIT\s*;/i, 'ROLLBACK;');
  await q(shadow);
  console.log('  ✅ 셰도 apply 성공 (문법·FK 대상·CHECK·RLS 조인 유효) → ROLLBACK 완료, prod 무변경.');
  console.log('  검증 후 잔존 확인:', (await q(PROBE_TABLE))[0]?.tbl ?? '(없음 — 정상: 롤백됨)');
  console.log('\nDRY_RUN=1 — 실제 적용하지 않고 종료.');
  process.exit(0);
}

console.log('\n── [2] apply ──');
await q(SQL);
console.log('✅ apply 완료\n');

console.log('── [3] probe-after ──');
console.log('  컬럼:');
for (const c of await q(PROBE_COLS)) console.log(`    ${c.column_name} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
console.log('  정책:');
for (const p of await q(PROBE_POLICIES)) console.log(`    [${p.cmd}] ${p.policyname}`);

console.log('\n── [4] ledger ──');
const led = await q(LEDGER);
console.log('  schema_migrations:', led.length ? `${led[0].version} ${led[0].name}` : '(미등재 — CLI 경유 아님, forward-doc 필요)');
console.log('\n✅ 완료');
