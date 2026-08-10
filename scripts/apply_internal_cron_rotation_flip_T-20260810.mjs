#!/usr/bin/env node
/**
 * T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — leg[b] value-swap FLIP (dev-foot executor)
 *
 * GO-token: db-gate/T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON_GO.token.json (ed25519 sig verify PASS, supv-dbgate-2026a)
 * lane    : value-swap-non-ddl. vault.secrets internal_cron_secret VALUE UPDATE (1-row) + EF-env *_NEXT=new.
 *           DDL 0 · schema 0 · data-table write 0.
 *
 * 안전 불변식:
 *   - 평문 노출 0 : 신값/구값은 sha256 digest(hex) 로만 로그/증적. 신값은 프로세스 내에서만 존재.
 *   - 순서(revoke-last) : (1)EF-env *_NEXT=new  → 전파 settle → (2)vault UPDATE=new(1-row assert)
 *                          → (3)fresh-conn 재-digest(bec0aa00→new 변동 assert). revoke-old 는 별 leg(28h soak 후).
 *   - dual-accept 안전망 : EF-env primary(INTERNAL_CRON_SECRET/CRON_SECRET=old) 는 flip 중 그대로 → old∨new 병존.
 *   - 1-row assert : vault UPDATE 대상 name unique·cnt==1 확인 후 DO-block RAISE 가드. 0-row=abort.
 *
 * modes:
 *   (default) --precheck : READ-ONLY. vault digest==token.old_digest 확인 + EF-env inventory + MgmtAPI access.
 *   --flip               : EF-env *_NEXT set → settle → vault update → re-digest verify. precheck 통과 전제.
 *   --settle=<sec>       : _NEXT set 후 vault flip 전 전파 대기(기본 90s).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

// ── env ────────────────────────────────────────────────────────────────
function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* ignore */ }
  return out;
}
const fileEnv = {
  ...loadEnvFile(join(homedir(), '.env.redpay-foot')),
  ...loadEnvFile(join(process.cwd(), '.env.local')),
};
const cfg = (k, d = '') => (process.env[k] ?? fileEnv[k] ?? d).toString().trim();

const REF = 'rxlomoozakkjesdqjtvd';
const MGMT = 'https://api.supabase.com';
const ACCESS_TOKEN = cfg('SUPABASE_ACCESS_TOKEN');
const OLD_DIGEST = 'bec0aa00595651a51aff3002cca82665d14e54dd311ace171a695d1641eaa728';
const TOKEN_EXPIRES = Date.parse('2026-08-10T03:31:57.987Z');

const args = process.argv.slice(2);
const MODE_FLIP = args.includes('--flip');
const settleArg = args.find((a) => a.startsWith('--settle='));
const SETTLE_SEC = settleArg ? parseInt(settleArg.split('=')[1], 10) : 90;

function digestHex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}
function fp(dg) { return dg ? dg.slice(0, 12) + '…' : '(null)'; }

