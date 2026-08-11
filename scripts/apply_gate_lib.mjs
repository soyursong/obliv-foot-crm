// ============================================================================
// apply_gate_lib.mjs — obliv-foot-crm prod DB apply DB-GATE GO 게이트 라이브러리
// ----------------------------------------------------------------------------
// 티켓 : T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (P0) — foot leg 이식 (crm 정본 참조)
//        계보 : 07-29 HONORSYS(784b8114) → scalp2 AC-3 08-03(ecc96a0f)
//               → body AC-2 08-05(f924e408) → crm 08-05(e1e4202) → foot(본건).
//        원본 계약 : T-20260731-meta-APPLY-BEFORE-GO-NONDESTRUCTIVE-DBGATE-HARDEN
//        supervisor CONSULT-REPLY MSG-20260731-142617-q8l6 (Q1 = α 확정)
//        = HONORSYS(APPLY-GATE-HONORSYS-HARDEN) 계약 SSOT 그대로 승계.
//        Opt-A(ed25519 서명) ∧ Opt-C(content-binding) 복합 AND 게이트.
// 목적 : prod DB apply 분기가 `--linked` 단독 또는 `--apply`/`APPLY=1` env flag
//        단독(honor-system)으로 열리는 구조적 재발(apply_before_go 절차사고)을 기계 차단.
//        → APPLY 는 supervisor 가 ed25519 로 서명한 DB-GATE GO 토큰이 디스크에
//          존재하고 서명이 유효하며 내용이 이 apply SQL·이 prod 에 바인딩될 때만 열림.
//
// ── ★ foot 크로스 표면 (T-20260801 foot leg — runner_gate_unwired 교훈 반영) ──
//   foot apply 경로는 두 lane 이 존재하며 둘 다 이 게이트를 강제 통과한다:
//     (a) DDL/SQL-file lane   → db_apply_guard.sh (npx supabase db query --linked)
//     (b) DML/DDL ad-hoc mjs lane → foot 티켓-전용 per-migration mjs 러너
//                               (`scripts/apply_<ts>_foot_*.mjs` — 대부분
//                                `scripts/lib/foot_migration_ledger.mjs` 의
//                                applyMigration()/query() 로 Management API POST,
//                                `--apply` argv flag 단독으로 prod COMMIT).
//   crm 실증(e1e4202 AC-3 재작업)에서 확인된 runner_gate_unwired 교훈:
//   canonical guard-lib 만 추가하고 티켓-전용 per-migration 러너를 retrofit 하지
//   않으면, 러너가 db_apply_guard.sh chokepoint 를 우회하는 별도 apply 경로로
//   `--apply` honor-system 단독 prod COMMIT 을 집행할 수 있다(라이브러리 추가만=NO-GO).
//   → (b) lane 을 위한 chokepoint = `assertApplyGateForRunner()` (아래). ad-hoc 러너는
//     실제 COMMIT(applyMigration/await query) 직전 이 함수를 반드시 호출해야 하며,
//     prod 대상 + `--apply` 요청 시 유효 GO-token 부재면 throw(fail-closed) → 러너
//     abort → COMMIT 도달 불가.
//     `--apply`/`APPLY=1` env flag 단독으로는 더 이상 prod write 를 열 수 없다.
//
// ── 비파괴(non-destructive) lane 시맨틱 ─────────────────────────────────────
//   content-binding 필드명은 `migration_sha256` 유지(계약 SSOT 승계) — 비파괴 lane
//   에서 그 의미 = **적용될 SQL 파일/문 전문의 sha256**(inline heredoc 금지는 (a)
//   lane; (b) 러너는 커밋될 SQL 문 전문을 canonical 문자열/파일로 바인딩).
//
// ── Gate-B GO ≠ DB-GATE GO (경계 명문화) ────────────────────────────────────
//   • Gate-B GO      = planner 착수 승인(티켓 approved). 코드 작성을 연다.
//   • DB-GATE GO     = supervisor prod APPLY 승인. prod DDL/DML 집행을 연다.
//   두 GO 는 별개다. Gate-B GO·md·슬랙·MQ·frontmatter(`db_gate_go:`)·`--apply` env
//   어떤 텍스트/마커/플래그도 DB-GATE GO 가 아니다(β REJECT: 기계검증 불가 필드).
//   DB-GATE GO 의 유일한 기계 SSOT = 아래 서명된 GO-token(.json + .sig).
//
// ── 게이트 = A ∧ C 복합(서로 다른 실패모드) ───────────────────────────────────
//   A(ed25519 서명 유효) : 위조 차단 — dev-foot 은 supervisor private key 부재 →
//                          유효 토큰 자체 제작 불가.
//   C(content-binding)   : 오적용 차단 — 다른 SQL/다른 prod/만료 토큰 재사용 차단.
//   둘 다 통과해야 GO. 하나라도 실패 → fail-closed(throw) → caller 는 APPLY
//   거부 + 명시 RAISE + non-zero exit.
//
// pubkey(고정 경로) : db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem
//   = 전 CRM byte-identical (sha256 884f9283…c96daa3, key_id=supv-dbgate-2026a).
//   private 는 supervisor secrets 단독. 동일 키로 전 CRM DB-GATE GO 를 서명한다.
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── CRM-agnostic 환경 pin (이식 시 이 블록만 교체) ───────────────────────────
//   dev_ops_policy.md §환경매트릭스 SSOT / obliv-foot-crm 인프라:
//     foot prod = rxlomoozakkjesdqjtvd (운영)
//     foot dev  = (미생성) — dev_ops_policy §환경매트릭스 foot dev DB 미생성.
//                   body/scalp2 선례대로 DEV_REF empty-guard(null, fail-closed) 채택
//                   — 추측 pin 금지.
//   ∴ prod 이외 target = unknown ref → fail-closed abort(미지 ref 는 prod 아님으로
//     간주 금지 = HONORSYS fail-closed 원칙). 실 apply 는 항상 prod → GO-token 필수.
export const FOOT_PROD_REF = 'rxlomoozakkjesdqjtvd';
export const FOOT_DEV_REF = null; // dev DB 미생성 — dev lane 부재
// 후방호환 별칭(포팅/공용 스크립트가 도메인 무관 심볼을 참조할 수 있게)
export const PROD_REF = FOOT_PROD_REF;
export const DEV_REF = FOOT_DEV_REF;

