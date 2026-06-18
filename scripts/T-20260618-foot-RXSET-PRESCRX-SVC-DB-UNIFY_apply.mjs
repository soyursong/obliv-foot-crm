/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — APPLY (스키마만, ADDITIVE)
 * 마이그 파일(BEGIN/COMMIT 내장) 실행 → 별도 연결로 영속 검증.
 * 백필(service_id 데이터 채움)은 본 스크립트에 미포함 — 사람확인 후 _backfill_apply 로 별도.
 * 실패 시 20260618140000_..._rollback.sql 로 무손실 복구.
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260618140000_prescription_codes_service_id_unify.sql';
const sql = fs.readFileSync(migPath, 'utf8');

// ── 1) APPLY ──
const c1 = conn(); await c1.connect();
console.log('✅ DB 연결 (APPLY)', new Date().toISOString());
try { await c1.query(sql); console.log('✅ 마이그 실행 완료 (COMMIT).'); }
catch (e) { console.error('❌ APPLY 실패:', e.message); await c1.end(); process.exit(1); }
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn(); await c2.connect();
const col = await c2.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name='prescription_codes' AND column_name='service_id'`);
console.log('\n── service_id 컬럼 ──');
console.log(col.rows.length ? `  ✅ ${col.rows[0].column_name} ${col.rows[0].data_type} ${col.rows[0].is_nullable==='YES'?'NULL':'NOT NULL'}` : '  ❌ 미생성');

const fk = await c2.query(`SELECT confdeltype FROM pg_constraint
  WHERE conrelid='prescription_codes'::regclass AND contype='f'
    AND confrelid='services'::regclass`);
console.log('  FK→services confdeltype:', fk.rows.map(r=>r.confdeltype).join(',') || '(없음)', '(n=SET NULL 기대)');

const idx = await c2.query(`SELECT indexname FROM pg_indexes WHERE tablename='prescription_codes' AND indexname='idx_prescription_codes_service_id'`);
console.log('  INDEX idx_prescription_codes_service_id:', idx.rows.length?'✅':'❌');

const vcnt = await c2.query(`SELECT count(*)::int AS n FROM v_foot_drug_master`);
const vlinked = await c2.query(`SELECT count(*)::int AS n FROM v_foot_drug_master WHERE has_hira_link`);
console.log(`\n── v_foot_drug_master ──`);
console.log(`  총 행(services 처방약): ${vcnt.rows[0].n}  (21 기대)`);
console.log(`  has_hira_link=true(백필됨): ${vlinked.rows[0].n}  (백필 전 0 기대)`);

await c2.end();
console.log('\n✅ 스키마 적용 완료. 백필은 사람확인 후 _backfill_apply 로 별도 실행.');
