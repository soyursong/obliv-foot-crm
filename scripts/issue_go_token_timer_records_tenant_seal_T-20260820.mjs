/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot timer_records cross-clinic tenant 격리 봉인
 * ticket: T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL (leg2 잔여 ①)
 * lane  : SQL-file 마이그 (CREATE POLICY x1 = ADDITIVE RESTRICTIVE tenant-isolation DDL · text-side cast)
 *         content-binding = migration up.sql 전문 sha256 (db_apply_guard migrationSha256 산식 == sha256(utf8 sql)).
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * ⚠ 이 스크립트는 GO-token(.json+.sig) 파일만 쓴다(prod 무접촉). apply 는 db_apply_guard.sh 에서 GO-token 검증 후.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL';
const SQL_REL = 'supabase/migrations/20260820120000_foot_timer_records_tenant_seal.sql';
const ROLLBACK_REL = 'supabase/migrations/20260820120000_foot_timer_records_tenant_seal.rollback.sql';
const EXPECTED_SHA = 'ebf9848867c192031c01c81e49186e79f5f5a66defbd069ebb1b374801ffd726';

const sql = readFileSync(new URL('../' + SQL_REL, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
if (sha !== EXPECTED_SHA) {
  console.error(`❌ content-binding 불일치 — 실측 sha256=${sha} ≠ 사전합의 ${EXPECTED_SHA}. 서명 중단.`);
  process.exit(1);
}
const rollbackSha = crypto
  .createHash('sha256')
  .update(readFileSync(new URL('../' + ROLLBACK_REL, import.meta.url), 'utf8'), 'utf8')
  .digest('hex');

const now = new Date();
const exp = new Date(now.getTime() + 60 * 60 * 1000); // TTL 60m (parent 동형)

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  ttl_sec: 3600,
  prod_ref: 'rxlomoozakkjesdqjtvd',
  migration_sha256: sha, // = up.sql 전문 sha256 (content-binding)
  rollback_sha256: rollbackSha,
  migration_version: '20260820120000',
  migration_name: 'foot_timer_records_tenant_seal',
  migration_files: [SQL_REL, ROLLBACK_REL],
  evidence_commit: '754d2845',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  lane: 'migration-sql-file',
  change_class:
    'ADDITIVE RESTRICTIVE tenant-isolation DDL (CREATE POLICY x1 timer_records_tenant_isolation · text-side cast · permissive 3종 DROP 0 · 데이터 mutation 0 · 신규 컬럼/타입/enum/테이블 0 · 완전가역 DROP 1줄)',
  da_consult_reply:
    'DA CONSULT-REPLY MSG-20260820-003137-sma7 (① timer_records = text-side cast-predicate CANONICAL: clinic_id = current_user_clinic_id()::text OR is_admin_or_manager(). uuid-side ::uuid REJECT(22P02) · (b) TEXT→uuid ALTER TYPE REJECT(691행 populated 비가역). ② waiting_board = authenticated-seal NO-OP CONFIRM(anon-intended-open 재분류·본 마이그 미대상). SSOT da_decision_foot_rls_newtables_residual_timer_waiting_20260820.md + 부모 doc ADDENDUM #1). AC-1 apply-gate=supervisor. change-class=exposure-REDUCING ADDITIVE.',
  ceo_gate:
    'N/A — exposure-REDUCING ADDITIVE(CREATE RESTRICTIVE POLICY x1 only · permissive DROP 0 · 데이터 mutation 0 · 신규 컬럼/타입/enum/테이블 0 · 완전가역 DROP 1줄) + DA Gate-B GO → 대표 파괴게이트 §3.1 면제(autonomy). 자매 부모 T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(applied 2026-08-20 00:36) coherence-extension 동형 선례.',
  precheck:
    'supervisor MIG-GATE/DDL-diff GO (2026-08-20). ' +
    '[DDL-diff] 실 SQL 대조: CREATE POLICY "timer_records_tenant_isolation" ON public.timer_records AS RESTRICTIVE FOR ALL TO authenticated USING(clinic_id = current_user_clinic_id()::text OR is_admin_or_manager()) WITH CHECK(동일) + COMMENT x1. DROP 0 · ALTER 0 · 데이터 0 · 신규 컬럼/타입/enum/테이블 0 = 순수 additive restrictive. ' +
    '[predicate] text-side cast(current_user_clinic_id()::text) — H2 회피(uuid-side ::uuid=22P02 raise 금지). admin bypass=is_admin_or_manager()(foot 캐노니컬·crm get_user_role 미사용). ' +
    '[grain] FOR ALL(USING+WITH CHECK 둘 다) — census write WIDE-OPEN(permissive INSERT/UPDATE(true)) 정합. ' +
    '[dispositive census] dev-foot READ-ONLY(prod rxlomoozakkjesdqjtvd·WRITE0/DDL0): timer_records total 691 · clinic_id NULL 0 · empty 0 · distinct 1 = 74967aea-…-930bc8(valid-uuid)=jongno clinic_id(text) · 691/691 jongno resolve → text-side cast 가 jongno 691행 전건 TRUE = clean seal·lockout 0 = (i) GO. (H1 (ii)slug-lockout / (iii)NULL/garbage 실측 배제.) ' +
    '[PREFLIGHT 가드 실증(up.sql 내장)] 대상 실재 + RLS ENABLE 전제 + NULL/empty clinic_id=0(census (iii) apply-시점 drift abort) + clinics 로 resolve 안 되는 행=0(census (ii) slug/label 혼입 lockout abort) + helper 2종(current_user_clinic_id/is_admin_or_manager) 실재 + restrictive 기존재 시 재적용 abort(멱등). ' +
    '[VERIFY 블록(up.sql 내장)] restrictive=1(RESTRICTIVE·roles={authenticated}·cmd=ALL 정확) + USING/WITH CHECK 둘 다 canonical 술어(한쪽 NULL=silent leak abort) + text-side ::text 존재·uuid-side clinic_id::uuid 부재 확인 + ADDITIVE 불변식(permissive >=3 존치). ' +
    '[effective-authz] RESTRICTIVE TO authenticated 만 → SELECT/INSERT/UPDATE = permissive(true) AND restrictive(own-clinic OR admin) → 타 clinic 0-row/write-block · own-clinic(jongno 691) 지속. anon=TO authenticated 미포함→무영향 · service_role=BYPASSRLS→무영향 · SECURITY DEFINER(owner=postgres)=definer 컨텍스트→무영향. = cross-clinic 도달 축소만(비-authenticated principal superset 보존). ' +
    '[dryrun] No-Persistence PASS(canonical dryrun_lib.mjs·migration_dryrun_no_persistence_standard v1.0: txn-control strip + plpgsql exception-handler 무영속 + post-probe 신규 restrictive 부재 실측). ' +
    '[deploy-precheck matrix] C0 fresh(no prior NO-GO) · C3 rollback 대칭 동봉(DROP POLICY IF EXISTS·before-image 완전복귀·permissive 무접촉) · C4 policy-only no contract touch(foot-local RLS) · C11 prod-realness=PREFLIGHT 실재 assert + DDL 원자 단일 마이그 · C13 754d2845==HEAD(db_only·apply=dev) · C16 deploy-order PASS · C18/§2.8+C18-2 holdcheck DA HOLD/BINDING CLEAR(signals+MQ) · C20 apply_before_go 부재(applied_at 공란) · C21 RETRACT CLEAR(frontmatter fresh-read status=deploy-ready·block_reason 공란·deploy_hold 부재) · C24 sha-pin(deploy_commit 754d2845==HEAD) · C36 anon-grant lint PASS(FAIL0/WARN0) · C38 version-collision PASS(slot 20260820120000 free·no collision) · C39 apply-직전 PRE-state = up.sql PREFLIGHT census-drift 재확인 내장. ' +
    'C1/C5 N/A(FE touch 0·db_only) · C10/C19/C23 N/A(CREATE FUNCTION 0·no OR REPLACE) · C14 N/A(db_only) · C26 N/A(ON CONFLICT 0) · C29/C30/C35 N/A(web bundle 0·domain=foot). ' +
    'apply-후 POSTCHECK(dev-foot 첨부): jongno 691행 lockout 0 · 타 clinic seal 실효(0-row+write-block) · admin cross 보존 · permissive 3종 존치(ADDITIVE) · 회귀 0.',
  issued_at_epoch: now.getTime() / 1000,
  issued_at: now.toISOString(),
  expires_at_epoch: exp.getTime() / 1000,
  expires_at: exp.toISOString(),
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
      rollback_sha256: rollbackSha,
      key_id: token.key_id,
      nonce: token.nonce,
      sig_selfverify: ok,
    },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
