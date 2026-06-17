/**
 * T-20260607-foot-PROCMENU-RX-UNIFY — Stage 1 additive backfill REAL APPLY
 *
 * 선행: dryrun ALL-PASS (PRE/POST/INVARIANT/rollback/idempotent) + supervisor DRY-RUN GO(6/16).
 * 적용 직전 NOT EXISTS 기준 캡처 → 단일 트랜잭션 COMMIT → POST 검증.
 * 캡처 파일(rollback 정밀화): rollback/T-20260607-foot-PROCMENU-RX-UNIFY_capture.csv
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const PKG = 'migration_packages/T-20260607-foot-PROCMENU-RX-UNIFY';
const stripTx = (s) => s.split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');
const fwd = stripTx(fs.readFileSync(`${PKG}/stage1_rx_unify_backfill.sql`, 'utf8'));

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
const one = async (sql) => (await client.query(sql)).rows[0];
const n = (r) => Number(Object.values(r)[0]);

await client.connect();
console.log(`✅ DB 연결 ${new Date().toISOString()} (REAL APPLY)\n`);

// ── 적용 직전 캡처 (NOT EXISTS 기준 — 본 마이그가 새로 만들 대상만) ──────────────
const capCodes = (await client.query(`
  WITH cand AS (
    SELECT DISTINCT 'LEGACY-' || left(md5(lower(trim(item->>'name'))),12) AS cc
    FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
    WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
      AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL )
  SELECT cc FROM cand WHERE NOT EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.claim_code=cand.cc)
`)).rows.map(r => r.cc);

let pass = true;
const chk = (cond, label) => { console.log(`  ${cond ? '✅' : '❌'} ${label}`); if (!cond) pass = false; };

try {
  await client.query('BEGIN');
  await client.query(fwd);

  // 캡처: 본 마이그가 insert 한 id (capture.csv)
  const newCodes = (await client.query(
    `SELECT id, claim_code, name_ko FROM prescription_codes WHERE code_source='custom' AND claim_code = ANY($1)`, [capCodes])).rows;
  const landingId = (await one(`SELECT id FROM prescription_folders WHERE name='처방세트 이관' AND parent_id IS NULL LIMIT 1`)).id;
  const newMaps = (await client.query(
    `SELECT prescription_code_id FROM prescription_code_folders WHERE folder_id=$1`, [landingId])).rows;

  const csv = ['type,id_or_code',
    `landing_folder_id,${landingId}`,
    ...newCodes.map(c => `code_id,${c.id}`),
    ...newMaps.map(m => `map_code_id,${m.prescription_code_id}`)].join('\n');
  fs.writeFileSync('rollback/T-20260607-foot-PROCMENU-RX-UNIFY_capture.csv', csv + '\n');
  console.log(`📝 capture.csv 기록: 코드 ${newCodes.length}건 / 매핑 ${newMaps.length}건 / 랜딩폴더 ${landingId}`);

  // POST 검증
  const Q1 = await one(`SELECT count(*) AS c FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%'`);
  const Q2 = await one(`SELECT count(*) AS c FROM prescription_code_folders f JOIN prescription_folders pf ON pf.id=f.folder_id WHERE pf.name='처방세트 이관' AND pf.parent_id IS NULL`);
  const sets = await one(`SELECT count(*) AS c FROM prescription_sets`);
  const Z1 = await one(`WITH ref AS (
      SELECT DISTINCT (item->>'prescription_code_id')::uuid cid
      FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
      WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL
      UNION SELECT pc.id FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
      JOIN prescription_codes pc ON pc.claim_code='LEGACY-'||left(md5(lower(trim(item->>'name'))),12)
      WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
        AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL )
    SELECT count(*) AS c FROM ref r WHERE r.cid IS NOT NULL
      AND EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id=r.cid)
      AND NOT EXISTS (SELECT 1 FROM prescription_code_folders f WHERE f.prescription_code_id=r.cid)`);

  console.log('\n── POST ──');
  chk(n(Q1) >= newCodes.length, `Q1 LEGACY 코드 = ${n(Q1)}`);
  chk(n(Q2) >= 1, `Q2 랜딩 매핑 = ${n(Q2)}`);
  chk(n(Z1) === 0, `Z1 미노출 약 = ${n(Z1)} (0이어야)`);
  console.log(`  ℹ️ prescription_sets = ${n(sets)}건 (무변경 보존)`);

  if (!pass) { await client.query('ROLLBACK'); throw new Error('POST 검증 실패 — ROLLBACK'); }
  await client.query('COMMIT');
  console.log('\n✅ COMMIT — Stage 1 backfill 영속 적용 완료.');
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  pass = false;
  console.error('\n❌ 예외:', e.message);
}
await client.end();
process.exit(pass ? 0 : 1);
