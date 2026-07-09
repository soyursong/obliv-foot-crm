/**
 * T-20260628-foot-WAITING-REALTIME — waiting_board sanitized projection (ADDITIVE) prod 적용.
 * SSOT: cross_crm_data_contract.md §16-3a (DA CONSULT-REPLY MSG-20260628-203318-lz5d).
 * supervisor APPLY-REQUEST MSG-20260709-185309-ov0e (DDL-diff gate 통과, prod apply 잔여).
 *
 * 흐름: probe-before → [DRY_RUN이면 BEGIN→apply→ROLLBACK 셰도 검증 후 멈춤] → apply → probe-after → ledger.
 * rollback: supabase/migrations/20260628200000_waiting_board_projection.rollback.sql (수동)
 *
 * 실행:
 *   dry-run: DRY_RUN=1 node scripts/apply_20260628200000_waiting_board_projection.mjs
 *   apply:            node scripts/apply_20260628200000_waiting_board_projection.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const VERSION = '20260628200000';
const SQL = readFileSync(join(__dir, `../supabase/migrations/${VERSION}_waiting_board_projection.sql`), 'utf8');
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

const PROBE_TABLE   = `SELECT to_regclass('public.waiting_board') AS tbl;`;
const PROBE_COLS    = `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='waiting_board' ORDER BY ordinal_position;`;
const PROBE_TRIGGER = `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_sync_waiting_board' AND NOT tgisinternal;`;
const PROBE_FUNCS   = `SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('mask_display_name','sync_waiting_board') ORDER BY proname;`;
const PROBE_RLS     = `SELECT c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='waiting_board';`;
const PROBE_POLICY  = `SELECT policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND tablename='waiting_board' ORDER BY policyname;`;
const PROBE_PUB     = `SELECT 1 AS present FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='waiting_board';`;
const PROBE_ROWS    = `SELECT count(*) AS n FROM public.waiting_board;`;
const LEDGER        = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`;

console.log('═══ T-20260628-foot-WAITING-REALTIME waiting_board projection 적용 ═══');
console.log('proj:', PROJ_REF, '(obliv-foot-crm)  mode:', DRY_RUN ? 'DRY-RUN(셰도 검증, 미persist)' : 'APPLY', '\n');

console.log('── [1] probe-before ──');
const beforeTbl = (await q(PROBE_TABLE))[0]?.tbl ?? '(없음)';
console.log('  waiting_board 존재:', beforeTbl);
console.log('  check_ins 존재:', (await q(`SELECT to_regclass('public.check_ins') AS t;`))[0]?.t ?? '(없음)');

if (DRY_RUN) {
  console.log('\n── [DRY-RUN] BEGIN→apply→ROLLBACK 셰도 검증 (prod 미persist) ──');
  const shadow = SQL.replace(/\bCOMMIT\s*;/i, 'ROLLBACK;');
  await q(shadow);
  console.log('  ✅ 셰도 apply 성공 (문법·컬럼·트리거·RLS·publication·backfill SELECT 유효) → ROLLBACK 완료.');
  console.log('  검증 후 잔존 확인:', (await q(PROBE_TABLE))[0]?.tbl ?? '(없음 — 정상: 롤백됨)');
  console.log('\nDRY_RUN=1 — 실제 적용하지 않고 종료.');
  process.exit(0);
}

console.log('\n── [2] apply ──');
await q(SQL);
console.log('✅ apply 완료\n');

console.log('── [3] probe-after ──');
console.log('  테이블:', (await q(PROBE_TABLE))[0]?.tbl ?? '(없음!)');
console.log('  컬럼:');
for (const c of await q(PROBE_COLS)) console.log(`    ${c.column_name} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
const trg = await q(PROBE_TRIGGER);
console.log('  트리거:', trg.length ? `${trg[0].tgname} (enabled=${trg[0].tgenabled})` : '(없음!)');
console.log('  함수:');
for (const f of await q(PROBE_FUNCS)) console.log(`    ${f.proname} (SECURITY DEFINER=${f.prosecdef})`);
console.log('  RLS enabled:', (await q(PROBE_RLS))[0]?.rls_enabled);
console.log('  정책:');
for (const p of await q(PROBE_POLICY)) console.log(`    [${p.cmd}] ${p.policyname} → ${p.roles}`);
console.log('  Realtime publication 등재:', (await q(PROBE_PUB)).length ? 'YES' : 'NO(!)');
console.log('  backfill row 수:', (await q(PROBE_ROWS))[0]?.n);

console.log('\n── [4] ledger ──');
const led = await q(LEDGER);
console.log('  schema_migrations:', led.length ? `${led[0].version} ${led[0].name}` : '(미등재 — Management API 경유, forward-doc 필요)');
console.log('\n✅ 완료');
