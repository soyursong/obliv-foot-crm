/**
 * DRY-RUN (No-Persistence Protocol) — 20260804210000_foot_cband_inflight_lock_approve_only.sql
 * T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY (증분-6 / AC-11)
 *
 * ── 무영속 보장(sentinel-bypass 불가, Migration Dry-Run No-Persistence 표준) ──────────
 *   1) 마이그 본문 top-level txn 제어문(BEGIN;/COMMIT;) STRIP — 내장 COMMIT 이 sentinel 前 확정하는 hazard 차단.
 *   2) `BEGIN; <stripped DDL>; <RAISE sentinel>;` 단일 트랜잭션 → RAISE 로 강제 abort/unwind → DDL 미영속.
 *   3) ★POST-PROBE — 실행 후 pg_indexes 재조회로 인덱스 술어가 '원형(tran_type 미포함)' 그대로임을 확정(무영속 실증).
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260804210000_foot_cband_inflight_lock_approve_only.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_210000';

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
  const raw = readFileSync(`${HERE}20260804210000_foot_cband_inflight_lock_approve_only.sql`, 'utf8');
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

  // 3) POST-PROBE — 무영속 실증(인덱스 술어가 여전히 원형 = tran_type 미포함).
  const probe = await q(`
    SELECT indexdef FROM pg_indexes
     WHERE schemaname='public' AND indexname='ux_cband_pa_inflight_checkin';`);
  let rows;
  try { rows = JSON.parse(probe.body); } catch { rows = []; }
  const def = rows?.[0]?.indexdef ?? '';
  const stillHasTranType = /tran_type/i.test(def);
  console.log(`  · post-probe indexdef: ${def || '(부재)'}`);
  if (stillHasTranType) {
    console.error('❌ POST-PROBE FAIL — 인덱스 술어에 tran_type 이 이미 반영됨(=DDL 영속 의심, 무영속 위반).');
    process.exit(1);
  }
  console.log('✓ 2) POST-PROBE — 인덱스 술어 원형(tran_type 미포함) 유지 = 무영속 실증. DRY-RUN PASS.');
})();
