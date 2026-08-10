/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot checklists anon 직접정책 봉쇄
 * ticket: T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT
 * lane  : DDL SQL-file migration — content-binding = 적용 SQL 파일(up.sql) raw utf8 sha256.
 *         apply 러너 apply_20260810190000_foot_rls_anon_checklists_seal.mjs 가
 *         assertApplyGateForRunner({migrationSqlFile: SQL_FILE}) 로 동일 sha 대조.
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * 선례   : issue_go_token_porphan_T-20260810.mjs / _foot_grade_enum_T-20260629.mjs (동일 계약)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT';
const SQL_REL = 'supabase/migrations/20260810190000_foot_rls_anon_checklists_seal.sql';
const EXPECTED_SHA = '74476c08aaf6bd1d82e7b08ce78e601e0ee7ea40c4df71053d8e9492ffb61244';

const sqlSrc = readFileSync(new URL('../' + SQL_REL, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sqlSrc, 'utf8').digest('hex');
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
  migration_sha256: sha,          // = up.sql raw utf8 sha256 (content-binding)
  runner_file: 'scripts/apply_20260810190000_foot_rls_anon_checklists_seal.mjs',
  lane: 'ddl-sql-file-migration',
  change_class: 'ADDITIVE (RESTRICTIVE anon-deny x2 read+write · permissive DROP 0 · 데이터 0 · rollback=DROP x2 · reversible)',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'MSG-20260810-091617-dnlg (DA-20260810-foot-RLS-ANON-LEGITPATH · SSOT da_decision_foot_rls_anon_legitpath_wb_checklists_20260810.md · verdict=checklists 봉쇄 GO 조건부 ADDITIVE · waiting_board NO-GO action0). ' +
    'SECDEF fn_complete_prescreen_checklist(owner=postgres·prosecdef=true·relforcerowsecurity=false) ↔ 직접 anon 정책 수학적 독립 CONFIRMED.',
  ceo_gate: 'N/A — ADDITIVE(신규 정책 2·DROP0·데이터0·reversible) · exposure-reducing PHI-leak 봉쇄 → 대표 파괴게이트 면제(autonomy §3.1). DDL 존재 → supervisor DDL-diff+GO-token REQUIRED(본 토큰).',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor). deploy-precheck: C0 fresh(no prior NO-GO) · C2 db_only exempt VALID(deploy commit 4b720ded = migrations/scripts/db-gate only, no src/) · ' +
    'C3 RLS: rollback SQL 동봉(DROP restrictive x2) + RLS-on+정책8(policy0 아님) + write-path 검증(apply 러너 behavioral probe anon INSERT BLOCKED, SELECT-갈음 아님) · ' +
    'C4 contract: checklists RLS만·customers/staff/reservations/clinics 계약표면 무접촉 · C5/C1.5 N/A(db_only·FE build 무) · ' +
    'C10/C19/C23 N/A(SECDEF fn 생성·재정의·grant 무 — PREFLIGHT read-only 참조만) · C11 원자성: applied_at 공(apply 미실행)·GO-token 前 prod DDL 선집행0 · ' +
    'C12/C17/C26 N/A(트리거/RPC/뷰 컬럼참조·archive INSERT·ON CONFLICT 무) · C13/C24 N/A(db_only·서빙 FE 번들 무변경·shared-worktree race 는 isolated worktree pin 4b720ded 로 회피) · ' +
    'C14 N/A(db_only·CI FE gate 무관) · C16 deploy-order PASS · C18/C21 CLEAN(GO 직전 signals+ticket fresh re-read — DA HOLD/RETRACT 0) · C27/C28/C29/C30 N/A(EF/staff-identity/웹번들/dist 무) · ' +
    'C20 = 본 GO-token(사후감지 대상). ' +
    'PRE-PROBE 라이브 재현(Management API elevated authctx): restrictive0 / permissive2(anon_checklist_read SELECT true·anon_checklist_write INSERT true) / authed6 / SECDEF prosecdef=t·owner=postgres·anon_exec=t — DA census 정합. ' +
    'FE census 독립 실측: anonClient.from(checklists) read+write=0(TabletChecklistPage=RPC-only fn_prescreen_start/fn_complete_prescreen_checklist+storage) · .from(checklists) 3건 전부 authed supabase client(Dashboard/CustomerChartPage staff). ' +
    'content-binding sha256=74476c08 == 티켓 bundle_hash. 러너 HARD-GATE=GO-token+sig verify(A) ∧ content-binding(C).',
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
    { ticket: TICKET, issued: token.issued_at, expires: token.expires_at, sql_sha256: sha, key_id: token.key_id, nonce: token.nonce, sig_selfverify: ok },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
