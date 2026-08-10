/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot internal_cron_secret rotation (leg[b] value-swap)
 * ticket: T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON
 * lane  : value-swap-non-ddl (vault.secrets UPDATE 1-row + EF-env V1/V2 *_NEXT→primary). db_change=false·DDL 0·schema 0.
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * 근거   : supervisor RECONCILE 4항 authoritative 실측 (Management API READ-ONLY, rxlomoozakkjesdqjtvd, 2026-08-10)
 *          + DA revoke-last timing (MSG-20260810-100638-r0nr) + body-sibling 선례(09:16 GO, 무중단 완결).
 * ⚠ 이 스크립트는 GO-token(.json+.sig) 파일만 쓴다(prod 무접촉). apply=dev-foot lane(GO-token 검증 후).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON';
const now = new Date();
const exp = new Date(now.getTime() + 90 * 60 * 1000); // TTL 90m — flip window (soak/revoke=flip 후 4-AND 게이트, 동일 승인 연장)

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  issued_at: now.toISOString(),
  expires_at: exp.toISOString(),
  prod_ref: 'rxlomoozakkjesdqjtvd',
  lane: 'value-swap-non-ddl',
  change_class:
    'vault.secrets internal_cron_secret VALUE UPDATE (1-row) + EF-env INTERNAL_CRON_SECRET(V1 5EF)·CRON_SECRET(V2 2EF) *_NEXT→primary. DDL 0·schema/컬럼/타입/enum/테이블 0·data-table write 0·db_change=false. reversible=old value 재주입(soak 중 old∨new dual-accept 병존).',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  evidence_commit: '07a5f17f',
  widen_deploy_commits: ['ca4dd709', '3206b2f1'],
  reconcile: {
    lane: 'supervisor-sole vault-decrypt (Management API READ-ONLY SELECT, prod WRITE/DDL 0, digest-hex only·plaintext 미노출)',
    conn: 'db=postgres · server_addr present · ref=rxlomoozakkjesdqjtvd (foot canon, URL-scoped)',
    divergence_verdict:
      'RESOLVED — 가설A 확정. foot prod vault_total=11 · internal_cron_secret cnt=1 (EXISTS) · vault_digest=bec0aa00…(09:01 dev-foot self-digest 정확일치). 09:21 "vault EMPTY total=0" = dev-isolation(kcdqtyivtqcjmcrdjkqi·별 프로젝트·empty vault) 오귀속 artifact.',
    locus: 'vault (P1) ONLY. GUC app.cron_secret = NULL(guc_digest null·guc_len null) → P2 는 live locus 아님.',
    old_digest_sha256: 'bec0aa00595651a51aff3002cca82665d14e54dd311ace171a695d1641eaa728',
    cron_surface: '13 active jobs — 10 secret-passing wrappers + 2 carve-out(j6 keep_warm anon·no icron / j30 pmw-autopromote SQL-only·no http) + (j33 redpay-unreg-digest wrapper=EF 미배포·moot).',
    ef_surface:
      'secret HEADER 수신 distinct EF=9 / secret VALIDATE EF=7. Δ2(crm-payment-sync-emit j28·crm-cancel-sync-emit j36)=INTERNAL_CRON_SECRET/CRON_SECRET 미read·auth축=anon-Bearer JWT(verify_jwt=true)·x-internal-cron=CORS allow-list 수동전달만·EF 미검증 → ROTATION-INERT(401 risk 0·widen 불요). 검증 EF 7 中 foot 배포=6(redpay-unreg-digest 미배포=moot).',
    widen_completeness:
      'COMPLETE. leg[a] dual-accept(*_NEXT old∨new) = 6 live 검증 EF 전량 배포 확인(updated 2026-08-10 01:28 UTC): send-notification(v35·verify_jwt=true) / dopamine-callback-dispatch(v18·false) / redpay-reconcile(v39·false) / redpay-planb-match(v9·false) / attendance-sync(v16·false·V2) / closing-confirmed-publisher(v14·false·V2). Δ2 EF 제외=정당(rotation-inert). blind re-widen 금지 게이트 SATISFIED — widen-확장 code-delta 불요.',
  },
  apply_surface_corrected:
    'P1 vault.secrets internal_cron_secret = 신값 UPDATE (VALID 1-row target·0-row silent write 위험 CLEARED) + EF-env V1 INTERNAL_CRON_SECRET_NEXT(5EF)·V2 CRON_SECRET_NEXT(2EF)=신값 주입. ★P2 GUC app.cron_secret = DROP from surface(null·no-op — 신규 set 금지: net-new override 생성 시 그 자체가 별 rotation 대상化). ★Δ2 EF widen-확장 = 불요(rotation-inert).',
  apply_sequence:
    'DA revoke-last 불변식(MSG-20260810-100638-r0nr). (0)widen live 旣충족(leg[a] 6-set) → (1)flip: EF-env *_NEXT=new(V1 5EF+V2 2EF) → vault P1 UPDATE=new → fresh-conn SHOW/재-digest 확인(digest bec0aa00→신값 변동 assert) → (2)soak ≥28h(00:00Z+09:00Z daily send-notification 발사 각 ≥1회 포함) → (3)401-rate=0 실측(6 live 검증 EF 로그·Δ2/미배포 제외) + stale caller 부재 → (4)revoke-old: EF-env primary INTERNAL_CRON_SECRET=new·CRON_SECRET=new(V1+V2 lockstep·한쪽 선-revoke 금지)·*_NEXT clear. vault old=flip 시점 旣교체.',
  soak: '≥24h+margin(≈28h). max-interval LIVE 검증 caller=send-notification daily(j9 00:00Z·j5 09:00Z). 두 daily 발사 span 필수.',
  da_consult_reply:
    'DA-20260720-GVSAUTHEXEC (DA lane COMPLETE·rotate-before-seal 게이트 충족·foot §10-5 대상셋 frozen) + revoke-last timing DA INFO MSG-20260810-100638-r0nr (A안 dual-accept=하드 401 window 부재·유일 위험축=revoke 순서·V1+V2 lockstep). body-sibling(hmxnjdmdgfxmsfvytssm) 동일 rotation 09:16 GO→09:41 무중단 완결(digest 622078d4→d50f589b·net 200×9/401×0) 선례.',
  ceo_gate:
    'N/A — value-swap non-DDL(vault value UPDATE + EF-env)·schema/DDL 0·비-PHI-스키마·비-금전. DA lane COMPLETE + presumed-compromised secret 회수(부모 T-20260717 노출봉합) = §3.1 CEO 파괴게이트 면제.',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor authoritative RECONCILE). ' +
    'RECONCILE 4항 실측 완료(위 reconcile 블록): locus=vault·DIVERGENCE=가설A RESOLVED(bec0aa00 재산출 일치·09:21 EMPTY=dev-isolation artifact)·Δ2 widen-gap=false-positive(rotation-inert)·widen COMPLETE(6 live). ' +
    'widen-live 실측: 6 검증 EF updated 2026-08-10 01:28 UTC(config-authoritative 6-set 재배포 GREEN=QA-REPLY MSG-20260810-103034-51hd)·verify_jwt 정합(dopamine-callback-dispatch=false[B1 landmine 회피]·send-notification=true[N1 Bearer anon+internal]). ' +
    'deploy-precheck matrix: C0 fresh(status blocked/gate_pending·본 티켓 prior NO-GO reconcile-hold 해소)·C18/§2.8 DA HOLD/RETRACT/deploy_hold CLEAR(signals+MQ+fresh frontmatter, internal_cron DA lane COMPLETE·RLS-SEAL HOLD=별티켓 무관)·C21 RETRACT CLEAR(frontmatter 재읽기 block_reason=gate_pending·deploy_hold 무)·C20 apply_before_go 준수(GO-token 前 prod vault/GUC/EF-env 선집행 0). ' +
    'C11 vault P1 UPDATE=VALID 1-row target(cross_crm_write_rowcheck_standard rows-affected assert 의무=flip 시 1 assert·0-row=abort)·C1/C5/C13/C14 N/A(db_only·EF-env·FE touch 0·widen code=leg[a] 별 code-gate 旣PASS)·C10/C19/C23/C26 N/A(CREATE FUNCTION/OR REPLACE/SECDEF grant/ON CONFLICT 0)·C25/C28/C29/C30 N/A. ' +
    'apply-후 POSTCHECK(dev-foot 첨부): 재-digest(신값·bec0aa00 아님) + soak≥28h 창 401-rate=0(6 live EF) + stale caller 부재 → revoke-old(V1+V2 lockstep) → supervisor 사후검증.',
  executor:
    'dev-foot (DB 적용=dev 책임·supervisor=사전승인[본 토큰]+사후검증). revoke-last 4-AND 게이트 전부 충족 前 old 제거 금지.',
  scope:
    'internal_cron_secret rotation leg[b] value-swap 전용. solapi HIGH leg(부모 T-20260717·human window)=범위 밖. cross-fork(scalp2/women/scalp/body)=per-fork vault·본 apply 비차단.',
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
      lane: token.lane,
      key_id: token.key_id,
      nonce: token.nonce,
      sig_selfverify: ok,
    },
    null,
    1,
  ),
);
if (!ok) process.exit(1);
