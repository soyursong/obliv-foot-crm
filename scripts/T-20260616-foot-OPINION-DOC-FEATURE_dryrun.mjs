/**
 * T-20260616-foot-OPINION-DOC-FEATURE (Phase 2) — DRY-RUN 검증 (영속 ZERO)
 * 마이그(BEGIN..COMMIT)의 COMMIT 을 ROLLBACK 으로 치환해 실행 → 전 DDL + DO 검증 블록을
 * 라이브 스키마 대상으로 실제 실행하되 트랜잭션 끝에 전량 ROLLBACK(아무것도 영속 안 됨).
 *   - FK 타깃(clinics/customers/clinic_doctors/auth.users) 존재, 역할 헬퍼 존재,
 *     immutability policy 부재(③), clinic isolation(④) DO 블록이 tx 내에서 검증.
 * prod 실제 적용은 supervisor DDL-diff GO 후 별도 _apply.mjs 로 수행(이 스크립트는 비파괴).
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

const migPath = 'supabase/migrations/20260616120000_opinion_documents.sql';
let sql = fs.readFileSync(migPath, 'utf8');
// 마지막 COMMIT → ROLLBACK (단일 트랜잭션). DO 검증 블록은 ROLLBACK 전에 실행됨.
const idx = sql.lastIndexOf('COMMIT;');
if (idx < 0) { console.error('❌ COMMIT 미발견'); process.exit(1); }
sql = sql.slice(0, idx) + 'ROLLBACK;' + sql.slice(idx + 'COMMIT;'.length);

const c = conn();
await c.connect();
console.log(`✅ DB 연결 (DRY-RUN, 비파괴)  ${new Date().toISOString()}\n`);
try {
  await c.query(sql);
  console.log('✅ DRY-RUN PASS — 전 DDL + DO 검증(①③④) 트랜잭션 내 통과, ROLLBACK(영속 0).');
} catch (e) {
  console.error('❌ DRY-RUN FAIL:', e.message);
  await c.end();
  process.exit(1);
}

// 비파괴 확인: 롤백 후 테이블이 실제로 없어야 함(영속 0 증명)
const left = (await c.query(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('opinion_doc_templates','opinion_documents')`)).rows;
console.log(`\n── 비파괴 확인: 롤백 후 잔존 테이블 = ${left.length} (기대 0) ${left.length === 0 ? '✅' : '❌'}`);
await c.end();
process.exit(left.length === 0 ? 0 : 1);
