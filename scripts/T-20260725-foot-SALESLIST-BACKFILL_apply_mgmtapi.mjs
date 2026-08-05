/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — prod APPLY (실적용)
 *   ⚠⚠ supervisor DB-GATE GO-token 이후에만 실행. GO-token 前 실행 금지(payments 잠금원장 write).
 *   실행: GATE_TOKEN=<supervisor GO-token 문자열> node scripts/T-20260725-foot-SALESLIST-BACKFILL_apply_mgmtapi.mjs
 *     - GATE_TOKEN 미제공 시 즉시 abort(오실행 방지 chokepoint).
 *     - up.sql(멱등 가드 내장) 단일 트랜잭션 apply + ledger mark + POSTCHECK(삽입 SELECT 재확인).
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260805190000_foot_saleslist_kimgyuri_ctb_backfill.sql';
const VERSION = '20260805190000';
const NAME = 'foot_saleslist_kimgyuri_ctb_backfill';

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

const NEW_LINE_IDS = "'bee88b6d-002c-4149-8c99-67d832b0e930','81c754c8-8cd8-4477-83fd-30fcbfe9bc19'";
const NEW_PAY_IDS  = "'7a0935ed-f4ac-491d-86c0-8d09d0d9440f','16729866-5bc8-40d6-9fc9-dc1286f692b8'";
const mig = fs.readFileSync(MIG, 'utf8');

async function main() {
  console.log('=== PRE (멱등: 이미 apply 됐는지) ===');
  const pre = (await q(`SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id IN (${NEW_LINE_IDS})) AS lines,
    (SELECT count(*)::int FROM public.payments WHERE id IN (${NEW_PAY_IDS})) AS pays,
    (SELECT seller_staff_id::text FROM public.check_in_services WHERE id='f519496a-e90f-4961-bed6-087e882ee18d') AS f4906`))[0];
  console.log(JSON.stringify(pre));

  console.log('\n=== APPLY (단일 트랜잭션 + ledger mark) ===');
  const ledger = `INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${VERSION}','${NAME}') ON CONFLICT (version) DO NOTHING;`;
  await q(`BEGIN;\n${mig}\n${ledger}\nCOMMIT;`);
  console.log('  apply 트랜잭션 COMMIT ✓');

  console.log('\n=== POSTCHECK (삽입건 SELECT 재확인 + 귀속) ===');
  const post = await q(`SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id IN (${NEW_LINE_IDS}) AND seller_staff_id='3a0c6774-2bd9-4018-bb38-ef6fab75d04b' AND price=15000) AS new_lines,
    (SELECT count(*)::int FROM public.payments WHERE id IN (${NEW_PAY_IDS}) AND amount=15000 AND method='card' AND payment_type='payment' AND is_simulation=false) AS new_pays,
    (SELECT seller_staff_id::text FROM public.check_in_services WHERE id='f519496a-e90f-4961-bed6-087e882ee18d') AS f4906_seller`);
  console.log(JSON.stringify(post[0]));
  const r = post[0];
  if (r.new_lines !== 2 || r.new_pays !== 2 || r.f4906_seller !== '3a0c6774-2bd9-4018-bb38-ef6fab75d04b') {
    console.error('❌ POSTCHECK FAIL — rows-affected 불일치. 롤백 SQL 검토 필요.'); process.exit(5);
  }
  console.log('\n✅ APPLY PASS: line 2 + payment 2 INSERT + F-4906 seller 귀속 확인. rows-affected 정합.');
  console.log('   다음: SalesStaffTab(담당치료사별 화장품 매출집계) 김규리 3건 반영 수동/브라우저 확인.');
}
main().catch((e) => { console.error('❌ APPLY FAIL:', e.message); process.exit(1); });