export const DBGATE_DIR = path.join(REPO_ROOT, 'db-gate');
export const DEFAULT_PUBKEY_PATH = path.join(
  DBGATE_DIR,
  'keys',
  'supervisor_dbgate_go_ed25519.pub.pem',
);
export const EXPECTED_GATE = 'DB-GATE-GO';
export const EXPECTED_ISSUER = 'supervisor';

// ── 배너 (guard 헤더 + 실행시 출력) ──────────────────────────────────────────
export const APPLY_GATE_BANNER = [
  '════════════════════════════════════════════════════════════════════════',
  ' DB-GATE GO 게이트 (foot 이식 · T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT)',
  ' ─────────────────────────────────────────────────────────────────────',
  ' Gate-B GO(planner 착수 승인) ≠ DB-GATE GO(supervisor prod APPLY 승인).',
  ' prod APPLY(DDL 러너 + DML ad-hoc 러너 `--apply`)는 supervisor 가 ed25519',
  '   서명한 GO-token 이 있을 때만 열린다.',
  ' GO-token(.json + .sig) 없으면 어떤 GO 문구·마커·`--apply` env flag 도',
  '   APPLY 근거가 아니다.',
  '════════════════════════════════════════════════════════════════════════',
].join('\n');

/**
 * 게이트 실패 시 던지는 에러. `.code` 로 실패 사유를 기계 식별.
 */
export class DbGateError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DbGateError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * migration_sha256 산식 SSOT — 적용 SQL 문자열의 sha256 hex.
 * supervisor 토큰 발행과 guard 검증이 반드시 동일 산식을 써야 한다.
 * (토큰 payload.migration_sha256 == migrationSha256(적용될 apply SQL 파일/문 전문))
 */
