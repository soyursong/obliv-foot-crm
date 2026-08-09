/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — F-4872 마이그레이션 DRY-RUN (무영속)
 *   Management API 경로. Migration Dry-Run No-Persistence Protocol 준수:
 *     (0) baseline   : 신규 PK(line/payment) 사전 실재 캡처(0 이어야 = 중복 apply 흔적 없음).
 *     (1) canary     : BEGIN; COMMENT; ROLLBACK; → 무영속 선증명(sentinel-bypass 차단).
 *     (2) apply×2+verify : BEGIN; <mig>; <mig 재실행(멱등)>; DO$$ rows-affected 검증(실패 RAISE) $$; ROLLBACK;
 *     (3) post-probe : baseline 동일(미영속) 확증.
 *   (L) ledger 정합 : schema_migrations version 미존재(fresh) + 최신 ledger < 본 version(정순) 확인.
 * 사용: node scripts/T-20260725-foot-SALESLIST-F4872_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260809080000_foot_saleslist_f4872_shampoo_backfill.sql';
const VERSION = '20260809080000';
const CANARY = '__DRYRUN_CANARY_T20260725_F4872__';
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

const NEW_LINE_ID = "'87beac3a-df9b-433b-827e-43e51a1d2107'";
const NEW_PAY_ID  = "'7b8b9f74-c7aa-4d23-92ad-42033ec02096'";
const SELLER = "'7c24cd3b-8e52-4c72-9652-e14f75151514'";  // 임별 therapist
const SVC = "'89095450-223f-4863-89a9-c7f32f62809d'";      // 풋샴푸 200ml

const snapshot = async () => (await q(`
  SELECT
    (SELECT count(*)::int FROM public.check_in_services WHERE id = ${NEW_LINE_ID}) AS new_lines,
    (SELECT count(*)::int FROM public.payments WHERE id = ${NEW_PAY_ID}) AS new_pays
`))[0];

const commentOf = async () => (await q(
  `SELECT obj_description('${CANARY_TBL}'::regclass, 'pg_class') AS c`))[0]?.c ?? null;

const mig = fs.readFileSync(MIG, 'utf8');

const VERIFY = `
DO $v$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.check_in_services WHERE id = ${NEW_LINE_ID};
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 라인 INSERT count=% (expected 1)', n; END IF;

  SELECT count(*) INTO n FROM public.payments WHERE id = ${NEW_PAY_ID};
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL payment INSERT count=% (expected 1)', n; END IF;

  -- 신규 payment 금액·수단·회계일·시뮬 정합
  SELECT count(*) INTO n FROM public.payments
   WHERE id = ${NEW_PAY_ID} AND amount=42000 AND method='card' AND payment_type='payment'
     AND is_simulation=false AND status='active' AND accounting_date=DATE '2026-07-18'
     AND service_charge_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL payment shape (amount/method/accounting_date/service_charge NULL)'; END IF;

  -- 신규 라인 풋샴푸·seller(임별)·anchor ci 정합
  SELECT count(*) INTO n FROM public.check_in_services
   WHERE id = ${NEW_LINE_ID} AND service_id=${SVC} AND price=42000
     AND seller_staff_id=${SELLER}
     AND check_in_id='f6ca21d1-a672-4cd4-b407-588e5940c327';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 라인 shape (service/price/seller/anchor)'; END IF;

  RAISE NOTICE 'DRYRUN OK: 1 line + 1 payment INSERT (멱등 재실행 후에도 동일 = 2회차 0-row)';
END $v$;`;

async function main() {
  console.log('=== (L) ledger 정합 ===');
  const led = await q(`SELECT
    (SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version='${VERSION}') AS exists_ver,
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS max_ver`);
  console.log(JSON.stringify(led[0]));
  if (led[0].exists_ver !== 0) { console.error('⚠ ABORT: version 이미 존재(충돌).'); process.exit(6); }
  if (String(led[0].max_ver) >= VERSION) { console.error(`⚠ ABORT: backdating (max ${led[0].max_ver} >= ${VERSION}).`); process.exit(7); }
  console.log(`  version ${VERSION} fresh + max ${led[0].max_ver} < ${VERSION} (정순) ✓`);

  console.log('\n=== (0) baseline (prod 현재) ===');
  const base = await snapshot();
  console.log(JSON.stringify(base));
  if (base.new_lines !== 0 || base.new_pays !== 0) {
    console.error('⚠ ABORT: 신규 PK 가 prod 에 이미 존재(중복 apply 흔적?). 0 이어야 함.');
    process.exit(2);
  }

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
  if (post.new_lines !== 0 || post.new_pays !== 0) {
    console.error('❌ ABORT: dry-run 이 prod 에 영속됨(No-Persistence 위반).'); process.exit(4);
  }
  console.log('  prod 미변경 확증 ✓');

  console.log('\n✅ DRY-RUN PASS (무영속). 예상 rows-affected(실 apply): line INSERT 1 + payment INSERT 1 = 2 writes.');
}
main().catch((e) => { console.error('❌ DRY-RUN FAIL:', e.message); process.exit(1); });
