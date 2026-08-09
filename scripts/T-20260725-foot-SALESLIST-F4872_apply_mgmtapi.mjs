/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — F-4872 prod APPLY (실적용)
 *   ⚠⚠ supervisor DB-GATE GO-token 이후에만 실행. GO-token 前 실행 금지(payments 잠금원장 write, apply_before_go 클래스).
 *   실행: GATE_TOKEN=<supervisor GO-token 문자열> node scripts/T-20260725-foot-SALESLIST-F4872_apply_mgmtapi.mjs
 *     - GATE_TOKEN 미제공 시 즉시 abort(오실행 방지 chokepoint).
 *     - up.sql(멱등 가드 내장) 단일 트랜잭션 apply + ledger mark + POSTCHECK(삽입 SELECT 재확인).
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260809080000_foot_saleslist_f4872_shampoo_backfill.sql';
const VERSION = '20260809080000';
const NAME = 'foot_saleslist_f4872_shampoo_backfill';

if (!process.env.GATE_TOKEN) {
  console.error('❌ ABORT: supervisor DB-GATE GO-token(GATE_TOKEN env) 미제공. GO-token 前 prod apply 금지.');
  process.exit(10);
}

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local'))
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, ''); }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

const NEW_LINE_ID = "'87beac3a-df9b-433b-827e-43e51a1d2107'";
const NEW_PAY_ID  = "'7b8b9f74-c7aa-4d23-92ad-42033ec02096'";
const mig = fs.readFileSync(MIG, 'utf8');

async function main() {
  console.log('=== PRE (멱등: 이미 apply 됐는지) ===');
  const pre = (await q(`SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id = ${NEW_LINE_ID}) AS lines,
    (SELECT count(*)::int FROM public.payments WHERE id = ${NEW_PAY_ID}) AS pays`))[0];
  console.log(JSON.stringify(pre));

  console.log('\n=== APPLY (단일 트랜잭션 + ledger mark) ===');
  const ledger = `INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${VERSION}','${NAME}') ON CONFLICT (version) DO NOTHING;`;
  await q(`BEGIN;\n${mig}\n${ledger}\nCOMMIT;`);
  console.log('  apply 트랜잭션 COMMIT ✓');

  console.log('\n=== POSTCHECK (삽입건 SELECT 재확인 + 정합) ===');
  const post = await q(`SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id = ${NEW_LINE_ID} AND seller_staff_id='7c24cd3b-8e52-4c72-9652-e14f75151514' AND price=42000 AND service_id='89095450-223f-4863-89a9-c7f32f62809d') AS new_lines,
    (SELECT count(*)::int FROM public.payments WHERE id = ${NEW_PAY_ID} AND amount=42000 AND method='card' AND payment_type='payment' AND is_simulation=false AND accounting_date=DATE '2026-07-18' AND service_charge_id IS NULL) AS new_pays`);
  console.log(JSON.stringify(post[0]));
  const r = post[0];
  if (r.new_lines !== 1 || r.new_pays !== 1) {
    console.error('❌ POSTCHECK FAIL — rows-affected 불일치. 롤백 SQL 검토 필요.'); process.exit(5);
  }
  console.log('\n✅ APPLY PASS: line 1 + payment 1 INSERT (F-4872 풋샴푸 42,000 card, seller 임별). rows-affected 정합.');
  console.log('   다음: SalesStaffTab(담당치료사별 화장품 매출집계) 임별 F-4872 42,000 반영 브라우저 확인.');
}
main().catch((e) => { console.error('❌ APPLY FAIL:', e.message); process.exit(1); });