export function migrationSha256(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function goTokenPath(ticketId, gateDir = DBGATE_DIR) {
  return path.join(gateDir, `${ticketId}_GO.token.json`);
}
export function goSigPath(ticketId, gateDir = DBGATE_DIR) {
  return path.join(gateDir, `${ticketId}_GO.token.sig`);
}

/**
 * DB-GATE GO 게이트. 통과 시 evidence 객체 반환, 실패 시 DbGateError throw.
 *
 * @param {object} o
 * @param {string} o.ticketId          - 이 apply 의 티켓 (payload.ticket_id 대조)
 * @param {string} o.migrationSql      - 적용될 SQL 파일/문 전문 (sha256 재계산 대조)
 * @param {string} [o.prodRef]         - 대상 prod ref (기본 FOOT_PROD_REF)
 * @param {string} [o.migrationVersion]- 있으면 payload.migration_version 대조
 * @param {string} [o.migrationName]   - 있으면 payload.migration_name 대조
 * @param {string} [o.gateDir]         - 토큰 디렉터리 (기본 db-gate/)
 * @param {string} [o.pubKeyPath]      - ed25519 pubkey PEM (기본 committed pubkey)
 * @param {number} [o.now]             - 현재시각 epoch ms (기본 Date.now(); TTL 테스트 주입용)
 * @returns {{ok:true, issuedAt, expiresAt, issuedAtMs, tokenPath, sigPath,
 *            sigVerify:'pass', keyId, nonce, migrationSha256}}
 */
export function assertDbGateGo(o) {
  const {
    ticketId,
    migrationSql,
    prodRef = FOOT_PROD_REF,
    migrationVersion,
    migrationName,
    gateDir = DBGATE_DIR,
    pubKeyPath = DEFAULT_PUBKEY_PATH,
    now = Date.now(),
  } = o || {};

  if (!ticketId) throw new DbGateError('bad_args', 'ticketId 필수');
  if (typeof migrationSql !== 'string' || !migrationSql.length) {
    throw new DbGateError('bad_args', 'migrationSql(적용 SQL 전문) 필수');
  }

  const tokenPath = goTokenPath(ticketId, gateDir);
  const sigPath = goSigPath(ticketId, gateDir);

  // ── 1. 존재 (token.json + token.sig) ──────────────────────────────────────
  if (!fs.existsSync(tokenPath)) {
    throw new DbGateError(
      'go_token_missing',
      `DB-GATE GO 토큰 부재: ${path.relative(REPO_ROOT, tokenPath)} 없음. ` +
        'supervisor DB-GATE GO 미발행 — APPLY 근거 없음.',
      { tokenPath },
    );
  }
  if (!fs.existsSync(sigPath)) {
    throw new DbGateError(
      'go_sig_missing',
      `DB-GATE GO 서명 부재: ${path.relative(REPO_ROOT, sigPath)} 없음.`,
      { sigPath },
    );
  }

  // pubkey 로드 (guard 는 이 committed pubkey 만 신뢰)
  let pubKey;
  try {
    pubKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath));
  } catch (e) {
    throw new DbGateError('pubkey_load_fail', `pubkey 로드 실패(${pubKeyPath}): ${e.message}`);
  }
  if (pubKey.asymmetricKeyType !== 'ed25519') {
    throw new DbGateError('pubkey_not_ed25519', `pubkey 타입이 ed25519 아님: ${pubKey.asymmetricKeyType}`);
  }

  // ── 2. ed25519 verify (raw bytes 전체 대상; parse 前) ─────────────────────
  const tokenBytes = fs.readFileSync(tokenPath); // Buffer (raw bytes)
  let sigBuf;
  try {
    sigBuf = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64');
  } catch (e) {
    throw new DbGateError('sig_decode_fail', `서명 base64 디코드 실패: ${e.message}`);
  }
  let sigOk = false;
  try {
    sigOk = crypto.verify(null, tokenBytes, pubKey, sigBuf);
  } catch (e) {
    throw new DbGateError('sig_verify_error', `ed25519 verify 예외: ${e.message}`);
  }
  if (!sigOk) {
    throw new DbGateError(
      'go_sig_invalid',
      'DB-GATE GO 서명 검증 실패 — 토큰 위조/변조 또는 잘못된 키. APPLY 거부.',
      { tokenPath, sigPath },
    );
  }

  // 서명 통과 후에야 parse
  let payload;
  try {
    payload = JSON.parse(tokenBytes.toString('utf8'));
  } catch (e) {
    throw new DbGateError('token_parse_fail', `토큰 JSON 파싱 실패(서명은 통과): ${e.message}`);
  }

  // ── 3. content-binding assert ────────────────────────────────────────────
  const bindFail = (code, msg, expected, actual) =>
    new DbGateError(code, msg, { expected, actual });

  if (payload.gate !== EXPECTED_GATE) {
    throw bindFail('gate_invalid', `gate 불일치`, EXPECTED_GATE, payload.gate);
  }
  if (payload.issued_by !== EXPECTED_ISSUER) {
    throw bindFail('issuer_invalid', `issued_by 불일치`, EXPECTED_ISSUER, payload.issued_by);
  }
  if (payload.ticket_id !== ticketId) {
    throw bindFail('ticket_mismatch', `ticket_id 불일치`, ticketId, payload.ticket_id);
  }
  if (payload.prod_ref !== prodRef) {
    throw bindFail('prod_mismatch', `prod_ref 불일치(오적용 방지)`, prodRef, payload.prod_ref);
  }
  const actualSha = migrationSha256(migrationSql);
  if (payload.migration_sha256 !== actualSha) {
    throw bindFail(
      'sha_mismatch',
      'migration_sha256 불일치 — 토큰이 서명한 SQL 과 적용 SQL 이 다름(SQL 재사용/변조 차단).',
      payload.migration_sha256,
      actualSha,
    );
  }
  if (!payload.issued_at) {
    throw new DbGateError('issued_at_missing', 'payload.issued_at 부재');
  }
  // 선택 대조 (guard 가 값을 넘긴 경우에만)
  if (migrationVersion && payload.migration_version !== migrationVersion) {
    throw bindFail('version_mismatch', `migration_version 불일치`, migrationVersion, payload.migration_version);
  }
  if (migrationName && payload.migration_name !== migrationName) {
    throw bindFail('name_mismatch', `migration_name 불일치`, migrationName, payload.migration_name);
  }

  const issuedAtMs = Date.parse(payload.issued_at);
  if (Number.isNaN(issuedAtMs)) {
    throw new DbGateError('issued_at_unparseable', `issued_at 파싱 불가: ${payload.issued_at}`);
  }

  // ── 4. TTL ────────────────────────────────────────────────────────────────
  if (!payload.expires_at) {
    throw new DbGateError('expires_at_missing', 'payload.expires_at 부재(TTL 게이트 불가)');
  }
  const expiresAtMs = Date.parse(payload.expires_at);
  if (Number.isNaN(expiresAtMs)) {
    throw new DbGateError('expires_at_unparseable', `expires_at 파싱 불가: ${payload.expires_at}`);
  }
  if (now > expiresAtMs) {
    throw new DbGateError(
      'go_token_expired',
      `DB-GATE GO 토큰 만료 — expires_at=${payload.expires_at} < now. ` +
        'supervisor 재발행(재서명) 필요. stale/후속 NO-GO 토큰 재사용 차단.',
      { expiresAt: payload.expires_at },
    );
  }

  return {
    ok: true,
    issuedAt: payload.issued_at,
    expiresAt: payload.expires_at,
    issuedAtMs,
    tokenPath,
    sigPath,
    sigVerify: 'pass',
    keyId: payload.key_id ?? null,
    nonce: payload.nonce ?? null,
    migrationSha256: actualSha,
  };
}

