/**
 * T-20260714-foot-REVENUE-INSURANCE-SPLIT-ZERO-DIAG — DIAGNOSTIC (READ-ONLY, NO WRITE)
 *
 * 목적: 매출집계 급여 항목(본부금·공단청구액) 0 표시가
 *   (a) 데이터 부재(오늘 급여 시술 0건) vs (b) 집계 파이프라인 버그(급여 분류 못읽음) 중 무엇인지 판별.
 *   *** SELECT 만. write 없음. ***
 *
 * 조사 항목:
 *   1. 당일(2026-07-14) payments.tax_type 분포 (급여 건 존재 여부) — clinic 서울오리진(오리)
 *   2. package_payments.tax_type 분포
 *   3. service_charges 급여/insurance 분류 건 존재 여부 (명세 grain)
 *   4. 급여 분류 필드 특정 + 집계 소스 grain 대조
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnv(name) {
  return Object.fromEntries(
    readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}
let env;
try { env = loadEnv('.env.local'); } catch { env = loadEnv('.env'); }
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const DAY = '2026-07-14';

async function main() {
  // clinic 식별 (서울오리진/오리)
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  console.log('=== clinics ===');
  for (const c of clinics ?? []) console.log(`  ${c.id}  ${c.name}  (${c.slug})`);

  // 각 clinic에 대해 당일 payments tax_type 분포
  for (const c of clinics ?? []) {
    const { data: pays, error } = await sb
      .from('payments')
      .select('tax_type, method, amount, payment_type, status')
      .eq('clinic_id', c.id)
      .neq('status', 'deleted')
      .gte('accounting_date', DAY)
      .lte('accounting_date', DAY);
    if (error) { console.log(`payments err ${c.name}: ${error.message}`); continue; }
    if (!pays || pays.length === 0) continue;
    console.log(`\n=== payments ${DAY} @ ${c.name} (${pays.length} rows) ===`);
    const byTax = {};
    for (const p of pays) {
      const k = p.tax_type ?? '(null)';
      byTax[k] = byTax[k] || { cnt: 0, sum: 0 };
      byTax[k].cnt++;
      byTax[k].sum += (p.payment_type === 'refund' ? -p.amount : p.amount);
    }
    for (const [k, v] of Object.entries(byTax)) console.log(`  tax_type=${k}: ${v.cnt}건, 합 ${won(v.sum)}`);

    // package_payments
    const { data: pkg } = await sb
      .from('package_payments')
      .select('tax_type, method, amount, payment_type')
      .eq('clinic_id', c.id)
      .gte('accounting_date', DAY)
      .lte('accounting_date', DAY);
    if (pkg && pkg.length) {
      console.log(`  --- package_payments (${pkg.length} rows) ---`);
      const byTaxP = {};
      for (const p of pkg) {
        const k = p.tax_type ?? '(null)';
        byTaxP[k] = byTaxP[k] || { cnt: 0, sum: 0 };
        byTaxP[k].cnt++;
        byTaxP[k].sum += (p.payment_type === 'refund' ? -p.amount : p.amount);
      }
      for (const [k, v] of Object.entries(byTaxP)) console.log(`    tax_type=${k}: ${v.cnt}건, 합 ${won(v.sum)}`);
    }
  }

  // service_charges 스키마 + 급여/insurance 분류
  console.log('\n=== service_charges probe ===');
  const { data: sc, error: scErr } = await sb.from('service_charges').select('*').limit(3);
  if (scErr) {
    console.log(`  service_charges 조회 실패: ${scErr.message}`);
  } else if (!sc || sc.length === 0) {
    console.log('  service_charges 테이블 존재하나 행 0건');
  } else {
    console.log('  columns:', Object.keys(sc[0]).join(', '));
  }

  // 전체 기간 급여 payments 존재 여부 (역대)
  const { count: everGyeoyeo } = await sb
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('tax_type', '급여');
  console.log(`\n=== 역대 payments tax_type='급여' 총건수: ${everGyeoyeo ?? '?'} ===`);
  const { count: everPkgGy } = await sb
    .from('package_payments')
    .select('id', { count: 'exact', head: true })
    .eq('tax_type', '급여');
  console.log(`=== 역대 package_payments tax_type='급여' 총건수: ${everPkgGy ?? '?'} ===`);
}
main().catch((e) => { console.error(e); process.exit(1); });
