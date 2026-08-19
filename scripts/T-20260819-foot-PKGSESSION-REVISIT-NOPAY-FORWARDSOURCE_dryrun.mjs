#!/usr/bin/env node
// T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — 무영속 dry-run.
//   up.sql = canonical consumption primitive(consume_one_session) + CIS 단일 writer 헬퍼
//   (fn_mark_cis_for_consumed_session) + body-drift(consume_package_sessions_for_checkin/deduct_session_atomic).
//   무영속 검증: 신규 함수 2종이 dry-run 롤백 후 prod 부재(post-probe absent)여야 PASS.
//   (기존 CREATE OR REPLACE 대상 2종은 이미 존재 → 부재 검사 대상 아님. 롤백으로 원형 복원.)
// write0/DDL0: harness 는 plpgsql exception-handler 서브트랜잭션 강제 롤백 = prod 영속 0.
import { runDryrun, procAbsent } from './dryrun_lib.mjs';

const UP = new URL('../supabase/migrations/20260819170000_foot_pkgsession_canonical_consume_primitive.sql', import.meta.url).pathname;

runDryrun({
  upPath: UP,
  assertAbsent: [
    procAbsent('consume_one_session'),
    procAbsent('fn_mark_cis_for_consumed_session'),
  ],
  passNote: '(신규 primitive/helper 무영속 확인 · body-drift 2종 CREATE OR REPLACE 롤백 복원)',
}).catch((e) => { console.error(e); process.exit(1); });
