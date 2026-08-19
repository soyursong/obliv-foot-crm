/**
 * T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY — J4 read-only prep 추가
 * 316행 flip-set(false→true, ⑨ already_paid 재분류 대상) CIS.price breakdown
 *   ① 날짜별 합(dev-sales `_FOOT_PKG_BACKFILL_KC_INCL` dict 스키마 = date→amount)
 *   ② 상품별 소계(DA A6 known-correction 등재용)
 * 합계 검증값 = ₩74,630,000 일치 확인.
 *
 * ref: dev-sales REPLY MSG-20260819-142821-35sk · DA CONSULT-REPLY MSG-20260819-141006-126k item(a)
 * planner NEW-TASK MSG-20260819-143117-5u5f
 *
 * READ-ONLY (prod service_role SELECT via Management API, mutation 0).
 * 프리즈 소스 = db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json (commit fea7e6da, 316행/₩74.63M)
 *   → cis_id·price·kst_date 는 프리즈 값 canonical(드리프트 무관), 상품명만 prod read 로 enrich.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const FREEZE = `${REPO}/db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json`;
const EXPECT_TOTAL = 74630000;
const EXPECT_COUNT = 316;

const envLocal = readFileSync(`${REPO}/.env.local`, 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(74)}\n${s}\n${'='.repeat(74)}`);
const won=(n)=>'₩'+Number(n).toLocaleString();

(async () => {
  // ── 프리즈 316 로드 (canonical set·price·date) ──
  const freeze = JSON.parse(readFileSync(FREEZE, 'utf8'));
  const rows = freeze.snapshot.rows.filter(r => r.prev_flag === false); // flip-set(false→true)
  hr(`[0] 프리즈 316 로드 @ ${freeze.remeasured_at_kst} (commit fea7e6da)`);
  const freezeSum = rows.reduce((a,r)=>a+Number(r.price||0),0);
  console.log(`flip-set(prev_flag=false) count=${rows.length} sum=${won(freezeSum)}`);
  if (rows.length !== EXPECT_COUNT || freezeSum !== EXPECT_TOTAL) {
    throw new Error(`FREEZE MISMATCH: count=${rows.length}(exp ${EXPECT_COUNT}) sum=${freezeSum}(exp ${EXPECT_TOTAL}) — 316 재산출 정합 재점검 필요`);
  }
  console.log(`✓ 프리즈 합계 검증 = ${won(EXPECT_TOTAL)} 일치`);

  // ── prod read: 316 cis_id 의 상품명·코드 enrich (READ-ONLY) ──
  hr('[1] prod read — 316 cis_id 상품명 enrich (mutation 0)');
  const ids = rows.map(r => `'${r.cis_id}'`).join(',');
  const svc = await q(`
    SELECT c.id AS cis_id,
           s.name AS service_name,
           s.service_code,
           COALESCE(NULLIF(s.category_label,''), NULLIF(s.category,''), '(무분류)') AS category
    FROM public.check_in_services c
    JOIN public.services s ON s.id = c.service_id
    WHERE c.id IN (${ids});`);
  const svcMap = new Map(svc.map(r => [r.cis_id, r]));
  console.log(`prod enrich 반환 ${svc.length}건 / 프리즈 ${rows.length}건`);
  const missing = rows.filter(r => !svcMap.has(r.cis_id));
  if (missing.length) console.log(`⚠ enrich 누락 ${missing.length}건 (프리즈 price 로 fallback, 상품명='(enrich-miss)')`);

  // ── ① 날짜별 합 (dev-sales dict 스키마: date → amount) ──
  hr('[2] ① 날짜별 합 (dev-sales _FOOT_PKG_BACKFILL_KC_INCL dict = date→amount)');
  const byDate = {};
  const byDateCnt = {};
  for (const r of rows) {
    byDate[r.kst_date] = (byDate[r.kst_date]||0) + Number(r.price||0);
    byDateCnt[r.kst_date] = (byDateCnt[r.kst_date]||0) + 1;
  }
  const dateKeys = Object.keys(byDate).sort();
  for (const d of dateKeys) console.log(`  ${d}  ${won(byDate[d]).padStart(14)}  (${byDateCnt[d]}건)`);
  const dateSum = Object.values(byDate).reduce((a,b)=>a+b,0);
  console.log(`  ── 날짜 ${dateKeys.length}일 합계 = ${won(dateSum)} (${rows.length}건)`);

  // ── ② 상품별 소계 (A6 등재용) ──
  hr('[2] ② 상품별 소계 (DA A6 known-correction 등재용)');
  const byProd = {};
  for (const r of rows) {
    const s = svcMap.get(r.cis_id);
    const key = s ? `${s.service_name}` : '(enrich-miss)';
    const code = s ? (s.service_code||'') : '';
    const cat = s ? s.category : '';
    if (!byProd[key]) byProd[key] = { service_code: code, category: cat, subtotal: 0, count: 0 };
    byProd[key].subtotal += Number(r.price||0);
    byProd[key].count += 1;
  }
  const prodKeys = Object.keys(byProd).sort((a,b)=>byProd[b].subtotal-byProd[a].subtotal);
  for (const p of prodKeys) console.log(`  ${p.padEnd(28)} ${byProd[p].service_code.padEnd(12)} ${won(byProd[p].subtotal).padStart(14)} (${byProd[p].count}건)`);
  const prodSum = prodKeys.reduce((a,p)=>a+byProd[p].subtotal,0);
  console.log(`  ── 상품 ${prodKeys.length}종 합계 = ${won(prodSum)} (${rows.length}건)`);

  // ── 보조: session_type(4종) 소계 ──
  const byType = {};
  for (const r of rows) byType[r.session_type] = (byType[r.session_type]||0) + Number(r.price||0);

  // ── 합계 3중 검증 ──
  hr('[3] 합계 검증 (date-sum == prod-sum == freeze-sum == ₩74,630,000)');
  const ok = dateSum === EXPECT_TOTAL && prodSum === EXPECT_TOTAL && freezeSum === EXPECT_TOTAL;
  console.log(`date=${won(dateSum)} prod=${won(prodSum)} freeze=${won(freezeSum)} expect=${won(EXPECT_TOTAL)} → ${ok?'✓ 3중 일치':'✗ 불일치'}`);
  if (!ok) throw new Error('SUM MISMATCH — 316 재산출 정합 재점검');

  // ── 산출물 write (single artifact, two consumers) ──
  const out = {
    ticket: 'T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY',
    task: 'MSG-20260819-143117-5u5f (J4 read-only prep 추가 — flip316 breakdown)',
    generated_from: 'db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json (commit fea7e6da)',
    prod_ref: REF,
    read_only: true, mutation_count: 0,
    flip_set: { definition: 'prev_flag=false→true (⑨ already_paid 재분류 대상)', count: rows.length },
    total_verified: EXPECT_TOTAL,
    sum_check: { date_sum: dateSum, prod_sum: prodSum, freeze_sum: freezeSum, expect: EXPECT_TOTAL, all_match: ok },
    // consumer 1: dev-sales — _FOOT_PKG_BACKFILL_KC_INCL dict 교체용 (date → amount)
    dev_sales_kc_dict: byDate,
    dev_sales_kc_dict_counts: byDateCnt,
    // consumer 2: DA/planner — A6 known-correction (상품별 소계)
    da_a6_by_product: byProd,
    da_a6_by_session_type: byType,
    date_span: { first: dateKeys[0], last: dateKeys[dateKeys.length-1], n_dates: dateKeys.length },
  };
  const OUT = `${REPO}/db-gate/T-20260724-foot-PKGSESSION_flip316_breakdown_20260819.json`;
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  hr(`DONE — ${OUT}`);
  console.log(JSON.stringify({
    count: rows.length, total: won(EXPECT_TOTAL),
    n_dates: dateKeys.length, n_products: prodKeys.length,
    by_session_type: Object.fromEntries(Object.entries(byType).map(([k,v])=>[k,won(v)])),
    all_sum_match: ok
  }, null, 2));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
