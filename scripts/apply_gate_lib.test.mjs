// ============================================================================
// apply_gate_lib.test.mjs — DB-GATE GO 게이트 단위 검증 (node --test)
// 티켓: T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (foot leg — crm 정본 참조)
//       계보: HONORSYS → scalp2 AC-3 → body AC-2 → crm → foot(본건)
//       원본: T-20260731-meta-APPLY-BEFORE-GO-NONDESTRUCTIVE-DBGATE-HARDEN
// 계약: supervisor CONSULT-REPLY MSG-20260731-142617-q8l6 (HONORSYS α 승계)
// 실행: node --test scripts/apply_gate_lib.test.mjs
//
// 실 supervisor private key 부재 상태에서도 전 경로를 검증하려고
// 테스트 전용 ephemeral ed25519 keypair 를 생성해 토큰/서명을 만든다.
// (게이트의 pubKeyPath 를 테스트 pubkey 로 주입 → 프로덕션 pubkey 무접점)
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertDbGateGo,
  assertApplyGateForRunner,
  applyTimingSelfCheck,
  migrationSha256,
  DbGateError,
  FOOT_PROD_REF,
  EXPECTED_GATE,
  getGatedApplyClient,
  resolveFootProdConn,
} from './apply_gate_lib.mjs';

const TICKET = 'T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT';
const SQL = "ALTER TABLE public.customers ADD COLUMN test_col text;\n";
// foot DML/DDL 러너 서브표면 대표 SQL — 단일행 UPDATE(ledger applyMigration 경유 예시).
const DML_SQL = "UPDATE reservations SET checkin_status='completed' WHERE id='a30166bf-6ef6-4585-ba2f-b1a599b49d78';\n";

// 테스트 픽스처 디렉터리 + ephemeral keypair
function makeFixture({ payloadOverride = {}, signWith, tamperToken = false, sql = SQL } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  // pubkey 파일
  const pubKeyPath = path.join(dir, 'test.pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  const nowIso = '2026-08-08T14:00:00+09:00';
  const payload = {
    ticket_id: TICKET,
    migration_version: '20260808_foot_gateskeleton',
    migration_name: '20260808_foot_gateskeleton_test',
    migration_sha256: migrationSha256(sql),
    prod_ref: FOOT_PROD_REF,
    gate: EXPECTED_GATE,
    issued_by: 'supervisor',
    issued_at: nowIso,
    expires_at: '2026-08-09T14:00:00+09:00',
    nonce: 'testnonce123',
    key_id: 'supv-dbgate-2026a',
    ...payloadOverride,
  };
  const tokenPath = path.join(dir, `${TICKET}_GO.token.json`);
  const sigPath = path.join(dir, `${TICKET}_GO.token.sig`);
  const bytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(tokenPath, bytes);

  // 서명은 (signWith ?? 방금 만든 privateKey) 로. tamper 면 서명 후 파일 변조.
  const signKey = signWith ?? privateKey;
  const sig = crypto.sign(null, bytes, signKey);
  fs.writeFileSync(sigPath, sig.toString('base64') + '\n');

  if (tamperToken) {
    const tampered = JSON.parse(bytes.toString('utf8'));
    tampered.prod_ref = 'EVILREFxxxxxxxxxxxx';
    fs.writeFileSync(tokenPath, JSON.stringify(tampered, null, 2));
  }

  return { dir, pubKeyPath, tokenPath, sigPath, payload };
}

function expectReject(fn, code) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof DbGateError, `DbGateError 기대, got ${e.name}: ${e.message}`);
    assert.equal(e.code, code, `code=${code} 기대, got ${e.code}`);
    return;
  }
  assert.fail(`throw 기대(code=${code})했으나 통과됨`);
}

// ── 1. 정상 토큰 → APPLY 허용 ────────────────────────────────────────────────
test('정상 토큰+유효 서명 → GO 통과', () => {
  const f = makeFixture();
  const gate = assertDbGateGo({
    ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    now: Date.parse('2026-08-08T15:00:00+09:00'),
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.sigVerify, 'pass');
  assert.equal(gate.keyId, 'supv-dbgate-2026a');
});

// ── 2. 토큰 부재 → 거부 ──────────────────────────────────────────────────────
test('토큰 파일 부재 → go_token_missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-empty-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubKeyPath = path.join(dir, 'test.pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: dir, pubKeyPath }),
    'go_token_missing',
  );
});

