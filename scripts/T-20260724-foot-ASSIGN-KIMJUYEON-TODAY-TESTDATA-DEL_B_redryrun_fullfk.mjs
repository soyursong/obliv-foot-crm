/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL (B) 서류테스트2 완료건 — RE-DRY-RUN (READ-ONLY, WRITE 0)
 *
 * DA verdict = CONDITIONAL-GO (MSG-20260724-214823-roen, DA-...-FKCLOSURE-PURGE-GATE.md §1 heavy archive-first).
 * 본 러너는 hard-DELETE 착수 아님. READ-ONLY 재-dry-run 만. 3게이트(총괄 confirm / supervisor DB-GATE / 형 apply_gate) 대기.
 *
 * 개선점 (ref commit 192700eb 동적 census 러너 계승·확장):
 *   기존 192700eb 는 customers/check_ins 만 부모로 walk → 본 러너는 payments/service_charges/
 *   package_sessions/check_ins/packages/customers 전부를 부모로 fixpoint walk (children→grandchildren
 *   소진까지). hand-enum undercount 재현(foot dummy gate 4차 22→30 교훈) 차단.
 *
 * 단계:
 *   (0) canary   — BEGIN;<무해 COMMENT>;ROLLBACK; → ROLLBACK 실효 선증명(No-Persistence Protocol §1).
 *   (1) census   — full-FK fixpoint walk (READ-ONLY). confdeltype 분류(a/r 차단자·n SET NULL silent·c CASCADE·d SET DEFAULT).
 *                  a/r/n 보유 자식 0 확인. 아침 스냅샷 미포함 자식 재검출.
 *   (Q1) revenue — service_charges/payments/customers 매출정합 fail-closed 증거. CLEAR-A(is_simulation=TRUE) 판정.
 *                  CLEAR-B(accounting period freeze + closing payload 미발사 + fct 미포함) 는 데이터레이크 접점 → 존재만 probe·DA lane 위임.
 *   (PKG) package — 01ddef31 기계확증: package_payments=0 + insurance/closing_manual_payments/refund=0 + 회차 credit money=0.
 *   (COL) columns — 대상 테이블 전-컬럼 명시열거(information_schema.columns, SELECT * 금지) → net-loss=0 archive 완전성.
 *   ★ WRITE 0: trial DELETE 미실행. prod 무변경.
 *
 * 시크릿: SUPABASE_ACCESS_TOKEN or ~/.config/medibuilder-secrets/foot-supabase-pat
 * 사용:  node scripts/T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_B_redryrun_fullfk.mjs
 */
import fs from 'node:fs';
import os from 'node:os';

const REF = 'rxlomoozakkjesdqjtvd';

// ── (B) freeze scope (from ..._FREEZE.json B_seoryutest2) ──────────────────────
const CHECK_IN = ['7f3f8b79-eb3d-45f2-afab-205d52bc4a70'];
const PAYMENTS = ['3fc1f13f-aae9-484a-af15-dbf20213fad8','69090734-1f12-45e1-93bc-a3fcc5c5102f',
                  'a7343e08-30d9-4957-993d-741a5362884e','6319a7bc-8c31-4d31-83b6-8d45713def88'];
