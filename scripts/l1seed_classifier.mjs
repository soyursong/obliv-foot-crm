// ============================================================================
// l1seed_classifier.mjs — "low-ceremony GO-token class"(L1-seed) 적격 classifier
// ----------------------------------------------------------------------------
// 티켓 : T-20260809-meta-DBGATE-ADVISORY-GOTOKEN-FASTPATH (P2, impl_lane=dev-meta, AC-2)
//        DA  : DA-20260809-META-DBGATE-ADVISORY-GOTOKEN-FASTPATH (AC-1, P1~P8 CONJUNCTIVE)
//        gate: supervisor 2026-08-15 gate-lane 입력 (N_bound=100 + manifest 8-field 계약)
//        부모: T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (6-CRM guard-lane 계약)
//
//   ★ canonical class 명칭 = "low-ceremony GO-token class"(별칭 L1-seed).
//     'advisory' 어휘는 코드/식별자/문자열 어디에도 사용하지 않는다(planner 개명 판정
//     2026-08-15 · DA §2 language-drift 경고: 'advisory' = "GO-token=선택적" 오독 vector).
//
// ── 이 파일이 하는 일 / 하지 않는 일 (경계 = DA §1·§6, 불변식 (a)(b)(c)) ─────────
//   하는 일   = guard-측에서 "이 change 가 저-의례 GO-token 발행 자격이 있나"를 기계판정.
//               manifest 의 declared_* 는 dev 의 **주장(declare)**일 뿐 — guard 가 apply
//               SQL 실측으로 **VERIFY**한다(declare ≠ authority). cross_crm_auth_identity_
//               standard "서버 VERIFY·클라 주장 불신" 과 동형 doctrine.
//   하지 않는 일 = apply 를 직접 열지 않는다. 반환 eligible=true 는 supervisor 가 저-의례
//               발행 의례(eligible 출력 + `--dry-run` PASS → 기존과 **완전 동일한** ed25519
//               GO-token 발행)를 밟을 **자격 신호**일 뿐이다.
//
//   불변식 (a) [token 선행-의무 면제 0] : 본 파일은 apply_gate_lib.mjs 의 verify leg
//     (assertDbGateGo / assertApplyGateForRunner)을 **일절 건드리지 않는다**. 물리
//     GO-token 발행·검증·TTL·C20 evidence 계약은 byte-for-byte 불변. fast-path =
//     GO-token 취득 **의례(DDL-diff·comp-gate·CEO 파괴게이트)** 감축이지 GO-token skip 아님.
//   불변식 (b) [self-authorize 금지] : 판정 술어는 이 guard-측 코드가 평가한다. 출력은
//     발행 **자격 신호**일 뿐 dev 러너가 자기 등급을 결정해 apply 로 직행하는 경로 없음.
//   불변식 (c) [fail-closed] : 비적격·모호·평가불가 = eligible:false → full MIG-GATE **강등**
//     (에러/차단 아님 — 경로 전환). positive-gated: 전건 명시적 적격일 때만 eligible.
//
//   CRM-agnostic : 본 파일은 env pin(prod/dev ref)·도메인 심볼에 **무의존**. apply_gate_lib
//     에서 env-agnostic 심볼(migrationSha256/DbGateError/DBGATE_DIR)만 import → 6-CRM
//     **byte-identical**(부모 계약 인터페이스 보존, big-bang 금지·leg-by-leg 이식).
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationSha256, DbGateError, DBGATE_DIR } from './apply_gate_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── supervisor gate-lane 입력 (2026-08-15 확정) ──────────────────────────────
export const L1SEED_N_BOUND = 100; // P4: row_count ≤ 100 만 적격. 101+ = full MIG-GATE 강등.
export const L1SEED_DECLARED_CLASS = 'low_ceremony_go_token';

// P3 data_class 적격 정의역 (DA §3)
export const L1SEED_DATA_CLASS_ENUM = Object.freeze([
  'reference_code', 'lookup', 'preset', 'system_codes_overlay', 'non_PHI_config',
]);
// P7 target_table_class 적격 정의역 (supervisor 필드 #7)
export const L1SEED_TARGET_TABLE_CLASS_ENUM = Object.freeze([
  'reference', 'lookup', 'config_overlay',
]);
// P8 on_conflict_action 적격 정의역 (supervisor 필드 #8)
export const L1SEED_ON_CONFLICT_ENUM = Object.freeze([
  'do_nothing', 'natural_key_not_exists',
]);

// P6 방화벽 denylist (DA §3 P6 축 · supervisor 필드 #6) — 소문자 substring 매칭(fail-closed
//   측: 과잉매칭→full gate 는 안전, DA §5 under-fast-path ≫ over-fast-path). 'M3 stats key'
//   등 컬럼으로 못 박을 수 없는 축은 target_table_class(P7) enum·table denylist 로 이중 방어.
export const L1SEED_FIREWALL_DENYLIST = Object.freeze([
  'inflow_channel', 'ad_inflow_channel_code', 'referral_source',
  'created_by', 'registrant', 'registrar',
  'hira_score', 'hira_unit_value',
  'source_split', 'insurance_split',
  'consultant_id', 'counselor_id',
  'payments', 'service_charges', 'purchase_net',
]);
// P7 target-table denylist (재무원장·정산·계약자산·attribution) — 소문자 substring 매칭.
export const L1SEED_TABLE_DENYLIST = Object.freeze([
  'payments', 'service_charges', 'settlements', 'check_in_settlements',
  'settlement_line_items', 'package_payments', 'cband_payment_attempts',
  'closing_manual_payments', 'refunds',
]);

