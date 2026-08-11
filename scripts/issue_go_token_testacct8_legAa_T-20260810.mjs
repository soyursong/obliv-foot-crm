/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot TESTACCT8 Leg A-(a) 정상삭제 3행
 * ticket : T-20260810-foot-TESTACCT-CLEANUP-8ACCT
 * lane   : SQL-file lane (db_apply_guard.sh · npx supabase db query --linked / mgmt API)
 *          content-binding = migration up.sql 전문 sha256 (apply_gate_lib.migrationSha256 산식).
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (supv-dbgate-2026a)
 * 선례   : issue_go_token_porphan_T-20260810.mjs / _foot_coord_autosync_T-20260808.mjs (동일 계약)
 * 게이트 : DA z676 조건부 GO(정상삭제 lane·CEO 파괴게이트 면제 §3.1) · CEO H6 GO(MSG-20260811-122210-psik) ·
 *          planner '잔여 유일 게이트=supervisor DB-GATE/GO-token' · supervisor DB-GATE PASS(아래).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { migrationSha256, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const TICKET = 'T-20260810-foot-TESTACCT-CLEANUP-8ACCT';
const SQL_FILE = 'supabase/migrations/20260811040000_foot_testacct8_legAa_normaldelete_3row.sql';
const EXPECTED_SHA = '6901c1d4812e29d9fe29bde679fcb870b0e2327f19861c582ab3f6c83c85a3fb';

const sqlSrc = readFileSync(new URL('../' + SQL_FILE, import.meta.url), 'utf8');
const sha = migrationSha256(sqlSrc); // = apply_gate_lib 산식(guard 재계산과 동일)
if (sha !== EXPECTED_SHA) {
  console.error(`❌ content-binding 불일치 — 실측 sha256=${sha} ≠ 지시값 ${EXPECTED_SHA}. 서명 중단.`);
  process.exit(1);
}

const now = new Date();
const exp = new Date(now.getTime() + 90 * 60 * 1000); // TTL 90m (dev-foot apply+POSTCHECK 여유)

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  issued_at: now.toISOString(),
  expires_at: exp.toISOString(),
  prod_ref: FOOT_PROD_REF, // rxlomoozakkjesdqjtvd
  migration_sha256: sha, // = up.sql 전문 sha256 (content-binding)
  migration_version: '20260811040000',
  migration_name: '20260811040000_foot_testacct8_legAa_normaldelete_3row',
  sql_file: SQL_FILE,
  lane: 'sql-file (db_apply_guard.sh)',
  change_class:
    'DESTRUCTIVE DELETE (customers 3 소멸 · closure 80행) + archive-first(무손실 _arch_testacct8_aa_* 17테이블/80행) + DDL(CREATE TABLE _arch_* reversible). reversible=rollback.sql(parents-first INSERT).',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'z676 (MSG-20260811-014106-z676 · DA-20260810-foot-TESTACCT-FORMSUB-RETENTION-PURGE §ADDENDUM#1). ' +
    '정상삭제 3행(F-4691 a0f8c846 / F-4703 02594dfa / F-4468 c074025b) = form_submissions 0행 → retention-guard 무접점 → CEO 파괴게이트 면제(§3.1 정상삭제 lane). ' +
    'HOLD leg 무접촉: A-b Path-B(F-4425/F-4692)·Leg B 2차 flag(F-4427/F-4445) 본 토큰 범위 밖. ' +
    '§2.8 DA HOLD 재확인 CLEAN: 유일 활성 "GO-token 발행 무대상" 은 T-20260810-women-RRN(women_rrn_key_v2 PHI_GATE_HOLD·mig 20260810220000 women repo) 대상 — 본 foot A-a 무관.',
  ceo_gate:
    'CEO H6 GO 수신(MSG-20260811-122210-psik "승인합니다" · escalated_to_ceo=resolved). Path-B(A-b) 파괴게이트 CLEARED. 정상삭제 A-a 는 §3.1 carve(form_submissions 0)로 애초 CEO 면제이나 총괄 김주연 "완전정리" erase-의도 confirm(ts 1786403792.800929)로 상위 커버.',
  precheck:
    'supervisor DB-GATE PASS(2026-08-11). ' +
    'DDL-diff: archive-first SELECT*(전컬럼 fidelity·17테이블 FK closure 80행) + in-txn freeze guard(customers=3 exact·form_submissions=0 else ABORT→Path-B·KEEP/real-customer id 배제) + children-first FK-safe DELETE(freeze-set=_arch_* 바인딩) + COMMIT + rollback 완전가역 + 멱등(IF NOT EXISTS · DELETE WHERE IN archive). ' +
    'Migration Dry-Run No-Persistence 독립 재현 PASS(supervisor, 판정 시각): txn-control strip[BEGIN;/COMMIT;] · plpgsql exception-rollback · harness response [](in-txn guard 통과=freeze-set 정확) · post-probe 17 _arch_aa_* 전건 absent + customers 3행 잔존 = 무영속. ' +
    'C11/C12 ledger: version 20260811040000 monotonic(legB 020000 후행·미기록) · 참조 테이블/컬럼 전건 prod 실재. ' +
    'C17 archive 완전성: CREATE TABLE AS SELECT * = 전컬럼 스냅샷. ' +
    'C28 N/A(customers 레코드·staff role/active/owner_tag 무접촉). ' +
    'DB-GATE rows-affected: freeze-set 3 customers exact(in-txn guard + POSTCHECK 80 삭제/3 소멸/80 보존).',
};

const jsonPath = new URL(`../db-gate/${TICKET}_GO.token.json`, import.meta.url);
writeFileSync(jsonPath, JSON.stringify(token, null, 1) + '\n');

const priv = crypto.createPrivateKey(
  readFileSync(path.join(os.homedir(), '.config', 'medibuilder-secrets', 'supervisor-dbgate-go-ed25519.pem')),
);
const sig = crypto.sign(null, readFileSync(jsonPath), priv);
writeFileSync(new URL(`../db-gate/${TICKET}_GO.token.sig`, import.meta.url), sig.toString('base64') + '\n');

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