const SERVICE_CHARGES = ['6ffa7bf5-5ab1-4089-8c28-f2f36a7f62ea','3b972fa1-918a-426f-8e88-d4cd51b7a7ee'];
const PACKAGE_SESSIONS = ['88040473-e1ee-4dc0-8e70-89645e32b746'];
const PACKAGES = ['01ddef31-ca48-4c57-ac4d-8c2696cfe6ad'];
const ASSIGNMENT_ACTIONS = ['914fb71f-6a53-4c44-a6b5-732c25610db9','0627a6b3-c508-4916-b278-613b75d067d2'];
// customer id 는 런타임 resolve (check_ins.customer_id).
const CANARY = '__DRYRUN_CANARY_T20260724_B_SEORYU2__';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
try { if (!TOKEN) TOKEN = fs.readFileSync(os.homedir() + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim(); } catch {}
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ PAT 미제공'); process.exit(1); }

const arr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(',')}]::uuid[]`;
const lit = (a) => a.map((x) => `'${x}'`).join(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(sql) {
  // 429 ThrottlerException 대응: 지수 backoff 재시도 + 매 쿼리 최소 간격(silent empty 방지)
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (r.status === 429 || /ThrottlerException|Too Many Requests/.test(t)) { await sleep(1500 * (attempt + 1)); continue; }
    let j = null; try { j = JSON.parse(t); } catch {}
    await sleep(350); // 정상 응답에도 최소 간격 유지
    return { ok: r.ok, body: t, rows: Array.isArray(j) ? j : null };
  }
  return { ok: false, body: 'THROTTLED_GIVEUP', rows: null };
}
const DELMAP = { a: 'NO ACTION(a·blocker)', r: 'RESTRICT(r·blocker)', n: 'SET NULL(n·silent 순소실)', c: 'CASCADE(c)', d: 'SET DEFAULT(d)' };

console.log(`# (B) 서류테스트2 RE-DRY-RUN full-FK fixpoint · ${new Date().toISOString()} · READ-ONLY(WRITE 0)\n`);

// ── (0) canary — ROLLBACK 실효 선증명 ──────────────────────────────────────────
{
  await q(`BEGIN; COMMENT ON TABLE public.check_ins IS '${CANARY}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.check_ins'::regclass) AS c`);
  const persisted = c.rows?.[0]?.c === CANARY;
  console.log(`── (0) canary ROLLBACK 실효: ${persisted ? '❌ 잔존(ABORT)' : '✅ 무영속'}`);
  if (persisted) { console.error('CANARY_PERSISTED — 중단'); process.exit(1); }
}

// ── resolve customer_id ────────────────────────────────────────────────────────
const cust = await q(`SELECT customer_id FROM public.check_ins WHERE id = ANY(${arr(CHECK_IN)})`);
const CUSTOMER = [...new Set((cust.rows || []).map((r) => r.customer_id).filter(Boolean))];
console.log(`── customer_id(서류테스트2 F-5113) = ${JSON.stringify(CUSTOMER)}`);

// ── (1) full-FK fixpoint census (READ-ONLY) ────────────────────────────────────
// seed frontier: {table: Set(pk ids)}. 각 부모의 자식 FK edge 를 pg_constraint 로 열거,
// 매칭 자식 카운트 + PK 수집 → CASCADE 자식은 새 frontier 로 재귀(grandchildren 소진).
const seed = {
  customers: new Set(CUSTOMER),
  check_ins: new Set(CHECK_IN),
  payments: new Set(PAYMENTS),
  service_charges: new Set(SERVICE_CHARGES),
  package_sessions: new Set(PACKAGE_SESSIONS),
  packages: new Set(PACKAGES),
  assignment_actions: new Set(ASSIGNMENT_ACTIONS),
};
const discovered = {}; for (const t in seed) discovered[t] = new Set(seed[t]);

// PK 컬럼 캐시
const pkCache = {};
async function pkCol(tbl) {
  if (pkCache[tbl] !== undefined) return pkCache[tbl];
  const r = await q(`SELECT a.attname FROM pg_index i
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid='public.${tbl}'::regclass AND i.indisprimary`);
  const col = r.rows?.length === 1 ? r.rows[0].attname : (r.rows?.[0]?.attname || 'id');
  pkCache[tbl] = col; return col;
}

const edges = [];           // {parent, child, childCol, dt, count, silentOrBlocker}
const arRnFindings = [];     // a/r/n edges with count>0
let queue = Object.keys(seed).filter((t) => seed[t].size > 0);
const walked = new Set();

