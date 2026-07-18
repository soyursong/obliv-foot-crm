/**
 * T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN — 매출마감 전령 발행체인 이식 (shadow apply)
 * supervisor DEPLOY-EXEC GO (MSG-20260718-115059-jqi7, GREEN-SHADOW 사전승인 commit b3a76bcb).
 *
 * ── 실행 요청 (supervisor) ──
 *   1) 20260718140000_foot_closing_herald_pilot.sql 을 prod(rxlomoozakkjesdqjtvd)에 shadow 모드로 apply.
 *   2) ★HARD: `supabase db push` 금지 — 본 파일 단건만 선택 apply(Management API /database/query).
 *   3) config 기본 shadow 유지(dispatch 0). live flip 절대 금지(supervisor 소관).
 *   4) POSTCHECK: 신규객체 3종 landing + RLS enabled + config.mode='shadow'.
 *
 * ── 단일경로 apply = 원장 기록 ──
 *   applyMigration() 경유 = SQL 적용 + schema_migrations 원장 idempotent INSERT (drift 재발 차단).
 *   bulk db push 미사용 → 860 pending 무접촉, 140000 만 선택 apply.
 *
 * usage: node scripts/T-20260718-...apply.mjs          (DRY — BEFORE 실측만)
 *        node scripts/T-20260718-...apply.mjs --apply  (실적용 + POSTCHECK)
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(BEFORE 실측만)';
const VERSION = '20260718140000';
const FILE = '20260718140000_foot_closing_herald_pilot.sql';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

// ── probe helpers (신규 객체 3종 + RLS + config + 부속) ──
const tblExists = (t) => scalar(
  `SELECT to_regclass('public.${t}') IS NOT NULL AS x;`);
const colExists = (tbl, col) => scalar(
  `SELECT count(*)::int AS n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}';`);
const rlsEnabled = (t) => scalar(
  `SELECT relrowsecurity AS x FROM pg_class WHERE oid = 'public.${t}'::regclass;`);
const funcExists = (fn) => scalar(
  `SELECT count(*)::int AS n FROM pg_proc
   WHERE proname='${fn}' AND pronamespace='public'::regnamespace;`);
const trigExists = (tg, tbl) => scalar(
  `SELECT count(*)::int AS n FROM pg_trigger
   WHERE tgname='${tg}' AND tgrelid='public.${tbl}'::regclass AND NOT tgisinternal;`);
const configMode = () => scalar(
  `SELECT mode FROM public.closing_confirmed_config WHERE id = true;`);
const anonHasPriv = (t) => scalar(
  `SELECT count(*)::int AS n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='${t}' AND grantee='anon';`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] CLOSING-HERALD mig ${VERSION} shadow apply — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── BEFORE 실측 ──
const ledgerBefore = await ledgerVersions();
console.log('── BEFORE (prod 실측) ──');
console.log(`  ledger has ${VERSION}?            : ${ledgerBefore.has(VERSION)}`);
console.log(`  closing_confirmed_outbox exists? : ${await tblExists('closing_confirmed_outbox')}`);
console.log(`  closing_confirmed_config exists? : ${await tblExists('closing_confirmed_config')}`);
console.log(`  daily_closings.revision col?     : ${(await colExists('daily_closings','revision')) === 1}`);
console.log('');

if (!APPLY) {
  console.log('DRY 종료. 실적용: node scripts/T-20260718-...apply.mjs --apply');
  process.exit(0);
}

// ── APPLY (단일경로: SQL 적용 + 원장 기록) ──
console.log('── APPLY (Management API 선택 apply, db push 미사용) ──');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-CLOSING-HERALD-GOLDEN' });
const appliedAt = nowKst();
console.log(`  applyMigration => ${JSON.stringify(res)}`);
console.log(`  applied_at = ${appliedAt}\n`);

// ── POSTCHECK ──
console.log('── POSTCHECK (supervisor 요청 4항목) ──');
const pc = {};
pc.outbox_table       = await tblExists('closing_confirmed_outbox');
pc.config_table       = await tblExists('closing_confirmed_config');
pc.revision_col       = (await colExists('daily_closings','revision')) === 1;
pc.outbox_rls         = await rlsEnabled('closing_confirmed_outbox');
pc.config_rls         = await rlsEnabled('closing_confirmed_config');
pc.config_mode        = await configMode();
pc.outbox_anon_grants = await anonHasPriv('closing_confirmed_outbox');   // 기대 0 (anon REVOKE)
pc.config_anon_grants = await anonHasPriv('closing_confirmed_config');   // 기대 0
pc.fn_enqueue         = (await funcExists('enqueue_closing_confirmed')) >= 1;
pc.fn_worker          = (await funcExists('process_closing_confirmed_outbox')) >= 1;
pc.fn_source_split    = (await funcExists('closing_source_split')) >= 1;
pc.fn_insurance_split = (await funcExists('closing_insurance_split')) >= 1;
pc.fn_month           = (await funcExists('closing_month_projection')) >= 1;
pc.fn_snapshot        = (await funcExists('closing_payment_snapshot')) >= 1;
pc.fn_preflight       = (await funcExists('foot_closing_herald_preflight')) >= 1;
pc.trg_confirm_guard  = (await trigExists('trg_daily_closing_confirm_guard','daily_closings')) === 1;
pc.trg_enqueue        = (await trigExists('trg_enqueue_closing_confirmed','daily_closings')) === 1;
pc.trg_config_stamp   = (await trigExists('trg_closing_config_stamp_live_since','closing_confirmed_config')) === 1;
pc.ledger_recorded    = (await ledgerVersions()).has(VERSION);

// preflight 진단(Q6 slug 현황 — supervisor field-soak 참고용, flip 아님)
let preflight = null;
try { preflight = await scalar('SELECT public.foot_closing_herald_preflight();'); } catch (e) { preflight = `ERR ${e.message}`; }

for (const [k, v] of Object.entries(pc)) console.log(`  ${k.padEnd(20)}: ${JSON.stringify(v)}`);
console.log(`  preflight(Q6)       : ${JSON.stringify(preflight)}`);
console.log('');

// ── 종합 판정 ──
const GATE = {
  '신규객체 3종 landing': pc.outbox_table && pc.config_table && pc.revision_col,
  'RLS enabled (2 tbl)': pc.outbox_rls === true && pc.config_rls === true,
  "config.mode='shadow'": pc.config_mode === 'shadow',
  'anon REVOKE (grants 0)': pc.outbox_anon_grants === 0 && pc.config_anon_grants === 0,
  '핵심 함수 실재': pc.fn_enqueue && pc.fn_worker && pc.fn_source_split && pc.fn_insurance_split && pc.fn_preflight,
  '트리거 3종 실재': pc.trg_confirm_guard && pc.trg_enqueue && pc.trg_config_stamp,
  '원장 기록': pc.ledger_recorded,
};
console.log('── GATE ──');
let allPass = true;
for (const [k, v] of Object.entries(GATE)) { console.log(`  ${v ? '✅' : '❌'} ${k}`); if (!v) allPass = false; }
console.log('');
console.log(allPass ? `✅ ALL PASS — shadow apply 성공 (applied_at=${appliedAt}, mode=shadow, dispatch=0)`
                    : '❌ 일부 실패 — supervisor 회신 전 확인 필요');
process.exit(allPass ? 0 : 1);
