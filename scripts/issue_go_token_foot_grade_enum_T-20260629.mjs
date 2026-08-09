/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot grade-enum 3-마이그 apply lane
 * ticket: T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE
 * 서명: ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 *       sig = sign(null, token.json raw bytes) → base64 (.sig)
 * 검증쌍: db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (apply_gate_lib 계약)
 * content-binding = 3파일 concat(구분자 없음, apply_order 194000∥194100∥194200) sha256
 *   = ad0832e3d93b603c52f8cccd79252b95e5ffa8159537f5f3d87b3398bd7155b6
 *   (러너 apply_20260806194000_194100_194200_… 의 migrationSql=combinedSql 산식과 동일)
 * 선례: issue_go_token_body_542_inflow_T-20260801.mjs (동일 계약)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE';
const EXPECTED_SHA = 'ad0832e3d93b603c52f8cccd79252b95e5ffa8159537f5f3d87b3398bd7155b6';

// apply_order = 194000 → 194100 → 194200 (러너 STEPS 와 동일 순서)
const FILES = [
  'supabase/migrations/20260806194000_foot_grade_valueset_add_near_poor_veteran.sql',
  'supabase/migrations/20260806194100_foot_service_charges_grade_rate_insert_guard.sql',
  'supabase/migrations/20260806194200_foot_service_charges_manual_grade_backfill.sql',
];

// content-binding: 3파일 concat(구분자 없음) — 러너 combinedSql 및 토큰 migration_sha256 산식 동일
const combinedSql = FILES.map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('');
const sha = crypto.createHash('sha256').update(combinedSql, 'utf8').digest('hex');

if (sha !== EXPECTED_SHA) {
  console.error(`❌ content-binding 불일치 — 실측 sha256=${sha} ≠ 사전합의 ${EXPECTED_SHA}. 서명 중단.`);
  process.exit(1);
}

const now = new Date();
const exp = new Date(now.getTime() + 45 * 60 * 1000); // TTL 45m

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  issued_at: now.toISOString(),
  expires_at: exp.toISOString(),
  prod_ref: 'rxlomoozakkjesdqjtvd',
  migration_sha256: sha,
  migration_files: FILES,
  apply_order: ['20260806194000', '20260806194100', '20260806194200'],
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'DA-20260806-foot-GRADE-ENUM-2-2-2-FINALIZE (CONSULT-REPLY MSG-20260806-193530-najs, CONDITIONAL FINALIZE) — canonical CORE 5 확정, ADDITIVE(enum 9→11 + insert-guard trigger + manual backfill). gate.da_consult=resolved.',
  ceo_gate:
    'N/A — 전량 ADDITIVE(enum_valueset_add + insert_guard_trigger + data_correction_backfill; DROP·타입변경 0) + DA GO = 대표 게이트 면제(autonomy §3.1).',
  precheck:
    'deploy-precheck GO(2026-08-10 00:10, 신규 sha d4c3c9f2). C0 fresh/C1(2 std env)/C2 spec 실재(post-apply green)/C3 rollback×3 대칭/C4 DA-resolved ADDITIVE/C5 build OK/C10 PREFLIGHT PASS(judgment-time 재현: prod update_insurance_grade md5=06bb9201, prosrc vs 194000 diff=allowlist 2값 near_poor·veteran 뿐, executable drift 0, superset)/C12 참조 6컬럼 prod 실재/C13 ancestry superset(651c8892⊆d4c3c9f2)/C14 CI green(run 31319612132)/C16 FE-first 충족(CF live d4c3c9f2)/C17·C26 archive PK arbiter PASS/C23 SECDEF staff-facing REVOKE PUBLIC+GRANT authenticated·anon 부재/C24 sha-pin. C18·C21 GO-token 서명 직전 fresh 재확인 CLEAN(signals+MQ DA HOLD/RETRACT 0).',
};

const jsonPath = new URL(`../db-gate/${TICKET}_GO.token.json`, import.meta.url);
writeFileSync(jsonPath, JSON.stringify(token, null, 1) + '\n');

const priv = crypto.createPrivateKey(
  readFileSync(path.join(os.homedir(), '.config', 'medibuilder-secrets', 'supervisor-dbgate-go-ed25519.pem')),
);
const sig = crypto.sign(null, readFileSync(jsonPath), priv);
writeFileSync(new URL(`../db-gate/${TICKET}_GO.token.sig`, import.meta.url), sig.toString('base64'));

// self-verify with committed pubkey (guard 가 신뢰하는 그 pubkey)
const pub = crypto.createPublicKey(
  readFileSync(new URL('../db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem', import.meta.url)),
);
const ok = crypto.verify(null, readFileSync(jsonPath), pub, sig);
console.log(
  JSON.stringify(
    { ticket: TICKET, issued: token.issued_at, expires: token.expires_at, migration_sha256: sha, key_id: token.key_id, nonce: token.nonce, sig_selfverify: ok },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