while (queue.length) {
  const parent = queue.shift();
  if (walked.has(parent)) continue;
  walked.add(parent);
  const pids = [...discovered[parent]];
  if (!pids.length) continue;

  // parent 를 참조하는 모든 FK (child rel, child col, confdeltype)
  const fkRows = (await q(`SELECT rel.relname ct, att.attname cc, c.confdeltype dt
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_class pf ON pf.oid=c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ord) ON true
    JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=k.attnum
    WHERE c.contype='f' AND pf.relname='${parent}' AND pf.relnamespace='public'::regnamespace
      AND rel.relnamespace='public'::regnamespace`)).rows || [];

  for (const e of fkRows) {
    const cpk = await pkCol(e.ct);
    const sel = await q(`SELECT ${cpk} AS pk FROM public.${e.ct} WHERE ${e.cc} = ANY(${arr(pids)})`);
    const cnt = sel.rows?.length || 0;
    const rec = { parent, child: e.ct, childCol: e.cc, dt: e.dt, count: cnt };
    if (cnt > 0) {
      edges.push(rec);
      if (e.dt === 'a' || e.dt === 'r' || e.dt === 'n') arRnFindings.push(rec);
      // CASCADE(c)/SET NULL(n)/SET DEFAULT(d) 모두 순소실/변형 유발 자식 → frontier 확장(CASCADE 만 재귀 소실)
      if (!discovered[e.ct]) discovered[e.ct] = new Set();
      let added = false;
      for (const r of sel.rows) if (r.pk && !discovered[e.ct].has(r.pk)) { discovered[e.ct].add(r.pk); added = true; }
      if (added && e.dt === 'c' && !walked.has(e.ct)) queue.push(e.ct); // CASCADE 자식만 grandchild 재귀
    }
  }
}

console.log(`\n── (1) full-FK fixpoint census (non-zero edges):`);
if (!edges.length) console.log('     (자식 edge 없음)');
for (const e of edges) console.log(`     ${e.parent} ← ${e.child}.${e.childCol} = ${e.count} [${DELMAP[e.dt] || e.dt}]`);
console.log(`\n── fixpoint 소실 대상 (parent scope 포함):`);
let netLoss = 0;
for (const t of Object.keys(discovered)) {
  const n = discovered[t].size;
  if (n) { console.log(`     ${t} = ${n}`); netLoss += n; }
}
console.log(`     ── net-loss total (CASCADE closure, seed+grandchildren) = ${netLoss}`);
console.log(`\n── ★ a/r(차단자)·n(SET NULL silent 순소실) 보유 자식: ${arRnFindings.length ? '⚠ 발견' : '✅ 0 (전부 CASCADE/scope-내)'}`);
for (const f of arRnFindings) console.log(`     ⚠ ${f.parent} ← ${f.child}.${f.childCol} = ${f.count} [${DELMAP[f.dt]}]`);

// ── scope-expansion: seed 밖에서 새로 끌려들어온 테이블/행 (아침 hand-enum undercount 재현) ──
const seedTables = new Set(Object.keys(seed));
const scopeExpansion = [];
for (const t of Object.keys(discovered)) {
  if (!seedTables.has(t) && discovered[t].size > 0) scopeExpansion.push({ table: t, count: discovered[t].size });
}
console.log(`\n── ★★ SCOPE-EXPANSION (총괄-confirmed·DA-adjudicated 스코프 밖, census 신규 검출):`);
if (!scopeExpansion.length) console.log('     (없음 — 확정 스코프 = census closure 일치)');
for (const s of scopeExpansion) console.log(`     ⚠ ${s.table} = ${s.count}  ← 아침 스냅샷/확정스코프 미포함`);

// ── (Q1) 매출정합 fail-closed 증거 (hinge = service_charges) ────────────────────
console.log(`\n── (Q1) 매출정합 fail-closed 증거 (hinge = service_charges 명세 grain):`);
// is_simulation 컬럼 존재 여부 (customers/payments/service_charges)
const simCols = (await q(`SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='is_simulation'
    AND table_name IN ('customers','payments','service_charges')`)).rows || [];
const hasSim = new Set(simCols.map((r) => r.table_name));
console.log(`   is_simulation 컬럼 보유 테이블: ${[...hasSim].join(', ') || '(없음)'}`);

