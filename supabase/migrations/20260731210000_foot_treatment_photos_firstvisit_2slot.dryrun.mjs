/**
 * DRY-RUN (No-Persistence): T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR
 *   20260731210000_foot_treatment_photos_firstvisit_2slot.sql
 *   (treatment_photos: source CHECK 값집합 ADDITIVE 확장 + foot_side ADD COLUMN(+CHECK) + partial unique index)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 신규 오브젝트 prod 부재 실측(INV-3).
 *   ⚠ up.sql = ALTER TABLE DROP/ADD CONSTRAINT(CHECK) + ADD COLUMN(+CHECK) + CREATE UNIQUE INDEX(non-CONCURRENTLY)
 *     + COMMENT → 전부 txn-safe/가역 → 무영속 dry-run 적격
 *     (CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
 *
 * post-probe:
 *   - column treatment_photos.foot_side  ABSENT (ADDITIVE 신규 컬럼 무영속 확인)
 *   - relation public.uq_treatment_photos_checkin_source_side  ABSENT (partial unique index 무영속 확인)
 *   ※ source CHECK 는 dry-run 전에도 존재(4값) → DROP/ADD 는 rollback 으로 복원되므로 absence 로 probe 불가.
 *     컬럼/인덱스 absence 가 핵심 무영속 근거.
 *
 * 실행: (repo root) node supabase/migrations/20260731210000_foot_treatment_photos_firstvisit_2slot.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, regclassAbsent, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260731210000_foot_treatment_photos_firstvisit_2slot.sql');

runDryrun({
  upPath: UP,
  assertAbsent: [
    columnAbsent('treatment_photos', 'foot_side'),
    regclassAbsent('public.uq_treatment_photos_checkin_source_side'),
  ],
  passNote: '(treatment_photos.foot_side 컬럼 + source CHECK 확장 + partial unique index 무영속 검증)',
}).catch((e) => { console.error(e); process.exit(1); });
