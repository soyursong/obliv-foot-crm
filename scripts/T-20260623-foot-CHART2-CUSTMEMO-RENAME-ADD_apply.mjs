/**
 * T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD — gated apply
 *
 * 목적: customers.customer_note(2번차트 1구역 고객메모) 컬럼을 DB(rxlomoozakkjesdqjtvd)에 적용.
 *   1구역 예약메모 하단 [고객메모] 칸 — 직접수정·non-history(현재값 단일 유지·수정).
 *   RECONCILE: customer_memo(MEMO-HISTORY가 history 전환 예정)와 무간섭하도록 신규 단일 TEXT 컬럼으로 분리.
 *   autonomy §3.1: ADDITIVE nullable 신규컬럼 → 대표게이트 면제, supervisor DDL-diff만. (responder: DA CONSULT 대기 불필요)
 *
 * 흐름:
 *   [A] read-only audit — 컬럼 존재여부 사전측정.
 *   [B] ADD COLUMN apply — supabase/migrations/20260623170000_customers_customer_note.sql
 *       (ADDITIVE·멱등 IF NOT EXISTS·nullable·DEFAULT 없음·backfill 불요. PG11+ fast — 테이블 rewrite 無.)
 *   [C] NOTIFY pgrst reload schema → PostgREST 스키마 캐시 반영.
 *   [D] post-verify — column metadata(text/YES/null).
 *
 * 실행:
 *   node scripts/T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD_apply.mjs           # audit-only
 *   node scripts/T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD_apply.mjs --apply    # 적용
 *
 * 롤백: ALTER TABLE customers DROP COLUMN IF EXISTS customer_note;  (= 20260623170000_customers_customer_note.rollback.sql)
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DO_APPLY = process.argv.includes('--apply');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}
const MIG_ADD = readFileSync(
  join(REPO, 'supabase/migrations/20260623170000_customers_customer_note.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD_evidence.md');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const flush = () => {
  try { mkdirSync(dirname(EVID), { recursive: true }); writeFileSync(EVID, log.join('\n') + '\n'); console.log('\n📄 evidence →', EVID); }
  catch (e) { console.error('evidence write fail:', e.message); }
};

(async () => {
  await client.connect();
  out('# T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD — DB-gate evidence');
  out(`- db: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out(`- ADDITIVE nullable 신규컬럼 customers.customer_note (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만)`);
  out('');

  // ── [A] read-only audit ──
  out('## [A] read-only audit (pre)');
  const { rows: colPre } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='customers' AND column_name='customer_note';`);
  const colExistsPre = colPre.length > 0;
  out('```');
  out(`customers.customer_note 컬럼(적용 전): ${colExistsPre ? JSON.stringify(colPre[0]) : '없음(신설 대상)'}`);
  out('```');

  if (!DO_APPLY) {
    out('\n✋ audit-only: --apply 미지정 → 적용 미실행.');
    await client.end(); flush(); process.exit(0);
  }

  // ── [B] ADD COLUMN apply (ADDITIVE·멱등) ──
  out('\n## [B] ADD COLUMN apply (20260623170000)');
  await client.query(MIG_ADD);
  out('✅ ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_note TEXT (+COMMENT) 적용 완료');

  // ── [C] PostgREST schema cache reload ──
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out("\n## [C] NOTIFY pgrst 'reload schema' 전송");

  // ── [D] post-verify ──
  out('\n## [D] post-verify');
  const { rows: colPost } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='customers' AND column_name='customer_note';`);
  out('```');
  out(`컬럼 메타(적용 후): ${colPost.length ? JSON.stringify(colPost[0]) : 'MISSING'}`);
  out('```');

  const c = colPost[0] || {};
  const ok = c.data_type === 'text' && c.is_nullable === 'YES' && c.column_default == null;
  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out(`- 컬럼 메타 text/YES/null: ${ok ? 'OK' : 'FAIL — ' + JSON.stringify(c)}`);
  out('- 롤백: ALTER TABLE customers DROP COLUMN IF EXISTS customer_note;');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
