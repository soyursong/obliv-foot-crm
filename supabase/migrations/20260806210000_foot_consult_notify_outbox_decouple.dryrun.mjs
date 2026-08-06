/**
 * DRY-RUN (No-Persistence Protocol) — 20260806210000_foot_consult_notify_outbox_decouple.sql
 * T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN
 *
 * 본 마이그 본문을 txn-strip 후 단일 트랜잭션에서 실행하고 sentinel RAISE 로 통째 unwind(무영속).
 * POST-PROBE 로 consult_notify_outbox 테이블/UNIQUE/함수 3종이 prod 에 영속되지 않았음을 실증한다.
 *
 * ⚠ Migration Dry-Run No-Persistence Protocol 준수: up.sql 내장 COMMIT 이 sentinel 이전에 txn 확정되지 않도록
 *    BEGIN/COMMIT strip 후 단일 txn 으로 감싸고 sentinel 로 unwind. cron.schedule 은 txn 밖 side-effect 라
 *    dry-run 에서 실제 잡 등록 가능성 → POST-PROBE 에서 잡 부재까지 확인(있으면 정리).
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260806210000_foot_consult_notify_outbox_decouple.dryrun.mjs
 */
import { readFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_20260806210000';
// cron.schedule 은 SELECT 함수라 strip 대상 아님 — 대신 dry-run 은 cron 등록문을 제거하고 DDL/함수만 검증.
const strip = (s) => s
  .split('\n')
  .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
  .join('\n');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

(async () => {
  let mig = strip(readFileSync(`${HERE}20260806210000_foot_consult_notify_outbox_decouple.sql`, 'utf8'));
  // cron.unschedule/schedule 은 txn 밖 side-effect(무영속 대상 아님) → dry-run 에서 제거하고 DDL/함수만 검증.
  mig = mig
    .split(/;\s*\n/)
    .filter((stmt) => !/cron\.(unschedule|schedule)/i.test(stmt))
    .join(';\n') + ';';

  // 단일 트랜잭션: 마이그 본문 → sentinel unwind(무영속).
  const wrapped = `BEGIN;\n${mig}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(DDL 오류/의존성/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 2000));
    process.exit(1);
  }
  console.log('✓ 1) DDL 문법/의존성(check_ins·vault·pg_net) 통과 + sentinel 도달 → 무영속 unwind.');

  // POST-PROBE — 테이블/UNIQUE/함수 3종 + cron 잡이 prod 에 영속되지 않았음 실증.
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='consult_notify_outbox') AS tbl,
      (SELECT count(*) FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_consult_notify_outbox_event') AS uq,
      (SELECT count(*) FROM pg_proc WHERE proname='enqueue_consult_notify') AS fn_enqueue,
      (SELECT count(*) FROM pg_proc WHERE proname='process_consult_notify_outbox') AS fn_worker,
      (SELECT count(*) FROM pg_proc WHERE proname='alert_consult_notify_dlq') AS fn_alert,
      (SELECT count(*) FROM cron.job WHERE jobname='foot-consult-notify-worker') AS cronjob;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row));
  const leaked =
    Number(row.tbl) !== 0 || Number(row.uq) !== 0 || Number(row.fn_enqueue) !== 0 ||
    Number(row.fn_worker) !== 0 || Number(row.fn_alert) !== 0 || Number(row.cronjob) !== 0;
  if (leaked) {
    console.error('❌ DRY-RUN LEAK — 무영속 위반(위 항목 중 0 아닌 것 = prod 영속됨). 즉시 rollback.sql 적용 필요.');
    process.exit(2);
  }
  console.log('✅ DRY-RUN PASS — DDL/함수/UNIQUE/cron 전부 무영속(0). 문법·의존성 OK. 실제용 apply 는 별도 게이트.');
})();
