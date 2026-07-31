/**
 * DRY-RUN (No-Persistence): T-20260731-foot-FOOTQST-PHOTO-2SLOT-LR-BOTTOM
 *   20260731200000_foot_healthq_photo_foot_side.sql
 *   (health_q_photos.foot_side ADD COLUMN + partial unique index + fn_health_q_submit 4-arg 확장)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 오브젝트 prod 부재 실측(INV-3).
 *   ⚠ up.sql = ALTER TABLE ADD COLUMN(+CHECK) + CREATE UNIQUE INDEX(non-CONCURRENTLY) + COMMENT
 *     + CREATE OR REPLACE FUNCTION → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * post-probe:
 *   - column health_q_photos.foot_side  ABSENT (ADDITIVE 신규 컬럼 무영속 확인)
 *   - relation public.uq_health_q_photos_result_side  ABSENT (partial unique index 무영속 확인)
 *   ※ fn_health_q_submit 은 dry-run 전에도 존재(4-arg) → CREATE OR REPLACE 는 rollback 으로 복원되므로
 *     absence 로 probe 불가(pre-exist). 컬럼/인덱스 absence 가 핵심 무영속 근거.
 *
 * 실행: (repo root) node supabase/migrations/20260731200000_foot_healthq_photo_foot_side.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, regclassAbsent, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260731200000_foot_healthq_photo_foot_side.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('health_q_photos', 'foot_side'),
    regclassAbsent('public.uq_health_q_photos_result_side'),
  ],
  passNote: '(health_q_photos.foot_side 컬럼 + partial unique index + fn 4-arg 확장 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
