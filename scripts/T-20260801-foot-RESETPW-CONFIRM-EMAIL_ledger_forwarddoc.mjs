/**
 * T-20260801-foot-RESETPW-CONFIRM-EMAIL — Migration Ledger Reconciliation forward-doc
 *
 * 성격: 코드 결함 아님. OOB(2026-08-01 093000) 적용분의 정직수렴 forward-doc.
 *   supervisor fn-diff GATE PASS (prod prosrc == intended body byte-exact,
 *   md5(prosrc)=d502103a4bf08a0b89bc37930e76a549) + merge GO(origin/main 597e082c) 완료 후.
 *   → schema_migrations 원장에 version '20260801093000' 을 forward-doc INSERT.
 *
 * 🚫 마이그 재적용 금지 — prod 함수 body 는 이미 intended 와 byte-exact (C19 body-drift 가드 대상).
 *   본 스크립트는 CREATE OR REPLACE 를 실행하지 않는다. 원장 1행 INSERT 만.
 *
 * statements = 마이그 파일 선언 그대로(파일 body 전체를 단일 text[] 원소로 = "그대로" 보존).
 * 멱등: ON CONFLICT (version) DO NOTHING.
 * rollback: DELETE FROM supabase_migrations.schema_migrations
 *             WHERE version='20260801093000' AND created_by='dev-foot:...-ledger-forwarddoc';
 *
 * 사용: node scripts/T-...forwarddoc.mjs          # dry-run
 *       node scripts/T-...forwarddoc.mjs --apply  # prod 원장 write (supervisor 위임)
 * author: dev-foot / 2026-08-01
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const VERSION = '20260801093000';
const NAME = 'foot_admin_reset_password_confirm_email';
const CREATED_BY = 'dev-foot:T-20260801-foot-RESETPW-CONFIRM-EMAIL-ledger-forwarddoc';
const MIG_FILE = join(__dirname, '../supabase/migrations/20260801093000_foot_admin_reset_password_confirm_email.sql');

const body = readFileSync(MIG_FILE, 'utf8');
const esc = (s) => String(s).replace(/'/g, "''");

// statements = 파일 선언 그대로(단일 원소 text[])
const sql = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('${esc(VERSION)}', '${esc(NAME)}', ARRAY['${esc(body)}']::text[], '${esc(CREATED_BY)}')
ON CONFLICT (version) DO NOTHING;`;

console.log(`── Ledger forward-doc (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log(`version=${VERSION} name=${NAME}`);
console.log(`statements[0] bytes=${body.length}  created_by=${CREATED_BY}`);
console.log(`SQL preview (head 240): ${sql.slice(0, 240)} ...`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → 원장 write 없음. 재적용(CREATE OR REPLACE) 없음.');
  process.exit(0);
}

const res = await query(sql);
console.log('INSERT result:', JSON.stringify(res));
console.log('✓ applied (idempotent)');