/**
 * self-check — APPLY 실행시각이 GO 발행시각보다 앞서면 경보.
 * 판정 권위 아님(경고 출력 + evidence 기록만). prod-apply 사후감지 권위는 supervisor
 * deploy-precheck C20(파괴러너+비파괴 guard-lane).
 * @returns {{apply_ts, go_issued_at, sig_verify:'pass', anomaly:boolean, note:string}}
 */
export function applyTimingSelfCheck(gate, applyTsMs) {
  const anomaly = applyTsMs < gate.issuedAtMs;
  const note = anomaly
    ? '⚠ SELF-CHECK 경보: apply_ts < go_issued_at — 선집행 지문 의심(apply_before_go). ' +
      'supervisor C20 사후감지 대상. (guard 는 판정 권위 아님)'
    : 'apply_ts ≥ go_issued_at — 정상 순서.';
  return {
    apply_ts: new Date(applyTsMs).toISOString(),
    go_issued_at: gate.issuedAt,
    sig_verify: gate.sigVerify,
    anomaly,
    note,
  };
}

/**
 * ★ DML/DDL ad-hoc 러너 chokepoint (foot 크로스 표면 — T-20260801 foot leg).
 *
 * foot 티켓-전용 per-migration mjs 러너(대부분 scripts/lib/foot_migration_ledger.mjs
 * 의 applyMigration()/query() 로 Management API POST)가 `--apply`/`APPLY=1` env flag
 * honor-system 단독으로 prod COMMIT 하는 통로를 구조적으로 닫는다.
 * 러너는 **실제 COMMIT(applyMigration / await query(def)) 직전** 이 함수를 반드시
 * 호출하고 반환 `.apply` 가 true 일 때만 COMMIT 한다. prod 대상 + apply 요청 시 유효
 * GO-token 부재면 DbGateError throw (fail-closed) → 러너 abort → COMMIT 도달 불가.
 *
 * @param {object} o
 * @param {string}  o.ticketId        - 이 apply 의 티켓
 * @param {string}  o.targetRef       - 러너가 실제 write 하는 Supabase project ref
 * @param {boolean} o.applyRequested  - APPLY 요청 여부 (예: process.argv.includes('--apply'))
 * @param {string}  [o.migrationSql]  - 커밋될 SQL 문 전문(canonical, content-binding).
 *                                       미제공 시 migrationSqlFile 사용.
 * @param {string}  [o.migrationSqlFile] - 커밋될 SQL 을 담은 파일 경로(대안 바인딩).
 * @param {string}  [o.prodRef]       - prod ref (기본 FOOT_PROD_REF)
 * @param {string|null} [o.devRef]    - dev ref (기본 FOOT_DEV_REF; foot=null)
 * @param {string}  [o.gateDir]       - 토큰 디렉터리
 * @param {string}  [o.pubKeyPath]    - pubkey PEM
 * @param {number}  [o.now]           - 현재시각 ms (테스트 주입)
 * @param {string|null} [o.evidenceLog] - 주면 evidence jsonl append
 * @returns {{ok:true, apply:boolean, lane:'dry-run'|'dev'|'prod', gated:boolean,
 *            targetRef:string, gate?:object}}
 *          apply=true 일 때만 러너가 COMMIT 해도 된다.
 */
