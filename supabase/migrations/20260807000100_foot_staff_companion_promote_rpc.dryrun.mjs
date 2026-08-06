/**
 * DRY-RUN (No-Persistence): T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX (promote RPC)
 *   20260807000100_foot_staff_companion_promote_rpc.sql
 *   (CREATE FUNCTION fn_staff_companion_promote SECDEF + REVOKE/GRANT — function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   CREATE FUNCTION + GRANT 전부 트랜잭션 DDL. plpgsql body 는 late-bound → companion_of 컬럼(선행 마이그) 미존재라도
 *   함수 생성은 성공(본문 참조는 생성 시 미검증). 무영속 롤백 봉투 검증 가능.
 *
 * 무영속 post-probe(INV-3): dry-run 후 prod 에 함수 fn_staff_companion_promote 부재 실측.
 *   추가: anon EXECUTE 부재(VG5) 가드 — dry-run 롤백 후이므로 함수 자체 부재로 자동 성립(부재 실측이 상위 불변식).
 *
 * 실행: (repo root) node supabase/migrations/20260807000100_foot_staff_companion_promote_rpc.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-06
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, procAbsent } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260807000100_foot_staff_companion_promote_rpc.sql');

runDryrun({
  upPath: UP,
  passNote: 'STAFF-COMPANION-PROMOTE RPC: SECDEF 함수+authenticated-only grant 무영속 적용 후 prod 부재 실증',
  assertAbsent: [
    procAbsent('fn_staff_companion_promote'),
  ],
});
