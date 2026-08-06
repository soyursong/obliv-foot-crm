/**
 * DRY-RUN (No-Persistence Protocol) — 20260807110000_foot_notiflog_dummy_sent_atafail_correction.sql
 * T-20260804-foot-FOOTCTR-SMS-DUMMY-LOG-CLEANUP
 *
 * 마이그 본문(txn-strip)을 단일 트랜잭션에서 실행 → 내부 가드(CLOSED-SENSOR/DRIFT/ROWS-AFFECTED/POST-VERIFY)를
 * 모두 통과시켜 정정을 실제 수행한 뒤, sentinel RAISE 로 통째 unwind(무영속).
 * POST-PROBE 로 (a) archive 테이블 미영속 (b) DUMMY-% 'sent' 잔존 = 582(원상) 실증.
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260807110000_foot_notiflog_dummy_sent_atafail_correction.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_20260807110000';
const strip = (s) => s.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l)).join('\n');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

(async () => {
  const mig = strip(readFileSync(`${HERE}20260807110000_foot_notiflog_dummy_sent_atafail_correction.sql`, 'utf8'));
  const wrapped = `BEGIN;\n${mig}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(가드 ABORT/문법오류/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 2000));
    process.exit(1);
  }
  console.log('✓ 1) 마이그 본문 전 가드(CLOSED-SENSOR/DRIFT/ROWS-AFFECTED=582/POST-VERIFY) 통과 + sentinel 도달 → 무영속 unwind.');

  // POST-PROBE — 무영속 실증: archive 테이블 미존재 + DUMMY 'sent' 원상(582).
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='notification_logs_dummy_sent_archive_20260807') AS archive_persisted,
      (SELECT count(*) FROM public.notification_logs
        WHERE recipient_phone LIKE 'DUMMY-%' AND customer_id IS NULL AND status='sent') AS dummy_sent_remaining;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row));
  if (Number(row.archive_persisted) !== 0) {
    console.error('❌ 무영속 위반 — dry-run 이 archive 테이블을 prod 에 영속시킴.');
    process.exit(2);
  }
  if (Number(row.dummy_sent_remaining) !== 582) {
    console.error(`❌ 무영속 위반/드리프트 — DUMMY 'sent' 잔존 ${row.dummy_sent_remaining} != 582(원상).`);
    process.exit(2);
  }
  console.log(`✓ 무영속 실증 완료(archive_persisted=0, dummy_sent_remaining=582 원상) — prod 무접점. DRY-RUN PASS.`);
})().catch((e) => { console.error('DRYRUN ERROR:', e.message); process.exit(1); });
