/**
 * T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST — DRY-RUN / APPLY
 *
 * publish_koh_result 에 birth_date 서버파생(fn_customer_birthdates 재사용) 주입.
 *   기존 phone/의뢰번호/검체번호 서버파생과 parity. 테이블/컬럼/enum 무변경(ADDITIVE, RPC 본체만).
 *
 * 게이트: PROD write = supervisor 함수-diff 게이트 경유. 기본 dry-run(트랜잭션 ROLLBACK, 미영속).
 *   --apply 는 게이트 통과 후에만. apply 는 공용 ledger helper 경유 → schema_migrations 자동 기록
 *   (원장 정지·drift 재발 차단, Track3 표준).
 *
 * 사용:
 *   node scripts/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST_apply.mjs            # dry-run(재현 로그)
 *   node scripts/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST_apply.mjs --apply     # PROD 적용(게이트 후)
 *   node scripts/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST_apply.mjs --ledger    # 원장 3자 대조만
 *
 * author: dev-foot / 2026-07-06
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, ledgerVersions, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const LEDGER_ONLY = process.argv.includes('--ledger');

const VERSION = '20260706140000';
const FILE = '20260706140000_koh_publish_birth_server_derive.sql';
const migPath = join(MIG_DIR, FILE);

// ── mig_ledger_check: schema_migrations(원장) ↔ 파일 ↔ prod 함수 실재 3자 대조 ──
async function ledgerCheck() {
  console.log('── mig_ledger_check (3자 대조) ──');
  const versions = await ledgerVersions();
  const inLedger = versions.has(VERSION);
  console.log(`  파일 존재      : ${FILE}`);
  console.log(`  원장(schema_migrations) 기록 : ${inLedger ? '있음' : '없음'} (version=${VERSION})`);
  const def = await query(
    `SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='publish_koh_result' LIMIT 1)) AS def;`);
  const prodDef = def?.[0]?.def ?? '';
  const prodHasBirth = /fn_customer_birthdates/.test(prodDef) && /COALESCE\(v_birth_ko/.test(prodDef);
  console.log(`  prod 함수 birth 서버파생 반영 : ${prodHasBirth ? '있음' : '없음'}`);
  return { inLedger, prodHasBirth };
}

async function main() {
  if (LEDGER_ONLY) { await ledgerCheck(); return; }

  const sql = readFileSync(migPath, 'utf8');

  if (!APPLY) {
    // ── DRY-RUN: 파일 그대로 실행하되 COMMIT → ROLLBACK 치환 = 재현 로그(미영속) ──
    console.log(`── DRY-RUN (트랜잭션 ROLLBACK, 미영속)  ${FILE} ──`);
    const dryicalSql = sql.replace(/\bCOMMIT;\s*$/m, 'ROLLBACK;');
    if (dryicalSql === sql) throw new Error('COMMIT → ROLLBACK 치환 실패(파일 끝 COMMIT; 확인)');
    try {
      await query(dryicalSql); // $verify$ DO 블록 포함 → 실패 시 throw
      console.log('✅ DRY-RUN 통과 — 마이그 파싱·$verify$ 검증·CREATE OR REPLACE 성공 후 ROLLBACK(미영속).');
    } catch (e) {
      console.error('❌ DRY-RUN 실패:', e.message);
      process.exit(1);
    }
    // prod 는 여전히 旣 정의(birth 미반영)여야 함 = ROLLBACK 무영속 증명
    const post = await ledgerCheck();
    if (post.prodHasBirth) {
      console.error('❌ DRY-RUN 인데 prod 에 birth 반영됨 — ROLLBACK 미작동 의심');
      process.exit(1);
    }
    console.log('\n✅ DRY-RUN 완료: 미영속 확인(prod 무변경). --apply 는 supervisor 게이트 통과 후.');
    return;
  }

  // ── APPLY: ledger helper 경유(적용 = 원장 기록 단일경로) ──
  console.log(`── APPLY (PROD, ledger 기록)  ${FILE} ──`);
  const res = await applyMigration({
    version: VERSION, file: FILE, dryRun: false,
    createdBy: 'T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST',
  });
  console.log('applyMigration:', res);

  const post = await ledgerCheck();
  if (!post.inLedger || !post.prodHasBirth) {
    console.error('\n❌ APPLY 후 검증 실패(원장 기록 또는 prod 반영 누락)');
    process.exit(1);
  }
  console.log('\n✅ APPLY 완료 — publish_koh_result birth 서버파생 반영 + 원장 기록 확정.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
