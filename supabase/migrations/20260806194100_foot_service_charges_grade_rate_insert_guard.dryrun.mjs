/**
 * DRY-RUN (No-Persistence Protocol) — 20260806194100_foot_service_charges_grade_rate_insert_guard.sql
 * T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE (AC-1/AC-2)
 *
 * 마이그 본문 txn-strip → 단일 트랜잭션 실행 → sentinel unwind(무영속).
 * POST-PROBE: trg_service_charges_grade_rate_guard 트리거가 prod 에 영속되지 않았음을 실증.
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260806194100_foot_service_charges_grade_rate_insert_guard.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_20260806194100';
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
  const mig = strip(readFileSync(`${HERE}20260806194100_foot_service_charges_grade_rate_insert_guard.sql`, 'utf8'));
  const wrapped = `BEGIN;\n${mig}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(DDL 오류/의존성/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  console.log('✓ 1) 트리거+함수 생성 문법/의존성 통과 + sentinel 도달 → 무영속 unwind.');

  const probe = await q(`
    SELECT
      (SELECT count(*) FROM pg_trigger WHERE tgname='trg_service_charges_grade_rate_guard') AS trg,
      (SELECT count(*) FROM pg_proc WHERE proname='foot_service_charges_grade_rate_guard') AS fn;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row), '(기대 trg=0 fn=0)');
  if (Number(row.trg) !== 0 || Number(row.fn) !== 0) {
    console.error('❌ 영속 감지 — 롤백 필요'); process.exit(1);
  }
  console.log('✓ 2) 무영속 확인 — DRY-RUN PASS.');
})();