// ── 3. 서명 파일 부재 → 거부 ─────────────────────────────────────────────────
test('서명 파일 부재 → go_sig_missing', () => {
  const f = makeFixture();
  fs.rmSync(f.sigPath);
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'go_sig_missing',
  );
});

// ── 4. 서명 후 토큰 변조 → 서명 무효 거부 (위조 차단) ────────────────────────
test('서명 후 토큰 변조 → go_sig_invalid', () => {
  const f = makeFixture({ tamperToken: true });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'go_sig_invalid',
  );
});

// ── 5. 다른 키로 서명(위조 시도) → 서명 무효 거부 ────────────────────────────
test('공격자 키로 서명 → go_sig_invalid (dev-foot 위조 불가)', () => {
  const attacker = crypto.generateKeyPairSync('ed25519').privateKey;
  const f = makeFixture({ signWith: attacker });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'go_sig_invalid',
  );
});

// ── 6. migration_sha256 불일치(다른 SQL) → 거부 ─────────────────────────────
test('적용 SQL 변조/재사용(sha 불일치) → sha_mismatch', () => {
  const f = makeFixture();
  expectReject(
    () => assertDbGateGo({
      ticketId: TICKET, migrationSql: SQL + '-- 몰래 추가한 DROP\n',
      gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    }),
    'sha_mismatch',
  );
});

// ── 7. prod_ref 불일치(오적용) → 거부 ───────────────────────────────────────
test('prod_ref 불일치 → prod_mismatch', () => {
  const f = makeFixture({ payloadOverride: { prod_ref: 'otherprodxxxxxxxxxx' } });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'prod_mismatch',
  );
});

// ── 8. ticket_id 불일치 → 거부 ───────────────────────────────────────────────
test('ticket_id 불일치 → ticket_mismatch', () => {
  const f = makeFixture({ payloadOverride: { ticket_id: 'T-OTHER' } });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'ticket_mismatch',
  );
});

// ── 9. gate 문자열 위조 → 거부 ───────────────────────────────────────────────
test('gate != DB-GATE-GO → gate_invalid', () => {
  const f = makeFixture({ payloadOverride: { gate: 'GATE-B-GO' } });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'gate_invalid',
  );
});

// ── 10. issued_by 위조 → 거부 ────────────────────────────────────────────────
test('issued_by != supervisor → issuer_invalid', () => {
  const f = makeFixture({ payloadOverride: { issued_by: 'dev-foot' } });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'issuer_invalid',
  );
});

// ── 11. TTL 초과(만료) → 거부 ────────────────────────────────────────────────
test('expires_at 초과 → go_token_expired', () => {
  const f = makeFixture(); // expires_at = 2026-08-09T14:00:00+09:00
  expectReject(
    () => assertDbGateGo({
      ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
      now: Date.parse('2026-08-10T00:00:00+09:00'), // 만료 이후
    }),
    'go_token_expired',
  );
});

// ── 12. expires_at 부재 → 거부 ───────────────────────────────────────────────
test('expires_at 부재 → expires_at_missing', () => {
  const f = makeFixture({ payloadOverride: { expires_at: undefined } });
  expectReject(
    () => assertDbGateGo({ ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath }),
    'expires_at_missing',
  );
});

// ── 13. self-check: apply_ts < issued_at → anomaly 경보 ──────────────────────
test('applyTimingSelfCheck: 선집행(apply<issued) → anomaly=true', () => {
  const f = makeFixture();
  const gate = assertDbGateGo({
    ticketId: TICKET, migrationSql: SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    now: Date.parse('2026-08-08T15:00:00+09:00'),
  });
  const before = applyTimingSelfCheck(gate, Date.parse('2026-08-08T13:00:00+09:00'));
  assert.equal(before.anomaly, true);
  const after = applyTimingSelfCheck(gate, Date.parse('2026-08-08T15:00:00+09:00'));
  assert.equal(after.anomaly, false);
});

// ════════════════════════════════════════════════════════════════════════════
// ★ DML/DDL ad-hoc 러너 chokepoint 검증 (foot 크로스 표면 — runner_gate_unwired 교훈)
//   assertApplyGateForRunner: `--apply`/`APPLY=1` honor-system 단독으로
//   prod write 열림 차단(foot 티켓-전용 per-migration mjs 러너 우회 경로 폐쇄).
// ════════════════════════════════════════════════════════════════════════════

