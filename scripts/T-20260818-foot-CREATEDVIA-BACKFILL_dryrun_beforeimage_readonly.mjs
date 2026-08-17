/**
 * T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION — DRY-RUN (SELECT-기반 무영속) + before-image 캡처
 * write0/DDL0: 실제 UPDATE 미실행. rows-would-update 를 predicate SELECT 로 산출(무영속 보장).
 *   실 UPDATE(BEGIN..RETURNING..)-형 apply SQL 은 supervisor MIG-GATE 에서 GO-token 후 실행.
 * 산출: before-image(target 188행 id + 현 created_via=NULL) + rows-affected 예측 + rollback 대상 명세.
 * GATE: READ-ONLY. write/DDL 0.
 */
import { writeFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);
const MIG = `'2026-06-29 11:09:35.494874+00'`;
const P_FS1 = `created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL`;
const P_FS2 = `created_via IS NULL AND created_at < ${MIG} AND source_system IS NULL AND external_id IS NULL`;

// 1. rows-would-update (무영속: 순수 predicate SELECT) — 실 UPDATE 아님
const fs1 = await q(`SELECT count(*) n FROM public.reservations WHERE ${P_FS1};`);
const fs2 = await q(`SELECT count(*) n FROM public.reservations WHERE ${P_FS2};`);

// 2. before-image: 대상 188행 id + 현 값(전부 NULL 이어야) — rollback 근거
const beforeFs1 = await q(`SELECT id, created_via, source_system, external_id, created_at
  FROM public.reservations WHERE ${P_FS1} ORDER BY created_at;`);
const beforeFs2 = await q(`SELECT id, created_via, created_at, source_system, external_id
  FROM public.reservations WHERE ${P_FS2} ORDER BY created_at;`);

// 3. 무영속 검증: 현재 NULL 총량(=200) 스냅샷 (apply 후 POSTCHECK 대조 기준)
const nullTotal = await q(`SELECT count(*) n FROM public.reservations WHERE created_via IS NULL;`);

// 4. before-image 전부 created_via IS NULL 인지 (fill 대상 순수성)
const nonNullInFs1 = beforeFs1.filter(r => r.created_via !== null).length;
const nonNullInFs2 = beforeFs2.filter(r => r.created_via !== null).length;

const report = {
  ticket: 'T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION',
  mode: 'DRY-RUN (SELECT-기반 무영속) · write0/DDL0 · 실 UPDATE 미실행',
  predicates: { FS1_dopamine: P_FS1, FS2_manual: P_FS2 },
  rows_would_update: { FS1_dopamine: Number(fs1[0].n), FS2_manual: Number(fs2[0].n), total: Number(fs1[0].n) + Number(fs2[0].n) },
  freeze_set_sizes: { FS1: 1, FS2: 187, FS3_keep_null: 12, total_null: Number(nullTotal[0].n) },
  before_image_purity: { FS1_nonnull_pre: nonNullInFs1, FS2_nonnull_pre: nonNullInFs2, note: '둘 다 0 이어야 = 대상 전부 현재 NULL' },
  before_image_fs1: beforeFs1,
  before_image_fs2_ids: beforeFs2.map(r => r.id),
  before_image_fs2_count: beforeFs2.length,
  fs1_flag: 'FS1 1행 = E2E 카나리(AC3취소카나리, external_id e2e...c301). provenance=dopamine 사실이나 실운영 analytics 가치 ≈0 → supervisor 판단 하 skip 가능.',
  fs3_flag: 'FS3 12행 = registrar_name=테스트시드(test seed), post-mig. DA do-less → NULL 유지(무접촉).',
  no_persistence_proof: 'UPDATE 미실행. rows_would_update 는 predicate SELECT 결과. apply 후 POSTCHECK 기준: total_null 200 → (200 - rows_applied) 감소.',
};
writeFileSync('db-gate/T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION_dryrun.json', j(report));
console.log(j(report));
console.log('\n=== dryrun.json written. write/DDL 0 (실 UPDATE 미실행). ===');
