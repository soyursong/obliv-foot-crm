/**
 * DRY-RUN (No-Persistence Protocol) — 20260731190500_foot_payments_payment_attempt_id_fk.sql (K7)
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
 *
 * ★K7 은 cband_payment_attempts(K6) 를 FK 참조 → dry-run 은 동일 트랜잭션에서 K6 본문을 먼저 세운 뒤 K7 을 실행하고
 *   sentinel RAISE 로 통째 unwind(양쪽 모두 무영속). txn-strip + POST-PROBE 로 무영속 실증(payments.payment_attempt_id 부재).
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260731190500_foot_payments_payment_attempt_id_fk.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_190500';
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
  const k6 = strip(readFileSync(`${HERE}20260731190000_foot_cband_payment_attempts.sql`, 'utf8'));
  const k7 = strip(readFileSync(`${HERE}20260731190500_foot_payments_payment_attempt_id_fk.sql`, 'utf8'));

  // 동일 트랜잭션: K6(참조대상) → K7(FK) → sentinel unwind.
  const wrapped = `BEGIN;\n${k6}\n${k7}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(DDL 오류/의존성/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  console.log(`✓ 1) K6+K7 DDL 문법/의존성(FK→cband_payment_attempts) 통과 + sentinel 도달 → 무영속 unwind.`);

  // POST-PROBE — payments.payment_attempt_id / merchant_no / UNIQUE index / FK 부재 실증.
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='payments'
          AND column_name IN ('payment_attempt_id','merchant_no')) AS cols,
      (SELECT count(*) FROM pg_indexes
        WHERE schemaname='public' AND indexname='ux_payments_payment_attempt_id') AS idx,
      (SELECT count(*) FROM information_schema.table_constraints
        WHERE constraint_name='payments_payment_attempt_id_fkey') AS fk;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row));
  if (Number(row.cols) !== 0 || Number(row.idx) !== 0 || Number(row.fk) !== 0) {
    console.error('❌ 무영속 위반 — dry-run 이 prod payments 에 컬럼/인덱스/FK 를 영속시킴. 즉시 롤백 필요.');
    process.exit(2);
  }
  console.log('✓ 무영속 실증 완료(cols=0, idx=0, fk=0) — prod 무접점. DRY-RUN PASS.');
})().catch((e) => { console.error('DRYRUN ERROR:', e.message); process.exit(1); });
