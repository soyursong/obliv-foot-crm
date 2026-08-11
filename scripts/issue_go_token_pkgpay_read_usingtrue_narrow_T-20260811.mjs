/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot package_payments_read USING(true) narrow
 * ticket: T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW
 * lane  : SQL-file 마이그 (RLS permissive narrow — DROP+CREATE package_payments_read
 *         USING(true) → USING(is_approved_user()) · exposure-REDUCING · 완전가역)
 *         content-binding = migration up.sql 전문 sha256.
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * 게이트 : DA §38-3 D1 (MSG-20260811-090219-fk5i) exposure-REDUCING·CEO/legal 불요 ·
 *          planner approved(TICKET-CREATE signals 09:07) · supervisor DB-GATE PASS(2026-08-11).
 * ⚠ 이 스크립트는 GO-token(.json+.sig) 파일만 쓴다(prod 무접촉). apply 는 GO-token 검증 후 dev-foot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW';
const SQL_REL = 'supabase/migrations/20260811070000_foot_pkgpay_read_usingtrue_narrow.sql';
const EXPECTED_SHA = '65ebd5eeeb827c0ce6a235e73604aa42e27fb25412e7f1b4fd16fdb3936806f6';

const sql = readFileSync(new URL('../' + SQL_REL, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
if (sha !== EXPECTED_SHA) {
  console.error(`❌ content-binding 불일치 — 실측 sha256=${sha} ≠ 사전합의 ${EXPECTED_SHA}. 서명 중단.`);
  process.exit(1);
}

const now = new Date();
const exp = new Date(now.getTime() + 120 * 60 * 1000); // TTL 120m

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  issued_at: now.toISOString(),
  expires_at: exp.toISOString(),
  prod_ref: 'rxlomoozakkjesdqjtvd',
  migration_sha256: sha, // = up.sql 전문 sha256 (content-binding)
  migration_version: '20260811070000',
  migration_name: 'foot_pkgpay_read_usingtrue_narrow',
  migration_file: SQL_REL,
  migration_files: [
    SQL_REL,
    'supabase/migrations/20260811070000_foot_pkgpay_read_usingtrue_narrow.rollback.sql',
  ],
  lane: 'migration-sql-file',
  evidence_commit: '5ff3c269',
  change_class:
    'exposure-REDUCING (§72) — package_payments_read permissive SELECT 술어 true → is_approved_user() ' +
    'in-place 재정의(DROP self + CREATE). 신규 컬럼/타입/enum/테이블 0 · 데이터 mutation 0 · ' +
    'RESTRICTIVE tenant_isolation(clinic_id) UNCHANGED → effective read floor = is_approved_user() ' +
    'AND own-clinic = payments sibling(payments_read) 및 body/scalp2/women byte-parity. ' +
    'reversible(rollback=USING(true) 복원). blast=inactive-only(census).',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'DA cross_crm_data_contract §38-3 D1 (MSG-20260811-090219-fk5i) — change-class=exposure-REDUCING, ' +
    'CEO/legal 인간게이트 불요 명시(outlier→canonical 정렬·role-floor narrowing 아님·승인 스태프=현 ' +
    '프로비저닝 데스크 전원→availability 회귀 0). 부모 T-20260716-cross-crm-FINANCE-READ-ROLEGATE-STD(done). ' +
    '잔여=supervisor MIG-GATE + 물리 GO-token.',
  ceo_gate:
    'N/A — §3.1 CEO 파괴게이트 면제(exposure-REDUCING: permissive 술어 narrow · 신규 컬럼/타입/enum/테이블 0 · ' +
    '데이터 mutation 0 · cross-product 계약 변경 0 · 완전가역). ⚠ DROP/CREATE POLICY=catalog-mutating DDL → ' +
    'DDL-0 carve 아님 → 본 GO-token 물리 선행이 apply 전제(apply_before_go 금지·C20).',
  precheck:
    'DB-GATE PASS(2026-08-11, supervisor). 독립 prod census(Management API READ-ONLY, WRITE/DDL 0) 재실행: ' +
    'C1 before-image 실측 = package_payments_read PERMISSIVE SELECT USING(true) OUTLIER 실재(ledger/PREFLIGHT drift-guard 전제 확증) · ' +
    'canonical package_payments_approved_read=is_approved_user() 병존(OR-덮임 moot 확증) · RESTRICTIVE tenant_isolation(clinic_id) 존치. ' +
    'C2/C3 availability census: read-loser = NOT(approved AND active) 집합 = 12행(approved&!active 8 + !approved&!active 4) 전건 active=false(offboarded) · ' +
    'approved=false AND active=true(활성-미승인 현업) = 0건 → legit 비-승인 consumer 부재(availability 회귀 0). ' +
    'C4 secdef readers(refund_package_atomic/refund_package_payment/record_planb_card_payment/foot_recompute_package_status) 전건 owner=postgres SECURITY DEFINER → RLS bypass → narrow 무영향. ' +
    'C5 anon 정책 0(TO anon 부재) → narrow 직교. C6 sibling payments_read=is_approved_user() AND clinic_id=current_user_clinic_id() → canonical target 확증(byte-parity). ' +
    'deploy-precheck matrix: C0 fresh(no prior NO-GO for this ticket)·C2 db_only exempt VALID(commit 5ff3c269 = 4 db 파일만·src/ diff 0)·C3 rollback 대칭 동봉(USING true 복원)·C4 policy-only no contract touch·' +
    'C11 prod-realness(package_payments 실재·relrowsecurity=true·is_approved_user()/current_user_clinic_id() resolver 실재)·C12 ref-col N/A(신규 컬럼 0·참조 함수 prod-present)·' +
    'C18/C18-2 DA HOLD·additive-binding CLEAR(signals+MQ+holdcheck exit0 go-ts 재확인)·C21 RETRACT CLEAR(frontmatter fresh reread: status=deploy-ready·block_reason 부재·deploy_hold 부재·applied_at 공백). ' +
    'C1(env)/C5(build)/C10/C19/C23 N/A(FE 0·CREATE FUNCTION/SECDEF 0)·C13/C24/C25/C26/C27/C28/C29/C30/C31/C32/C33 N/A(db_only·no bundle/push/apk/onconflict/EF/staff-identity/codeploy/turnstile). ' +
    'up.sql PREFLIGHT(대상실재+RLS ENABLE+술어함수 실재+현행 USING=true drift-guard abort+RESTRICTIVE tenant 존치)+VERIFY(is_approved_user() 포함·잔여 true 0·USING(true) permissive read 잔존 0·RESTRICTIVE tenant 존치·approved_read 존치) 내장. ' +
    'dry-run PASS(무영속·post-probe 4/4 before-image(USING true) 보존). ' +
    'apply=dev-foot 책임(C20 apply_before_go 준수: apply_ts>=issued_at & <=expires_at, go_token_path/go_issued_at/apply_ts evidence 3필드 기록 의무). ' +
    'apply-후 POSTCHECK(supervisor 사후검증): package_payments_read=is_approved_user() 착지·USING(true) permissive read 잔존 0·RESTRICTIVE tenant 존치·approved_read 존치·승인 스태프 read 지속·비활성 계정 read 상실.',
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
      sig_selfverify: ok ? 'pass' : 'FAIL',
    },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
