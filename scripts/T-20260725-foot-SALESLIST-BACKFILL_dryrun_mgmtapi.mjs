/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — 마이그레이션 DRY-RUN (무영속)
 *   Management API 경로. Migration Dry-Run No-Persistence Protocol 준수:
 *     (0) baseline   : 대상 3 check_in 의 CTB 라인/15,000 payment/F-4906 seller 사전 실재 캡처.
 *     (1) canary     : BEGIN; COMMENT ON check_in_services=canary; ROLLBACK; → 무영속 선증명(sentinel-bypass 차단).
 *     (2) apply×2+verify : BEGIN; <mig>; <mig 재실행(멱등)>; DO$$ rows-affected 검증(실패 RAISE) $$; ROLLBACK;
 *     (3) post-probe : baseline 동일(미영속) 확증.
 * 사용: node scripts/T-20260725-foot-SALESLIST-BACKFILL_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260805190000_foot_saleslist_kimgyuri_ctb_backfill.sql';
const CANARY = '__DRYRUN_CANARY_T20260725_SALESLIST__';
const CANARY_TBL = 'public.check_in_services';

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
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const NEW_LINE_IDS = "'bee88b6d-002c-4149-8c99-67d832b0e930','81c754c8-8cd8-4477-83fd-30fcbfe9bc19'";
const NEW_PAY_IDS  = "'7a0935ed-f4ac-491d-86c0-8d09d0d9440f','16729866-5bc8-40d6-9fc9-dc1286f692b8'";
const F4906_LINE = "'f519496a-e90f-4961-bed6-087e882ee18d'";
const KIMGYURI = "'3a0c6774-2bd9-4018-bb38-ef6fab75d04b'";

const snapshot = async () => (await q(`
  SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id IN (${NEW_LINE_IDS})) AS new_lines,
    (SELECT count(*)::int FROM public.payments WHERE id IN (${NEW_PAY_IDS})) AS new_pays,
    (SELECT seller_staff_id::text FROM public.check_in_services WHERE id = ${F4906_LINE}) AS f4906_seller
`))[0];

const commentOf = async () => (await q(
  `SELECT obj_description('${CANARY_TBL}'::regclass, 'pg_class') AS c`))[0]?.c ?? null;

// up.sql: 순수 DML(BEGIN/COMMIT/schema_migrations 없음) → strip 불요. 그대로 사용.
const mig = fs.readFileSync(MIG, 'utf8');

const VERIFY = `
DO $v$
DECLARE n int; sel text;
BEGIN
  SELECT count(*) INTO n FROM public.check_in_services WHERE id IN (${NEW_LINE_IDS});
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 라인 INSERT count=% (expected 2)', n; END IF;

  SELECT count(*) INTO n FROM public.payments WHERE id IN (${NEW_PAY_IDS});
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL payment INSERT count=% (expected 2)', n; END IF;

  -- 신규 payment 금액·수단·회계일 정합
  SELECT count(*) INTO n FROM public.payments
   WHERE id IN (${NEW_PAY_IDS}) AND amount=15000 AND method='card' AND payment_type='payment'
     AND is_simulation=false AND status='active';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL payment shape count=% (expected 2)', n; END IF;

  -- F-4550 payment accounting_date=07-25 / F-5016=07-22
  SELECT count(*) INTO n FROM public.payments WHERE id='7a0935ed-f4ac-491d-86c0-8d09d0d9440f' AND accounting_date=DATE '2026-07-25';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL F-4550 accounting_date'; END IF;
  SELECT count(*) INTO n FROM public.payments WHERE id='16729866-5bc8-40d6-9fc9-dc1286f692b8' AND accounting_date=DATE '2026-07-22';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL F-5016 accounting_date'; END IF;

  -- 신규 라인 CTB·seller 정합
  SELECT count(*) INTO n FROM public.check_in_services
   WHERE id IN (${NEW_LINE_IDS}) AND service_id='e17ba3a3-4842-4097-87bc-0778a64d2755'
     AND price=15000 AND seller_staff_id=${KIMGYURI};
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 라인 shape count=% (expected 2)', n; END IF;

  -- F-4906 seller 귀속
  SELECT seller_staff_id::text INTO sel FROM public.check_in_services WHERE id=${F4906_LINE};
  IF sel <> '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' THEN RAISE EXCEPTION 'FAIL F-4906 seller=%', sel; END IF;

  RAISE NOTICE 'DRYRUN OK: 2 lines + 2 payments INSERT, F-4906 seller set(멱등 재실행 후에도 동일)';
END $v$;`;

async function main() {
  console.log('=== (0) baseline (prod 현재) ===');
  const base = await snapshot();
  console.log(JSON.stringify(base));
  if (base.new_lines !== 0 || base.new_pays !== 0) {
    console.error('⚠ ABORT: 신규 PK 가 prod 에 이미 존재(중복 apply 흔적?). new_lines/new_pays 0 이어야 함.');
    process.exit(2);
  }
  console.log(`  · F-4906 현재 seller = ${base.f4906_seller ?? 'NULL'} (NULL=미귀속, backfill 대상)`);

  console.log('\n=== (1) canary: BEGIN; COMMENT; ROLLBACK; 무영속 선증명 ===');
  const before = await commentOf();
  await q(`BEGIN; COMMENT ON TABLE ${CANARY_TBL} IS '${CANARY}'; ROLLBACK;`);
  const after = await commentOf();
  if (after === CANARY) { console.error('❌ ABORT: canary 잔존 = ROLLBACK 무영속 실패(sentinel-bypass hazard).'); process.exit(3); }
  console.log(`  canary before=${before ?? 'null'} / after=${after ?? 'null'} → ROLLBACK 정상(무영속) ✓`);

  console.log('\n=== (2) apply×2(멱등) + verify (BEGIN…ROLLBACK) ===');
  const tx = `BEGIN;\n${mig}\n-- ▼ 멱등 재실행(2회차 = 0 rows 이어야, NOT EXISTS/ON CONFLICT 가드)\n${mig}\n${VERIFY}\nROLLBACK;`;
  const res = await q(tx);
  console.log('  트랜잭션 무예외 반환 = 구문/rows-affected/멱등 검증 통과 ✓');
  console.log('  (raw):', JSON.stringify(res));

  console.log('\n=== (3) post-probe: baseline 동일(무영속) ===');
  const post = await snapshot();
  console.log(JSON.stringify(post));
  if (post.new_lines !== 0 || post.new_pays !== 0 || (post.f4906_seller ?? null) !== (base.f4906_seller ?? null)) {
    console.error('❌ ABORT: dry-run 이 prod 에 영속됨(No-Persistence 위반).'); process.exit(4);
  }
  console.log('  prod 미변경 확증 ✓');

  console.log('\n✅ DRY-RUN PASS (무영속). 예상 rows-affected(실 apply): line INSERT 2 + payment INSERT 2 + seller UPDATE 1 = 5 writes.');
}
main().catch((e) => { console.error('❌ DRY-RUN FAIL:', e.message); process.exit(1); });
