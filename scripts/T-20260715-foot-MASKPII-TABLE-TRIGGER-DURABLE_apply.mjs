/**
 * T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — prod apply + evidence runner
 * supervisor APPLY-GO: MSG-20260723-052723-5p3n (QA PASS + 착지순서 HOLD 해제 + DA GO e3cz).
 *
 * 집행:
 *   1) apply supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql (foot prod, ref rxlomoozakkjesdqjtvd)
 *      - 원장 무접점(mig_ledger_check: forward-doc, foot manual-apply 관례) → query() 직접(applyMigration X)
 *   2) evidence:
 *      (a) has_trigger=true 실측 (pg_trigger tgname='trg_customers_reject_masked_pii')
 *      (b) grandfathered flagged 1행 무관 필드(address 자기대입) UPDATE → 통과(short-circuit, 회귀0). name/phone 불변 확인.
 *      (c) masked-payload INSERT 시도 → RAISE 22023 reject 확인(fail-closed). 사후 count=0(무영속) 실증.
 *
 * PHI 위생: raw name/phone 값 미출력(불변 boolean·flag만). 마이그 트리거 에러메시지 정책과 정합.
 *
 * usage: node scripts/T-20260715-...apply.mjs          (DRY — read-only 프리체크만)
 *        node scripts/T-20260715-...apply.mjs --apply  (실적용 + evidence)
 * author: dev-foot / 2026-07-23
 */