// P1 DDL 토큰 (노이즈 제거 후 스캔). 1건 검출 = 비적격(선언 0 무시).
const DDL_TOKEN_RE =
  /\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b|\bCOMMENT\s+ON\b|\b(POLICY|TRIGGER|FUNCTION|PROCEDURE|SEQUENCE|MATERIALIZED)\b/i;
// P2 파괴/변경 write (up.sql). 1건 검출 = 비적격.
const MUTATE_TOKEN_RE = /\b(UPDATE|DELETE|MERGE|UPSERT|REPLACE)\b/i;
// L0 dollar-quote 마커 — strip 前 raw 검출. 존재 자체가 비적격 신호(reference-seed 는
//   $$…$$/DO body 불요). dollar-quoted PL/pgSQL body 는 임의 DELETE/UPDATE/DDL/GRANT 실행
//   가능한데 stripSqlNoise 가 이를 문자열-리터럴처럼 통째 제거 → P1/P2 lexical 스캔이
//   파괴문을 못 봄(fail-open H1/H1b RC). 따라서 raw 단계에서 fail-closed. (FIX 2026-08-15)
const DOLLAR_QUOTE_RE = /\$[A-Za-z0-9_]*\$/;

// ── SQL 노이즈 제거 : 주석·문자열 리터럴 제거 후 구조만 lexical 스캔 ──────────────
//   문자열 리터럴 내부의 우연한 키워드/괄호/콤마가 술어 오판을 내지 않도록 선(先)제거.
//   DDL 은 문자열 안에 있어도 실행 안 되므로 제거는 안전(정오탐 감소).
//   ★ dollar-quoted 영역은 여기서 " '' " 로 치환(문 분할 시 내부 세미콜론 오분할 방지)하되,
//     dollar-quote 는 실행 가능한 PL/pgSQL body 를 담을 수 있어 "치환=은닉"이 곧 fail-open
//     벡터다(H1). 따라서 dollar-quote 의 존재 자체는 classify 의 L0 체크가 raw 단계에서
//     fail-closed 로 걸러낸다 — 이 strip 은 어디까지나 그 뒤 lexical 스캔의 견고성을 위한 것.
export function stripSqlNoise(sql) {
  let s = String(sql);
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');            // 블록 주석
  s = s.replace(/--[^\n]*/g, ' ');                     // 라인 주석
  s = s.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " '' "); // dollar-quoted (L0 가 별도 거부)
  s = s.replace(/'(?:''|[^'])*'/g, " '' ");            // 단일인용 문자열 → 빈 리터럴
  return s;
}

// ── 문(statement) allowlist (P2) : 세미콜론 분할 후 각 문이 VALUES-INSERT 형태인지 ──
//   기존 P2 는 denylist(UPDATE/DELETE/MERGE 부재)여서, 파괴문이 DO 블록/dollar body 안에
//   은닉되면(H1/H1b) 스캔 대상에서 사라져 통과했다. allowlist 로 전환 = "문 전량이
//   VALUES-INSERT(±ON CONFLICT DO NOTHING)임"을 positive 로 요구. INSERT 외 문(DO·SELECT·
//   SET·CALL·UPDATE·DELETE …) 1건이라도 존재하면 fail-closed. (FIX 2026-08-15)
export function statementShapeAllowlist(code) {
  const stmts = String(code).split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  if (stmts.length === 0) return { ok: false, reason: '실행 문 없음(fail-closed).' };
  for (const st of stmts) {
    if (!/^INSERT\s+INTO\b/i.test(st)) {
      const head = st.slice(0, 28).replace(/\s+/g, ' ');
      return { ok: false, reason: `비-INSERT 문 검출: "${head}…" (allowlist: VALUES-INSERT 문만 허용 · DO/SELECT/SET/CALL 등 = 비적격).` };
    }
    if (!/\bVALUES\b/i.test(st)) {
      return { ok: false, reason: 'INSERT 에 VALUES 절 부재 (INSERT...SELECT/파이프형 = 비적격).' };
    }
    if (/\bSELECT\b/i.test(st)) {
      return { ok: false, reason: 'INSERT(VALUES) 문에 SELECT 검출 (서브쿼리/INSERT...SELECT = 비적격).' };
    }
  }
  return { ok: true, stmtCount: stmts.length };
}

