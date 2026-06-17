/**
 * T-20260607-foot-PROCMENU-RX-UNIFY — Stage 1 additive backfill DRY-RUN REHEARSAL
 *
 * supervisor DRY-RUN GO (2026-06-16) 후속. 풋 dev DB 미생성 → 운영 DB(rxlomoozakkjesdqjtvd)
 * 에 대해 단일 트랜잭션 안에서 PRE → forward apply → POST/INVARIANT → rollback 리허설
 * → idempotent 재적용 검증 후 최종 ROLLBACK (영속 변경 0건).
 *
 * dry_run_report.md §적용순서 1~3 그대로 수행. 모든 불변식 통과 시 실제 승격은 별도.
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
const rbk = stripTx(fs.readFileSync(`${PKG}/stage1_rx_unify_backfill.rollback.sql`, 'utf8'));

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const one = async (sql) => (await client.query(sql)).rows[0];
const n = (r, k) => Number(Object.values(r)[k ?? 0]);

await client.connect();
console.log(`✅ DB 연결 ${new Date().toISOString()} (DRY-RUN — 끝에서 ROLLBACK, 영속 변경 0)\n`);

// ── PRE ────────────────────────────────────────────────────────────────────
const P1 = await one(`SELECT count(*) AS sets, coalesce(sum(jsonb_array_length(items)),0) AS total_items FROM prescription_sets`);
const P2 = await one(`SELECT count(DISTINCT (item->>'prescription_code_id')) AS distinct_code_ids
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
  WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL`);
const P3 = await one(`SELECT count(DISTINCT lower(trim(item->>'name'))) AS distinct_freetext_names
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
  WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
    AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL`);
const P4 = await one(`SELECT count(*) AS pre_legacy FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%'`);
const P5 = await one(`SELECT count(*) AS orphan_code_ids FROM (
    SELECT DISTINCT (item->>'prescription_code_id')::uuid AS cid
    FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
    WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL
  ) t WHERE NOT EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id=t.cid)`);
const P6 = await one(`SELECT count(*) AS pre_foldered FROM prescription_code_folders`);

console.log('── PRE ──');
console.log(`  P1 sets=${n(P1,0)} total_items=${n(P1,1)}`);
console.log(`  P2 distinct_code_ids=${n(P2)}`);
console.log(`  P3 distinct_freetext_names=${n(P3)}`);
console.log(`  P4 pre_legacy=${n(P4)}`);
console.log(`  P5 orphan_code_ids=${n(P5)}`);
console.log(`  P6 pre_foldered=${n(P6)}\n`);

let pass = true;
const chk = (cond, label) => { console.log(`  ${cond ? '✅' : '❌'} ${label}`); if (!cond) pass = false; };

try {
  await client.query('BEGIN');

  // ── FORWARD apply ──────────────────────────────────────────────────────────
  await client.query(fwd);

  // ── POST ───────────────────────────────────────────────────────────────────
  const Q1 = await one(`SELECT count(*) AS post_legacy FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%'`);
  const Q2 = await one(`SELECT count(*) AS landing_assigned FROM prescription_code_folders f
    JOIN prescription_folders pf ON pf.id=f.folder_id
    WHERE pf.name='처방세트 이관' AND pf.parent_id IS NULL`);
  const post = await one(`SELECT count(*) AS sets, coalesce(sum(jsonb_array_length(items)),0) AS total_items FROM prescription_sets`);
  const Z1 = await one(`WITH ref AS (
      SELECT DISTINCT (item->>'prescription_code_id')::uuid cid
      FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
      WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL
      UNION
      SELECT pc.id FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
      JOIN prescription_codes pc ON pc.claim_code='LEGACY-'||left(md5(lower(trim(item->>'name'))),12)
      WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
        AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL )
    SELECT count(*) AS unshown FROM ref r
    WHERE r.cid IS NOT NULL AND EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id=r.cid)
      AND NOT EXISTS (SELECT 1 FROM prescription_code_folders f WHERE f.prescription_code_id=r.cid)`);

  console.log('── POST (트랜잭션 내, 미커밋) ──');
  console.log(`  Q1 post_legacy=${n(Q1)}  (신규 custom 코드 = ${n(Q1)-n(P4)})`);
  console.log(`  Q2 landing_assigned=${n(Q2)}`);
  console.log(`  Z1 unshown=${n(Z1)}\n`);

  console.log('── INVARIANTS ──');
  chk(n(Q1) - n(P4) === n(P3), `I1 신규 custom 코드(${n(Q1)-n(P4)}) == distinct 자유텍스트 약명(${n(P3)})`);
  chk(n(Z1) === 0, `I3/Z1 세트 참조 약 중 폴더 미노출 = ${n(Z1)} (0이어야)`);
  chk(n(post,0) === n(P1,0) && n(post,1) === n(P1,1), `I4 prescription_sets 무변경 (sets ${n(post,0)}/${n(P1,0)}, items ${n(post,1)}/${n(P1,1)})`);
  console.log(`  ℹ️ I5 orphan skip = P5(${n(P5)}) (보고용, 비차단)`);

  // ── ROLLBACK 리허설 ──────────────────────────────────────────────────────────
  await client.query(rbk);
  const r1 = await one(`SELECT count(*) AS c FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%'`);
  const r2 = await one(`SELECT count(*) AS c FROM prescription_folders WHERE name='처방세트 이관' AND parent_id IS NULL`);
  const r3 = await one(`SELECT count(*) AS c FROM prescription_code_folders f JOIN prescription_folders pf ON pf.id=f.folder_id WHERE pf.name='처방세트 이관'`);
  console.log('\n── ROLLBACK 리허설 (capture 없는 scope 모드) ──');
  chk(n(r1) === n(P4), `rollback LEGACY 코드 → PRE 수준 복귀 (${n(r1)} == P4 ${n(P4)})`);
  chk(n(r2) === 0, `rollback 랜딩 폴더 제거 (${n(r2)} == 0)`);
  chk(n(r3) === 0, `rollback 랜딩 매핑 제거 (${n(r3)} == 0)`);

  // ── IDEMPOTENT 재적용 ────────────────────────────────────────────────────────
  await client.query(fwd);
  const i1 = await one(`SELECT count(*) AS c FROM prescription_codes WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%'`);
  const i2 = await one(`SELECT count(*) AS c FROM prescription_code_folders f JOIN prescription_folders pf ON pf.id=f.folder_id WHERE pf.name='처방세트 이관' AND pf.parent_id IS NULL`);
  console.log('\n── IDEMPOTENT 재적용 (rollback 후 재forward) ──');
  chk(n(i1) === n(Q1), `재적용 후 LEGACY 코드 == 1차 POST (${n(i1)} == ${n(Q1)})`);
  chk(n(i2) === n(Q2), `재적용 후 랜딩 매핑 == 1차 POST (${n(i2)} == ${n(Q2)})`);

  await client.query('ROLLBACK');
  console.log('\n🔄 트랜잭션 ROLLBACK — DB 영속 변경 0건.');
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  pass = false;
  console.error('\n❌ 예외:', e.message);
}
await client.end();
console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS — 실제 승격(supabase/migrations/) 적용 GO' : '❌ DRY-RUN FAIL — 승격 금지'}`);
process.exit(pass ? 0 : 1);
