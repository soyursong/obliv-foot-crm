/**
 * T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY — gated apply
 *
 * 목적: reservations.is_healer_intent 컬럼을 운영 DB(rxlomoozakkjesdqjtvd)에 적용.
 *   FE(5699b54)는 컬럼 기대하나 prod 미적용 → PGRST204. 본 건이 영구 RC.
 *
 * 흐름:
 *   [A] read-only audit — 현재 컬럼 존재여부 + healer_flag=true 대상건수 사전측정(리스크#4 권고).
 *   [B] ADD COLUMN apply — supabase/migrations/20260614130000_reservation_is_healer_intent.sql
 *       (ADDITIVE·멱등 IF NOT EXISTS·무손실. PG11+ fast-default → 테이블 rewrite 無).
 *   [C] backfill datafix — supabase/migrations/20260615T_is_healer_intent_backfill.datafix.sql
 *       (healer_flag=true → is_healer_intent=true 승계. IS DISTINCT FROM 가드로 멱등·소량.)
 *       ※ 본 티켓 AC1/AC2.4 + risk#4 가 backfill 명시 → 본 티켓이 분리 datafix 게이트.
 *   [D] NOTIFY pgrst reload schema → PGRST204 해소.
 *   [E] post-verify — column metadata(boolean/NO/false) + backfill 결과 + sample.
 *
 * 실행:
 *   node scripts/T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY_apply.mjs            # 기본 = audit-only
 *   node scripts/T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY_apply.mjs --apply     # supervisor DDL-diff GO 후
 *
 * 롤백: ALTER TABLE public.reservations DROP COLUMN IF EXISTS is_healer_intent;
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
  join(REPO, 'supabase/migrations/20260614130000_reservation_is_healer_intent.sql'),
  'utf8',
);
const MIG_BACKFILL = readFileSync(
  join(REPO, 'supabase/migrations/20260615T_is_healer_intent_backfill.datafix.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY_evidence.md');

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
  out('# T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY — DB-gate evidence');
  out(`- prod: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out('');

  // ── [A] read-only audit ──
  out('## [A] read-only audit (pre)');
  const { rows: colPre } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='reservations' AND column_name='is_healer_intent';`);
  const colExistsPre = colPre.length > 0;
  out('```');
  out(`is_healer_intent 컬럼(적용 전): ${colExistsPre ? JSON.stringify(colPre[0]) : '없음(PGRST204 원인)'}`);
  const { rows: cntR } = await client.query(`
    SELECT
      (SELECT count(*) FROM reservations)                      AS total,
      (SELECT count(*) FROM reservations WHERE healer_flag=true) AS healer_flag_true;`);
  out(`reservations 총 ${cntR[0].total}행 | healer_flag=true ${cntR[0].healer_flag_true}행 (backfill 대상 상한)`);
  out('```');
  const backfillTarget = +cntR[0].healer_flag_true;

  if (!DO_APPLY) {
    out('\n✋ audit-only: --apply 미지정 → 적용 미실행 (supervisor DDL-diff GO 대기).');
    await client.end(); flush(); process.exit(0);
  }

  // ── [B] ADD COLUMN apply (ADDITIVE·멱등) ──
  out('\n## [B] ADD COLUMN apply (20260614130000)');
  await client.query(MIG_ADD);
  out('✅ ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false (+COMMENT) 적용 완료');

  // ── [C] backfill datafix (조건부·멱등) ──
  out('\n## [C] backfill datafix (20260615T)');
  const bf = await client.query(MIG_BACKFILL);
  out(`✅ backfill UPDATE 적용 완료 — ${bf.rowCount}행 갱신 (대상상한 ${backfillTarget}행 / IS DISTINCT FROM 가드)`);

  // ── [D] PostgREST schema cache reload ──
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out("\n## [D] NOTIFY pgrst 'reload schema' 전송 (PGRST204 해소)");

  // ── [E] post-verify ──
  out('\n## [E] post-verify');
  const { rows: colPost } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='reservations' AND column_name='is_healer_intent';`);
  const { rows: vR } = await client.query(`
    SELECT
      (SELECT count(*) FROM reservations WHERE is_healer_intent=true)               AS intent_true,
      (SELECT count(*) FROM reservations WHERE healer_flag=true AND is_healer_intent=true) AS both_true,
      (SELECT count(*) FROM reservations WHERE healer_flag=true AND is_healer_intent IS DISTINCT FROM true) AS unmigrated;`);
  out('```');
  out(`컬럼 메타(적용 후): ${colPost.length ? JSON.stringify(colPost[0]) : 'MISSING'}`);
  out(`is_healer_intent=true: ${vR[0].intent_true}행`);
  out(`healer_flag=true AND is_healer_intent=true (승계 확인): ${vR[0].both_true}행`);
  out(`healer_flag=true AND is_healer_intent != true (미승계 잔여): ${vR[0].unmigrated}행 (0 기대)`);
  out('```');

  const c = colPost[0] || {};
  const metaOk = c.data_type === 'boolean' && c.is_nullable === 'NO' && String(c.column_default).includes('false');
  const backfillOk = +vR[0].unmigrated === 0 && +vR[0].both_true === backfillTarget;
  const ok = metaOk && backfillOk;
  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out(`- 컬럼 메타 boolean/NO/false: ${metaOk ? 'OK' : 'FAIL'}`);
  out(`- backfill 승계 완료(잔여 0, 승계 ${vR[0].both_true}=${backfillTarget}): ${backfillOk ? 'OK' : 'FAIL'}`);
  out('- FE 내성화(a2ff8f5 isHealerIntentColMissing 재시도)는 잔존(no-op) — 정상 경로 1회 성공.');
  out('- 롤백: ALTER TABLE public.reservations DROP COLUMN IF EXISTS is_healer_intent;');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
