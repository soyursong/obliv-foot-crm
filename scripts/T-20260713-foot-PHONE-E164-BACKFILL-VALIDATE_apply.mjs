/**
 * Step2 BACKFILL APPLY — T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
 *   reads OFF-GIT freeze_resolved.json (freeze_preflight.mjs 산출, §3-5 PASS 전제).
 *   default = DRY (write 없음). --apply 로만 실제 UPDATE.
 *
 * data_correction_backfill_sop 준수:
 *   §5-8 apply 직전 freeze-set 재-스윕: 각 PK 현재값 == frozen old 확인. genuine drift = ABORT.
 *   §3-3 멱등 WHERE: UPDATE ... WHERE id=id AND col=old → 재실행 no-op, drift-safe.
 *   §4    원장 무접점: DDL 0 (순수 데이터 UPDATE), schema_migrations 미소비.
 *   §8    파생층: trg_updated_at 이 updated_at bump → Bronze watermark 자연전진 = 자기치유
 *          (NOSHOW-CHECKIN 선례). updated_at 동결 아님 → id-scoped 강제 re-ingest 불요.
 *
 * PHI 위생(§4): apply-capture(before/after 실값) OFF-GIT. git-tracked stdout = 카운트/판정만.
 * author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const one = (r) => (Array.isArray(r) ? r : r.result ?? []);
const OUT = process.env.HOME + '/foot-backfill-artifacts/T-20260713-PHONE-E164';
const fz = JSON.parse(readFileSync(`${OUT}/freeze_resolved.json`, 'utf8'));
if (!fz.preflight?.pass) { console.error('❌ freeze_resolved.json preflight!=pass → apply 금지'); process.exit(1); }

const esc = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
console.log(`══ Step2 BACKFILL APPLY (${APPLY ? 'APPLY 🔴 WRITE' : 'DRY'}) ══`);
console.log('측정시각(UTC):', new Date().toISOString());
console.log('freeze generated:', fz.generated_utc, '\n');

// ── 1) apply 직전 재-스윕 (drift 판정) ────────────────────────────────────
async function resweep(table, col, freeze) {
  const ids = freeze.map((r) => `'${r.id}'`).join(',');
  const cur = one(await query(`SELECT id, ${col} AS phone FROM public.${table} WHERE id IN (${ids});`));
  const curMap = new Map(cur.map((r) => [r.id, r.phone]));
  let matchOld = 0, alreadyNew = 0, drift = [];
  for (const r of freeze) {
    const now = curMap.get(r.id);
    if (now === r.old) matchOld++;
    else if (now === r.new) alreadyNew++;              // 멱등 재실행 = 이미 적용
    else drift.push({ id: r.id, disp: r.disposition }); // genuine drift
  }
  return { table, matchOld, alreadyNew, drift, curMap };
}

const rsC = await resweep('customers', 'phone', fz.customers);
const rsR = await resweep('reservations', 'customer_phone', fz.reservations);
for (const rs of [rsC, rsR]) {
  console.log(`재-스윕 ${rs.table}: match-old=${rs.matchOld} already-applied=${rs.alreadyNew} drift=${rs.drift.length}`);
  rs.drift.forEach((d) => console.log(`   ⚠ DRIFT ...${String(d.id).slice(-6)} (${d.disp})`));
}
if (rsC.drift.length || rsR.drift.length) {
  console.error('\n❌ genuine drift 감지 → ABORT (SOP §5-8). freeze 재산출 필요.');
  process.exit(2);
}
console.log('  → 재-스윕 clean (drift 0)\n');

// ── 2) 멱등 UPDATE (set-based FROM VALUES, old-value guard) ────────────────
async function applyTable(table, col, freeze) {
  const todo = freeze; // 멱등 WHERE 가 already-applied 자연제외
  if (!todo.length) return { table, changed: 0 };
  const values = todo.map((r) => `(${esc(r.id)}::uuid, ${esc(r.old)}, ${esc(r.new)}::text)`).join(',');
  const sql = `WITH v(id, oldv, newv) AS (VALUES ${values})
    UPDATE public.${table} t SET ${col} = v.newv
    FROM v WHERE t.id = v.id AND t.${col} = v.oldv
    RETURNING t.id;`;
  if (!APPLY) { console.log(`  [DRY] ${table}: would UPDATE ≤${todo.length} rows (idempotent guard)`); return { table, changed: 0, dry: true }; }
  const changed = one(await query(sql)).length;
  console.log(`  [APPLY] ${table}: changed=${changed}`);
  return { table, changed };
}
console.log('── UPDATE ──');
const upC = await applyTable('customers', 'phone', fz.customers);
const upR = await applyTable('reservations', 'customer_phone', fz.reservations);

// ── 3) 사후 정합검증 (위반 0 기대) ────────────────────────────────────────
console.log('\n── 사후 정합검증 ──');
const susPred = (col) => `${col} IS NOT NULL AND ${col} NOT LIKE 'DUMMY-%' AND ${col} <> '+821000000000'
   AND ${col} !~ '^\\+82(1[016789]\\d{7,8})$' AND ${col} !~ '^\\+(?!82)[1-9]\\d{6,14}$'`;
const cViol = one(await query(`SELECT count(*)::int n FROM public.customers WHERE ${susPred('phone')};`))[0].n;
const rViol = one(await query(`SELECT count(*)::int n FROM public.reservations WHERE ${susPred('customer_phone')};`))[0].n;
console.log(`  잔존 위반: customers=${cViol}  reservations=${rViol}  (APPLY 후 기대 0)`);

// per-row after-image (off-git capture)
if (APPLY) {
  const cap = { note: 'OFF-GIT — apply capture', applied_utc: new Date().toISOString(),
    customers_changed: upC.changed, reservations_changed: upR.changed,
    residual_violation_after: { customers: cViol, reservations: rViol },
    customers: fz.customers.map((r) => ({ id: r.id, old: r.old, new: r.new, disp: r.disposition })),
    reservations: fz.reservations.map((r) => ({ id: r.id, old: r.old, new: r.new, disp: r.disposition })) };
  writeFileSync(`${OUT}/apply_capture.json`, JSON.stringify(cap, null, 2));
  console.log(`  apply-capture(off-git): ${OUT}/apply_capture.json`);
}

const ok = APPLY ? (cViol === 0 && rViol === 0) : true;
console.log('════════════════════════════════════');
console.log(APPLY ? `APPLY 종합: ${ok ? '✅ 위반 0 (Step3 VALIDATE 준비됨)' : '❌ 잔존 위반 존재'}` : 'DRY 완료 (--apply 로 실행)');
process.exit(ok ? 0 : 1);