// ── 14. dry-run(APPLY 미요청) → apply=false (COMMIT 불가 신호), GO-token 불요 ──
test('runner-gate: APPLY 미요청 → apply=false (dry-run, GO-token 불요)', () => {
  const r = assertApplyGateForRunner({
    ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: false,
  });
  assert.equal(r.apply, false);
  assert.equal(r.lane, 'dry-run');
  assert.equal(r.gated, false);
});

// ── 15. ★ prod + --apply + GO-token 부재 → abort (honor-system 통로 폐쇄 핵심) ─
test('runner-gate: prod + APPLY 요청 + GO-token 부재 → go_token_missing (--apply 단독 차단)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-nogo-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubKeyPath = path.join(dir, 'test.pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  expectReject(
    () => assertApplyGateForRunner({
      ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: true,
      migrationSql: DML_SQL, gateDir: dir, pubKeyPath,
    }),
    'go_token_missing',
  );
});

// ── 16. prod + --apply + 유효 GO-token(DML SQL 바인딩) → apply=true 허용 ──────
test('runner-gate: prod + APPLY 요청 + 유효 GO-token → apply=true, gated=true', () => {
  const f = makeFixture({ sql: DML_SQL });
  const r = assertApplyGateForRunner({
    ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: true,
    migrationSql: DML_SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    now: Date.parse('2026-08-08T15:00:00+09:00'),
  });
  assert.equal(r.apply, true);
  assert.equal(r.lane, 'prod');
  assert.equal(r.gated, true);
  assert.equal(r.gate.sigVerify, 'pass');
});

// ── 17. prod + --apply + GO-token 은 있으나 다른 SQL 바인딩 → sha_mismatch ────
test('runner-gate: 커밋 SQL 이 토큰 서명 SQL 과 다름 → sha_mismatch (SQL 변조 차단)', () => {
  const f = makeFixture({ sql: DML_SQL });
  expectReject(
    () => assertApplyGateForRunner({
      ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: true,
      migrationSql: DML_SQL + '-- 몰래 추가\n', gateDir: f.dir, pubKeyPath: f.pubKeyPath,
      now: Date.parse('2026-08-08T15:00:00+09:00'),
    }),
    'sha_mismatch',
  );
});

// ── 18. 미지 ref + --apply → fail-closed abort (prod 아님 간주 금지) ─────────
test('runner-gate: 미지 ref + APPLY 요청 → unknown_ref (fail-closed)', () => {
  const f = makeFixture({ sql: DML_SQL });
  expectReject(
    () => assertApplyGateForRunner({
      ticketId: TICKET, targetRef: 'hmxnjdmdgfxmsfvytssm', applyRequested: true, // body prod ref (foot prod/dev 어디에도 없음)
      migrationSql: DML_SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    }),
    'unknown_ref',
  );
});

// ── 19. prod + --apply + content(SQL) 미제공 → bad_args (content-binding 강제) ─
test('runner-gate: prod apply 인데 migrationSql/File 미제공 → bad_args', () => {
  const f = makeFixture({ sql: DML_SQL });
  expectReject(
    () => assertApplyGateForRunner({
      ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: true,
      gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    }),
    'bad_args',
  );
});