import { query, PROJ_REF } from './lib/foot_migration_ledger.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const MIG_FILE = 'supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql';
const TRG = 'trg_customers_reject_masked_pii';
const FN = '_trg_customers_reject_masked_pii';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 실존 clinic (evidence c INSERT용)
const SMOKE_CHART = 'SMOKE-MASKPII-REJECT-22023'; // no-persist 검증 marker

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${APPLY ? 'APPLY(실적용)' : 'DRY(계획만)'}] MASKPII table-trigger — ref ${PROJ_REF} (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── fail-closed 프리체크 (read-only) ──
const helperN = await scalar(`SELECT count(*)::int n FROM pg_proc WHERE proname='_fn_is_masked_pii';`);
console.log(`[preflight] helper _fn_is_masked_pii = ${helperN} (기대 1, 의존)`);
if (helperN < 1) { console.error('⛔ ABORT — helper 부재. 트리거 함수 의존 붕괴.'); process.exit(2); }

const trgPre = await scalar(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='${TRG}' AND NOT tgisinternal;`);
console.log(`[preflight] trigger ${TRG} (pre) = ${trgPre} (기대 0)`);

const flagged = await query(
  `SELECT id::text FROM public.customers WHERE public._fn_is_masked_pii(name, phone) ORDER BY id;`
);
console.log(`[preflight] grandfathered flagged(masked-PII) rows = ${flagged.length} (07-15 감사 9행 → 자연변동)`);

if (!APPLY) {
  console.log(`\n── DRY 계획 ──`);
  console.log(`  1) apply ${MIG_FILE} (BEGIN..COMMIT 내장, ADDITIVE: 함수 ${FN}() + 트리거 ${TRG})`);
  console.log(`  2) evidence a/b/c 실행 (--apply 필요)`);
  console.log(`\n실적용: --apply 플래그.\n`);
  process.exit(0);
}

// ══════════════════════ APPLY ══════════════════════
console.log(`\n── [1] apply ${MIG_FILE} ──`);
const sql = readFileSync(join(REPO_ROOT, MIG_FILE), 'utf8');
await query(sql);
console.log(`  ✅ 적용 완료 (${sql.length} bytes). 원장 무접점(forward-doc).`);

// ── evidence (a) has_trigger=true ──
console.log(`\n── [evidence a] has_trigger 실측 ──`);
const trgPost = await query(
  `SELECT t.tgname, c.relname AS tbl, p.proname AS fn,
          (t.tgtype & 2) <> 0 AS is_before,
          (t.tgtype & 4) <> 0 AS on_insert,
          (t.tgtype & 16) <> 0 AS on_update,
          t.tgenabled
   FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgname='${TRG}' AND NOT t.tgisinternal;`
);
const hasTrigger = trgPost.length === 1;
console.log(`  has_trigger = ${hasTrigger}`);
console.log(`  meta: ${JSON.stringify(trgPost[0] || {})}`);
if (!hasTrigger) { console.error('⛔ FAIL — has_trigger != true. supervisor 즉시 회신.'); process.exit(3); }

// ── evidence (b) grandfathered 무관필드 UPDATE → 통과(short-circuit, 회귀0) ──
console.log(`\n── [evidence b] grandfathered flagged 1행 무관필드 UPDATE (short-circuit) ──`);
const targetId = flagged[0].id;
console.log(`  target flagged id = ${targetId}`);
const before = (await query(
  `SELECT md5(name) AS nh, md5(phone) AS ph, public._fn_is_masked_pii(name, phone) AS flagged FROM public.customers WHERE id='${targetId}';`
))[0];
console.log(`  before: flagged=${before.flagged} (PHI 위생: name/phone raw 미출력, md5 대조만)`);
// 무관 필드(address) 자기대입 — name/phone 미변경 → 트리거 short-circuit RETURN NEW. 데이터 순변동 0(idempotent).
const upd = await query(
  `UPDATE public.customers SET address = address WHERE id='${targetId}' RETURNING id::text;`
);
const passedUpdate = upd.length === 1;
console.log(`  UPDATE address=address (무관필드) rows_affected = ${upd.length} → ${passedUpdate ? '통과(예외 없음)' : 'FAIL'}`);
const after = (await query(
  `SELECT md5(name) AS nh, md5(phone) AS ph FROM public.customers WHERE id='${targetId}';`
))[0];
const nameUnchanged = before.nh === after.nh;
const phoneUnchanged = before.ph === after.ph;
console.log(`  name 불변=${nameUnchanged} / phone 불변=${phoneUnchanged} → 회귀0 = ${passedUpdate && nameUnchanged && phoneUnchanged}`);
if (!(passedUpdate && nameUnchanged && phoneUnchanged)) { console.error('⛔ FAIL — short-circuit 회귀0 미충족.'); process.exit(4); }

// ── evidence (c) masked INSERT → RAISE 22023 reject (fail-closed, 무영속) ──
console.log(`\n── [evidence c] masked-payload INSERT → 22023 reject (fail-closed) ──`);
let rejected = false, sqlstate = null, rawErr = '';
try {
  // NOT NULL 무-default 4컬럼(clinic_id/name/phone/chart_number) 전부 채움 → reject 사유 = 오직 트리거.
  await query(
    `INSERT INTO public.customers (clinic_id, name, phone, chart_number)
     VALUES ('${CLINIC_ID}', '스모크마스킹*리젝트', '01099998888', '${SMOKE_CHART}');`
  );
  console.log('  ⚠ INSERT 예상외 성공 — reject 미발생.');
} catch (e) {
  rawErr = String(e.message || e);
  rejected = /22023/.test(rawErr);
  sqlstate = (rawErr.match(/22023/) || [])[0] || 'unknown';
  console.log(`  INSERT 거부됨 = ${rejected} (sqlstate 매치: ${sqlstate})`);
  console.log(`  err(발췌): ${rawErr.slice(0, 220)}`);
}
// 무영속 실증
const persistN = await scalar(`SELECT count(*)::int n FROM public.customers WHERE chart_number='${SMOKE_CHART}';`);
console.log(`  사후 무영속 count(chart_number='${SMOKE_CHART}') = ${persistN} (기대 0)`);
if (!rejected || persistN !== 0) { console.error('⛔ FAIL — fail-closed(22023 reject + 무영속) 미충족.'); process.exit(5); }

console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`✅ ALL EVIDENCE PASS`);
console.log(`  (a) has_trigger=true`);
console.log(`  (b) grandfathered 무관필드 UPDATE 통과(short-circuit) + name/phone 불변 = 회귀0`);
console.log(`  (c) masked INSERT → 22023 reject + 무영속(count=0) = fail-closed 실증`);
console.log(`  rollback 대기: supabase/migrations/20260715130000_customers_maskreject_table_trigger.rollback.sql`);
console.log(`════════════════════════════════════════════════════════════`);
