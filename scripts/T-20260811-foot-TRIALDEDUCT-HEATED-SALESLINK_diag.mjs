/**
 * T-20260811-foot-TRIALDEDUCT-HEATED-SALESLINK — RC 진단 (READ-ONLY, prod rxlomo)
 *
 * 목적(진단 선행): 체험권 차감 매출 미연동 RC 확정 + 소급 residue 규모.
 *   (1) 빨간박스 4행(F-5537/F-5727/F-5668/F-5538) 현재 unit_price 확인 (child backfill 반영 여부).
 *   (2) trial(체험권) session_type 이면서 unit_price=0/NULL 잔존 행 systematic residue count.
 *   (3) 각 trial 행의 package.trial_unit_price 대조 (hypothesis c: 단가 링크 미설정 → 0).
 *   (4) 매출 산식(SalesStaffTab)에 trial 필터 제외 여부 확인 — 코드상 status='used'만, session_type 무필터.
 *   (5) 참고: 가열/비가열(heated/unheated) unit_price=0 잔존 규모 (out-of-scope 관찰).
 *
 * ★READ-ONLY: SELECT only. 어떤 UPDATE/DELETE 없음.
 * 실행: node scripts/T-20260811-foot-TRIALDEDUCT-HEATED-SALESLINK_diag.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function envVal(key) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim();
    }
  }
  return process.env[key];
}
const URL = envVal('VITE_SUPABASE_URL');
const KEY = envVal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) { console.error('❌ creds 필요'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const RED_BOX = ['F-5537', 'F-5727', 'F-5668', 'F-5538'];

async function main() {
  // ── (1)+(3) trial session 전건 조회 (status='used'), package.trial_unit_price 대조
  const { data: rows, error } = await sb
    .from('package_sessions')
    .select(`id, unit_price, session_type, session_date, status, performed_by,
             packages ( id, trial_unit_price, heated_unit_price, unheated_unit_price,
                        customer_id, customers!packages_customer_id_fkey ( name, chart_number ) )`)
    .eq('session_type', 'trial')
    .eq('status', 'used');
  if (error) { console.error('query err', error); process.exit(1); }

  console.log(`\n=== (A) trial(체험권) status=used 전건: ${rows.length}행 ===`);
  let zeroCnt = 0, zeroWithPrice = 0, zeroNoPrice = 0;
  const redBoxState = {};
  for (const r of rows) {
    const chart = r.packages?.customers?.chart_number ?? '?';
    const tup = r.packages?.trial_unit_price ?? null;
    const up = r.unit_price ?? 0;
    if (RED_BOX.includes(chart)) redBoxState[chart] = { up, tup, date: r.session_date };
    if (up === 0) {
      zeroCnt++;
      if (tup && tup > 0) zeroWithPrice++;  // hypothesis a/c: 단가 있는데 스냅샷 0 (미재계산 잔존)
      else zeroNoPrice++;                    // 정당 0 가능 (trial_unit_price 미설정)
    }
  }
  console.log(`  unit_price=0 잔존: ${zeroCnt}행`);
  console.log(`    ├ package.trial_unit_price>0 인데 스냅샷 0 (=미연동 진성 잔존): ${zeroWithPrice}행`);
  console.log(`    └ package.trial_unit_price 0/NULL (정당 0 가능): ${zeroNoPrice}행`);

  console.log(`\n=== (B) 빨간박스 4행 현재 상태 (child backfill 반영 여부) ===`);
  for (const c of RED_BOX) {
    const s = redBoxState[c];
    console.log(`  ${c}: ${s ? `unit_price=${s.up} / pkg.trial_unit_price=${s.tup} / ${s.date}` : 'NOT FOUND(used-trial 아님)'}`);
  }

  // ── (B2) 빨간박스 잔존 0 상세 (backfill 미반영이면 여기 표출)
  const stillZero = rows.filter(r => (r.unit_price ?? 0) === 0 && (r.packages?.trial_unit_price ?? 0) > 0);
  console.log(`\n=== (C) 진성 미연동(trial_unit_price>0 & snapshot=0) ${stillZero.length}행 목록 ===`);
  for (const r of stillZero) {
    console.log(`  ${r.packages?.customers?.chart_number ?? '?'} | ${r.session_date} | snap=${r.unit_price} | pkg.trial=${r.packages?.trial_unit_price} | perf=${r.performed_by}`);
  }

  // ── (D) 참고: heated/unheated unit_price=0 잔존 규모 (out-of-scope 관찰, 가열 0원 행 설명)
  for (const st of ['heated', 'unheated']) {
    const col = st === 'heated' ? 'heated_unit_price' : 'unheated_unit_price';
    const { data: hr } = await sb
      .from('package_sessions')
      .select(`id, unit_price, session_date, packages ( ${col} )`)
      .eq('session_type', st).eq('status', 'used');
    const z = (hr ?? []).filter(r => (r.unit_price ?? 0) === 0);
    const zWithPrice = z.filter(r => (r.packages?.[col] ?? 0) > 0);
    console.log(`\n=== (D) ${st}: 전건 ${hr?.length ?? 0} / unit_price=0 ${z.length}행 (그중 pkg단가>0 미연동 잔존 ${zWithPrice.length}행) ===`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
