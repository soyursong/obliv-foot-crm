/**
 * T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL
 * ── DRY-RUN + FREEZE-SET SELECT + ARCHIVE-FIRST PREP (READ-ONLY) ──
 *
 * ⚠⚠ 이 스크립트는 SELECT 만 수행한다. package_sessions 를 포함해 어떤 write 도 하지 않는다.
 *    실제 prod UPDATE 는 2중 하드게이트(박민지 comp-transparency ack + supervisor DB-GATE GO-token)
 *    충족 후 별도 _apply 스크립트로만 집행한다. (apply_before_go 금지)
 *
 * SOP: data_correction_backfill_sop
 *  1) archive-first  : 대상행 before-image 를 JSON 아카이브로 산출(가역 근거).
 *  2) freeze set     : PK(id) VALUES 로 정확 행수 확정. blanket/단일-count 술어 UPDATE 금지.
 *  4) 원장 무접점    : payments/purchase/service_charges 무접촉. package_sessions.unit_price 스냅샷만.
 *  5) SET 값 SSOT    : 부모 package 의 type-matched <session_type>_unit_price (하드코딩 금지).
 *                      = SalesStaffTab.currentUnitPrice() parity. 기대와 다르면 ABORT.
 *  7) under-correct ≫ over-correct.
 *
 * 대상 술어 (DA CONSULT-REPLY MSG-20260811-145931-j54p, zero-snapshot genuine class):
 *   session_type IN ('trial','unheated_laser')
 *   AND unit_price = 0
 *   AND status = 'used'  (deleted 제외)
 *   AND package.status = 'active'  (활성)
 *   AND package.<type>_unit_price > 0   (진성 미연동 — legit-0 제외)
 *   AND chart NOT IN red-box 4 (F-5537/F-5727/F-5668/F-5538 = 자식 CHARTEDIT 소관·disjoint)
 *
 * 기대: trial 28 + unheated_laser 3 = 31행 (≈329,000원). 카운트 불일치 시 DRIFT 경고.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

const RED_BOX = new Set(['F-5537', 'F-5727', 'F-5668', 'F-5538', '5537', '5727', '5668', '5538']);
const TYPES = ['trial', 'unheated_laser'];
const TYPE_PRICE_COL = { trial: 'trial_unit_price', unheated_laser: 'unheated_unit_price' };

async function fetchAll(table, columns, filter) {
  const out = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < PAGE) break;
  }
  return out;
}

// ── 1. 후보 세션: type IN(...) AND status='used' AND deleted_at IS NULL ──
const sessions = await fetchAll(
  'package_sessions',
  'id, package_id, check_in_id, session_number, session_type, session_date, unit_price, surcharge, status, deleted_at, created_at',
  (q) => q.in('session_type', TYPES).eq('status', 'used').is('deleted_at', null)
);

// unit_price = 0 (진성 zero-snapshot). NULL 은 별도 리포트만(freeze 제외).
const zeroSnap = sessions.filter((s) => s.unit_price === 0);
const nullSnap = sessions.filter((s) => s.unit_price == null);

// ── 2. 부모 package 조인 ──
const pkgIds = [...new Set(zeroSnap.map((s) => s.package_id).filter(Boolean))];
const pkgs = pkgIds.length
  ? await fetchAll('packages', 'id, customer_id, status, package_name, trial_unit_price, unheated_unit_price, heated_unit_price', (q) => q.in('id', pkgIds))
  : [];
const pkgById = new Map(pkgs.map((p) => [p.id, p]));

// ── 3. customer chart_number 조인 (red-box 식별) ──
const custIds = [...new Set(pkgs.map((p) => p.customer_id).filter(Boolean))];
const custs = custIds.length
  ? await fetchAll('customers', 'id, chart_number, name', (q) => q.in('id', custIds))
  : [];
const custById = new Map(custs.map((c) => [c.id, c]));

// ── 4. 분류 ──
const freeze = [];       // 진성 미연동 = 정정 대상 (활성∩used∩pkg.price>0∩red-box 제외)
const excluded = { no_pkg: [], pkg_not_active: [], legit_zero: [], red_box: [], abort_after_zero: [] };

for (const s of zeroSnap) {
  const pkg = pkgById.get(s.package_id);
  if (!pkg) { excluded.no_pkg.push(s); continue; }
  if (pkg.status !== 'active') { excluded.pkg_not_active.push({ s, pkgStatus: pkg.status }); continue; }
  const priceCol = TYPE_PRICE_COL[s.session_type];
  const after = pkg[priceCol] ?? 0;
  const cust = custById.get(pkg.customer_id);
  const chart = cust?.chart_number ?? null;
  // legit-0: 부모 단가도 0 → 진성 미연동 아님, 제외
  if (!(after > 0)) { excluded.legit_zero.push({ s, chart, after }); continue; }
  // red-box 4 = 자식 CHARTEDIT 소관, disjoint 제외
  if (chart && (RED_BOX.has(String(chart)) || RED_BOX.has(`F-${chart}`))) { excluded.red_box.push({ s, chart, after }); continue; }
  // materiality: after==0 이면 위에서 걸러짐. 방어적 재확인.
  if (after === 0) { excluded.abort_after_zero.push({ s, chart }); continue; }
  freeze.push({
    id: s.id,
    package_id: s.package_id,
    check_in_id: s.check_in_id,
    session_type: s.session_type,
    session_number: s.session_number,
    session_date: s.session_date,
    chart_number: chart,
    customer_name: cust?.name ?? null,
    package_name: pkg.package_name,
    before_unit_price: s.unit_price,
    after_unit_price: after,     // SSOT = pkg.<type>_unit_price
    price_col: priceCol,
    surcharge: s.surcharge,
    delta: after - (s.unit_price ?? 0),
  });
}

const byType = (t) => freeze.filter((r) => r.session_type === t);
const trial = byType('trial');
const unheated = byType('unheated_laser');
const totalDelta = freeze.reduce((sum, r) => sum + r.delta, 0);

// ── 5. 출력 ──
console.log('═══════════════════════════════════════════════════════════════');
console.log('  T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL');
console.log('  DRY-RUN + FREEZE-SET + ARCHIVE-FIRST PREP  (READ-ONLY, NO WRITE)');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`후보(type∈{trial,unheated_laser} & used & !deleted): ${sessions.length}행`);
console.log(`  ├ unit_price=0 : ${zeroSnap.length}행`);
console.log(`  └ unit_price=NULL(freeze 제외·리포트만): ${nullSnap.length}행\n`);

console.log('── 제외 사유별 ──');
console.log(`  부모 package 없음        : ${excluded.no_pkg.length}`);
console.log(`  package 비활성(refund/cancel): ${excluded.pkg_not_active.length}  ${excluded.pkg_not_active.map(e=>e.pkgStatus).join(',')}`);
console.log(`  legit-0(부모 단가=0)     : ${excluded.legit_zero.length}`);
console.log(`  red-box 4(자식 CHARTEDIT): ${excluded.red_box.length}  ${excluded.red_box.map(e=>`${e.chart}(${won(e.after)})`).join(', ')}`);
console.log(`  materiality ABORT(after=0): ${excluded.abort_after_zero.length}\n`);

console.log('═══ FREEZE SET (정정 대상, PK id 확정) ═══');
console.log(`  trial          : ${trial.length}행 (기대 28)`);
console.log(`  unheated_laser : ${unheated.length}행 (기대 3)`);
console.log(`  ─────────────────────────────`);
console.log(`  TOTAL          : ${freeze.length}행 (기대 31)`);
console.log(`  보정 매출 합계(Σdelta): ${won(totalDelta)}원 (기대 ≈329,000)\n`);

const fmt = (r) => `  ${r.session_type.padEnd(14)} | chart ${String(r.chart_number ?? '-').padEnd(8)} | ${String(r.customer_name??'-').padEnd(6)} | ps ${String(r.id).slice(0,8)} | ${won(r.before_unit_price)} → ${won(r.after_unit_price)} (${r.price_col}) | ${r.session_date ?? '-'}`;
console.log('── trial ──');
trial.forEach((r) => console.log(fmt(r)));
console.log('── unheated_laser ──');
unheated.forEach((r) => console.log(fmt(r)));

// ── DRIFT / ABORT 게이트 ──
console.log('\n── 게이트 판정 ──');
const warns = [];
if (trial.length !== 28) warns.push(`⚠ DRIFT: trial ${trial.length} ≠ 기대 28`);
if (unheated.length !== 3) warns.push(`⚠ DRIFT: unheated_laser ${unheated.length} ≠ 기대 3`);
if (freeze.length !== 31) warns.push(`⚠ DRIFT: total ${freeze.length} ≠ 기대 31`);
if (excluded.abort_after_zero.length) warns.push(`⛔ ABORT: after=0 materiality 위반 ${excluded.abort_after_zero.length}건`);
const zeroAfter = freeze.filter((r) => r.after_unit_price === 0);
if (zeroAfter.length) warns.push(`⛔ ABORT: freeze 내 after=0 ${zeroAfter.length}건 (SSOT 위반)`);
if (warns.length === 0) console.log('  ✅ 카운트/기대 일치. materiality 위반 없음. archive-first 산출 진행.');
else warns.forEach((w) => console.log('  ' + w));

// ── ARCHIVE-FIRST: before-image 아카이브 산출 (가역 근거) ──
const stamp = process.env.RUN_STAMP || 'DRYRUN';
mkdirSync(new URL('../_artifacts/', import.meta.url), { recursive: true });
const archivePath = new URL(`../_artifacts/T-20260811-TRIALDEDUCT-ZEROSNAP_before_image_${stamp}.json`, import.meta.url);
const archive = {
  ticket: 'T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL',
  generated_stamp: stamp,
  db: env.VITE_SUPABASE_URL,
  sop: 'data_correction_backfill_sop',
  predicate: "session_type IN ('trial','unheated_laser') AND unit_price=0 AND status='used' AND deleted_at IS NULL AND package.status='active' AND package.<type>_unit_price>0 AND chart NOT IN red-box4",
  reconstruction_rule: 'package_sessions.unit_price := packages.<session_type>_unit_price (SalesStaffTab.currentUnitPrice parity)',
  ledger_untouched: ['payments', 'purchase', 'service_charges'],
  counts: { candidates: sessions.length, zeroSnap: zeroSnap.length, nullSnap: nullSnap.length, freeze: freeze.length, trial: trial.length, unheated_laser: unheated.length },
  expected: { trial: 28, unheated_laser: 3, total: 31, delta_won: 329000 },
  total_delta_won: totalDelta,
  gate_warnings: warns,
  excluded: {
    no_pkg: excluded.no_pkg.map((s) => s.id),
    pkg_not_active: excluded.pkg_not_active.map((e) => ({ id: e.s.id, status: e.pkgStatus })),
    legit_zero: excluded.legit_zero.map((e) => ({ id: e.s.id, chart: e.chart })),
    red_box: excluded.red_box.map((e) => ({ id: e.s.id, chart: e.chart })),
  },
  // PK VALUES freeze set + before-image (each row full before state for rollback)
  freeze_set: freeze,
};
writeFileSync(archivePath, JSON.stringify(archive, null, 2));
console.log(`\n📦 archive-first before-image → _artifacts/${archivePath.pathname.split('/').pop()}`);
console.log('   (PK VALUES freeze + before unit_price = rollback 근거. apply−1 re-freeze 로 DRIFT 재확인.)');
console.log('\n⚠ NO WRITE PERFORMED. prod UPDATE 는 [박민지 comp ack + supervisor GO-token] 후 _apply 스크립트로만.');
