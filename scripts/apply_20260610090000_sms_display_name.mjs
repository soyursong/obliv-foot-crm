/**
 * T-20260610-foot-SMS-DISPLAYNAME-SPLIT — 운영 DB 적용 (FIX-REQUEST MSG-20260611-044905-e5jb)
 *
 * supervisor QA phase1 FAIL(db_migration_pending) 해소:
 *   1) clinic_messaging_capability.sms_display_name 컬럼 존재 확인 → 없으면 적용
 *   2) admin_set_sms_display_name(uuid,text) RPC 존재 확인 → 없으면 적용
 *   3) 적용 후 재검증 (컬럼 + 함수)
 *
 * 멱등: 마이그 자체가 ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
 * 실행: node scripts/apply_20260610090000_sms_display_name.mjs
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260610090000_sms_display_name.sql'),
  'utf8',
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const out = (s) => console.log(s);

const checkColumn = async () => {
  const { rows } = await client.query(`
    SELECT data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='clinic_messaging_capability'
       AND column_name='sms_display_name';`);
  return rows[0] || null;
};

const checkFunc = async () => {
  const { rows } = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_set_sms_display_name';`);
  return rows[0] || null;
};

(async () => {
  await client.connect();
  out('🚀 T-20260610-foot-SMS-DISPLAYNAME-SPLIT 운영 DB 적용/검증');
  out(`   시각: ${new Date().toISOString()}`);

  // ── 사전 상태 ─────────────────────────────────────────────
  const preCol = await checkColumn();
  const preFn = await checkFunc();
  out(`\n[사전] sms_display_name 컬럼: ${preCol ? `있음(${preCol.data_type}(${preCol.character_maximum_length}) null=${preCol.is_nullable})` : '없음'}`);
  out(`[사전] admin_set_sms_display_name RPC: ${preFn ? `있음(${preFn.args})` : '없음'}`);

  if (preCol && preFn) {
    out('\n✅ 이미 적용됨 (idempotent) — 변경 없이 검증만 진행.');
  } else {
    out('\n[적용] 마이그레이션 SQL 실행…');
    await client.query('BEGIN');
    try {
      await client.query(MIG_SQL);
      await client.query('COMMIT');
      out('   ✅ 마이그레이션 COMMIT 완료');
    } catch (e) {
      await client.query('ROLLBACK');
      out(`   ❌ 실패 → ROLLBACK: ${e.message}`);
      throw e;
    }
  }

  // ── 사후 검증 ─────────────────────────────────────────────
  const col = await checkColumn();
  const fn = await checkFunc();
  out('\n[검증]');
  out(`   컬럼: ${col ? `OK ${col.data_type}(${col.character_maximum_length}) nullable=${col.is_nullable}` : 'FAIL 미존재'}`);
  out(`   RPC : ${fn ? `OK admin_set_sms_display_name(${fn.args})` : 'FAIL 미존재'}`);
  if (!col || !fn) throw new Error('검증 실패 — 컬럼/RPC 미존재');

  // ── EF select 시뮬: clinic_messaging_capability 에서 sms_display_name 포함 select 무에러 ──
  out('\n[EF select 시뮬] clinic_messaging_capability sms_display_name 컬럼 select');
  const { rows: smp } = await client.query(`
    SELECT clinic_id, sms_display_name
      FROM public.clinic_messaging_capability
     LIMIT 3;`);
  out(`   ✅ select OK — ${smp.length} row 반환 (런타임 500 위험 해소)`);
  for (const r of smp) out(`      clinic=${r.clinic_id} sms_display_name=${r.sms_display_name ?? 'NULL(fallback)'}`);

  out('\n🏁 적용/검증 완료 — deploy-ready 재마킹 가능');
})()
  .catch((e) => { console.error('❌ 치명:', e.message); process.exitCode = 1; })
  .finally(async () => { try { await client.end(); } catch {} });
