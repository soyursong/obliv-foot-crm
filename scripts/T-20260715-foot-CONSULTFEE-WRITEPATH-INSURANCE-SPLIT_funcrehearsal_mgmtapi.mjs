/**
 * T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT — 기능 RPC 무영속 리허설 (Management API)
 *
 * 마이그 적용(txn 내) → record_insurance_consult_payment 실 prod 데이터로 호출 → 생성 명세·payment 검증 → ROLLBACK.
 * 검증: W1(calc 반환 적재)·W2(tax_type NULL)·W4(FK 링크)·W5(grade NULL→명세 공단=0/수납 30% 잠정)·W6(payment=copay)·W3(멱등).
 * 무영속: 전 과정 단일 BEGIN;...ROLLBACK;. prod 영속 0.
 * ★ 본 리허설 sample 은 pre-cutover 검증용 — W8 정식 sample 대조(명세=화면=EDI)는 배포 후 실수납 1건으로 회신.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const mig = fs.readFileSync('supabase/migrations/20260715160000_foot_consultfee_writepath_insurance.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

// 실 prod sample (2026-07-15 조회): 진찰료(초진) hira_score=153.36 · clinic hira_unit_value=95.60(2026)
const SVC = 'b98f6831-12a3-459b-b199-f543dd15cba1';           // 진찰료 (초진), 급여
const CI_GEN = 'f4ca01ce-64bd-4d5f-9b11-2ce9bdc3d4e5', CU_GEN = 'c59a2600-af70-4a11-937c-86fde9721c41'; // grade=general
const CI_NUL = '3da1fcc5-b214-45df-864a-c7ce5bb81e38', CU_NUL = '94f41fec-d4a4-4054-bff2-4ac3ac6463ff'; // grade=null
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const SQL = `BEGIN;
${mig}
;
-- general 등급 수납
SELECT 'gen1' AS tag, * FROM record_insurance_consult_payment('${CI_GEN}','${CU_GEN}','${CLINIC}','${SVC}','card', CURRENT_DATE);
-- 멱등 재호출(general) — idempotent_hit=true 기대, 중복 명세 미생성
SELECT 'gen2' AS tag, * FROM record_insurance_consult_payment('${CI_GEN}','${CU_GEN}','${CLINIC}','${SVC}','card', CURRENT_DATE);
-- grade=null 수납
SELECT 'nul1' AS tag, * FROM record_insurance_consult_payment('${CI_NUL}','${CU_NUL}','${CLINIC}','${SVC}','cash', CURRENT_DATE);
-- 최종 검증 read-back
SELECT json_build_object(
  'gen_sc', (SELECT json_agg(row_to_json(x)) FROM (
     SELECT sc.is_insurance_covered, sc.base_amount, sc.copayment_amount, sc.insurance_covered_amount,
            sc.customer_grade_at_charge, sc.hira_unit_value, sc.hira_unit_value_year,
            p.amount AS pay_amount, p.tax_type AS pay_tax_type, (p.service_charge_id = sc.id) AS fk_linked, p.payment_type
     FROM service_charges sc JOIN payments p ON p.service_charge_id = sc.id
     WHERE sc.check_in_id='${CI_GEN}' AND sc.calculation_engine_version='consult_writepath_v1') x),
  'gen_sc_count', (SELECT count(*)::int FROM service_charges WHERE check_in_id='${CI_GEN}' AND service_id='${SVC}' AND calculation_engine_version='consult_writepath_v1'),
  'nul_sc', (SELECT json_agg(row_to_json(y)) FROM (
     SELECT sc.base_amount, sc.copayment_amount, sc.insurance_covered_amount, sc.customer_grade_at_charge,
            p.amount AS pay_amount, p.tax_type AS pay_tax_type
     FROM service_charges sc JOIN payments p ON p.service_charge_id = sc.id
     WHERE sc.check_in_id='${CI_NUL}' AND sc.calculation_engine_version='consult_writepath_v1') y)
) AS result;
ROLLBACK;`;

let ok = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) ok = false; };
try {
  console.log(`✅ Management API 연결(${REF}) — 기능 리허설, 무영속(ROLLBACK)\n`);
  const res = (await q(SQL))[0].result;
  const gen = res.gen_sc?.[0]; const nul = res.nul_sc?.[0];
  console.log('── general 등급 수납 ──');
  console.log(`  ${JSON.stringify(gen)}`);
  chk(gen?.is_insurance_covered === true, 'W1 service_charge is_insurance_covered=TRUE');
  chk(gen?.base_amount === 14661, `W1 base_amount=14661 (실=${gen?.base_amount})`);
  // ── calc_copayment v1.5 정합(T-20260715-foot-COPAY-GENERAL-CEIL-TO-FLOOR-FIX, mig 20260715150000) ──
  //   14661×30%=4398.3 → 일반 정률 원단위 FLOOR ⇒ copay 4300 / covered 10361 (구 CEIL 4400/10261 폐기).
  //   write-path 는 calc_copayment 반환을 그대로 적재(단일권위) → 산식 변경이 코드수정 0으로 전파됨을 실증.
  chk(gen?.copayment_amount === 4300, `W1 copay=4300 30%FLOOR (실=${gen?.copayment_amount})`);
  chk(gen?.insurance_covered_amount === 10361, `W1 covered=10361 (실=${gen?.insurance_covered_amount})`);
  chk(gen?.base_amount === gen?.copayment_amount + gen?.insurance_covered_amount,
    `W-불변식 base==copay+covered (${gen?.base_amount}==${gen?.copayment_amount}+${gen?.insurance_covered_amount})`);
  chk(gen?.hira_unit_value_year === 2026, `W1 hira_unit_value_year=2026 (실=${gen?.hira_unit_value_year})`);
  chk(gen?.pay_amount === 4300, `W6 payment.amount==copay 4300 (공단분 미수납, 실=${gen?.pay_amount})`);
  chk(gen?.pay_tax_type === null, `W2 payment.tax_type NULL=면세 (실=${gen?.pay_tax_type})`);
  chk(gen?.fk_linked === true, 'W4 payment.service_charge_id → service_charge FK 링크');
  chk(res.gen_sc_count === 1, `W3 멱등: 재호출 후 명세 1건 (중복 미생성, 실=${res.gen_sc_count})`);
  console.log('\n── grade=null 수납 (W5) ──');
  console.log(`  ${JSON.stringify(nul)}`);
  chk(nul?.customer_grade_at_charge === 'unverified', `W5 grade=unverified 스냅샷 (실=${nul?.customer_grade_at_charge})`);
  chk(nul?.pay_amount === 4300, `W5 수납 payment=general_default 30%FLOOR 4300 잠정 (실=${nul?.pay_amount})`);
  chk(nul?.insurance_covered_amount === 0, `W5 명세 공단부담=0 보수(phantom 방지, 실=${nul?.insurance_covered_amount})`);
  chk(nul?.base_amount === 14661, `W5 base_amount 유지 14661 (실=${nul?.base_amount})`);
  console.log(`\n${ok ? '✅ 기능 리허설 PASS (무영속)' : '❌ 기능 리허설 FAIL'}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('❌ 리허설 실패:', e.message);
  process.exit(1);
}
