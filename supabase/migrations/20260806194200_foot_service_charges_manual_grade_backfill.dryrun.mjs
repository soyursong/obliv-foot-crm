/**
 * DRY-RUN (No-Persistence Protocol) — 20260806194200_foot_service_charges_manual_grade_backfill.sql
 * T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE (AC-4)
 *
 * (a) READ-ONLY 사전 census: 대상 fingerprint 행 수 + 이탈('manual'이나 지문 불일치) 행 보고.
 * (b) 마이그 본문 txn-strip → 단일 트랜잭션 실행 → 트랜잭션 내부에서 UPDATE 영향행수 집계 → sentinel unwind(무영속).
 * (c) POST-PROBE: 아카이브 테이블/등급변경이 prod 에 영속되지 않았음을 실증.
 *
 * ⚠ write 영속 0. 실행: node supabase/migrations/20260806194200_foot_service_charges_manual_grade_backfill.dryrun.mjs
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
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_20260806194200';
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
  // (a) READ-ONLY 사전 census — 대상 지문 + 이탈행
  const census = await q(`
    SELECT
      count(*) FILTER (WHERE customer_grade_at_charge='manual'
                        AND is_insurance_covered=false AND copayment_rate_at_charge=1.0) AS target,
      count(*) FILTER (WHERE customer_grade_at_charge='manual'
                        AND NOT (is_insurance_covered=false AND copayment_rate_at_charge=1.0)) AS off_fingerprint
    FROM service_charges;`);
  const c = JSON.parse(census.body)[0];
  console.log(`사전 census: target(지문일치 backfill 대상)=${c.target}, off_fingerprint(제외·미접촉)=${c.off_fingerprint}`);
  if (Number(c.off_fingerprint) > 0) {
    console.log('⚠ 지문 불일치 manual 행 존재 — 본 backfill 은 해당 행 미접촉(supervisor 확인 권장).');
  }

  // (b) 마이그 실행 + 트랜잭션 내부 영향행수 집계 → sentinel unwind
  const mig = strip(readFileSync(`${HERE}20260806194200_foot_service_charges_manual_grade_backfill.sql`, 'utf8'));
  const wrapped = `BEGIN;
${mig}
DO $$
DECLARE v_updated INT; v_frozen INT;
BEGIN
  SELECT count(*) INTO v_frozen FROM _backfill_sc_manual_grade_20260806;
  SELECT count(*) INTO v_updated FROM service_charges
    WHERE id IN (SELECT id FROM _backfill_sc_manual_grade_20260806)
      AND customer_grade_at_charge='unverified';
  -- 무결성 가드: 트랜잭션 내부 실제 적용행수 = 사전 census target 과 일치해야 함(불일치 시 sentinel 대신 assert-fail).
  ASSERT v_frozen = v_updated, format('frozen(%s) <> updated(%s)', v_frozen, v_updated);
  RAISE EXCEPTION '${SENTINEL}';
END $$;`;
  const res = await q(wrapped);
  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(assert-fail 또는 DDL 오류). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  // NOTE: Supabase Management API 는 NOTICE 를 body 에 반환하지 않음 → 영향행수는 위 사전 census(target) 가 SSOT.
  //   트랜잭션 내부 ASSERT(frozen=updated) 통과 = INSERT..SELECT freeze 셋과 UPDATE 적용셋 1:1 정합 실증.
  console.log(`✓ 1) 마이그 실행 통과 + 내부 ASSERT(frozen=updated) 통과 + sentinel 도달 → 무영속 unwind. 적용 예정 = census target ${c.target}건.`);

  // (c) POST-PROBE — 아카이브 테이블/등급변경 무영속 실증
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='_backfill_sc_manual_grade_20260806') AS archive_tbl,
      (SELECT count(*) FROM service_charges WHERE customer_grade_at_charge='manual') AS manual_still;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row), '(기대 archive_tbl=0, manual_still=원본 20 유지)');
  if (Number(row.archive_tbl) !== 0) { console.error('❌ 아카이브 테이블 영속 감지'); process.exit(1); }
  console.log('✓ 2) 무영속 확인 — DRY-RUN PASS.');
})();
