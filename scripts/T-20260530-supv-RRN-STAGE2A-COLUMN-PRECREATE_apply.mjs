/**
 * T-20260530-supv-RRN-STAGE2A-COLUMN-PRECREATE — APPLY (audit 컬럼 선생성 ONLY)
 * 출처 SQL: agents/docs/_draft/sql/rrn_stage2a_columns_only.sql (ADD COLUMN + COMMENT 블록만)
 * ⚠️ 범위: failures 테이블·검증 DO 블록 실행 금지 (STAGE3 잔류).
 *          본 스크립트는 columns_only.sql 의 BEGIN..COMMIT (L12–26) 만 실행.
 * 멱등: ADD COLUMN IF NOT EXISTS → 재실행 무해. write 0건. 무중단·무 rewrite (PG11+ instant).
 * 환경: foot CRM = 단일 Supabase 프로젝트(rxlomoozakkjesdqjtvd). prod DB 미생성(env matrix) → dev=prod 1위치.
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

// columns_only.sql 의 BEGIN..COMMIT 블록 (검증 주석 제외, 정확히 ADD COLUMN + 3 COMMENT)
const SQL = `BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS rrn_vault_id UUID,
  ADD COLUMN IF NOT EXISTS rrn_re_encrypted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rrn_encryption_version SMALLINT DEFAULT 1;

COMMENT ON COLUMN public.customers.rrn_vault_id IS
  'v3 Vault 패턴 ID (Stage 7 SSOT 통일 후 정식 사용). NULL=v1·v2 패턴';
COMMENT ON COLUMN public.customers.rrn_re_encrypted_at IS
  'Stage 4 batch re-encrypt 시각 또는 신규 INSERT 시각 (v2 이후). 진행률 추적용';
COMMENT ON COLUMN public.customers.rrn_encryption_version IS
  '1=구키 (Stage 2 이전), 2=신키 (Stage 4 batch 완료 후), 3=Vault (Stage 7 통일 후)';

COMMIT;`;

const VERIFY = `SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('rrn_vault_id','rrn_re_encrypted_at','rrn_encryption_version')
  ORDER BY column_name;`;

// ── 1) APPLY ──
const c1 = conn(); await c1.connect();
console.log('✅ DB 연결 (APPLY) [rxlomoozakkjesdqjtvd]', new Date().toISOString());
try { await c1.query(SQL); console.log('✅ STAGE2A 컬럼 선생성 완료 (COMMIT).'); }
catch (e) { console.error('❌ APPLY 실패:', e.message); await c1.end(); process.exit(1); }
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn(); await c2.connect();
const r = await c2.query(VERIFY);
console.log('\n── 검증 결과 (기대: 3 row, rrn_encryption_version default=1, 나머지 NULL) ──');
console.table(r.rows);
const ok = r.rows.length === 3
  && r.rows.find(x=>x.column_name==='rrn_encryption_version')?.column_default?.startsWith('1')
  && r.rows.find(x=>x.column_name==='rrn_vault_id')?.column_default == null
  && r.rows.find(x=>x.column_name==='rrn_re_encrypted_at')?.column_default == null;
console.log(ok ? '\n✅ 검증 PASS (3 row · version default=1 · 나머지 NULL)' : '\n❌ 검증 FAIL — 수동 확인 필요');
await c2.end();
process.exit(ok ? 0 : 2);
