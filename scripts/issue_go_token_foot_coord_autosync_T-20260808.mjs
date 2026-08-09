/**
 * DB-GATE GO-token 재발급 (supervisor 전용) — foot coord auto-registrar-sync apply lane
 * ticket: T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC
 * 사유: 1차 GO-token(issued 2026-08-09T12:57:11Z → expired 13:42:11Z, 45분 창 미사용) 만료.
 *       applied_at='' + evidence 부재 → prod apply 미실행 확정(apply_before_go 준수).
 *       재-QA 아님 — 순수 apply-window 재발급 (planner FOLLOWUP MSG-20260810-000419-bc0x).
 * 서명: ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍: db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (apply_gate_lib 계약)
 * content-binding = 단일 up.sql raw bytes sha256 (러너 migrationSql 산식과 동일)
 *   = 46fc549a15e937f8c0b7eec79e8415221a93f4bc8cb015dde7e97eb7e0d83418
 * 선례: issue_go_token_foot_grade_enum_T-20260629.mjs (동일 계약)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC';
const FILE = 'supabase/migrations/20260809130000_foot_coord_auto_registrar_sync.sql';
const EXPECTED_SHA = '46fc549a15e937f8c0b7eec79e8415221a93f4bc8cb015dde7e97eb7e0d83418';

const sql = readFileSync(new URL('../' + FILE, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
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
  migration_file: FILE,
  change_class: 'ADDITIVE',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'MSG-20260809-101347-88ke (verdict=GO 조건부·verify-gated·ADDITIVE·§3.1 대표게이트 면제). VG census PASS(VG1=NO §416 방화벽/VG2=PASS/VG-Q4=coordinator lowercase/FK=staff.id).',
  ceo_gate:
    'N/A — 전량 ADDITIVE(nullable staff_id FK + partial UNIQUE + SECDEF role-gated trigger; DROP·타입변경·기존행 mutation 0) + DA GO = 대표 게이트 면제(autonomy §3.1).',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor 재발급). DDL-diff=ADDITIVE(staff_id UUID FK→staff.id ON DELETE SET NULL nullable / partial UNIQUE(staff_id,group_name) WHERE staff_id IS NOT NULL / CREATE OR REPLACE fn SECDEF role=coordinator gate + REVOKE PUBLIC·anon / AFTER INSERT trigger). ' +
    'C11/C12 PREFLIGHT PASS: 트리거 참조 5컬럼(clinic_id/group_name/name/active/created_by) prod 실재 + no-default NOT NULL(clinic_id/group_name/name) 전부 트리거가 명시 제공, sort_order DEFAULT 0·created_at/updated_at DEFAULT now()·id DEFAULT gen_random_uuid() → NOT NULL 위반 0. staff 참조 5컬럼(id/role/active/name/clinic_id) 실재(active nullable→COALESCE 가드). ' +
    'C26 arbiter PASS: ON CONFLICT (staff_id,group_name) WHERE staff_id IS NOT NULL 술어 = partial index 술어 정확 일치, idx 동일 마이그 §2 선-생성(트리거 발화 시점 실재). ' +
    'mig_ledger_check PASS: 20260809130000 schema_migrations 부재·drift 0, col/idx/fn/trg prod count=0(미적용 확정·apply_before_go 준수). ' +
    'MIG-GATE No-Persistence dry-run PASS: txn-control(BEGIN;/COMMIT;) strip 기록 + plpgsql exception-rollback 무영속 + post-probe(staff_id/idx/fn/trg) 전부 absent + 실 마이그 에러 re-raise 미발생(sentinel 도달=DDL 무결 실행). ' +
    'C24 sha-pin: migration_sha256=46fc549a…83418 = commit ab936e48(마이그 추가 커밋·HEAD b1a945c3의 조상, 파일 byte-identical) + planner 3자 대조 일치. ' +
    'C18/C21 fresh 재확인 CLEAN: signals+supervisor MQ 대상 DA HOLD/RETRACT/bounce 0(DA=GO). C28 N/A(기존 staff role/active/owner mutation 0·directory-population only). artifact_class=db_only(build/E2E/browser N/A).',
};

const jsonPath = new URL(`../db-gate/${TICKET}_GO.token.json`, import.meta.url);
writeFileSync(jsonPath, JSON.stringify(token, null, 1) + '\n');

const priv = crypto.createPrivateKey(
  readFileSync(path.join(os.homedir(), '.config', 'medibuilder-secrets', 'supervisor-dbgate-go-ed25519.pem')),
);
const sig = crypto.sign(null, readFileSync(jsonPath), priv);
writeFileSync(new URL(`../db-gate/${TICKET}_GO.token.sig`, import.meta.url), sig.toString('base64'));

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