export function assertApplyGateForRunner(o) {
  const {
    ticketId,
    targetRef,
    applyRequested,
    migrationSql,
    migrationSqlFile,
    prodRef = FOOT_PROD_REF,
    devRef = FOOT_DEV_REF,
    gateDir = DBGATE_DIR,
    pubKeyPath = DEFAULT_PUBKEY_PATH,
    now = Date.now(),
    evidenceLog = null,
  } = o || {};

  if (!ticketId) throw new DbGateError('bad_args', 'ticketId 필수');
  if (!targetRef) throw new DbGateError('bad_args', 'targetRef(러너 write 대상 ref) 필수');

  const resolveSql = () => {
    if (typeof migrationSql === 'string' && migrationSql.length) return migrationSql;
    if (migrationSqlFile) return fs.readFileSync(migrationSqlFile, 'utf8');
    return null;
  };

  const emit = (rec) => {
    if (!evidenceLog) return;
    try {
      fs.mkdirSync(path.dirname(evidenceLog), { recursive: true });
      fs.appendFileSync(
        evidenceLog,
        JSON.stringify({ guard: 'assertApplyGateForRunner', schema_version: 1, ...rec }) + '\n',
      );
    } catch { /* evidence append 실패는 게이트 판정에 영향 없음 */ }
  };

  // ── dry-run(APPLY 미요청) → COMMIT 불가 신호. lane 판정만, GO-token 불요. ──
  if (!applyRequested) {
    emit({ ticket_id: ticketId, target_ref: targetRef, lane: 'dry-run', apply: false, gated: false });
    return { ok: true, apply: false, lane: 'dry-run', gated: false, targetRef };
  }

  // ── lane 해석 (fail-closed: 미지 ref = prod 아님 간주 금지) ────────────────
  let lane;
  if (targetRef === prodRef) lane = 'prod';
  else if (devRef && targetRef === devRef) lane = 'dev';
  else {
    throw new DbGateError(
      'unknown_ref',
      `targetRef=${targetRef} 가 env matrix pin(prod=${prodRef}` +
        `${devRef ? `/dev=${devRef}` : ' · dev 부재(단일 prod DB)'}) 어디에도 없음 → fail-closed abort.`,
      { targetRef, prodRef, devRef },
    );
  }

  // ── dev lane → GO-token 면제(dev 대상). 단 evidence 로깅(guard ④ 패리티). ──
  //   foot 은 dev DB 미생성(devRef=null) → 이 분기는 실질 도달 불가(unknown_ref 로 abort).
  //   포팅 패리티 위해 로직은 보존(dev DB 생성 시 즉시 유효).
  if (lane === 'dev') {
    emit({ ticket_id: ticketId, target_ref: targetRef, lane, apply: true, gated: false });
    return { ok: true, apply: true, lane, gated: false, targetRef };
  }

  // ── prod lane → GO-token 필수(A∧C). 부재/무효/불일치/만료 → throw(abort). ──
  const sql = resolveSql();
  if (typeof sql !== 'string' || !sql.length) {
    throw new DbGateError(
      'bad_args',
      'prod apply content-binding 을 위해 migrationSql 또는 migrationSqlFile(커밋될 SQL 전문) 필수. ' +
        'ad-hoc 러너는 COMMIT 될 SQL 문 전문을 canonical 문자열/파일로 바인딩해야 함.',
    );
  }
  const gate = assertDbGateGo({
    ticketId,
    migrationSql: sql,
    prodRef,
    gateDir,
    pubKeyPath,
    now,
  });
  emit({
    ticket_id: ticketId, target_ref: targetRef, lane, apply: true, gated: true,
    go_issued_at: gate.issuedAt, sql_sha256: gate.migrationSha256, key_id: gate.keyId,
  });
  return {
    ok: true, apply: true, lane, gated: true, targetRef, gate,
    // ★ EXEC-OBS(T-20260715 G6): 러너는 COMMIT 성공 직후 이 클로저를 호출 → bus deploy_exec_done 발화.
    //   ad-hoc DML 러너 lane = 정식 마이그 무접점 → mig_version:null · ledger_registered:null.
    //   (dry-run/dev lane 은 애초 이 prod-grant 경로에 도달 안 함 → 발화 없음.)
    emitDeployExecDone: (extra = {}) => emitDeployExecDone({
      ticket: ticketId,
      repo: extra.repo ?? path.basename(REPO_ROOT),
      targetRef,
      sqlSha256: gate.migrationSha256,
      migVersion: null,
      ledgerRegistered: null,
      applier: extra.applier,
      lane: 'prod',
      status: 'applied',
      dryRun: false,
      from: extra.from ?? 'apply_gate_runner',
      busPath: extra.busPath,
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ★ EXEC-OBS — DEPLOY-EXEC 관측성 (T-20260715-meta-DEPLOY-EXEC-BUS-LEDGER-GATE)
//   deploy_flow.md v3.8 §2-A MIG-GATE G6 (EXEC-OBS v1.0). db_apply_guard.sh(⑥) 와
//   ad-hoc DML 러너(assertApplyGateForRunner post-COMMIT) 공용 bus 발화 chokepoint.
//   ★ 발화 조건 = lane==='prod' && status==='applied' && !dryRun 뿐. dry-run·dev
//     lane·비-applied = no-op(skipped). append 실패는 throw 하지 않는다(호출부 apply/
//     COMMIT 는 기수행 — exit 오염 금지) → {emitted:false,error} 반환.
// ════════════════════════════════════════════════════════════════════════════
export function deployBusPath() {
  // SSOT 절대경로 고정 — bare/cwd 상대 append 금지(T-20260712-infra-BUS-WRITEPATH-ABSOLUTE-HARDEN).
  //   os 모듈 비의존(포크마다 import 상이) → process.env.HOME 로 홈 해석.
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, 'claude-sync', 'memory', '_handoff', 'bus.jsonl');
}

export function emitDeployExecDone(o) {
  const {
    ticket,
    repo = null,
    targetRef = null,
    sqlSha256 = null,
    migVersion = null,
    ledgerRegistered = null,
    applier = process.env.DEPLOY_EXEC_APPLIER || process.env.APPLIER || process.env.USER || null,
    lane,
    status,
    dryRun = false,
    from = 'db_apply_guard',
    busPath = deployBusPath(),
    ts = new Date().toISOString(),
  } = o || {};

  // ── 발화 게이트: prod+applied+non-dry-run 만. 그 외 = no-op. ──────────────────
  if (dryRun || lane !== 'prod' || status !== 'applied') {
    return {
      emitted: false,
      skipped: true,
      reason: `no-op: lane=${lane} status=${status} dry_run=${dryRun} (prod+applied+non-dry-run 아님)`,
      busPath,
    };
  }
  if (!ticket) return { emitted: false, error: 'ticket 필수', busPath };

  const record = {
    ts,
    from,
    type: 'deploy_exec_done',
    ticket,
    repo,
    target_ref: targetRef,
    sql_sha256: sqlSha256,
    mig_version: migVersion,
    applier,
    ledger_registered:
      ledgerRegistered === true || ledgerRegistered === false ? ledgerRegistered : null,
  };
  try {
    fs.mkdirSync(path.dirname(busPath), { recursive: true });
    fs.appendFileSync(busPath, JSON.stringify(record) + '\n');
    return { emitted: true, record, busPath };
  } catch (e) {
    // append 실패 = 게이트/apply 판정에 영향 없음(호출부가 WARN 처리). throw 금지.
    return { emitted: false, error: e.message, record, busPath };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
//   node scripts/apply_gate_lib.mjs sha256 <sql>
//   node scripts/apply_gate_lib.mjs verify <ticketId> <sql> [--prod <ref>]
//   node scripts/apply_gate_lib.mjs verify-json <ticketId> <sql> [--prod <ref>]
//     → 성공 시 gate JSON 만 stdout(기계 파싱용; guard evidence 필드 추출). 실패 시 exit 1.
//   node scripts/apply_gate_lib.mjs runner-gate <ticketId> <sql> --ref <ref> [--apply]
//     → DML 러너 chokepoint 리허설. apply=true 이고 prod 면 GO-token 검증(부재=exit1).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const resolvePaths = () => {
    const ticketId = rest[0];
    const upPath = rest.find((a, i) => i > 0 && !a.startsWith('--'));
    const prodIdx = rest.indexOf('--prod');
    const prodRef = prodIdx >= 0 ? rest[prodIdx + 1] : FOOT_PROD_REF;
    return { ticketId, upPath, prodRef };
  };
  if (cmd === 'sha256') {
    const p = rest.find((a) => !a.startsWith('--'));
    if (!p) { console.error('usage: node scripts/apply_gate_lib.mjs sha256 <sql>'); process.exit(64); }
    console.log(migrationSha256(fs.readFileSync(p, 'utf8')));
    process.exit(0);
  } else if (cmd === 'verify' || cmd === 'verify-json') {
    const { ticketId, upPath, prodRef } = resolvePaths();
    if (!ticketId || !upPath) {
      console.error(`usage: node scripts/apply_gate_lib.mjs ${cmd} <ticketId> <sql> [--prod <ref>]`);
      process.exit(64);
    }
    const jsonOnly = cmd === 'verify-json';
    if (!jsonOnly) console.log(APPLY_GATE_BANNER);
    try {
      const gate = assertDbGateGo({ ticketId, migrationSql: fs.readFileSync(upPath, 'utf8'), prodRef });
      if (jsonOnly) console.log(JSON.stringify(gate));
      else console.log('DB-GATE GO ✔', JSON.stringify(gate, null, 2));
      process.exit(0);
    } catch (e) {
      // 실패 사유는 stderr(기계 파싱용 code 포함). qa_fail_reason 어휘와 정합.
      console.error(`DB-GATE GO 거부 [${e.code}]: ${e.message}`);
      process.exit(1);
    }
  } else if (cmd === 'runner-gate') {
    const ticketId = rest[0];
    const sqlPath = rest.find((a, i) => i > 0 && !a.startsWith('--'));
    const refIdx = rest.indexOf('--ref');
    const targetRef = refIdx >= 0 ? rest[refIdx + 1] : FOOT_PROD_REF;
    const applyRequested = rest.includes('--apply');
    if (!ticketId || !sqlPath) {
      console.error('usage: node scripts/apply_gate_lib.mjs runner-gate <ticketId> <sql> --ref <ref> [--apply]');
      process.exit(64);
    }
    console.log(APPLY_GATE_BANNER);
    try {
      const r = assertApplyGateForRunner({
        ticketId, targetRef, applyRequested, migrationSqlFile: sqlPath,
      });
      console.log('RUNNER-GATE →', JSON.stringify(r, null, 2));
      console.log(r.apply ? '[APPLY 허용]' : '[APPLY 불가 — dry-run/COMMIT 금지]');
      process.exit(0);
    } catch (e) {
      console.error(`RUNNER-GATE 거부 [${e.code}]: ${e.message}`);
      process.exit(1);
    }
  } else if (cmd === 'emit-deploy-exec-done') {
    // bash guard(db_apply_guard.sh ⑥) 가 prod apply 성공 후 호출하는 bus append entrypoint.
    const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
    const norm = (v) => (v === undefined || v === 'null' || v === '') ? null : v;
    const ledgerRaw = norm(flag('--ledger'));
    const r = emitDeployExecDone({
      ticket: norm(flag('--ticket')),
      repo: norm(flag('--repo')),
      targetRef: norm(flag('--target-ref')),
      sqlSha256: norm(flag('--sql-sha256')),
      migVersion: norm(flag('--mig-version')),
      ledgerRegistered: ledgerRaw === 'true' ? true : ledgerRaw === 'false' ? false : null,
      applier: norm(flag('--applier')),
      lane: norm(flag('--lane')),
      status: norm(flag('--status')),
      dryRun: rest.includes('--dry-run'),
      from: norm(flag('--from')) || 'db_apply_guard',
      busPath: norm(flag('--bus-path')) || undefined,
    });
    console.log(JSON.stringify(r));
    // write error(append 실패)만 non-zero. emitted/skipped 는 0 → guard 가 bus_emit ok 로 기록.
    process.exit(r.emitted || r.skipped ? 0 : 1);
  } else if (cmd === 'emit-selftest') {
    // DB-free 실측: prod+applied 만 발화 / dry-run·dev·비-applied 미발화 + 절대경로 SSOT 검증.
    const tmp = rest.find((a) => !a.startsWith('--')) ||
      path.join(process.env.TMPDIR || '/tmp', `busemit-selftest-${process.pid}.jsonl`);
    try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
    const base = { ticket: 'T-SELFTEST', repo: 'selftest-repo', targetRef: 'selftestref',
      sqlSha256: 'deadbeef', applier: 'selftest', busPath: tmp };
    const cases = [
      ['prod+applied(mig)',    { ...base, lane: 'prod', status: 'applied', migVersion: '20260715120000', ledgerRegistered: true }, true],
      ['prod+applied(no-mig)', { ...base, lane: 'prod', status: 'applied' }, true],
      ['dry-run',              { ...base, lane: 'prod', status: 'applied', dryRun: true }, false],
      ['dev lane',             { ...base, lane: 'dev',  status: 'applied' }, false],
      ['prod+apply_failed',    { ...base, lane: 'prod', status: 'apply_failed' }, false],
    ];
    let pass = true;
    for (const [name, o, wantEmit] of cases) {
      const rr = emitDeployExecDone(o);
      const ok = (!!rr.emitted === wantEmit);
      if (!ok) pass = false;
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}: emitted=${!!rr.emitted} want=${wantEmit}${rr.reason ? ' (' + rr.reason + ')' : ''}`);
    }
    const lines = fs.existsSync(tmp) ? fs.readFileSync(tmp, 'utf8').trim().split('\n').filter(Boolean) : [];
    const lineOk = lines.length === 2; // 2 prod+applied 케이스만 기록
    if (!lineOk) pass = false;
    console.log(`  [${lineOk ? 'PASS' : 'FAIL'}] bus lines written=${lines.length} want=2`);
    let schemaOk = true;
    const expectKeys = JSON.stringify(['ts', 'from', 'type', 'ticket', 'repo', 'target_ref', 'sql_sha256', 'mig_version', 'applier', 'ledger_registered']);
    for (const l of lines) {
      const j = JSON.parse(l);
      if (j.type !== 'deploy_exec_done' || j.from !== 'db_apply_guard') schemaOk = false;
      if (JSON.stringify(Object.keys(j)) !== expectKeys) schemaOk = false;
    }
    if (!schemaOk) pass = false;
    console.log(`  [${schemaOk ? 'PASS' : 'FAIL'}] emitted record schema (keys+type+from)`);
    const bp = deployBusPath();
    const absOk = path.isAbsolute(bp) && bp.endsWith('claude-sync/memory/_handoff/bus.jsonl');
    if (!absOk) pass = false;
    console.log(`  [${absOk ? 'PASS' : 'FAIL'}] deployBusPath absolute SSOT = ${bp}`);
    try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
    console.log(pass ? 'EMIT-SELFTEST: PASS' : 'EMIT-SELFTEST: FAIL');
    process.exit(pass ? 0 : 1);
  } else {
    console.error('usage: node scripts/apply_gate_lib.mjs <sha256|verify|verify-json|runner-gate|emit-deploy-exec-done|emit-selftest> ...');
    process.exit(64);
  }
}