async function simCheck(tbl, ids) {
  if (!hasSim.has(tbl) || !ids.length) return { table: tbl, hasCol: hasSim.has(tbl), total: ids.length, sim_true: null };
  const r = (await q(`SELECT count(*) FILTER (WHERE is_simulation IS TRUE) sim_true,
    count(*) FILTER (WHERE is_simulation IS NOT TRUE) sim_notrue, count(*) tot
    FROM public.${tbl} WHERE id IN (${lit(ids)})`)).rows?.[0];
  return { table: tbl, hasCol: true, ...r };
}
const simCust = await simCheck('customers', CUSTOMER);
const simPay = await simCheck('payments', PAYMENTS);
const simSc = await simCheck('service_charges', SERVICE_CHARGES);
for (const s of [simCust, simPay, simSc]) console.log(`   ${JSON.stringify(s)}`);
const clearA = [simCust, simPay, simSc].every((s) => s.hasCol && Number(s.sim_notrue) === 0 && Number(s.sim_true) === Number(s.tot) && Number(s.tot) > 0);
console.log(`   → CLEAR-A (cust+payments+service_charges 전부 is_simulation=TRUE, IS NOT TRUE 유니버스 밖): ${clearA ? '✅ CLEAR' : '❌ 미CLEAR'}`);

// CLEAR-B 데이터레이크 접점 probe (존재만 — 대사는 DA/dev-sales lane)
console.log(`   [CLEAR-B probe — 데이터레이크 접점, 대사는 DA/dev-sales lane]`);
const scMeta = (await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='service_charges'
    AND column_name IN ('service_date','charge_date','created_at','accounting_date')`)).rows?.map((r) => r.column_name) || [];
const payAcct = (await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments' AND column_name IN ('accounting_date','paid_at','created_at')`)).rows?.map((r) => r.column_name) || [];
console.log(`   service_charges 회계귀속 후보컬럼: ${scMeta.join(', ') || '(none)'}`);
console.log(`   payments 회계귀속 후보컬럼: ${payAcct.join(', ') || '(none)'}`);
const fctExists = (await q(`SELECT to_regclass('public.fct_revenue_daily') AS t`)).rows?.[0]?.t;
const closingTbl = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
  AND table_name ILIKE '%closing%'`)).rows?.map((r) => r.table_name) || [];
console.log(`   fct_revenue_daily in foot DB: ${fctExists || 'ABSENT (데이터레이크 별 lane)'}`);
console.log(`   closing 관련 테이블: ${closingTbl.join(', ') || '(none in foot DB)'}`);
// 회계귀속일 실제값 (소급여부 판정용)
if (payAcct.length) {
  const col = payAcct.includes('accounting_date') ? 'accounting_date' : payAcct[0];
  const pv = (await q(`SELECT ${col} FROM public.payments WHERE id IN (${lit(PAYMENTS)}) ORDER BY 1`)).rows?.map((r) => r[col]);
  console.log(`   payments.${col} 값: ${JSON.stringify(pv)}`);
}

// ── (PKG) package 01ddef31 기계확증 ────────────────────────────────────────────
console.log(`\n── (PKG) package 01ddef31 (AF레이저, memo=테스트용환불예정) 기계확증:`);
// package_payments (선수금 원장)
const ppTbl = (await q(`SELECT to_regclass('public.package_payments') AS t`)).rows?.[0]?.t;
if (ppTbl) {
  const pp = (await q(`SELECT count(*) c, coalesce(sum(amount),0) sum_amount FROM public.package_payments WHERE package_id IN (${lit(PACKAGES)})`)).rows?.[0];
  console.log(`   package_payments(선수금 원장): rows=${pp.c}, sum_amount=${pp.sum_amount} ${Number(pp.c) === 0 ? '✅ 0행' : '⚠'}`);
} else console.log(`   package_payments 테이블 ABSENT`);
// packages 행 전체 (paid/insurance/closing/refund/credit 컬럼 명시 확인)
const pkgCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' ORDER BY ordinal_position`)).rows?.map((r) => r.column_name) || [];
console.log(`   packages 컬럼: ${pkgCols.join(', ')}`);
const moneyCols = pkgCols.filter((c) => /paid|insurance|closing|refund|amount|credit|remaining|used|balance|deposit/i.test(c));
if (moneyCols.length) {
  const pv = (await q(`SELECT ${moneyCols.map((c) => `"${c}"`).join(', ')} FROM public.packages WHERE id IN (${lit(PACKAGES)})`)).rows?.[0];
  console.log(`   packages money 필드값: ${JSON.stringify(pv)}`);
}
// package_sessions 회차 credit (잔여/사용/환불대기)
const psCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='package_sessions' ORDER BY ordinal_position`)).rows?.map((r) => r.column_name) || [];
const psState = (await q(`SELECT id, session_number, status, session_type, unit_price FROM public.package_sessions WHERE package_id IN (${lit(PACKAGES)}) ORDER BY session_number`)).rows || [];
console.log(`   package_sessions(회차) of 01ddef31: ${JSON.stringify(psState)}`);
console.log(`   (삭제순서 검증: package_session 먼저 → package session0+payments0 재검증 → orphan package)`);

// ── (FORMS) form_submissions published/immutable 상태 (서류테스트2 = 의무기록 성격) ──
console.log(`\n── (FORMS) form_submissions closure 상태 (published 의무기록 불변 트리거 대상 여부):`);
let formsPublished = [];
if (discovered.form_submissions && discovered.form_submissions.size) {
  const fids = [...discovered.form_submissions];
  const fcols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='form_submissions' AND column_name IN ('status','is_published','published_at','form_type','signed_at')`)).rows?.map((r) => r.column_name) || [];
  const selCols = ['id', ...fcols].map((c) => `"${c}"`).join(', ');
  formsPublished = (await q(`SELECT ${selCols} FROM public.form_submissions WHERE id IN (${lit(fids)})`)).rows || [];
  console.log(`   form_submissions(${fids.length}) 상태컬럼=${fcols.join(',')||'(none)'}:`);
  for (const f of formsPublished) console.log(`     ${JSON.stringify(f)}`);
} else console.log('   (form_submissions closure 없음)');

