/**
 * T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B — MIG-GATE apply + evidence
 *   ① DRY-RUN(No-Persistence): up.sql 본문 전체를 BEGIN…ROLLBACK 으로 실행(txn-control strip=COMMIT→ROLLBACK).
 *      → ALTER/CREATE FUNCTION/INDEX 전부 실제 실행·파싱 검증 후 무영속 ROLLBACK. post-probe 로 잔존 0 확인.
 *   ② APPLY: up.sql 원본(BEGIN…COMMIT) 영속 적용.
 *   ③ LEDGER: 컬럼 2/함수 2/부분인덱스 1 실재 + soft-hide 아직 0행 + ★B2 parity(consulted_cust_rev==consulted_cust
 *      @zero-deleted → avg_amount 무변) 실측.
 *
 * mode: node ...apply.mjs dryrun | apply | ledger   (기본 dryrun)
 * prod=rxlomoozakkjesdqjtvd. ADDITIVE + DA-20260725-...-MONEYSAFE GO.
 */
import { readFileSync } from 'node:fs';
const DIR = '/Users/domas/GitHub/obliv-foot-crm';
const env = Object.fromEntries(readFileSync(`${DIR}/.env.local`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const UP = `${DIR}/supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql`;

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

const mode = process.argv[2] || 'dryrun';
const up = readFileSync(UP, 'utf8');

async function colProbe() {
  return (await q(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name IN ('deleted_at','deleted_by')`))[0].n;
}

if (mode === 'dryrun') {
  console.log('════ ① DRY-RUN (No-Persistence: COMMIT→ROLLBACK, 본문 전체 실행) ════');
  const before = await colProbe();
  console.log('[pre] deleted_* 컬럼 실재 =', before, '(기대 0 = 미적용)');
  // up.sql 의 최종 COMMIT 을 ROLLBACK 으로 치환(BEGIN 은 유지) → 전체 DDL 실행 후 무영속.
  const body = up.replace(/\bCOMMIT\s*;/i, 'ROLLBACK;');
  await q(body); // 실패 시 throw = 파싱/의존성 오류 노출
  const after = await colProbe();
  console.log('[post-probe] ROLLBACK 후 잔존 컬럼 =', after, '(기대', before, '= 무영속 확인)');
  if (after !== before) throw new Error(`무영속 위반: pre=${before} post=${after}`);
  console.log('DRY-RUN PASS — 전체 DDL 실행 성공 + 무영속.');
} else if (mode === 'apply') {
  console.log('════ ② APPLY (영속) ════');
  await q(up); // BEGIN…COMMIT 원본
  const n = await colProbe();
  console.log('적용 후 deleted_* 컬럼 =', n, '(기대 2)');
  if (n !== 2) throw new Error(`APPLY 검증 실패: ${n}/2`);
  console.log('APPLY OK.');
} else if (mode === 'ledger') {
  console.log('════ ③ LEDGER CHECK ════');
  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' AND column_name IN ('deleted_at','deleted_by') ORDER BY 1`);
  console.log('컬럼:', JSON.stringify(cols));
  const fns = await q(`SELECT proname FROM pg_proc WHERE proname IN ('foot_stats_consultant','foot_stats_noshow_returning') ORDER BY 1`);
  console.log('함수:', JSON.stringify(fns.map(f => f.proname)));
  const idx = await q(`SELECT indexname FROM pg_indexes WHERE tablename='check_ins' AND indexname='idx_check_ins_live_clinic_checkedin'`);
  console.log('부분인덱스:', JSON.stringify(idx.map(i => i.indexname)));
  const del = (await q(`SELECT count(*)::int AS n FROM check_ins WHERE deleted_at IS NOT NULL`))[0].n;
  console.log('soft-hide 행 수(현재):', del, '(신규 feature → 기대 0)');
  // ★B2 parity @zero-deleted: consulted_cust_rev(include) == consulted_cust(exclude) 이므로 avg_amount 무변.
  const parity = (await q(`
    WITH ticketed AS (
      SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.deleted_at
      FROM check_ins ci JOIN status_transitions st ON st.check_in_id=ci.id
      WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL
        AND st.to_status='consultation'
        AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN '2000-01-01' AND '2999-12-31'
    ),
    excl AS (SELECT consultant_id, COUNT(DISTINCT customer_id) c FROM ticketed WHERE deleted_at IS NULL GROUP BY 1),
    incl AS (SELECT consultant_id, COUNT(DISTINCT customer_id) c FROM ticketed GROUP BY 1)
    SELECT COUNT(*)::int AS mismatch
    FROM excl FULL OUTER JOIN incl USING (consultant_id)
    WHERE COALESCE(excl.c,0) <> COALESCE(incl.c,0)`))[0].mismatch;
  console.log('★B2 parity @zero-deleted (consulted 객수 exclude vs include 불일치 상담사 수):', parity, '(기대 0 = avg_amount 무변)');
  if (fns.length !== 2 || cols.length !== 2 || idx.length !== 1) throw new Error('LEDGER 실재 검증 실패');
  if (parity !== 0) throw new Error(`B2 parity 위반: mismatch=${parity} (배포시 avg_amount 변동 = 회귀)`);
  console.log('LEDGER PASS — 실재 확정 + zero-deleted parity(무회귀) 확인.');
} else {
  console.log('mode? dryrun|apply|ledger');
}
