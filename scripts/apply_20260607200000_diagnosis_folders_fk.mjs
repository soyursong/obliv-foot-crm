/**
 * T-20260607-foot-DXRX-MGMT-2PANEL 갈래① 상병명 3-A additive FK
 * supabase/migrations/20260607200000_diagnosis_folders_fk.sql 적용 + backfill STEP1(dry-run NOTICE).
 *
 * ⚠️ D3 supervisor SQL 게이트 — GATE-RESULT GO 수신 후에만 실행할 것.
 *    (dev-foot 직접 실행 정책 준수 / 대시보드 수동 실행 금지)
 *
 * ADDITIVE ONLY / 무손실 / idempotent / self-sufficient:
 *   · services.diagnosis_folder TEXT  ADD COLUMN IF NOT EXISTS (방어 보강)
 *   · diagnosis_folders 테이블 신설 (자기참조 트리, IF NOT EXISTS)
 *   · services.diagnosis_folder_id uuid NULL FK (ON DELETE SET NULL, IF NOT EXISTS)
 *   · RLS read-all / write authenticated (앱레이어 admin gate)
 * 정책(CREATE POLICY)은 비멱등 → 사전 DROP POLICY IF EXISTS 가드 후 재생성.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

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
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 diagnosis_folders_fk 적용 (T-20260607-foot-DXRX-MGMT-2PANEL 갈래① 3-A)');

const POLICY_GUARD = `
  DROP POLICY IF EXISTS "diagnosis_folders_read_all"  ON public.diagnosis_folders;
  DROP POLICY IF EXISTS "diagnosis_folders_write_auth" ON public.diagnosis_folders;
`;

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  const sql = fs.readFileSync('supabase/migrations/20260607200000_diagnosis_folders_fk.sql', 'utf8');

  // 정책 재생성 충돌 방지: 본문 적용 전 가드 DROP을 autocommit(트랜잭션 밖)에서 수행.
  //  테이블 부재 시 DROP POLICY IF EXISTS 는 "relation does not exist" 로 throw 하므로
  //  트랜잭션 안에서 실행하면 txn 이 abort 된다 → 반드시 BEGIN 이전 autocommit 에서 개별 실행.
  for (const stmt of POLICY_GUARD.split(';').map(s => s.trim()).filter(Boolean)) {
    try { await client.query(stmt); }
    catch (e) { console.log('  [guard skip]', e.message); /* 테이블/정책 아직 없음 — 무시 */ }
  }

  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ 마이그 본문 적용 완료 (DDL + RLS + 정책)');

  // ── 검증 ────────────────────────────────────────────────
  const { rows: tbl } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name='diagnosis_folders'`);
  if (tbl.length === 0) throw new Error('검증 실패 — diagnosis_folders 테이블 미생성');

  const { rows: cols } = await client.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='services'
       AND column_name IN ('diagnosis_folder','diagnosis_folder_id')
     ORDER BY column_name`);
  console.log('✅ services 폴더 컬럼:', cols.map(c => c.column_name));

  const { rows: pol } = await client.query(`
    SELECT policyname FROM pg_policies WHERE tablename='diagnosis_folders' ORDER BY policyname`);
  console.log('✅ RLS 정책:', pol.map(p => p.policyname).join(', '));

  // ── backfill STEP1 (dry-run NOTICE, 변경 없음) ────────────
  const bf = fs.readFileSync('supabase/migrations/20260607200000_diagnosis_folders_fk.backfill.sql', 'utf8');
  // STEP1 DO 블록만 추출(STEP2/3은 주석). 파일 전체 실행해도 STEP2/3은 주석이라 안전.
  client.on('notice', (n) => console.log('  [backfill NOTICE]', n.message));
  await client.query(bf);
  console.log('✅ backfill STEP1 dry-run 완료 (변경 없음 — 백필 대상 0건 기대)');

  console.log('🎉 D3 적용 완료. FE 2패널 착수 가능.');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  console.error('❌ 실패:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
