/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot anon-도달 permissive READ 봉쇄
 * ticket: T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL
 * lane  : SQL-file 마이그 (CREATE POLICY x2 = ADDITIVE RESTRICTIVE anon-deny DDL)
 *         content-binding = migration up.sql 전문 sha256 (apply_gate_lib.migrationSha256 산식과 동일).
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * 게이트 : DA INFO(MSG-20260810-072908-tkv8, anon-도달=미인증 누수→즉시 봉쇄) · planner approved(07:48) ·
 *          RE-SCOPE SUBSET 2/4(planner 08:20, services+package_tiers) · supervisor DB-GATE PASS(2026-08-10).
 * ⚠ 이 스크립트는 GO-token(.json+.sig) 파일만 쓴다(prod 무접촉). apply 는 별도 러너에서 GO-token 검증 후.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL';
const SQL_REL = 'supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.sql';
const EXPECTED_SHA = '8f1f037599fd90b3efe0e55c7d1f249d32d33b26e760bb21858ae30d8fed51a5';

// content-binding = 적용될 SQL 파일 전문 sha256 (apply_gate_lib.migrationSha256 == sha256(utf8 sql))
const sql = readFileSync(new URL('../' + SQL_REL, import.meta.url), 'utf8');
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
  migration_sha256: sha, // = up.sql 전문 sha256 (content-binding)
  migration_file: SQL_REL,
  lane: 'migration-sql-file',
  change_class:
    'ADDITIVE RESTRICTIVE anon-deny DDL (CREATE POLICY x2 · permissive DROP 0 · 데이터 write 0 · 컬럼/타입/enum/테이블 0 · reversible=DROP 1줄/테이블)',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'DA INFO MSG-20260810-072908-tkv8 (umbrella T-20260723-xcrm-RLS-PERMISSIVE-FORKINHERIT-SWEEP Stage-3 fan-out · anon-도달 노출=격리의도 무관 미인증 누수→confirm 불요 즉시 봉쇄). ' +
    'RE-SCOPE SUBSET 2/4(planner 08:20): services+package_tiers 확정(정당 anon 소비자 0). ' +
    'HOLD 2건(waiting_board·checklists)=별도 티켓 T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT(DA CONSULT MSG-20260810-082014-cmbw) — 본 GO 범위 아님.',
  ceo_gate:
    'N/A — §3.1 CEO 파괴게이트 면제(ADDITIVE: CREATE POLICY only · permissive DROP 0 · 데이터 파괴 0 · cross-product 계약 변경 0). ⚠ DDL 존재(CREATE POLICY) → DDL-0 carve 아님 → 본 GO-token 물리 선행이 apply 전제.',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor). ' +
    'DDL-diff 재확인(§2, 실 SQL 대조): CREATE POLICY services_anon_deny / package_tiers_anon_deny — AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false) + COMMENT x2. DROP 0·ALTER 0·데이터 0·신규 컬럼/타입/enum/테이블 0 = 순수 additive restrictive. ' +
    'PREFLIGHT 가드 실증(up.sql 내장): 대상 2테이블 실재 + RLS ENABLE 전제 + before-image permissive(anon_service_read·anon_read_package_tiers) 존치 확인(census drift abort) + restrictive 기존재 시 재적용 abort(멱등). VERIFY 블록: restrictive anon-deny=2(PERMISSIVE 아님·roles={anon} 정확) + permissive 존치 2(ADDITIVE 불변식·DROP 0). ' +
    'effective-authz superset: RESTRICTIVE TO anon 만 → anon SELECT=permissive(true) AND restrictive(false)=false 차단. authenticated=TO anon 미포함→무영향(기존 authed read 정책 존치)·service_role=BYPASSRLS→무영향·SECURITY DEFINER 함수(fn_complete_prescreen_checklist)=definer 컨텍스트→무영향·waiting_board anon read=별 테이블 무접촉. = anon 접근 축소만(비-anon principal 전건 superset 보존). ' +
    '제거되는 anon 접근=정당 소비자 0(재-census 실측: services 전 public route 미read=/admin authed only / package_tiers src 참조 0=dead grant). 봉쇄 SUBSET 2/4 확정, waiting_board(read)·checklists(SECDEF write)=HOLD 분리로 파괴 회피. ' +
    'No-Persistence dry-run PASS(dev, canonical dryrun_lib.mjs=migration_dryrun_no_persistence_standard v1.0: txn-control strip + plpgsql exception-handler 무영속 실행 + post-probe 신규 restrictive 부재 실측). PRE-PROBE: restrictive anon-deny=0·permissive anon-read=2(before-image 일치). ' +
    'deploy-precheck matrix(active): C0 fresh(status in_progress·no prior NO-GO)·C2 db_only exempt VALID(artifact_class=db_only·no src/ diff·e2e_exempt=db_only)·C3 rollback 대칭 동봉(DROP POLICY IF EXISTS x2·before-image 완전복귀)·C4 policy-only no contract touch(foot-local RLS)·C11 prod-realness=PREFLIGHT 실재 assert+DDL 원자 단일 마이그·C13 dc8af409=HEAD(db_only·apply=dev)·C18/§2.8 DA HOLD/RETRACT CLEAR(signals+MQ+fresh frontmatter, HOLD 2건은 별티켓 분리)·C20 apply_before_go 준수(applied_at 공백·prod DDL 미집행)·C21 RETRACT CLEAR(frontmatter 재읽기 block_reason 부재)·C24 sha-pin(commit_sha=dc8af409==HEAD). C5/C1 N/A(FE touch 0)·C10/C19/C23 N/A(CREATE FUNCTION 0·no OR REPLACE)·C14 N/A(db_only)·C25/C26/C27/C28/C29 N/A. ' +
    'apply-후 POSTCHECK(anon-key REST 실효 실측·scripts/T-20260810-...postcheck.mjs)로 봉쇄 실증 + authed/SECDEF/waiting_board 무영향 재확인 = dev 첨부.',
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
    {
      ticket: TICKET,
      issued: token.issued_at,
      expires: token.expires_at,
      migration_sha256: sha,
      key_id: token.key_id,
      nonce: token.nonce,
      sig_selfverify: ok,
    },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
