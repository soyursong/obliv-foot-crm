/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot 회차권 P-orphan 재-결선 correction lane
 * ticket: T-20260810-foot-ARCHE-PORPHAN-CORRECTION
 * lane  : data-correction mjs 러너 (SQL-file 아님) — content-binding = 러너 스크립트 raw bytes sha256.
 *         (SQL-file lane 의 migration up.sql sha256 와 동형 계약, 대상만 러너 파일)
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem
 * 선례   : issue_go_token_foot_coord_autosync_T-20260808.mjs / _foot_grade_enum_T-20260629.mjs (동일 계약)
 * 게이트 : DA 조건부 GO(MSG-20260810-015024-v8dg) · Q5 forward-seal=H1 · planner approved(02:27) ·
 *          supervisor DB-GATE dry-run 재현 PASS(freeze 62==62 novel=0 · A28/amb0/absent34 · 매출축 불변).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260810-foot-ARCHE-PORPHAN-CORRECTION';
const RUNNER = 'scripts/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_apply.mjs';
const EXPECTED_SHA = '02554b3168bd07062a9ff38241223194649b1c0190942801b1529f23ed4753fe';

const runnerSrc = readFileSync(new URL('../' + RUNNER, import.meta.url));
const sha = crypto.createHash('sha256').update(runnerSrc).digest('hex');
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
  migration_sha256: sha,          // = 러너 스크립트 sha256 (content-binding)
  runner_file: RUNNER,
  lane: 'data-correction-mjs-runner',
  change_class: 'DATA-CORRECTION (FK fill-on-NULL · DDL 0 · 매출축 무접촉 · reversible)',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply:
    'MSG-20260810-015024-v8dg (DA-20260810-foot-ARCHE-PORPHAN-CORRECTION-SPEC · verdict=조건부 GO · db_change=false · fork-parity from scalp2). ' +
    'signals L85 corroborated. ⚠ SSOT doc da_decision_foot_arche_porphan_correction_spec_20260810.md 파일 미작성(citation-gap, DA 백필 통지) — 판정 자체는 MQ+signals+ticket changelog 3중 실재.',
  ceo_gate: 'N/A — DDL 0 · db_change=false · 62 freeze 한정 reversible FK backfill · DA GO → 대표 게이트 면제(autonomy §3.1).',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor). deploy-precheck: C0 fresh(no prior NO-GO) · C2 db_only exempt VALID(deploy commit f1215b6e = scripts/+evidence/ only, no src/) · C3 rollback_sql 동봉(before-image 기반 package_session_id→NULL) · C11/C12 N/A(DDL 0·data UPDATE만) · C18/C21 CLEAN(signals+MQ 대상 DA HOLD/RETRACT 0) · C28 N/A(check_in_services FK·staff role/active/owner 무접촉) · C29 N/A(웹번들 무). ' +
    'dry-run 독립 재현 PASS: freeze live 62==frozen 62 · novel=0(Q5 seal 정합) · A_resolvable 28 / B_ambiguous 0 / B_absent 34 = census 일치. ' +
    'plan 무결성: pick_ps_id 28 distinct(double-claim 0) · after==null 0 · before!=null 0(preserve-on-NULL 준수). ' +
    '매출축 불변: package_session_id(FK) 만 write · Σprice 27,950,000 / Σorigprice 34,200,000 / flag_true 111 불변. ' +
    'B-absent 34 무접촉(현장확정 void 라우팅·본 apply 미포함). ' +
    'AF-2 per-row 확인 완료: 비가열레이저-AF 2건(89443cb7/ae8fcdb3) 모두 동일 check_in_id+customer 상 유일 unclaimed status=used ps 로 결선 · 매핑오류 시 downside=non-match(mis-link 아님) · reversible. ' +
    'apply 대상=A-resolvable 28(POSTCHECK rows==28 · P-orphan 62→34 · healthy 49→77). 러너 HARD-GATE=GO-token+sig+--i-have-go-token.',
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
    { ticket: TICKET, issued: token.issued_at, expires: token.expires_at, runner_sha256: sha, key_id: token.key_id, nonce: token.nonce, sig_selfverify: ok },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