// ── VALUES 리터럴 튜플 count + 리터럴-원소 강제 (P4 실측) ─────────────────────
//   noise-strip 된 코드에서 각 VALUES 뒤 top-level 괄호 그룹 수를 센다.
//   INSERT...SELECT/파이프형 = VALUES 부재 → {ok:false} → P4 기계판정 불가 → 비적격.
//   ★ literalOnly : 튜플 내부(depth≥1)에 중첩 괄호가 나타나면 = 스칼라 서브쿼리
//     `(SELECT …)` 또는 함수호출 `now()` 등 비-리터럴 원소 → false. DA P4 "VALUES
//     **리터럴** 튜플" 취지·phi_write=false 전제를 defeat 하는 fail-open(H2) 차단.
//     리터럴/캐스트(''::text)/상수/NULL 은 중첩 괄호가 없으므로 통과. (FIX 2026-08-15)
export function countValuesTuples(code) {
  const re = /\bVALUES\b/gi;
  let total = 0;
  let literalOnly = true;
  let m;
  while ((m = re.exec(code)) !== null) {
    let depth = 0;
    let counted = 0;
    let sawTuple = false;
    for (let i = m.index + m[0].length; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') {
        if (depth === 0) { counted++; sawTuple = true; }
        else { literalOnly = false; }                // 튜플 내부 중첩 괄호 = 서브쿼리/함수호출
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth < 0) return { count: 0, ok: false, literalOnly: false }; // 괄호 불균형 → 판정불가
      } else if (depth === 0) {
        if (ch === ';') break;                       // 문 종료
        if (sawTuple && /[A-Za-z]/.test(ch)) break;  // 튜플 뒤 top-level 단어 = ON/RETURNING → 목록 끝
      }
    }
    if (!sawTuple) return { count: 0, ok: false, literalOnly };
    total += counted;
  }
  if (total === 0) return { count: 0, ok: false, literalOnly };
  return { count: total, ok: true, literalOnly };
}

// ── INSERT 문 target 테이블 추출 (under-enumeration 가드) ─────────────────────
export function insertTargetTables(code) {
  const re = /\bINSERT\s+INTO\s+("?[A-Za-z0-9_.]+"?)/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(code)) !== null) {
    let t = m[1].replace(/"/g, '').toLowerCase();
    if (t.includes('.')) t = t.split('.').pop(); // schema 한정 제거
    out.add(t);
  }
  return out;
}

const lc = (v) => String(v == null ? '' : v).toLowerCase();
const denyHit = (token, list) => list.find((d) => lc(token).includes(d));

/**
 * L1-seed(low-ceremony GO-token) 적격 classifier.
 * declared(manifest) ≠ authority — guard 가 apply SQL 실측으로 VERIFY.
 *
 * @param {object} o
 * @param {string}  o.ticketId       - 이 apply 의 티켓 (manifest.ticket_id 대조)
 * @param {string}  o.migrationSql   - 적용될 apply SQL 전문 (sha256/lexical VERIFY 대상)
 * @param {string}  [o.manifestPath] - 기본 db-gate/{ticketId}_L1SEED_manifest.json
 * @param {string}  [o.gateDir]      - manifest/down-script 디렉토리 (기본 DBGATE_DIR)
 * @param {string}  [o.repoRoot]     - 상대경로 표기용 (기본 REPO_ROOT)
 * @returns {{schema_version:1, classifier, ticket_id, eligible:boolean,
 *            disposition:'eligible_low_ceremony_go_token'|'full_mig_gate',
 *            downgrade_reason:string|null, manifest_sha256:string|null,
 *            manifest_path:string, checks:Array<{id,pass,reason?,note?}>}}
 *          eligible=true 는 supervisor 저-의례 발행 자격 신호일 뿐(불변식 b).
 */
