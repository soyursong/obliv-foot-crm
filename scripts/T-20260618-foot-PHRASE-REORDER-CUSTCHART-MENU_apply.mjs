/**
 * T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU — CS-AC-2 APPLY (영속)
 * dev-foot 직접 DB 적용 (메모리 'dev-foot DB 마이그레이션 직접 실행', 대시보드 수동 금지).
 * data-architect CONSULT-REPLY: GO + ADDITIVE — MSG-20260619-001458-5t5o.
 *   판정: 기존 CHECK 2값(pen_chart, medical_chart)에 customer_chart 확장=ADDITIVE-safe(위반 row 0).
 *   대표 게이트 면제(autonomy §3.1), supervisor DDL-diff만.
 *
 * 흐름: 0) 적용 전 CHECK 정의 + phrase_type 분포 READ-only 스냅(DDL-diff 근거)
 *       1) DRY-RUN: BEGIN → 마이그 본문(트랜잭션 제거판) → ROLLBACK (SQL 유효성 검증, 무변경)
 *       2) 실적용: 마이그(BEGIN/COMMIT 내장) 그대로 실행
 *       3) 별도 연결로 영속 검증 — CHECK 3값 확인 + 기존 row 무변경
 * 실패 시 rollback 마이그(20260619010000_phrase_type_customer_chart.rollback.sql)로 복구.
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

const migPath = 'supabase/migrations/20260619010000_phrase_type_customer_chart.sql';
const sql = fs.readFileSync(migPath, 'utf8');
// DRY-RUN 용: 트랜잭션 키워드 제거 (외부 BEGIN/ROLLBACK 으로 감싸기 위해)
const sqlBody = sql.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

const qCheck = `SELECT check_clause FROM information_schema.check_constraints WHERE constraint_name='chk_phrase_templates_type'`;
const qDist = `SELECT phrase_type, count(*)::int AS n FROM phrase_templates GROUP BY phrase_type ORDER BY phrase_type`;

const DRY = process.argv.includes('--dry-run');

// ── 0) 적용 전 READ-only 스냅 ──
const c0 = conn();
await c0.connect();
console.log(`✅ DB 연결 (PRE-SNAP)  ${new Date().toISOString()}`);
const before = await c0.query(qCheck);
console.log('── 적용 전 CHECK ──\n ', before.rows[0]?.check_clause ?? '(없음)');
const distBefore = await c0.query(qDist);
console.log('── 적용 전 phrase_type 분포 ──');
for (const r of distBefore.rows) console.log(`   ${r.phrase_type}: ${r.n}`);

// ── 1) DRY-RUN (무변경) ──
const c1 = conn(); await c1.connect();
try {
  await c1.query('BEGIN');
  await c1.query(sqlBody);
  const dryCheck = await c1.query(qCheck);
  console.log('── DRY-RUN 후 CHECK (롤백 예정) ──\n ', dryCheck.rows[0]?.check_clause);
  await c1.query('ROLLBACK');
  console.log('✅ DRY-RUN 통과 (롤백 완료, 무변경)');
} catch (e) {
  await c1.query('ROLLBACK').catch(() => {});
  console.error('❌ DRY-RUN 실패:', e.message);
  await c1.end(); await c0.end();
  process.exit(1);
} finally { await c1.end(); }

if (DRY) {
  console.log('🟡 --dry-run 모드 — 실적용 생략');
  await c0.end();
  process.exit(0);
}

// ── 2) 실적용 (마이그 BEGIN/COMMIT 내장) ──
const c2 = conn(); await c2.connect();
try {
  await c2.query(sql);
  console.log('✅ 실적용 완료');
} catch (e) {
  console.error('❌ 실적용 실패:', e.message);
  await c2.end(); await c0.end();
  process.exit(1);
} finally { await c2.end(); }

// ── 3) 영속 검증 (별도 연결) ──
const c3 = conn(); await c3.connect();
const after = await c3.query(qCheck);
console.log('── 적용 후 CHECK ──\n ', after.rows[0]?.check_clause);
const distAfter = await c3.query(qDist);
console.log('── 적용 후 phrase_type 분포 (기존 row 무변경 확인) ──');
for (const r of distAfter.rows) console.log(`   ${r.phrase_type}: ${r.n}`);
const ok = (after.rows[0]?.check_clause ?? '').includes('customer_chart');
await c3.end(); await c0.end();
console.log(ok ? '✅ 검증 통과 — customer_chart 허용' : '❌ 검증 실패 — customer_chart 미반영');
process.exit(ok ? 0 : 1);
