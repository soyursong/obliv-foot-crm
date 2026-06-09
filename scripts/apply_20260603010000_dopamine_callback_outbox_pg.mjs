/**
 * T-20260602-multi-CALLBACK-EF-4-NEW — 풋 CRM 도파민 콜백 outbox 적용/검증
 *
 *   AC-S1) dopamine_callback_outbox / dopamine_callback_config 테이블 + 인덱스 + RLS
 *   AC-S2) enqueue_dopamine_callback() 트리거 2종 (check_ins / reservations)
 *   AC-S3) process_dopamine_callback_outbox() + pg_cron 'foot-dopamine-callback-worker'(분당)
 *   AC-S4) alert_dopamine_callback_dlq()
 *
 * 실행 모드:
 *   node scripts/apply_20260603010000_dopamine_callback_outbox_pg.mjs --dry-run
 *     → BEGIN; (마이그 SQL); ROLLBACK;  : 파싱·객체생성 검증, 영속 변경 0.
 *   node scripts/apply_20260603010000_dopamine_callback_outbox_pg.mjs --apply
 *     → COMMIT. ⚠️ supervisor 마이그 게이트(db_change=true) GO 후에만 사용.
 *       적용 즉시 'foot-dopamine-callback-worker' cron 분당 기동(mode 기본 shadow).
 *
 * node-pg pooler 직접 연결. CREATE ... IF NOT EXISTS + cron.unschedule 가드 = 멱등(재실행 안전).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const MIG = 'supabase/migrations/20260603010000_dopamine_callback_outbox.sql';
const raw = fs.readFileSync(MIG, 'utf8');
const inner = raw
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// 핵심 객체 4종(테이블2/함수2) + 트리거2 + cron 잡 존재 검증 + 기본 모드 shadow.
const SMOKE = `
SELECT
  (SELECT to_regclass('public.dopamine_callback_outbox') IS NOT NULL)  AS has_outbox_tbl,
  (SELECT to_regclass('public.dopamine_callback_config') IS NOT NULL)  AS has_config_tbl,
  (SELECT mode FROM public.dopamine_callback_config WHERE id = true)    AS cfg_mode,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'enqueue_dopamine_callback')          AS fn_enqueue,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'process_dopamine_callback_outbox')   AS fn_worker,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'alert_dopamine_callback_dlq')        AS fn_alert,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('trg_dopamine_cb_checkin','trg_dopamine_cb_resv')) AS trg_cnt,
  (SELECT COUNT(*) FROM cron.job WHERE jobname = 'foot-dopamine-callback-worker')     AS cron_cnt;
`;

(async () => {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(inner);
    const r = (await client.query(SMOKE)).rows[0];
    console.log('스모크 결과:', r);
    const fail = [];
    if (r.has_outbox_tbl !== true) fail.push('outbox 테이블 부재');
    if (r.has_config_tbl !== true) fail.push('config 테이블 부재');
    if (r.cfg_mode !== 'shadow')   fail.push(`기본 모드가 shadow 아님(${r.cfg_mode})`);
    if (Number(r.fn_enqueue) !== 1) fail.push('enqueue 함수 부재');
    if (Number(r.fn_worker)  !== 1) fail.push('worker 함수 부재');
    if (Number(r.fn_alert)   !== 1) fail.push('alert 함수 부재');
    if (Number(r.trg_cnt)    !== 2) fail.push(`트리거 ${r.trg_cnt}/2`);
    if (Number(r.cron_cnt)   !== 1) fail.push(`cron 잡 ${r.cron_cnt}/1`);
    if (fail.length) throw new Error('AC 위반: ' + fail.join(' / '));

    if (MODE === 'apply') {
      await client.query('COMMIT');
      console.log('✅ --apply: 마이그 COMMIT 완료. (worker cron 분당 기동, mode=shadow)');
    } else {
      await client.query('ROLLBACK');
      console.log('✅ --dry-run: 객체 4+2+1 검증 통과. ROLLBACK (영속 변경 없음).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