export function classifyLowCeremonyGoToken(o) {
  const {
    ticketId,
    migrationSql,
    manifestPath,
    gateDir = DBGATE_DIR,
    repoRoot = REPO_ROOT,
  } = o || {};

  if (!ticketId) throw new DbGateError('bad_args', 'ticketId 필수');
  if (typeof migrationSql !== 'string' || !migrationSql.length) {
    throw new DbGateError('bad_args', 'migrationSql(적용 SQL 전문) 필수');
  }

  const checks = [];
  const fail = (id, reason) => checks.push({ id, pass: false, reason });
  const ok = (id, note) => checks.push({ id, pass: true, note: note || null });

  const mPath = manifestPath || path.join(gateDir, `${ticketId}_L1SEED_manifest.json`);
  const rel = (p) => { try { return path.relative(repoRoot, p); } catch { return p; } };

  const result = (extra = {}) => {
    const eligible = checks.length > 0 && checks.every((c) => c.pass);
    const firstFail = checks.find((c) => !c.pass);
    return {
      schema_version: 1,
      classifier: 'low_ceremony_go_token',
      ticket_id: ticketId,
      eligible,
      disposition: eligible ? 'eligible_low_ceremony_go_token' : 'full_mig_gate',
      downgrade_reason: eligible ? null : (firstFail ? `${firstFail.id}: ${firstFail.reason}` : 'no_checks_run'),
      manifest_path: mPath,
      manifest_sha256: null,
      checks,
      ...extra,
    };
  };

  // ── envelope: manifest 실재/파싱 (부재·파싱불능 = 저-의례 요청 아님 → full gate) ──
  if (!fs.existsSync(mPath)) {
    fail('manifest_present', `L1SEED manifest 부재: ${rel(mPath)} — 저-의례 요청 아님. full MIG-GATE.`);
    return result();
  }
  let manifest, manifestSha;
  try {
    const raw = fs.readFileSync(mPath);
    manifestSha = crypto.createHash('sha256').update(raw).digest('hex');
    manifest = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    fail('manifest_parse', `manifest JSON 파싱 불능(fail-closed): ${e.message}`);
    return result();
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest_parse', 'manifest 최상위가 object 아님(fail-closed).');
    return result({ manifest_sha256: manifestSha });
  }
  ok('manifest_present', rel(mPath));

  const actualSha = migrationSha256(migrationSql);

  // ── envelope 필드계약 (positive-gate) ────────────────────────────────────────
  manifest.schema_version === 1
    ? ok('env.schema_version')
    : fail('env.schema_version', `schema_version != 1 (got ${JSON.stringify(manifest.schema_version)})`);
  manifest.ticket_id === ticketId
    ? ok('env.ticket_id')
    : fail('env.ticket_id', `manifest.ticket_id(${JSON.stringify(manifest.ticket_id)}) != guard 인자(${ticketId})`);
  manifest.sql_sha256 === actualSha
    ? ok('env.sql_sha256', 'manifest↔SQL content-binding OK')
    : fail('env.sql_sha256', `manifest.sql_sha256 != 실측 migrationSha256 (declared=${manifest.sql_sha256} actual=${actualSha})`);
  manifest.declared_class === L1SEED_DECLARED_CLASS
    ? ok('env.declared_class')
    : fail('env.declared_class', `declared_class != "${L1SEED_DECLARED_CLASS}" (got ${JSON.stringify(manifest.declared_class)})`);
  (typeof manifest.declared_by === 'string' && manifest.declared_by.length)
    ? ok('env.declared_by', manifest.declared_by)
    : fail('env.declared_by', 'declared_by(발행 dev agent id) 부재/비문자열.');
  manifest.phi_write === false
    ? ok('env.phi_write', 'phi_write:false 명시')
    : fail('env.phi_write', `phi_write 는 boolean false 명시 필수(positive-gate) — got ${JSON.stringify(manifest.phi_write)}`);

  // ── L0 : dollar-quote 부재 (strip 前 raw 검출 — DO/dollar body 파괴문 은닉 차단) ──
  //   reference-seed 는 $$…$$/DO body 를 쓰지 않는다. dollar-quote 존재 = PL/pgSQL body
  //   (임의 DELETE/UPDATE/DDL/GRANT) 은닉 벡터 → fail-closed (H1). P2 allowlist·strip 앞단.
  {
    if (DOLLAR_QUOTE_RE.test(migrationSql)) {
      fail('L0.dollar_quote', 'dollar-quoted 영역($tag$…$tag$) 검출 — reference-seed 불요·PL/pgSQL body(DELETE/UPDATE/DDL) 은닉 벡터 = 비적격.');
    } else {
      ok('L0.dollar_quote', 'dollar-quote 부재');
    }
  }

  // ── lexical 준비 ─────────────────────────────────────────────────────────────
  const code = stripSqlNoise(migrationSql);
  const targetTables = insertTargetTables(code);

  // ── P1 : ddl_count == 0 (SQL lexical DDL 토큰 0) ────────────────────────────
  {
    const declOk = manifest.ddl_count === 0;
    const lexHit = DDL_TOKEN_RE.exec(code);
    if (!declOk) fail('P1.ddl_count', `declared ddl_count != 0 (got ${JSON.stringify(manifest.ddl_count)})`);
    else if (lexHit) fail('P1.ddl_count', `SQL 에 DDL 토큰 검출: "${lexHit[0]}" (선언 0 무시·비적격)`);
    else ok('P1.ddl_count', 'DDL 0');
  }

  // ── P2 : write_ops == ["INSERT"] + 문 allowlist (VALUES-INSERT 만) ──────────
  //   denylist(파괴토큰 부재) → allowlist(문 전량이 VALUES-INSERT) 전환 (H1/H1b/H2 fail-open
  //   봉합). DO 블록·서브쿼리·SELECT·SET 등 INSERT 외 문 1건이라도 존재 = fail-closed.
  {
    const wo = manifest.write_ops;
    const declOk = Array.isArray(wo) && wo.length === 1 && wo[0] === 'INSERT';
    const mutHit = MUTATE_TOKEN_RE.exec(code);
    const hasInsert = /\bINSERT\s+INTO\b/i.test(code);
    const shape = statementShapeAllowlist(code);
    if (!declOk) fail('P2.write_ops', `declared write_ops != ["INSERT"] (got ${JSON.stringify(wo)})`);
    else if (!hasInsert) fail('P2.write_ops', 'SQL 에 INSERT INTO 문 부재.');
    else if (!shape.ok) fail('P2.write_ops', shape.reason);
    else if (mutHit) fail('P2.write_ops', `파괴/변경 write 검출: "${mutHit[0]}" (UPDATE/DELETE/MERGE = 비적격).`);
    else ok('P2.write_ops', `INSERT(VALUES) allowlist (${shape.stmtCount} stmt)`);
  }

  // ── P3 : data_class ∈ enum AND phi_write=false ─────────────────────────────
  {
    const dc = manifest.data_class;
    if (!L1SEED_DATA_CLASS_ENUM.includes(dc)) {
      fail('P3.data_class', `data_class 미지 enum: ${JSON.stringify(dc)} (적격: ${L1SEED_DATA_CLASS_ENUM.join('|')})`);
    } else if (manifest.phi_write !== false) {
      fail('P3.data_class', 'phi_write 가 false 아님 → P3 AND 조건 미충족.');
    } else ok('P3.data_class', dc);
  }

  // ── P4 : row_count ∈ [1, N_bound] AND VALUES 튜플 실측 일치 ─────────────────
  {
    const rc = manifest.row_count;
    if (!Number.isInteger(rc) || rc < 1 || rc > L1SEED_N_BOUND) {
      fail('P4.row_count', `declared row_count 범위 밖: ${JSON.stringify(rc)} (적격 1..${L1SEED_N_BOUND})`);
    } else {
      const t = countValuesTuples(code);
      if (!t.ok) fail('P4.row_count', 'VALUES 튜플 count 불능(INSERT...SELECT/파이프형/괄호불균형 의심) → 기계판정 불가.');
      else if (!t.literalOnly) fail('P4.row_count', 'VALUES 튜플에 비-리터럴 원소(스칼라 서브쿼리/함수호출·중첩 괄호) 검출 = 비적격(리터럴/캐스트/상수만 허용).');
      else if (t.count !== rc) fail('P4.row_count', `declared row_count=${rc} ≠ VALUES 실측=${t.count}.`);
      else ok('P4.row_count', `${t.count} ≤ ${L1SEED_N_BOUND}`);
    }
  }

  // ── P5 : reversible (down_script 실재 + sha 대조 + scoped-DELETE-only lexical) ──
  {
    if (manifest.down_script_present !== true) {
      fail('P5.reversible', `down_script_present != true (got ${JSON.stringify(manifest.down_script_present)})`);
    } else if (typeof manifest.down_script_path !== 'string' || !manifest.down_script_path.length) {
      fail('P5.reversible', 'down_script_path 부재 — down-script 파일 지정 필수.');
    } else {
      const dPath = path.isAbsolute(manifest.down_script_path)
        ? manifest.down_script_path
        : path.join(gateDir, manifest.down_script_path);
      const dPathAlt = path.join(repoRoot, manifest.down_script_path);
      const realDown = fs.existsSync(dPath) ? dPath : (fs.existsSync(dPathAlt) ? dPathAlt : null);
      if (!realDown) {
        fail('P5.reversible', `down_script 파일 부재: ${manifest.down_script_path}`);
      } else {
        const downRaw = fs.readFileSync(realDown, 'utf8');
        const downSha = crypto.createHash('sha256').update(downRaw, 'utf8').digest('hex');
        if (manifest.down_script_sha256 !== downSha) {
          fail('P5.reversible', `down_script_sha256 불일치 (declared=${manifest.down_script_sha256} actual=${downSha})`);
        } else {
          const dcode = stripSqlNoise(downRaw);
          const ddl = DDL_TOKEN_RE.exec(dcode);
          const hasTruncate = /\bTRUNCATE\b/i.test(dcode);
          const hasUpdate = /\b(UPDATE|MERGE|INSERT)\b/i.test(dcode);
          const deletes = dcode.match(/\bDELETE\b[\s\S]*?(?=;|$)/gi) || [];
          const hasDelete = /\bDELETE\b/i.test(dcode);
          const unscoped = deletes.some((d) => !/\bWHERE\b/i.test(d));
          if (ddl) fail('P5.reversible', `down-script 에 DDL 토큰 검출: "${ddl[0]}" (scoped DELETE 만 허용).`);
          else if (hasTruncate) fail('P5.reversible', 'down-script 에 TRUNCATE 검출 (비적격).');
          else if (hasUpdate) fail('P5.reversible', 'down-script 에 UPDATE/MERGE/INSERT 검출 (scoped DELETE 만 허용).');
          else if (!hasDelete) fail('P5.reversible', 'down-script 에 DELETE 문 부재 (원복 불가).');
          else if (unscoped) fail('P5.reversible', 'down-script 에 WHERE 없는 DELETE 검출 (전체삭제 위험·비적격).');
          else ok('P5.reversible', 'scoped DELETE down-script 검증');
        }
      }
    }
  }

  // ── P6 : firewall_touch=false (touched_columns 전수열거 + denylist 교집합 0) ──
  {
    const tc = manifest.touched_columns;
    if (!Array.isArray(tc) || tc.length === 0) {
      fail('P6.firewall', 'touched_columns 비어있음/미배열 (전수 열거 필수).');
    } else if (!tc.every((x) => typeof x === 'string' && x.includes('.'))) {
      fail('P6.firewall', 'touched_columns 원소는 "table.column" 형식 문자열이어야 함.');
    } else {
      const fwCol = tc.map((x) => denyHit(x, L1SEED_FIREWALL_DENYLIST)).find(Boolean);
      const fwTbl = [...targetTables].map((t) => denyHit(t, L1SEED_FIREWALL_DENYLIST)).find(Boolean);
      // under-enumeration: SQL 이 참조하는 INSERT target 이 touched 집합 밖이면 비적격
      const touchedTblSet = new Set(tc.map((x) => lc(x).split('.').slice(-2, -1)[0]));
      const declaredTblSet = new Set((Array.isArray(manifest.touched_tables) ? manifest.touched_tables : []).map(lc));
      const under = [...targetTables].find((t) => !touchedTblSet.has(t) && !declaredTblSet.has(t));
      if (fwCol) fail('P6.firewall', `touched_columns 가 방화벽 축 접촉: "${fwCol}".`);
      else if (fwTbl) fail('P6.firewall', `INSERT target 이 방화벽 축 테이블 접촉: "${fwTbl}".`);
      else if (under) fail('P6.firewall', `SQL 이 참조하는 테이블 "${under}" 이 touched 집합 밖 (과소열거 차단).`);
      else ok('P6.firewall', 'firewall_touch=false');
    }
  }

  // ── P7 : target_table_class ∈ enum + touched_tables + 재무/계약자산 배제 ──────
  {
    const ttc = manifest.target_table_class;
    const tt = manifest.touched_tables;
    if (!L1SEED_TARGET_TABLE_CLASS_ENUM.includes(ttc)) {
      fail('P7.target_table_class', `미지 enum: ${JSON.stringify(ttc)} (적격: ${L1SEED_TARGET_TABLE_CLASS_ENUM.join('|')})`);
    } else if (!Array.isArray(tt) || tt.length === 0) {
      fail('P7.target_table_class', 'touched_tables 부재/비어있음 (부속 필수).');
    } else {
      const denyTbl = tt.map((t) => denyHit(t, L1SEED_TABLE_DENYLIST)).find(Boolean);
      const denyTgt = [...targetTables].map((t) => denyHit(t, L1SEED_TABLE_DENYLIST)).find(Boolean);
      // SQL target 이 touched_tables 밖 = 비적격(과소열거)
      const ttSet = new Set(tt.map(lc));
      const under = [...targetTables].find((t) => !ttSet.has(t));
      if (denyTbl) fail('P7.target_table_class', `touched_tables 에 재무원장/계약자산 테이블 검출: "${denyTbl}".`);
      else if (denyTgt) fail('P7.target_table_class', `INSERT target 에 재무원장/계약자산 테이블 검출: "${denyTgt}".`);
      else if (under) fail('P7.target_table_class', `SQL INSERT target "${under}" 이 touched_tables 밖 (과소열거 차단).`);
      else ok('P7.target_table_class', ttc);
    }
  }

  // ── P8 : on_conflict_action (do_nothing → 전 INSERT ON CONFLICT DO NOTHING) ──
  {
    const oca = manifest.on_conflict_action;
    if (!L1SEED_ON_CONFLICT_ENUM.includes(oca)) {
      fail('P8.on_conflict', `미지 enum: ${JSON.stringify(oca)} (적격: ${L1SEED_ON_CONFLICT_ENUM.join('|')})`);
    } else if (/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b/i.test(code)) {
      fail('P8.on_conflict', 'ON CONFLICT DO UPDATE 검출 (기존행 mutation = 비적격).');
    } else if (oca === 'do_nothing') {
      const segs = code.split(/\bINSERT\s+INTO\b/i).slice(1);
      const allDoNothing = segs.length > 0 && segs.every((s) => /\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i.test(s));
      if (!allDoNothing) fail('P8.on_conflict', 'do_nothing 선언이나 일부 INSERT 에 ON CONFLICT DO NOTHING lexical 부재.');
      else ok('P8.on_conflict', 'do_nothing (전 INSERT ON CONFLICT DO NOTHING)');
    } else { // natural_key_not_exists
      if (!/\bWHERE\s+NOT\s+EXISTS\b/i.test(code)) {
        fail('P8.on_conflict', 'natural_key_not_exists 선언이나 WHERE NOT EXISTS 형태 부재.');
      } else {
        // 주의: WHERE NOT EXISTS 는 INSERT...SELECT 형태를 수반 → P2 가 이미 비적격 처리.
        //       술어 자체는 규격대로 검증(자의 완화 0). 최종 eligible 은 P2 AND 로 fail-closed.
        ok('P8.on_conflict', 'natural_key_not_exists (WHERE NOT EXISTS 실재 · P2 INSERT...SELECT 축과 AND)');
      }
    }
  }

  return result({ manifest_sha256: manifestSha });
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
//   node scripts/l1seed_classifier.mjs classify <ticketId> <sqlFile> [--manifest <path>]
//     → 판정 JSON stdout. exit 0 = eligible / 20 = 비적격(full-gate 강등) / 64 = usage.
//   node scripts/l1seed_classifier.mjs selftest
//     → DB-free 자가검증(적격 canonical 1 + fail-closed 다수). exit 0 = 전건 PASS.
// ════════════════════════════════════════════════════════════════════════════
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])));

