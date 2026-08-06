/**
 * DRY-RUN (No-Persistence Protocol) — 20260806194000_foot_grade_valueset_add_near_poor_veteran.sql
 * T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE (AC-0)
 *
 * 마이그 본문을 txn-strip 후 단일 트랜잭션에서 실행 → sentinel RAISE 로 통째 unwind(무영속).
 * POST-PROBE: customers.insurance_grade CHECK 가 near_poor 를 prod 에 영속하지 않았음을 실증.
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260806194000_foot_grade_valueset_add_near_poor_veteran.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_20260806194000';
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
  const mig = strip(readFileSync(`${HERE}20260806194000_foot_grade_valueset_add_near_poor_veteran.sql`, 'utf8'));
  const wrapped = `BEGIN;\n${mig}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);

  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(DDL 오류/의존성/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  console.log('✓ 1) DDL 문법/의존성(CHECK 재작성 + update_insurance_grade CREATE OR REPLACE) 통과 + sentinel 도달 → 무영속 unwind.');

  // POST-PROBE — near_poor 가 prod CHECK 에 영속되지 않았음 실증 (무영속).
  const probe = await q(`
    SELECT count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname='customers' AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%insurance_grade %'
      AND pg_get_constraintdef(c.oid) ILIKE '%near_poor%';`);
  const n = Number(JSON.parse(probe.body)[0].n);
  console.log(`POST-PROBE(무영속 실증): CHECK contains near_poor = ${n} (기대 0)`);
  if (n !== 0) { console.error('❌ 영속 감지 — 롤백 필요'); process.exit(1); }
  console.log('✓ 2) 무영속 확인 — DRY-RUN PASS.');
})();
