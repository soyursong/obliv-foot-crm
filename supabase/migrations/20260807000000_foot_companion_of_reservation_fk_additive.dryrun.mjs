/**
 * DRY-RUN (No-Persistence): T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX (FK ADDITIVE)
 *   20260807000000_foot_companion_of_reservation_fk_additive.sql
 *   (ALTER TABLE reservations ADD COLUMN companion_of_reservation_id uuid FK SET NULL + partial index + COMMENT)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   전부 트랜잭션 DDL(ALTER ADD COLUMN·CREATE INDEX 비-concurrent·COMMENT) → 무영속 롤백 봉투 검증 가능.
 *
 * 무영속 post-probe(INV-3): dry-run 후 prod 에 (a)컬럼 (b)partial index 둘 다 부재 실측.
 *
 * 실행: (repo root) node supabase/migrations/20260807000000_foot_companion_of_reservation_fk_additive.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-06
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, columnAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807000000_foot_companion_of_reservation_fk_additive.sql');

runDryrun({
  upPath: UP,
  passNote: 'COMPANION-OF FK ADDITIVE: 컬럼+partial index 무영속 적용 후 prod 부재 실증',
  assertAbsent: [
    columnAbsent('reservations', 'companion_of_reservation_id'),
    {
      label: 'index public.idx_reservations_companion_of',
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_indexes
              WHERE schemaname='public' AND indexname='idx_reservations_companion_of'
            ) AS absent;`,
    },
  ],
});
