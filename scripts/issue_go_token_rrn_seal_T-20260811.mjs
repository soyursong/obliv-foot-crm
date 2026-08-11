/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot rrn_encrypt tenant-binding seal
 * ticket: T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL
 * lane  : SQL-file 마이그 (CREATE OR REPLACE FUNCTION public.rrn_encrypt SECDEF · ADDITIVE tenant/role seal · Vault-V2 base-preserve)
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem (key_id supv-dbgate-2026a)
 * ⚠ prod 무접촉 — .json+.sig 만 쓴다. apply 는 db_apply_guard.sh 가 GO-token 검증 후.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL';
const SQL_REL = 'supabase/migrations/20260811020000_foot_rrn_encrypt_tenant_binding_seal.sql';
const EXPECTED_SHA = '9d7c98a74751fea5320e7084b82356d51b8dc86c15d133a801895fc98f487519';

const sql = readFileSync(new URL('../' + SQL_REL, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
if (sha !== EXPECTED_SHA) {
  console.error(`content-binding 불일치 — 실측 sha256=${sha} != ${EXPECTED_SHA}. 서명 중단.`);
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
  migration_file: SQL_REL,
  lane: 'migration-sql-file',
  change_class: 'ADDITIVE exposure-REDUCING (SECDEF CREATE OR REPLACE rrn_encrypt · in-body role assert(is_approved_user)+tenant assert(customers.clinic_id=current_user_clinic_id(), NULL=any-clinic) + UPDATE WHERE tenant belt · Vault-V2 base-preserve[foot_rrn_key_v2·V2 하드닝 write 3종·SECDEF/search_path/GRANT authenticated 불변·decrypt 무접촉·anon 재개방 0] · 데이터 mutation 0 · DROP 0 · 신규 컬럼/타입/enum/테이블 0)',
  evidence_commit: 'f197f88793434d0651cccfeb32568944f77dc41f',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(8).toString('hex'),
  da_consult_reply: 'DA CONSULT-REPLY MSG-20260811-134705-kmfa firsthand: foot(root) rrn_encrypt = women 동일 shape(customer-scoped in-body UPDATE·GRANT authenticated·tenant/role assert 부재)=systemic. change-class=ADDITIVE in-body tenant assert(women 과 동일 doctrine·cross-fork settled → foot 신규 DA게이트 불요). foot own-helper census 필수(is_staff_clinic 부재·women 리터럴 blind-copy 금지) — 충족.',
  supervisor_verify: 'MIG-GATE independent prod introspection (foot rxlomoozakkjesdqjtvd, READ-ONLY). (C10) rrn_encrypt OVERLOAD_COUNT=1 sig(uuid,text)+prosecdef=true+search_path=public,extensions·live def_md5=0385d316f5c8d336824ce211ce35281b (기대 Vault-V2 pre-seal 정확 일치). own-helper census: current_user_clinic_id()/is_approved_user() foot-native(20260426000000, NOT women blind-copy)·is_staff_clinic() 부재→미사용. (C11/C12) 참조컬럼 customers.clinic_id/rrn_enc/resident_id/rrn_re_encrypted_at/rrn_encryption_version 전건 PRESENT(sibling women NO-GO 클래스 미재현)·Vault foot_rrn_key_v2 실재·GUC app.rrn_key 부재. (C23) anon EXEC=0·authenticated EXEC=1(intended encrypt-WRITE staff-facing tier). Dry-run No-Persistence PASS(base-compare live md5 0385d316 일치·harness 무영속·post-probe 5/5 absent·rrn_decrypt SECDEF 무접촉). rollback=Vault-V2 pre-seal body 원복(md5 0385d316 재현·byte-preserve). C24-applyguard: 공유 checkout HEAD 이동(f197f887→dd0c29e4 TESTACCT lane) 감지→격리 detached worktree(f197f887) 에서 apply(up.sql blob 9d7c98a7 assert). C18/C21 HOLD/RETRACT CLEAR(signals+MQ+fresh frontmatter). C0 fresh remark(0b50c2c4→f197f887·qa_result cleared·deploy_ready_at 16:12). build exit0(FE 0).',
};

const jsonPath = new URL(`../db-gate/${TICKET}_GO.token.json`, import.meta.url);
writeFileSync(jsonPath, JSON.stringify(token, null, 1) + '\n');

const priv = crypto.createPrivateKey(readFileSync(path.join(os.homedir(), '.config', 'medibuilder-secrets', 'supervisor-dbgate-go-ed25519.pem')));
const sig = crypto.sign(null, readFileSync(jsonPath), priv);
writeFileSync(new URL(`../db-gate/${TICKET}_GO.token.sig`, import.meta.url), sig.toString('base64'));

const pub = crypto.createPublicKey(readFileSync(new URL('../db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem', import.meta.url)));
const ok = crypto.verify(null, readFileSync(jsonPath), pub, sig);
console.log(JSON.stringify({ ticket: TICKET, issued: token.issued_at, expires: token.expires_at, migration_sha256: sha, nonce: token.nonce, sig_verify: ok }, null, 1));
if (!ok) process.exit(2);
