/**
 * T-20260811-foot-CHARTEDIT-TRIAL-PRICE-BACKFILL — PROD APPLY (per-row, freeze-only)
 *
 * ⚠⚠ GO-token 게이트: supervisor DB-GATE GO-token 파일 경로를 --go=<path> 로 넘겨야만 집행.
 *    apply_before_go 금지 — GO-token 부재 시 즉시 exit(무영속).
 *
 * 절차(Data-Correction Backfill SOP):
 *   1. apply−1 re-freeze: 4 PK 재조회 → before-image 불일치 시 즉시 ABORT (DRIFT).
 *   2. SET 값 = 각 행 live package.trial_unit_price (하드코딩 금지). 10,000 아니면 ABORT.
 *   3. per-row UPDATE (4 PK만). rows-affected==1/행 검증 (cross-CRM write rowcheck 표준).
 *   4. POSTCHECK: 4행 unit_price==trial_unit_price / 4행 외 무변경.
 *
 * 원장(payments/purchase/service_charges) 무접촉 — package_sessions.unit_price 스냅샷만.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const goArg = process.argv.find((a) => a.startsWith('--go='));
if (!goArg) { console.log('❌ ABORT: --go=<GO-token 경로> 필요. GO-token 前 apply 금지(apply_before_go).'); process.exit(9); }
const goPath = goArg.slice('--go='.length);
if (!existsSync(goPath)) { console.log(`❌ ABORT: GO-token 파일 없음: ${goPath}`); process.exit(9); }
console.log(`✅ GO-token 확인: ${goPath}`);
console.log(readFileSync(goPath, 'utf8'));

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

const BEFORE = JSON.parse(readFileSync(new URL('../rollback/T-20260811-foot-CHARTEDIT-TRIAL-PRICE-BACKFILL_archive_before.json', import.meta.url), 'utf8'));
const FREEZE = BEFORE.rows;
const FREEZE_PK = FREEZE.map((r) => r.pk);

// ── STEP 1: apply−1 re-freeze DRIFT check ──
console.log('\n── STEP 1: apply−1 re-freeze DRIFT check ──');
const { data: live, error: rErr } = await sb
  .from('package_sessions')
  .select(`id, unit_price, session_type, session_date, performed_by, status, deleted_at,
           packages!inner(id, trial_unit_price)`)
  .in('id', FREEZE_PK);
if (rErr) throw new Error('refreeze: ' + rErr.message);
if (live.length !== 4) { console.log(`❌ ABORT(DRIFT): 재조회 ${live.length}행 ≠ 4.`); process.exit(2); }

const liveById = new Map(live.map((r) => [r.id, r]));
let drift = false;
for (const b of FREEZE) {
  const l = liveById.get(b.pk);
  if (!l) { console.log(`❌ DRIFT: PK ${b.pk} 소실.`); drift = true; continue; }
  const mism = [];
  if ((l.unit_price ?? 0) !== b.unit_price) mism.push(`unit_price ${l.unit_price}≠${b.unit_price}`);
  if (l.session_type !== b.session_type) mism.push(`session_type ${l.session_type}≠${b.session_type}`);
  if (l.session_date !== b.session_date) mism.push(`session_date ${l.session_date}≠${b.session_date}`);
  if (l.performed_by !== b.performed_by) mism.push('performed_by');
  if (l.status !== b.status) mism.push(`status ${l.status}≠${b.status}`);
  if ((l.deleted_at ?? null) !== (b.deleted_at ?? null)) mism.push('deleted_at');
  if (mism.length) { console.log(`❌ DRIFT ${b.pk}: ${mism.join(', ')}`); drift = true; }
}
if (drift) { console.log('\n❌❌ ABORT: before-image 불일치. apply 중단, planner 보고.'); process.exit(2); }
console.log('✅ re-freeze OK — 4행 before-image 일치.');

// ── STEP 2: SET 값 = live trial_unit_price 검증 ──
console.log('\n── STEP 2: SET 값 검증 (live trial_unit_price) ──');
const setMap = new Map();
for (const l of live) {
  const tup = l.packages?.trial_unit_price;
  if (tup == null || tup <= 0) { console.log(`❌ ABORT: ${l.id} trial_unit_price 무효(${tup}).`); process.exit(3); }
  if (tup !== 10000) { console.log(`❌ ABORT: ${l.id} trial_unit_price ${won(tup)} ≠ owner 기대 10,000. planner 재확인(하드코딩 금지).`); process.exit(3); }
  setMap.set(l.id, tup);
  console.log(`  ${l.id} → SET unit_price=${won(tup)}`);
}

// ── STEP 3: per-row UPDATE (4 PK only) + rows-affected 검증 ──
console.log('\n── STEP 3: per-row UPDATE ──');
for (const [pk, tup] of setMap) {
  const { data, error } = await sb
    .from('package_sessions')
    .update({ unit_price: tup })
    .eq('id', pk)
    .eq('unit_price', 0)      // 방어: 여전히 0인 행만 (재실행 idempotent + drift guard)
    .select('id, unit_price');
  if (error) { console.log(`❌ UPDATE 실패 ${pk}: ${error.message}`); process.exit(4); }
  if (!data || data.length !== 1) { console.log(`❌ ABORT: ${pk} rows-affected=${data?.length ?? 0} ≠ 1 (silent write-fail 방지).`); process.exit(4); }
  console.log(`  ✓ ${pk} unit_price → ${won(data[0].unit_price)}`);
}

// ── STEP 4: POSTCHECK ──
console.log('\n── STEP 4: POSTCHECK ──');
const { data: post, error: pErr } = await sb
  .from('package_sessions')
  .select('id, unit_price, packages!inner(trial_unit_price)')
  .in('id', FREEZE_PK);
if (pErr) throw new Error('postcheck: ' + pErr.message);
let ok = true;
for (const r of post) {
  const good = r.unit_price === r.packages?.trial_unit_price && r.unit_price === 10000;
  console.log(`  ${r.id} | unit_price=${won(r.unit_price)} | trial_up=${won(r.packages?.trial_unit_price)} ${good ? '✓' : '❌'}`);
  if (!good) ok = false;
}
console.log(ok
  ? '\n✅✅ APPLY 완료 — 4행 unit_price==trial_unit_price(10,000). archive 경로: rollback/..._archive_before.json'
  : '\n❌ POSTCHECK 실패 — rollback SQL 검토.');
