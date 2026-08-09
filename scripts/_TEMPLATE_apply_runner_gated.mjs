/**
 * _TEMPLATE_apply_runner_gated.mjs — per-migration / ad-hoc prod-apply 러너 정본 템플릿 (foot)
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (foot leg · requirement 2)
 *
 * ⚠ 신규 티켓-전용 apply 러너는 이 파일을 카피 소스로 삼는다.
 *   (ungated legacy 러너를 카피 소스로 쓰지 말 것 — assertApplyGateForRunner 미배선
 *    러너가 복제되면 `--apply` 단독 honor-system prod write 통로가 재생산된다.)
 *
 * 계약(반드시 지킬 것):
 *   1) prod ref 는 apply_gate_lib 의 FOOT_PROD_REF 를 신뢰원으로 pin.
 *   2) APPLY 분기(실제 applyMigration/COMMIT/CREATE OR REPLACE/INSERT/UPDATE) **직전** 에
 *      assertApplyGateForRunner() 를 호출한다 — throw → try/catch → exit1 → COMMIT 미도달.
 *   3) migrationSql/migrationSqlFile 은 "실제로 커밋될 SQL 문 전문/파일" 을 바인딩한다
 *      (content-binding). foot 는 대부분 supabase/migrations/<file>.sql 을 migrationSqlFile 로 바인딩.
 *   4) evidenceLog 경로를 넘겨 C20 사후감지 evidence 를 남긴다.
 *
 * 실행:
 *   node scripts/apply_<ts>_foot_<slug>.mjs           # PRE-PROBE / 검증만(무영속)
 *   node scripts/apply_<ts>_foot_<slug>.mjs --apply   # supervisor GO-token 게이트 통과 후 apply
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';

// ── 0) 필수 상수 (티켓별 교체) ────────────────────────────────────────────────
const TICKET_ID = 'T-YYYYMMDD-foot-<SLUG>';   // ★ 이 러너가 집행하는 티켓 (GO-token 발행 대상과 동일해야 함)
const REF       = FOOT_PROD_REF;              // prod ref = env matrix pin(신뢰원). foot dev DB 미생성 → 항상 prod.
const VERSION   = 'YYYYMMDDHHMMSS';           // ★ 14자리 마이그 버전
const FILE      = 'YYYYMMDDHHMMSS_foot_<slug>.sql'; // ★ supabase/migrations 하위 forward .sql
const APPLY     = process.argv.includes('--apply');

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dirname, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);         // content-binding 대상(= applyMigration 이 읽는 파일과 동일)

// ── 1) dry-run / PRE-PROBE (불변식·pre-image 재대조 등 — 티켓별 작성) ──────────
//   여기서 무영속 read-only probe 로 적용 전 상태를 확정한다.

if (!APPLY) {
  console.log('(DRY) --apply 미지정 → PRE-PROBE 만 수행. supervisor GO-token 게이트 통과 후 --apply.');
  process.exit(0);
}

// ── 2) ★ APPLY 게이트 chokepoint — 이 블록을 삭제/우회하지 말 것 ─────────────────
//   prod + --apply → supervisor ed25519 GO-token(A∧C content-binding) 검증.
//   부재/무효/불일치/만료 → throw → try/catch → exit1 → 아래 applyMigration 미도달.
try {
  assertApplyGateForRunner({
    ticketId: TICKET_ID,
    targetRef: REF,
    applyRequested: APPLY,
    migrationSqlFile: SQL_FILE,   // 실제 COMMIT 될 SQL 파일 전문 content-binding
    evidenceLog: EVIDENCE_LOG,
  });
} catch (e) {
  console.error(`❌ APPLY-GATE 거부 [${e.code}]: ${e.message}\n   → GO-token 부재/무효. COMMIT 미도달(abort).`);
  process.exit(1);
}

// ── 3) APPLY (게이트 통과 후에만 도달) ─────────────────────────────────────────
console.log('\nAPPLY ...');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: `dev-foot:${TICKET_ID}` });
console.log('✅ 적용 완료:', JSON.stringify(res));