if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'classify') {
    const ticketId = rest[0];
    const sqlFile = rest.find((a, i) => i > 0 && !a.startsWith('--'));
    const mIdx = rest.indexOf('--manifest');
    const manifestPath = mIdx >= 0 ? rest[mIdx + 1] : undefined;
    if (!ticketId || !sqlFile) {
      console.error('usage: node scripts/l1seed_classifier.mjs classify <ticketId> <sqlFile> [--manifest <path>]');
      process.exit(64);
    }
    let out;
    try {
      out = classifyLowCeremonyGoToken({
        ticketId, migrationSql: fs.readFileSync(sqlFile, 'utf8'), manifestPath,
      });
    } catch (e) {
      console.error(`classify 오류 [${e.code || 'error'}]: ${e.message}`);
      process.exit(1);
    }
    console.log(JSON.stringify(out, null, 2));
    if (out.eligible) {
      console.log('\n[ELIGIBLE] low-ceremony GO-token class 적격 — supervisor 저-의례 발행 자격 신호.');
      console.log('           ★ GO-token 선행-의무 불변(불변식 a): eligible + --dry-run PASS → 기존 동일 ed25519 GO-token 발행.');
      process.exit(0);
    }
    console.log(`\n[NOT ELIGIBLE → full MIG-GATE 강등] ${out.downgrade_reason}`);
    console.log('           (차단 아님 · 경로 전환 · fail-closed — 불변식 c)');
    process.exit(20);
  } else if (cmd === 'selftest') {
    process.exit(runSelftest() ? 0 : 1);
  } else {
    console.error('usage: node scripts/l1seed_classifier.mjs <classify|selftest> ...');
    process.exit(64);
  }
}

