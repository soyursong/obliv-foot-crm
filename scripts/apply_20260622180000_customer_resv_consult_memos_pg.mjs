/**
 * T-20260622-foot-CHART2-MEMO-HISTORY (item4) — 예약메모/상담메모 히스토리 테이블 직접 적용
 *
 * 신규 테이블 customer_reservation_memos / customer_consult_memos 생성 (customer_treatment_memos 패턴 복제).
 * ADDITIVE: 기존 customers.customer_memo / customers.tm_memo 컬럼 무변경. DA CONSULT 옵션A GO.
 *
 * 실행:
 *   node scripts/apply_20260622180000_customer_resv_consult_memos_pg.mjs --dry-run
 *   node scripts/apply_20260622180000_customer_resv_consult_memos_pg.mjs --apply
 *
 * node-pg pooler 직접 연결. 멱등(CREATE IF NOT EXISTS, 정책 drop&create). 적용 후 INSERT 1건 테스트 → ROLLBACK.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const MIGRATION_SQL = fs.readFileSync('supabase/migrations/20260622180000_customer_resv_consult_memos.sql', 'utf8');
const TABLES = ['customer_reservation_memos', 'customer_consult_memos'];
const POLICIES = {
  customer_reservation_memos: ['clinic_isolation_crm_select','clinic_isolation_crm_insert','own_update_crm','own_delete_crm'],
  customer_consult_memos: ['clinic_isolation_ccm_select','clinic_isolation_ccm_insert','own_update_ccm','own_delete_ccm'],
};

async function tableExists(name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE ──');
  for (const t of TABLES) console.log(`  ${t} 존재 : ${await tableExists(t) ? 'YES' : 'NO'}`);

  if (MODE === 'dry-run') { console.log('\n🟡 dry-run 종료 (변경 없음).'); await client.end(); process.exit(0); }

  console.log('\n── APPLY: 마이그레이션 SQL 실행 ──');
  // 정책 create 는 멱등이 아니라서 사전 drop (테이블 존재할 때만)
  for (const t of TABLES) {
    if (await tableExists(t)) {
      for (const pol of POLICIES[t]) {
        await client.query(`DROP POLICY IF EXISTS "${pol}" ON public.${t};`).catch(() => {});
      }
    }
  }
  await client.query(MIGRATION_SQL);
  console.log('✅ 마이그레이션 적용 완료');

  console.log('\n── POST-APPLY 검증 ──');
  for (const t of TABLES) console.log(`  ${t} 존재 : ${await tableExists(t) ? 'YES' : 'NO'}`);

  const rls = await client.query(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname = ANY($1) AND relnamespace='public'::regnamespace;`, [TABLES]);
  console.table(rls.rows);

  const pol = await client.query(`
    SELECT tablename, policyname, cmd FROM pg_policies
    WHERE tablename = ANY($1) ORDER BY tablename, cmd;`, [TABLES]);
  console.table(pol.rows);
  console.log(`▶ 정책 수 = ${pol.rowCount} (기대: 8)`);

  // ── 실제 저장 1건 테스트 (INSERT → SELECT → ROLLBACK) ──
  console.log('\n── 실제 저장 1건 테스트 ──');
  const cust = await client.query(`SELECT id, clinic_id FROM public.customers WHERE clinic_id IS NOT NULL ORDER BY created_at LIMIT 1;`);
  if (cust.rowCount === 0) { console.log('⚠️ customers 없음 — 저장 테스트 skip'); }
  else {
    const { id: customerId, clinic_id: clinicId } = cust.rows[0];
    await client.query('BEGIN');
    for (const t of TABLES) {
      const ins = await client.query(`
        INSERT INTO public.${t} (customer_id, clinic_id, content, created_by, created_by_name)
        VALUES ($1, $2, 'MEMO-HISTORY SMOKE — 자동삭제', NULL, '(검증)')
        RETURNING id, created_at;`, [customerId, clinicId]);
      console.log(`▶ ${t} INSERT OK (id=${ins.rows[0].id})`);
    }
    await client.query('ROLLBACK');
    console.log('▶ ROLLBACK — 검증 데이터 정리 완료 (실데이터 0건 유지)');
  }

  await client.end();
  console.log('\n🟢 done — 예약메모/상담메모 히스토리 테이블 생성 완료.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
