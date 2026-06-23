/**
 * T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND (B안 파일보관) — patient_file_records 직접 적용
 *
 * 신규 메타 테이블 patient_file_records 생성 (derm 미러링, ADDITIVE).
 * DA CONSULT-REPLY GO (MSG-20260623-083432-0ov6). 파괴0·계약충돌0.
 *
 * 실행:
 *   node scripts/apply_20260623150000_patient_file_records_pg.mjs --dry-run
 *   node scripts/apply_20260623150000_patient_file_records_pg.mjs --apply
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

const MIGRATION_SQL = fs.readFileSync('supabase/migrations/20260623150000_patient_file_records.sql', 'utf8');
const TABLE = 'patient_file_records';
const POLICIES = ['clinic_isolation_pfr_select', 'clinic_isolation_pfr_insert', 'own_delete_pfr'];

async function tableExists(name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE ──');
  console.log(`  ${TABLE} 존재 : ${await tableExists(TABLE) ? 'YES' : 'NO'}`);

  if (MODE === 'dry-run') { console.log('\n🟡 dry-run 종료 (변경 없음).'); await client.end(); process.exit(0); }

  console.log('\n── APPLY: 마이그레이션 SQL 실행 ──');
  if (await tableExists(TABLE)) {
    for (const pol of POLICIES) {
      await client.query(`DROP POLICY IF EXISTS "${pol}" ON public.${TABLE};`).catch(() => {});
    }
  }
  await client.query(MIGRATION_SQL);
  console.log('✅ 마이그레이션 적용 완료');

  console.log('\n── POST-APPLY 검증 ──');
  console.log(`  ${TABLE} 존재 : ${await tableExists(TABLE) ? 'YES' : 'NO'}`);

  const rls = await client.query(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname = $1 AND relnamespace='public'::regnamespace;`, [TABLE]);
  console.table(rls.rows);

  const pol = await client.query(`
    SELECT tablename, policyname, cmd FROM pg_policies
    WHERE tablename = $1 ORDER BY cmd;`, [TABLE]);
  console.table(pol.rows);
  console.log(`▶ 정책 수 = ${pol.rowCount} (기대: 3)`);

  // ── 실제 저장 1건 테스트 (INSERT → SELECT → ROLLBACK) ──
  console.log('\n── 실제 저장 1건 테스트 ──');
  const cust = await client.query(`SELECT id, clinic_id FROM public.customers WHERE clinic_id IS NOT NULL ORDER BY created_at LIMIT 1;`);
  if (cust.rowCount === 0) { console.log('⚠️ customers 없음 — 저장 테스트 skip'); }
  else {
    const { id: customerId, clinic_id: clinicId } = cust.rows[0];
    await client.query('BEGIN');
    const ins = await client.query(`
      INSERT INTO public.${TABLE} (clinic_id, customer_id, file_name, file_path, file_size, mime_type, kind, note)
      VALUES ($1, $2, 'smoke.pdf', 'customer/${customerId}/blood_result_0.pdf', 1024, 'application/pdf', 'blood_result', 'SMOKE — 자동삭제')
      RETURNING id, created_at;`, [clinicId, customerId]);
    console.log(`▶ ${TABLE} INSERT OK (id=${ins.rows[0].id})`);
    // mime CHECK 위반 거부 확인
    let rejected = false;
    try {
      await client.query(`
        INSERT INTO public.${TABLE} (clinic_id, customer_id, file_name, file_path, mime_type)
        VALUES ($1, $2, 'bad.exe', 'x', 'application/x-msdownload');`, [clinicId, customerId]);
    } catch { rejected = true; }
    console.log(`▶ mime CHECK 위반 거부 : ${rejected ? 'OK(거부됨)' : '❌ 통과돼버림'}`);
    await client.query('ROLLBACK');
    console.log('▶ ROLLBACK — 검증 데이터 정리 완료 (실데이터 0건 유지)');
  }

  await client.end();
  console.log('\n🟢 done — patient_file_records 메타 테이블 생성 완료.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