// ── (COL) 전-컬럼 명시열거 (net-loss=0 archive 완전성, SELECT * 금지) ────────────
console.log(`\n── (COL) 대상 테이블 전-컬럼 명시열거 (information_schema.columns):`);
const tables = ['customers','check_ins','payments','service_charges','package_sessions','packages','assignment_actions'];
const colMap = {};
for (const t of tables) {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position`)).rows?.map((r) => r.column_name) || [];
  colMap[t] = cols;
  console.log(`   ${t} (${cols.length}): ${cols.join(', ')}`);
}

// ── published 의무기록 불변 트리거 노출 여부 ────────────────────────────────────
const immTrig = (await q(`SELECT tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal AND tgname ILIKE '%published_immutable%'`)).rows || [];
console.log(`\n── published 의무기록 불변 트리거: ${immTrig.length ? immTrig.map((r) => r.tgname + '@' + r.relname).join(', ') : '(대상 테이블에 미노출)'}`);

// ── 산출 evidence JSON ─────────────────────────────────────────────────────────
const evidence = {
  ticket: 'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL', scope: 'B_seoryutest2',
  mode: 'READ-ONLY re-dry-run (WRITE 0)', da_verdict: 'CONDITIONAL-GO (MSG-20260724-214823-roen)',
  generated_at_iso: new Date().toISOString(),
  customer_id: CUSTOMER,
  fullfk_edges: edges, net_loss_total: netLoss, discovered_counts: Object.fromEntries(Object.entries(discovered).map(([k, v]) => [k, v.size])),
  ar_n_findings: arRnFindings, scope_expansion: scopeExpansion,
  q1_revenue: { is_simulation_tables: [...hasSim], sim: { customers: simCust, payments: simPay, service_charges: simSc }, clear_a: clearA,
    clear_b_probe: { fct_revenue_daily: fctExists || null, closing_tables: closingTbl, sc_accounting_cols: scMeta, pay_accounting_cols: payAcct } },
  package_01ddef31: { package_payments_present: !!ppTbl, sessions: psState },
  columns: colMap, immutable_triggers: immTrig, form_submissions_state: formsPublished,
};
const out = 'scripts/T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_B_REDRYRUN_EVIDENCE.json';
fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(`\n✅ evidence 저장: ${out}`);
console.log(`\n★ HOLD: hard-DELETE 미실행. 3게이트(총괄 confirm / supervisor DB-GATE / 형 apply_gate) 통과 후에만 apply.`);
