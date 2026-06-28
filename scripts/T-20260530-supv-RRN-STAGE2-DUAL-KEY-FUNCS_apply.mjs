/**
 * T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS — STEP 4 APPLY (foot 한정, supervisor dry-run GO 후)
 * 출처 SQL: agents/docs/_draft/sql/rrn_stage2_foot_dual_key_functions.sql (216L, commit 4f502d6)
 * GO 근거: supervisor MQ MSG-20260629-031030-ulu0 (foot scoped deploy_hold release)
 *
 * 범위: CREATE OR REPLACE FUNCTION rrn_decrypt / rrn_encrypt (atomic in-place, 반환형 일치 확인됨)
 *       + rrn_decrypt_fallback_log 테이블/인덱스/COMMENT.
 *       데이터 row 변경 0건 (함수정의·DDL only). 전부 단일 트랜잭션 atomic.
 * 멱등: CREATE OR REPLACE FUNCTION / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS → 재실행 무해.
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

const SQL_PATH = process.env.HOME + '/claude-sync/agents/docs/_draft/sql/rrn_stage2_foot_dual_key_functions.sql';
const sql = fs.readFileSync(SQL_PATH, 'utf8');

const c = conn(); await c.connect();
console.log('✅ DB 연결 (STEP 4 APPLY) [rxlomoozakkjesdqjtvd]', new Date().toISOString());

try {
  await c.query('BEGIN');
  await c.query(sql);                 // 파일 전체(주석 포함). 실행 DDL = 2 fn + 1 table + 2 index + COMMENT.
  await c.query('COMMIT');
  console.log('✅ STEP 4 APPLY 완료 (COMMIT) — 함수 atomic replace + fallback_log 생성.');
} catch (e) {
  try { await c.query('ROLLBACK'); } catch {}
  console.error('❌ APPLY 실패 (ROLLBACK):', e.message);
  await c.end();
  process.exit(1);
}
await c.end();

// ── 별도 연결로 영속 검증 (객체 실재) ──
const v = conn(); await v.connect();
const fn = await v.query(`SELECT proname, pg_get_function_result(oid) AS ret,
    pg_get_function_identity_arguments(oid) AS args, prosecdef
  FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('rrn_decrypt','rrn_encrypt') ORDER BY proname`);
const tbl = await v.query(`SELECT to_regclass('public.rrn_decrypt_fallback_log') AS tbl`);
const idx = await v.query(`SELECT indexname FROM pg_indexes
  WHERE schemaname='public' AND tablename='rrn_decrypt_fallback_log' ORDER BY indexname`);
const newkey = await v.query(`SELECT pg_get_functiondef('public.rrn_decrypt(uuid)'::regprocedure) AS def`);

console.log('\n── 영속 검증 ──');
console.table(fn.rows);
console.log('fallback_log 테이블:', tbl.rows[0].tbl);
console.log('인덱스:', idx.rows.map(r=>r.indexname).join(', '));
const hasVault = /foot_rrn_key_v2/.test(newkey.rows[0].def);
const hasGuc = /current_setting\(\s*'app\.rrn_key/.test(newkey.rows[0].def);
console.log('신키 Vault 참조(foot_rrn_key_v2):', hasVault, '| GUC 분기 잔존:', hasGuc);

const ok = fn.rows.length === 2
  && tbl.rows[0].tbl === 'rrn_decrypt_fallback_log'
  && idx.rows.length >= 2
  && hasVault && !hasGuc;
console.log(ok ? '\n✅ STEP 4 검증 PASS' : '\n❌ STEP 4 검증 FAIL — 수동 확인');
await v.end();
process.exit(ok ? 0 : 2);