// ── DB-free 자가검증 (execution evidence · Q-gate) ───────────────────────────
function runSelftest() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'l1seed-selftest-'));
  const write = (name, content) => { const p = path.join(tmp, name); fs.writeFileSync(p, content); return p; };
  const TID = 'T-SELFTEST-L1SEED';

  // canonical 적격 up.sql (CALLCONSULT-PRESET-SEED 형: DDL0·INSERT 5행 VALUES·DO NOTHING·reference)
  const upEligible =
    "-- preset seed\n" +
    "INSERT INTO call_consult_presets (code, label) VALUES\n" +
    "  ('P1','상담 예약'), ('P2','부재중'), ('P3','재통화'), ('P4','거절'), ('P5','완료')\n" +
    "ON CONFLICT (code) DO NOTHING;\n";
  const downEligible =
    "DELETE FROM call_consult_presets WHERE code IN ('P1','P2','P3','P4','P5');\n";

  const upSqlPath = write('up_eligible.sql', upEligible);
  const downSqlPath = write('down_eligible.sql', downEligible);
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const baseManifest = {
    schema_version: 1,
    ticket_id: TID,
    sql_sha256: sha(upEligible),
    declared_class: 'low_ceremony_go_token',
    declared_by: 'dev-meta',
    phi_write: false,
    ddl_count: 0,
    write_ops: ['INSERT'],
    data_class: 'reference_code',
    row_count: 5,
    down_script_present: true,
    down_script_path: downSqlPath,
    down_script_sha256: sha(downEligible),
    touched_columns: ['call_consult_presets.code', 'call_consult_presets.label'],
    target_table_class: 'reference',
    touched_tables: ['call_consult_presets'],
    on_conflict_action: 'do_nothing',
  };

  const run = (manifestObj, sqlText) => {
    const mp = write(`m_${Math.abs(hashInt(JSON.stringify(manifestObj) + sqlText))}.json`, JSON.stringify(manifestObj));
    return classifyLowCeremonyGoToken({ ticketId: TID, migrationSql: sqlText, manifestPath: mp });
  };
  const withM = (over) => ({ ...baseManifest, ...over });

  const cases = [];
  // 1) canonical 적격
  cases.push(['canonical eligible', run(baseManifest, upEligible), true, null]);
  // 2) DDL 존재
  cases.push(['DDL(ALTER) 검출', run(withM({ sql_sha256: sha(upEligible + 'ALTER TABLE x ADD c int;') }),
    upEligible + 'ALTER TABLE x ADD c int;'), false, 'P1']);
  // 3) UPDATE 존재
  {
    const s = "UPDATE call_consult_presets SET label='x' WHERE code='P1';\n";
    cases.push(['UPDATE 검출', run(withM({ sql_sha256: sha(s), write_ops: ['UPDATE'] }), s), false, 'P2']);
  }
  // 4) INSERT...SELECT
  {
    const s = "INSERT INTO call_consult_presets (code,label) SELECT c,l FROM staging WHERE NOT EXISTS (SELECT 1 FROM call_consult_presets);\n";
    cases.push(['INSERT...SELECT', run(withM({ sql_sha256: sha(s), on_conflict_action: 'natural_key_not_exists' }), s), false, 'P2']);
  }
  // 5) row_count 불일치 (선언 5, 실측 3)
  {
    const s = "INSERT INTO call_consult_presets (code,label) VALUES ('A','a'),('B','b'),('C','c') ON CONFLICT (code) DO NOTHING;\n";
    cases.push(['row_count mismatch', run(withM({ sql_sha256: sha(s) }), s), false, 'P4']);
  }
  // 6) row_count > N_bound
  cases.push(['row_count > 100', run(withM({ row_count: 101 }), upEligible), false, 'P4']);
  // 7) 방화벽 축 접촉 (payments)
  cases.push(['firewall touch(payments)', run(withM({ touched_columns: ['payments.amount'] }), upEligible), false, 'P6']);
  // 8) 방화벽 컬럼 (created_by)
  cases.push(['firewall col(created_by)', run(withM({ touched_columns: ['call_consult_presets.created_by'] }), upEligible), false, 'P6']);
  // 9) sql_sha256 불일치
  cases.push(['sql_sha256 mismatch', run(withM({ sql_sha256: 'deadbeef' }), upEligible), false, 'env.sql_sha256']);
  // 10) DO UPDATE
  {
    const s = "INSERT INTO call_consult_presets (code,label) VALUES ('A','a') ON CONFLICT (code) DO UPDATE SET label='a';\n";
    cases.push(['ON CONFLICT DO UPDATE', run(withM({ sql_sha256: sha(s), row_count: 1 }), s), false, 'P2']);
  }
  // 11) down-script 무-WHERE DELETE
  {
    const badDown = "DELETE FROM call_consult_presets;\n";
    const bp = write('bad_down.sql', badDown);
    cases.push(['down 무-WHERE DELETE',
      run(withM({ down_script_path: bp, down_script_sha256: sha(badDown) }), upEligible), false, 'P5']);
  }
  // 12) target_table_class 미지 enum
  cases.push(['target_table_class phi', run(withM({ target_table_class: 'phi' }), upEligible), false, 'P7']);
  // 13) manifest 부재
  cases.push(['manifest absent',
    classifyLowCeremonyGoToken({ ticketId: TID, migrationSql: upEligible, manifestPath: path.join(tmp, 'nope.json') }),
    false, 'manifest_present']);
  // 14) data_class 미지 enum
  cases.push(['data_class 미지', run(withM({ data_class: 'clinical' }), upEligible), false, 'P3']);
  // 15) phi_write true
  cases.push(['phi_write true', run(withM({ phi_write: true }), upEligible), false, 'env.phi_write']);

  // ── FIX 2026-08-15 회귀고정: fail-open H1/H1b/H2 봉합 + H3 정탐 유지 ──────────
  const refM = (over) => withM({
    touched_columns: ['ref_presets.code', 'ref_presets.label'],
    touched_tables: ['ref_presets'], row_count: 2, ...over,
  });
  // 16) H1 : 익명 DO 블록/dollar-quoted body 파괴문(DELETE) 은닉 → L0 fail-closed
  {
    const s =
      "INSERT INTO ref_presets (code,label) VALUES ('P1','a'),('P2','b') ON CONFLICT (code) DO NOTHING;\n" +
      "DO $$ BEGIN DELETE FROM patients; END $$;\n";
    cases.push(['H1 DO/dollar-quote 파괴문 은닉', run(refM({ sql_sha256: sha(s) }), s), false, 'L0']);
  }
  // 17) H1b : single-quote DO body(UPDATE) 은닉 → P2 allowlist(비-INSERT 문) fail-closed
  {
    const s =
      "INSERT INTO ref_presets (code,label) VALUES ('P1','a'),('P2','b') ON CONFLICT (code) DO NOTHING;\n" +
      "DO 'BEGIN UPDATE payments SET x=0; END';\n";
    cases.push(['H1b DO single-quote body', run(refM({ sql_sha256: sha(s) }), s), false, 'P2']);
  }
  // 18) H2 : VALUES 튜플 내 스칼라 서브쿼리(PHI read) → P2 SELECT 검출 fail-closed
  {
    const s = "INSERT INTO ref_presets (code,label) VALUES ('P1',(SELECT name FROM customers LIMIT 1)),('P2','b') ON CONFLICT (code) DO NOTHING;\n";
    cases.push(['H2 tuple 스칼라 서브쿼리', run(refM({ sql_sha256: sha(s) }), s), false, 'P2']);
  }
  // 18b) H2 변형 : 튜플 내 함수호출(SELECT 없음) → P4 literal-only 가드 fail-closed
  {
    const s = "INSERT INTO ref_presets (code,label) VALUES ('P1',now()),('P2','b') ON CONFLICT (code) DO NOTHING;\n";
    cases.push(['H2b tuple 함수호출', run(refM({ sql_sha256: sha(s) }), s), false, 'P4']);
  }
  // 19) H3 : 둘째 INSERT INTO payments (정탐 대조군 — 여전히 비적격 유지)
  {
    const s =
      "INSERT INTO ref_presets (code,label) VALUES ('P1','a'),('P2','b') ON CONFLICT (code) DO NOTHING;\n" +
      "INSERT INTO payments (amount) VALUES (100) ON CONFLICT DO NOTHING;\n";
    cases.push(['H3 둘째 INSERT payments', run(refM({ sql_sha256: sha(s) }), s), false, null]);
  }

  let pass = true;
  console.log('── l1seed_classifier selftest ──');
  for (const [name, res, wantEligible, wantFailPrefix] of cases) {
    let good = res.eligible === wantEligible;
    if (!wantEligible && wantFailPrefix) {
      good = good && typeof res.downgrade_reason === 'string' && res.downgrade_reason.startsWith(wantFailPrefix);
    }
    if (!good) pass = false;
    const detail = res.eligible ? 'eligible' : `→full-gate (${res.downgrade_reason})`;
    console.log(`  [${good ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  console.log(pass ? 'SELFTEST: PASS' : 'SELFTEST: FAIL');
  return pass;
}

function hashInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return h;
}
