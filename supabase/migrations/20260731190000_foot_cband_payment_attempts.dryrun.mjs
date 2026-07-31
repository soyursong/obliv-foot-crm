/**
 * DRY-RUN (No-Persistence Protocol) — 20260731190000_foot_cband_payment_attempts.sql (K6)
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
 *
 * ── 무영속 보장(sentinel-bypass 불가, Migration Dry-Run No-Persistence 표준) ──────────
 *   1) 마이그 본문에서 top-level txn 제어문(BEGIN;/COMMIT;) STRIP — 본문 내장 COMMIT 이 sentinel 前 확정하는 hazard 차단.
 *      (plpgsql $$...$$ 내부의 BEGIN/END 는 'BEGIN;' 형태가 아니므로 미영향.)
 *   2) `BEGIN; <stripped DDL>; <RAISE sentinel>;` 단일 트랜잭션 실행 → RAISE 로 강제 abort/unwind → 어떤 DDL 도 미영속.
 *   3) ★POST-PROBE — 실행 후 information_schema 재조회로 cband_payment_attempts / 트리거 / 함수 부재 확정(무영속 실증).
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260731190000_foot_cband_payment_attempts.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_190000';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t };
}

(async () => {
  // 1) 본문 로드 + top-level txn 제어문 STRIP
  const raw = readFileSync(`${HERE}20260731190000_foot_cband_payment_attempts.sql`, 'utf8');
  const stripped = raw.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l)).join('\n');

  // 2) 단일 트랜잭션 + sentinel RAISE unwind
  const wrapped = `BEGIN;\n${stripped}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  const sentinelHit = res.body.includes(SENTINEL);
  if (!sentinelHit) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(=DDL 실행 중 오류 또는 조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  console.log(`✓ 1) DDL 문법/의존성 통과 + sentinel(${SENTINEL}) 도달 → 트랜잭션 강제 unwind(무영속).`);

  // 3) POST-PROBE — 무영속 실증(테이블/트리거/함수 부재)
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='cband_payment_attempts') AS tbl,
      (SELECT count(*) FROM information_schema.triggers
        WHERE trigger_schema='public' AND trigger_name IN ('trg_cband_pa_pci_guard','trg_cband_pa_sim_stamp','trg_cband_pa_touch_updated_at')) AS trgs,
      (SELECT count(*) FROM pg_proc WHERE proname IN ('cband_pa_pci_guard','cband_pa_sim_stamp')) AS fns;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row));
  if (Number(row.tbl) !== 0 || Number(row.trgs) !== 0) {
    console.error('❌ 무영속 위반 — dry-run 이 prod 에 객체를 영속시킴. 즉시 롤백 필요.');
    process.exit(2);
  }
  console.log('✓ 무영속 실증 완료(tbl=0, trgs=0) — prod 무접점. DRY-RUN PASS.');
})().catch((e) => { console.error('DRYRUN ERROR:', e.message); process.exit(1); });