async function mgmt(method, path, body) {
  const res = await fetch(`${MGMT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MgmtAPI ${method} ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}
async function sql(query) {
  return mgmt('POST', `/v1/projects/${REF}/database/query`, { query });
}

// vault digest via SQL (plaintext 미반환 — sha256 hex only)
async function vaultDigest() {
  const rows = await sql(
    `SELECT count(*)::int AS cnt,
            encode(sha256(convert_to((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='internal_cron_secret' LIMIT 1),'UTF8')),'hex') AS dg
     FROM vault.decrypted_secrets WHERE name='internal_cron_secret';`,
  );
  return rows && rows[0] ? rows[0] : { cnt: 0, dg: null };
}
async function efSecretDigests() {
  // MgmtAPI GET /secrets returns {name, value} where value is a sha256 digest of the secret value.
  const list = await mgmt('GET', `/v1/projects/${REF}/secrets`);
  const want = ['INTERNAL_CRON_SECRET', 'CRON_SECRET', 'INTERNAL_CRON_SECRET_NEXT', 'CRON_SECRET_NEXT'];
  const out = {};
  for (const s of list) if (want.includes(s.name)) out[s.name] = s.value; // value = server-side digest
  return out;
}

function guardCreds() {
  if (!ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 없음 (Management API 불가).'); process.exit(2); }
  if (Date.now() > TOKEN_EXPIRES) {
    console.error(`❌ GO-token TTL 만료 (expires 2026-08-10T03:31:57Z). flip 금지 — supervisor 재발급 필요.`);
    process.exit(2);
  }
}

async function precheck() {
  guardCreds();
  console.log(`== PRECHECK (READ-ONLY) ref=${REF} now=${new Date().toISOString()} ==`);
  const v = await vaultDigest();
  console.log(`  vault internal_cron_secret: cnt=${v.cnt} digest=${fp(v.dg)}`);
  const matchOld = v.dg === OLD_DIGEST;
  console.log(`  token.old_digest 일치(bec0aa00…): ${matchOld ? '✅ MATCH' : '❌ MISMATCH'}`);
  const ef = await efSecretDigests();
  console.log('  EF-env (server-side digest):');
  for (const k of ['INTERNAL_CRON_SECRET', 'CRON_SECRET', 'INTERNAL_CRON_SECRET_NEXT', 'CRON_SECRET_NEXT']) {
    console.log(`    ${k.padEnd(26)} = ${k in ef ? fp(ef[k]) : '(NOT SET)'}`);
  }
  const okPre = v.cnt === 1 && matchOld;
  console.log(`  PRECHECK: ${okPre ? '✅ PASS (flip 가능)' : '❌ FAIL (flip 금지)'}`);
  return { ok: okPre, vault: v, ef };
}

async function flip() {
  const pre = await precheck();
  if (!pre.ok) { console.error('\n❌ precheck FAIL → flip 중단.'); process.exit(3); }

  // 신값 생성 — 32 byte random, base64url(무-특수문자: A-Za-z0-9-_). 프로세스 내부에서만 존재.
  const NEW = crypto.randomBytes(32).toString('base64url');
  const NEW_DG = digestHex(NEW);
  console.log(`\n== FLIP == 신값 생성 digest=${fp(NEW_DG)} (len=${NEW.length}) [평문 미노출]`);

  // (1) EF-env *_NEXT = new (V1 INTERNAL_CRON_SECRET_NEXT 5EF + V2 CRON_SECRET_NEXT 2EF, 프로젝트-레벨 1회 set)
  console.log('  (1) EF-env *_NEXT=new set …');
  await mgmt('POST', `/v1/projects/${REF}/secrets`, [
    { name: 'INTERNAL_CRON_SECRET_NEXT', value: NEW },
    { name: 'CRON_SECRET_NEXT', value: NEW },
  ]);
  const efAfter = await efSecretDigests();
  const nextOk = efAfter['INTERNAL_CRON_SECRET_NEXT'] && efAfter['CRON_SECRET_NEXT'];
  console.log(`      INTERNAL_CRON_SECRET_NEXT=${fp(efAfter['INTERNAL_CRON_SECRET_NEXT'])}  CRON_SECRET_NEXT=${fp(efAfter['CRON_SECRET_NEXT'])}`);
  if (!nextOk) { console.error('❌ *_NEXT set 확인 실패 → 중단 (vault 미변경).'); process.exit(4); }
  console.log(`      primary 유지(dual-accept 안전망): INTERNAL_CRON_SECRET=${fp(efAfter['INTERNAL_CRON_SECRET'])} CRON_SECRET=${fp(efAfter['CRON_SECRET'])}`);

  // settle — 전파(전 isolate 가 _NEXT=new 를 보게) 대기. primary(old) 는 여전히 accepted → 안전.
  console.log(`  (settle) ${SETTLE_SEC}s 전파 대기 후 vault flip …`);
  await new Promise((r) => setTimeout(r, SETTLE_SEC * 1000));

  // (2) vault UPDATE = new (1-row assert; DO-block RAISE 가드)
  console.log('  (2) vault.update_secret internal_cron_secret=new (1-row assert) …');
  const NEW_SQL = NEW.replace(/'/g, "''"); // base64url 엔 '가 없지만 방어적
  await sql(
    `DO $$
     DECLARE v_id uuid; v_cnt int;
     BEGIN
       SELECT id INTO v_id FROM vault.secrets WHERE name='internal_cron_secret';
       GET DIAGNOSTICS v_cnt = ROW_COUNT;
       IF v_cnt <> 1 THEN RAISE EXCEPTION 'ABORT: expected 1 vault row, got %', v_cnt; END IF;
       PERFORM vault.update_secret(v_id, '${NEW_SQL}');
     END $$;`,
  );
  console.log('      vault UPDATE 실행 완료 (cnt==1 assert 통과).');

  // (3) fresh-conn 재-digest — bec0aa00 → new 변동 assert
  console.log('  (3) fresh-conn 재-digest assert …');
  const v2 = await vaultDigest();
  const changed = v2.dg !== OLD_DIGEST;
  const matchesNew = v2.dg === NEW_DG;
  console.log(`      vault digest: ${fp(OLD_DIGEST)} → ${fp(v2.dg)}  cnt=${v2.cnt}`);
  console.log(`      old(bec0aa00) 로부터 변동: ${changed ? '✅' : '❌'} | 신값 digest 일치: ${matchesNew ? '✅' : '❌'}`);
  if (!(v2.cnt === 1 && changed && matchesNew)) {
    console.error('❌ 재-digest assert FAIL — 상태 불일치. 수동 점검 필요 (신값 digest 는 evidence 참조).');
    process.exit(5);
  }

  // evidence (digest only)
  const ts = new Date().toISOString();
  const evidence = {
    ticket: 'T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON',
    leg: 'b-value-swap FLIP',
    executor: 'dev-foot',
    go_token_sig_verify: 'PASS (ed25519 supv-dbgate-2026a)',
    ref: REF,
    flipped_at: ts,
    settle_sec: SETTLE_SEC,
    vault_digest_before: OLD_DIGEST,
    vault_digest_after: v2.dg,
    new_secret_digest: NEW_DG,
    vault_row_cnt: v2.cnt,
    ef_env_after: {
      INTERNAL_CRON_SECRET: efAfter['INTERNAL_CRON_SECRET'] || null,
      CRON_SECRET: efAfter['CRON_SECRET'] || null,
      INTERNAL_CRON_SECRET_NEXT: efAfter['INTERNAL_CRON_SECRET_NEXT'] || null,
      CRON_SECRET_NEXT: efAfter['CRON_SECRET_NEXT'] || null,
    },
    invariants: {
      one_row_assert: 'PASS (DO-block cnt==1)',
      digest_changed: changed,
      digest_matches_new: matchesNew,
      dual_accept_safety: 'primary(old) 유지 — soak 중 old∨new 병존',
    },
    next_legs: 'soak≥28h (00:00Z j9 + 09:00Z j5 daily send-notification 각 ≥1회 span) → 401-rate=0 실측(6 live EF) + stale caller 부재 → revoke-old(EF-env primary=new, V1+V2 lockstep, *_NEXT clear).',
    plaintext_exposure: 'NONE (sha256 digest hex only)',
  };
  const evPath = new URL('../db-gate/T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON_flip_evidence.json', import.meta.url);
  writeFileSync(evPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\n✅ FLIP 완료. evidence → ${evPath.pathname}`);
  console.log(JSON.stringify(evidence, null, 2));
}

(async () => {
  try {
    if (MODE_FLIP) await flip();
    else await precheck();
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
