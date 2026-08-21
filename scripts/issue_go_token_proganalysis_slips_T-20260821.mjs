/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot 경과분석 배치 슬립 스키마(Phase-2 §4/§5)
 * ticket: T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE
 * lane  : SQL-file 마이그 (신규 테이블 2 + progress_result_images additive 컬럼 5 + RLS/감사트리거/가드 = ADDITIVE DDL)
 *         content-binding = migration up.sql 전문 sha256 (db_apply_guard migrationSha256 == sha256(utf8 sql)).
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * ⚠ 이 스크립트는 GO-token(.json+.sig) 파일만 쓴다(prod 무접촉). apply 는 db_apply_guard.sh 에서 GO-token 검증 후.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE';
const SQL_REL = 'supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.sql';
const ROLLBACK_REL = 'supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.rollback.sql';
const EXPECTED_SHA = 'fde2affad650fddf3935736c2e63eee0eead6521f7b803b6e58cf5739a048ecb';

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
const exp = new Date(now.getTime() + 60 * 60 * 1000); // TTL 60m (foot 부모 동형)

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  ttl_sec: 3600,
  prod_ref: 'rxlomoozakkjesdqjtvd',
  migration_sha256: sha, // = up.sql 전문 sha256 (content-binding)
  rollback_sha256: rollbackSha,
  migration_version: '20260822010000',
  migration_name: 'foot_progress_analysis_slips_schema',
  migration_files: [SQL_REL, ROLLBACK_REL],
  evidence_commit: 'fbb5be72',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  lane: 'migration-sql-file',
  change_class:
    'ADDITIVE — 신규 테이블 2(progress_analysis_slips + progress_analysis_slips_audit_log) + progress_result_images additive 컬럼 5(slip_id/deleted_at/deleted_by/delete_reason/is_deleted GENERATED ALWAYS) + RLS 정책/감사트리거/hard-DELETE 가드/touch 트리거/인덱스. DROP·타입변경·소급변형 0. 멱등(IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE). 말미 self-verify DO 블록(전 불변식 assert)·BEGIN/COMMIT 원자.',
  da_consult_reply:
    'DA CONSULT-REPLY MSG-20260822-004858-nlnt(1차 스키마) + MSG-20260822-011210-jrwf(2차 soft-delete form confirm). verdict=GO(조건부·ADDITIVE)·후보B 전용테이블 progress_analysis_slips 채택(후보A REJECT·grain충돌/content_hash automatch 오염)·예약 canonical key=slips.reservation_id UNIQUE(plain·resolve 술어 fail-closed)·soft-delete 위치=progress_result_images(slip=state revert≠delete)·삭제술어=reservation_id 등가 ONLY·확정/체크인 구조배제. soft-delete canonical=deleted_at 단일 authority atom + is_deleted GENERATED ALWAYS(mutable bool REJECT·nlnt 문자표기 RETRACT). DRAFT(ee108800→fbb5be72) 선례(form_submissions 20260802150000) 채택=정확·형태변경0. §3.1 대표게이트 면제 확정. SSOT da_decision_foot_proganalysis_slip_schema_extract_link_20260822.md. AC-0: DA GO≠apply.',
  ceo_gate:
    'N/A — ADDITIVE(신규 테이블 2 + additive 컬럼 5 · DROP 0 · 타입변경 0 · 데이터 mutation 0) + DA Gate-B GO(ADDITIVE 확정) → 대표 파괴게이트 §3.1 면제(autonomy). risk_verdict GO_WARN 의 "DA GO+ADDITIVE 시 대표 게이트 불요" 조건 충족.',
  precheck:
    'supervisor DB-GATE GO-token 서명 (2026-08-22). ' +
    '[① DDL-diff] 1차 판정 hw4x PASS 재확인: change-class=ADDITIVE(신규테이블2+images additive5+정책/트리거/인덱스, DROP·타입변경·소급변형 0). DA 4대판정 1:1 정합(후보B / slips.reservation_id UNIQUE plain / state=text+CHECK 3-slug native-enum 금지 / soft-delete=images(slip=state revert) / RESTRICTIVE clinic-gate / audit append-only(UPDATE·DELETE 정책 부재)·SELECT director/admin / hard-DELETE BEFORE 가드). is_deleted=GENERATED ALWAYS AS(deleted_at IS NOT NULL) STORED(form_submissions 선례 미러·mutable bool REJECT·2차 jrwf 확정 형태변경0). 참조객체 repo lineage 전건 실재(FK clinics/customers/reservations · RLS 헬퍼 4종 20260426000000 · ALTER 대상 progress_result_images base 20260718210000). ' +
    '[Option A] anon EXECUTE 미부여 — GRANT ... TO anon 0 · GRANT EXECUTE 0 · 전 RLS 정책 TO authenticated · SECURITY DEFINER 함수 2종(audit·harddelete_guard)=트리거 전용(anon 직접호출 불가). anon write-path/RPC 노출 0. ' +
    '[C24 byte-identity] 실 migration .sql sha256=fde2affa…a048ecb == 티켓 mig_files 명시 sha ✓ · rollback sha256=1f7274b1…2032496 == 명시 sha ✓. evidence commit fbb5be72 = 1차 판정 대상 ee108800 의 descendant(ee108800 ⊆ fbb5be72), migration 바이트 무변(§4/§5 스키마 stomp 0). ' +
    '[② dryrun — supervisor 독립 재실행] No-Persistence PASS(canonical dryrun_lib.mjs · migration_dryrun_no_persistence_standard v1.0 3요소: stripTxnControl["BEGIN;","COMMIT;"] + plpgsql exception-handler sentinel 무영속 + assertAbsent post-probe). supervisor 격리 worktree 재실행 실측: RUN A(forward) PASS(self-verify DO 통과·13종 post-probe absent:true) + RUN B(forward+rollback round-trip) PASS(clean 역전·13종 absent:true) → sentinel-bypass 없음·prod 영속 0(누출 0). §5 non-txn DDL 검출=0. ' +
    '[③ ledger] net-new=clean: schema_migrations[20260822010000]=0 rows(미등록) · 신규버전 > 최신 20260821170000(단조증가·gap/collision 0) · 대상 오브젝트 prod 실재 0(present:false 13종) = 부분적용/OOB drift 잔재 0. ' +
    '[③ 롤백] rollback.sql 역순·IF EXISTS 가드·apply前 백업 경고 + round-trip dry-run(RUN B) clean 역전. ' +
    '[deploy-precheck matrix] C0 fresh(no prior NO-GO) · C10/C19 CREATE OR REPLACE FUNCTION 2종=신규 함수(계약자산 아님·body-drift 대상 아님·trigger-only) · C11 prod-realness=post-probe 실재/부재 실측 + DDL 원자 단일 마이그 · C13 db_only·apply=dev-foot(feat 브랜치·main 미머지) · C16 deploy-order PASS · C18/§2.8 DA HOLD(b5f8) RESOLVED(DA 인박스 done + 정본 decision 7d1f19660a9 자기정정·GENERATED 유일허용) + signals/MQ 재확인 활성 HOLD/RETRACT 0 · C20 apply_before_go 부재(deployed_at/applied_at 공란) · C21 frontmatter fresh-read status=approved·block_reason 공란·deploy_hold 부재·활성 RETRACT 0(line234 RETRACT=nlnt 오복제 자기정정 RESOLVED marker) · C22 CEO 조건 N/A(§3.1 면제) · C24 sha-pin(migration_sha256 == 티켓 mig_files) · C28 N/A(staff-record 정정 아님) · C29/C30/C35 N/A(web bundle 0·domain=foot·db_only). ' +
    'C1/C5 N/A(FE touch 0·db_only) · C14 N/A(db_only) · C26 N/A(ON CONFLICT arbiter 없음). ' +
    'apply-후 POSTCHECK(dev-foot 첨부 요망): 신규 테이블 2 + images 컬럼 5 실재 · RLS 정책/트리거/가드 실효 · self-verify DO 불변식 · 회귀 0. §6 노쇼 자동폐기 트리거 실배선 = 스키마 GO ∧ reporter confirm(hxdj divergence) 後 별도 마이그(본 GO-token 범위 밖).',
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
