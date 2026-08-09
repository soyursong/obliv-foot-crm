/**
 * apply_20260806194000_194100_194200_foot_grade_enum_insert_validate.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE
 * 게이트: supervisor DB-GATE GO (apply 인가 — MSG-20260810 precheck GO 전 게이트 PASS)
 *   FE 선착지 완료(d4c3c9f2, CF live 확인 = C16 FE-first 충족 → 라이브 'manual' write 중단).
 *   content-binding(combined) = 3파일 concat(구분자 없음, apply_order 194000∥194100∥194200)
 *     = ad0832e3d93b603c52f8cccd79252b95e5ffa8159537f5f3d87b3398bd7155b6
 *     (per-file: 194000=5d9ccf57…5535 · 194100=74a67129…0b2e · 194200=f76f2a16…81c0).
 *
 * 3-마이그 원자 배포 (apply 순서 = 토큰 apply_order 194000→194100→194200):
 *   ① 194000 AC-0 자격등급 값-집합에 near_poor·veteran 추가 (CHECK + SECDEF allowlist)
 *   ② 194100 AC-1/AC-2 service_charges INSERT-path 검증/정규화 가드 트리거
 *      ★ C16: FE(DocumentPrintPanel grade='manual' 제거) 선착지 완료 → 194100 트리거 apply 안전.
 *   ③ 194200 AC-4 legacy 'manual' 등급 스냅샷 정규화 backfill (freeze셋 + manual→unverified)
 *   (194000/194200 순서무관; 194100 만 FE 선착지 의존.)
 *
 * 계약(apply_20260805171000_171100_171200 선례 승계):
 *   · content-binding = 3파일 concat(구분자 없음, apply_order) sha256 == 토큰 migration_sha256.
 *     단일 chokepoint(assertApplyGateForRunner) 통과 후에만 COMMIT.
 *   · 각 파일은 applyMigration() 경유 → DDL/DML 적용 + schema_migrations 원장 row 기록(3 row).
 *   · evidenceLog 에 C20 사후감지 evidence append.
 *
 * 실행:
 *   node scripts/apply_20260806194000_194100_194200_foot_grade_enum_insert_validate.mjs --dry
 *   node scripts/apply_20260806194000_194100_194200_foot_grade_enum_insert_validate.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const TICKET_ID = 'T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE';
const REF = FOOT_PROD_REF;
const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dirname, '../db-gate/_apply_evidence/runner_apply.log.jsonl');

// apply 순서 = 토큰 apply_order (194000 → 194100 → 194200)
const STEPS = [
  { version: '20260806194000', file: '20260806194000_foot_grade_valueset_add_near_poor_veteran.sql', tag: 'AC-0 값-집합 near_poor·veteran 추가' },
  { version: '20260806194100', file: '20260806194100_foot_service_charges_grade_rate_insert_guard.sql', tag: 'AC-1/AC-2 INSERT-path 가드 트리거' },
  { version: '20260806194200', file: '20260806194200_foot_service_charges_manual_grade_backfill.sql', tag: 'AC-4 legacy manual 등급 정규화 backfill' },
];

// content-binding: 3파일 concat(구분자 없음) — 토큰 migration_sha256 산식과 동일
const combinedSql = STEPS.map((s) => readFileSync(join(MIG_DIR, s.file), 'utf8')).join('');

if (!APPLY) {
  console.log(`(DRY) ${TICKET_ID} — 3-마이그 배포 계획:`);
  STEPS.forEach((s, i) => console.log(`   ${i + 1}) ${s.version} ${s.tag}  (${s.file})`));
  console.log(`   content-binding(combined concat no-sep) sha256 = ad0832e3…55b6 (토큰 대조 대상)`);
  console.log('   → supervisor DB-GATE GO-token 게이트 통과 후 --apply.');
  process.exit(0);
}

// ── APPLY 게이트 chokepoint (A∧C content-binding; combined SQL) ────────────────
try {
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID,
    targetRef: REF,
    applyRequested: APPLY,
    migrationSql: combinedSql,
    evidenceLog: EVIDENCE_LOG,
  });
  console.log(`✔ DB-GATE GO 통과 — go_issued_at=${gate.gate.issuedAt} sql_sha256=${gate.gate.migrationSha256}`);
} catch (e) {
  console.error(`❌ APPLY-GATE 거부 [${e.code}]: ${e.message}\n   → COMMIT 미도달(abort).`);
  process.exit(1);
}

// ── APPLY (게이트 통과 후에만 도달) — 순서 보존, 각 단계 원장 기록 ────────────────
console.log('\nAPPLY (순서 194000→194100→194200) ...');
for (const s of STEPS) {
  process.stdout.write(`   apply ${s.version} ${s.tag} ... `);
  const r = await applyMigration({
    version: s.version,
    file: s.file,
    dryRun: false,
    createdBy: TICKET_ID,
  });
  console.log(`✅ (ledger recorded: ${r.applied})`);
}
console.log('\n✅ 3-마이그 적용 완료 + schema_migrations 3 row 기록.');
