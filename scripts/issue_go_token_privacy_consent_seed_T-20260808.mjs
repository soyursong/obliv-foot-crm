/**
 * DB-GATE GO-token 발행 (supervisor 전용) — foot 개인정보 수집·이용 동의서 form_templates ADDITIVE seed
 * ticket: T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM
 * lane  : SQL-file lane — content-binding = seed .sql raw bytes sha256 (apply_gate_lib verify-json 계약)
 * 서명   : ed25519 private (~/.config/medibuilder-secrets/supervisor-dbgate-go-ed25519.pem)
 * 검증쌍 : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem
 * 게이트 : supervisor 코드 QA GREEN(2026-08-10, AC-9 신규 HEAD b64bf76c 재-QA) ·
 *          §8 2.10 판정시점 라이브 번들 재대조 PASS(version.json commit==b64bf76c · photoUrl chunk 문구부재+§24완전) ·
 *          field GO(김주연 총괄 U0ATDB587PV ts=1786348398.793179) · db_change=false ADDITIVE data INSERT.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const TICKET = 'T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM';
const SQL_FILE = 'supabase/migrations/20260809110000_foot_docform_privacy_consent_seed.sql';
const EXPECTED_SHA = 'fd59ec4e6d1cf50b0a708d14bfdc9a7dee33c0a7951ab92a04cbfbc0bafb772a';

const sqlSrc = readFileSync(new URL('../' + SQL_FILE, import.meta.url), 'utf8');
const sha = crypto.createHash('sha256').update(sqlSrc, 'utf8').digest('hex');
if (sha !== EXPECTED_SHA) {
  console.error(`❌ content-binding 불일치 — 실측 sha256=${sha} ≠ 사전합의 ${EXPECTED_SHA}. 서명 중단.`);
  process.exit(1);
}

const now = new Date();
const exp = new Date(now.getTime() + 60 * 60 * 1000); // TTL 60m

const token = {
  ticket_id: TICKET,
  gate: 'DB-GATE-GO',
  issued_by: 'supervisor',
  issued_at: now.toISOString(),
  expires_at: exp.toISOString(),
  prod_ref: 'rxlomoozakkjesdqjtvd',
  migration_sha256: sha,
  migration_version: '20260809110000',
  migration_name: 'foot_docform_privacy_consent_seed',
  lane: 'sql-file',
  change_class: 'ADDITIVE (form_templates 단일행 INSERT · DDL 0 · 멱등 WHERE NOT EXISTS · scoped-DELETE rollback · db_change=false)',
  key_id: 'supv-dbgate-2026a',
  nonce: crypto.randomBytes(12).toString('hex'),
  da_consult_reply:
    'n/a — 스키마 변경 0(신규 컬럼/테이블/enum 없음) · form_templates seed=데이터 INSERT(멱등) · db_change=false → §S2.4 DA CONSULT 게이트 무대상 · MIG-GATE 무대상(planner risk_verdict GO_WARN 정합).',
  ceo_gate: 'N/A — DDL 0 · ADDITIVE 단일행 seed · reversible(scoped DELETE) → 대표 파괴게이트 면제(autonomy §3.1).',
  precheck:
    'DB-GATE PASS(2026-08-10, supervisor). 코드 QA GREEN @HEAD b64bf76c(=티켓 commit_sha, origin/main pushed): ' +
    'P1 build BUILD OK(exit0) · dist grep AC-9 삭제문구 0건 · §24 블록 완전(고유식별정보3/외국인등록번호1/여권번호1/주민등록번호12) · ' +
    'P2 browser BROWSER OK(3/0) · E2E 7 tests PASS. ' +
    '§8 2.10 판정시점 라이브 번들 재대조 PASS: pages.dev/version.json commit==b64bf76cee76342c46b810565c9d3bc5ff751bcd(정확) · ' +
    'live photoUrl-KG0Eafmy.js: AC-9 삭제문구(셀프접수 태블릿 오류~) 0건 · Consent to Collection 1 · 고유식별정보3 · pcf-sig-cell 2(기관↔서명 스왑) · ' +
    'env 인라인 라이브 실측: rxlomoozakkjesdqjtvd.supabase.co + sb_publishable_ 1(wrong-project 0). ' +
    '§8 2.8 DA HOLD recheck CLEAN(signals+MQ 대상 HOLD/RETRACT 0). ' +
    'field GO 확보(김주연 총괄 U0ATDB587PV ts=1786348398.793179 "미리보기 됐으니깐 펜차트에 올려줘 그냥 바로"). ' +
    'PRE-APPLY prod probe: existing_privacy_rows=0(seed 필요·would-INSERT=1) · total_clinic_rows=34(footDbTpls>0 → FALLBACK 미사용 → dormant 안전 확증). ' +
    'dryrun(no-persistence BEGIN..ROLLBACK) 무예외. ADDITIVE 단일행·멱등·scoped-DELETE rollback 동봉.',
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
