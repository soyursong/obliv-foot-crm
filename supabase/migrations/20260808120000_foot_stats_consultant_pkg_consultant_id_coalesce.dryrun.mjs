/**
 * DRY-RUN (No-Persistence): T-20260718-foot-PKG-CONSULTANT-ID-RPC-CUTOVER (Phase 2)
 *   20260808120000_foot_stats_consultant_pkg_consultant_id_coalesce.sql
 *   (CREATE OR REPLACE FUNCTION foot_stats_consultant — pkg_attr COALESCE(fact,heuristic) 본문 스왑)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + post-probe).
 *   up.sql = BEGIN…COMMIT + CREATE OR REPLACE FUNCTION + REVOKE + COMMENT.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── 무영속 post-probe (INV-3) — 본건은 CREATE OR REPLACE(본문 스왑)라 오브젝트는 항상 존재. ──
 *   따라서 "오브젝트 부재"가 아니라 "신규 본문의 고유 마커가 롤백 후 prod 정의에 부재"를 검증한다.
 *   마커 = `p.consultant_id` — 신규 pkg_attr 의 COALESCE(p.consultant_id, ...) 에만 등장.
 *   구(0724 live) 본문의 pkg_attr 는 `ta.consultant_id` 만 참조 → `p.consultant_id` 부재.
 *   dry-run 롤백 후 live 정의에 `p.consultant_id` 가 여전히 부재 = 무영속 확증(신규 본문 미영속).
 *   (probe 는 dryrun_lib 계약대로 ABSENT 시 boolean TRUE 반환.)
 *
 * 실행: (repo root) node supabase/migrations/20260808120000_foot_stats_consultant_pkg_consultant_id_coalesce.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-08
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260808120000_foot_stats_consultant_pkg_consultant_id_coalesce.sql');

await runDryrun({
  upPath: UP,
  assertAbsent: [{
    label: 'foot_stats_consultant body NEW marker `p.consultant_id` (COALESCE fact) — must be ABSENT after rollback',
    sql: `SELECT position('p.consultant_id' IN pg_get_functiondef('public.foot_stats_consultant(uuid,date,date)'::regprocedure)) = 0 AS absent;`,
  }],
  passNote: '(pkg_attr COALESCE 본문 미영속 — 신규 마커 p.consultant_id 부재 확증)',
});