// ── 20. prod + --apply + 만료 GO-token → go_token_expired ────────────────────
test('runner-gate: 만료 GO-token → go_token_expired', () => {
  const f = makeFixture({ sql: DML_SQL });
  expectReject(
    () => assertApplyGateForRunner({
      ticketId: TICKET, targetRef: FOOT_PROD_REF, applyRequested: true,
      migrationSql: DML_SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
      now: Date.parse('2026-08-10T00:00:00+09:00'),
    }),
    'go_token_expired',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// ★ R1 runtime 백스톱 (foot Class-A P-A) — getGatedApplyClient 공유 커넥션 팩토리.
//   핵심 불변식: prod refuse 시 clientFactory 절대 미호출 = DB 무접점.
//   실 secrets/pg/DB 무접점 위해 connResolver·clientFactory 주입.
//   (scalp2 loci leg 테스트 21~28 동형 — CONSULT-REPLY 불변조건 ①②③④)
// ════════════════════════════════════════════════════════════════════════════

// 호출 여부를 기록하는 스텁 팩토리(= pg 커넥션 객체 생성 대리).
function recordingFactory() {
  const state = { calls: 0, lastConfig: null };
  const fn = async (cfg) => {
    state.calls += 1;
    state.lastConfig = cfg;
    return { connect: async () => { state.connected = true; }, query: async () => ({ rows: [] }), end: async () => {} };
  };
  return { fn, state };
}
const prodResolver = () => ({ ref: FOOT_PROD_REF, config: { host: 'x', user: `postgres.${FOOT_PROD_REF}` } });
const FOREIGN_REF = 'wpzstrxuwdooaalvoklg'; // scalp2 prod — foot 기준 미지 ref

// ── 21. ★ prod + GO-token 부재 → throw + clientFactory 미호출(DB 무접점) ──────
test('gated-client: prod + GO-token 부재 → go_token_missing + 커넥션 미생성(DB 무접점)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-gc-nogo-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubKeyPath = path.join(dir, 'test.pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const rec = recordingFactory();
  let thrown = null;
  try {
    await getGatedApplyClient({
      ticketId: TICKET, sqlContent: DML_SQL, gateDir: dir, pubKeyPath,
      connResolver: prodResolver, clientFactory: rec.fn, evidenceLog: null,
    });
  } catch (e) { thrown = e; }
  assert.ok(thrown instanceof DbGateError, 'DbGateError 기대');
  assert.equal(thrown.code, 'go_token_missing');
  assert.equal(rec.state.calls, 0, '★ refuse 시 clientFactory 호출=0 (DB 무접점) 이어야 함');
});

// ── 22. prod + 유효 GO-token → client 반환 + gated=true + factory 1회 호출 ─────
test('gated-client: prod + 유효 GO-token → client 반환, gated=true', async () => {
  const f = makeFixture({ sql: DML_SQL });
  const rec = recordingFactory();
  const r = await getGatedApplyClient({
    ticketId: TICKET, sqlContent: DML_SQL, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
    now: Date.parse('2026-08-08T15:00:00+09:00'),
    connResolver: prodResolver, clientFactory: rec.fn, evidenceLog: null,
  });
  assert.equal(r.lane, 'prod');
  assert.equal(r.gated, true);
  assert.equal(rec.state.calls, 1, 'gate 통과 후 정확히 1회 client 생성');
  assert.equal(rec.state.connected, true, 'autoConnect 로 connect() 호출');
  assert.equal(r.gate.sigVerify, 'pass');
});

// ── 23. ★ prod + 토큰은 있으나 SQL 불일치 → sha_mismatch + 커넥션 미생성 ──────
test('gated-client: SQL 바인딩 불일치 → sha_mismatch + 커넥션 미생성(DB 무접점)', async () => {
  const f = makeFixture({ sql: DML_SQL });
  const rec = recordingFactory();
  let thrown = null;
  try {
    await getGatedApplyClient({
      ticketId: TICKET, sqlContent: DML_SQL + '-- 몰래 추가\n',
      gateDir: f.dir, pubKeyPath: f.pubKeyPath,
      now: Date.parse('2026-08-08T15:00:00+09:00'),
      connResolver: prodResolver, clientFactory: rec.fn, evidenceLog: null,
    });
  } catch (e) { thrown = e; }
  assert.equal(thrown?.code, 'sha_mismatch');
  assert.equal(rec.state.calls, 0, '★ refuse 시 커넥션 미생성');
});

// ── 24. dev ref(가상 dev 주입) → GO-token 면제, gated=false, client 반환 ──────
test('gated-client: dev ref → GO-token 면제(apply, gated=false)', async () => {
  const rec = recordingFactory();
  const DEV = 'devref0000000000dev0';
  const r = await getGatedApplyClient({
    ticketId: TICKET, devRef: DEV,
    connResolver: () => ({ ref: DEV, config: { host: 'x', user: `postgres.${DEV}` } }),
    clientFactory: rec.fn, evidenceLog: null,
  });
  assert.equal(r.lane, 'dev');
  assert.equal(r.gated, false);
  assert.equal(rec.state.calls, 1, 'dev 면제 → client 생성');
});

// ── 25. ★ 미지 ref → unknown_ref (fail-closed) + 커넥션 미생성 ────────────────
test('gated-client: 미지 ref → unknown_ref (fail-closed) + 커넥션 미생성', async () => {
  const rec = recordingFactory();
  let thrown = null;
  try {
    await getGatedApplyClient({
      ticketId: TICKET, sqlContent: DML_SQL,
      connResolver: () => ({ ref: FOREIGN_REF, config: { host: 'x' } }), // scalp2 prod = foot 미지 ref
      clientFactory: rec.fn, evidenceLog: null,
    });
  } catch (e) { thrown = e; }
  assert.equal(thrown?.code, 'unknown_ref');
  assert.equal(rec.state.calls, 0, '★ 미지 ref refuse 시 커넥션 미생성(DB 무접점)');
});

// ── 26. prod + sqlContent 미제공 → bad_args (content-binding 강제) + 미생성 ────
test('gated-client: prod 인데 sqlContent 미제공 → bad_args + 커넥션 미생성', async () => {
  const f = makeFixture({ sql: DML_SQL });
  const rec = recordingFactory();
  let thrown = null;
  try {
    await getGatedApplyClient({
      ticketId: TICKET, gateDir: f.dir, pubKeyPath: f.pubKeyPath,
      connResolver: prodResolver, clientFactory: rec.fn, evidenceLog: null,
    });
  } catch (e) { thrown = e; }
  assert.equal(thrown?.code, 'bad_args');
  assert.equal(rec.state.calls, 0);
});

// ── 27. R4 evidence: refuse 시 _apply_evidence jsonl 에 refuse 레코드 append ──
test('gated-client: refuse → evidence jsonl 에 event=refuse, db_contact=false 기록', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-gc-ev-'));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubKeyPath = path.join(dir, 'test.pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const evLog = path.join(dir, '_apply_evidence', 'apply_evidence.jsonl');
  const rec = recordingFactory();
  try {
    await getGatedApplyClient({
      ticketId: TICKET, sqlContent: DML_SQL, gateDir: dir, pubKeyPath,
      connResolver: prodResolver, clientFactory: rec.fn, evidenceLog: evLog,
    });
  } catch { /* expected */ }
  const lines = fs.readFileSync(evLog, 'utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.guard, 'getGatedApplyClient');
  assert.equal(last.event, 'refuse');
  assert.equal(last.db_contact, false);
  assert.equal(last.code, 'go_token_missing');
  assert.equal(last.schema_version, 1);
});

// ── 28. resolveFootProdConn: ref pin + user=postgres.<ref> + env password 해석 ─
//   주입값은 동적 조합(하드코딩 리터럴 회피 — gitleaks hardcoded-test-password 오탐 방지).
test('resolveFootProdConn: password 주입 → ref/user/host(southeast-1)/ssl 배선', () => {
  const injected = ['t3st', 'poolr', 'pw'].join('-'); // 동적 조합 = 리터럴 아님
  const { ref, config } = resolveFootProdConn({ password: injected });
  assert.equal(ref, FOOT_PROD_REF);
  assert.equal(config.user, `postgres.${FOOT_PROD_REF}`);
  assert.equal(config.host, 'aws-1-ap-southeast-1.pooler.supabase.com');
  assert.equal(config.password, injected);
  assert.equal(config.ssl.rejectUnauthorized, false);
});

// ── 29. resolveFootProdConn: .env 폴백 경로(SUPABASE_DB_PASSWORD) 해석 ────────
test('resolveFootProdConn: .env 폴백 → SUPABASE_DB_PASSWORD 라인 해석', () => {
  const savedEnv = process.env.SUPABASE_DB_PASSWORD;
  delete process.env.SUPABASE_DB_PASSWORD; // env 그림자 제거 → .env 폴백 강제
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgate-env-'));
    const envFile = path.join(dir, '.env');
    const val = ['t3st', 'env', 'pw'].join('-');
    fs.writeFileSync(envFile, `SOME_OTHER=1\nSUPABASE_DB_PASSWORD=${val}\n`);
    const { config } = resolveFootProdConn({ envFile });
    assert.equal(config.password, val, '.env 의 SUPABASE_DB_PASSWORD 라인이 해석돼야 함');
  } finally {
    if (savedEnv !== undefined) process.env.SUPABASE_DB_PASSWORD = savedEnv;
  }
});
