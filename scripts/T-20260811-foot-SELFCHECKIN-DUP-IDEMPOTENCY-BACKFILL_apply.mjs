/**
 * T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL — Leg A forward-seal apply 러너
 * ════════════════════════════════════════════════════════════════════════════════
 * WHAT: §2.5 멱등룩업 하드닝(CREATE OR REPLACE FUNCTION 2종) — self_checkin_with_reservation_link
 *       + fn_selfcheckin_dup_guard. 델타 = [RC seal] KST 영업일 = 서버 now-KST 고정
 *       + [H-A5] status NOT IN ('cancelled','done'). 스키마-shape DDL 0(body-only ADDITIVE).
 *
 * GATE (C20 · apply_before_go 금지):
 *   - supervisor MIG-GATE PASS → 물리 GO-token 발행 (db-gate/<TICKET>_GO.token.json + .sig, ed25519).
 *   - 실제 apply(query COMMIT) 직전 assertApplyGateForRunner() 통과(prod+--apply → GO-token A∧C 검증).
 *     부재/무효/만료/불일치 → throw(fail-closed) → abort. TTL: 06:33:55Z 만료.
 *   - ledger/applied_at 원자 기입: applyMigration() = "적용=원장 기록" 단일경로
 *     (08-11 INS-CLAIM OOB-apply 원장미봉합 재발방지).
 *
 * MODES:
 *   (default) --dry-run : 게이트 리허설(dry-run lane) + PRE-image + plan. ZERO prod write.
 *   --apply --i-have-go-token : GO-token 검증 → 마이그 SQL apply → 원장 기록 → POST-image 검증.
 *
 * author: dev-foot / 2026-08-11 · ticket: T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';
import { query, recordLedger, MIG_DIR, PROJ_REF } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const TICKET = 'T-20260811-foot-SELFCHECKIN-DUP-IDEMPOTENCY-BACKFILL';
const VERSION = '20260811120000';
const MIG_FILE = '20260811120000_foot_selfcheckin_dup_idempotency_forward_seal.sql';
const MIG_NAME = MIG_FILE.replace(/^\d{14}_/, '').replace(/\.sql$/, '');
const MIG_PATH = join(MIG_DIR, MIG_FILE);
const EVIDENCE_LOG = join(REPO_ROOT, 'db-gate/_apply_evidence/apply_evidence.jsonl');
const EVIDENCE_OUT = join(REPO_ROOT, `db-gate/${TICKET}_apply_evidence.json`);

const ARGS = new Set(process.argv.slice(2));
const MODE_APPLY = ARGS.has('--apply');
const HAS_GO_FLAG = ARGS.has('--i-have-go-token');

const FNS = ['self_checkin_with_reservation_link', 'fn_selfcheckin_dup_guard'];
// supervisor C10 before-image (독립 대조)
const C10_BEFORE = {
  self_checkin_with_reservation_link: '740a27d5314fc95da57cc0ab65ea6442',
  fn_selfcheckin_dup_guard: '96b969b41fabf9697a322ca6c091f774',
};

async function introspect() {
  const q = `SELECT p.proname, md5(p.prosrc) AS src_md5, p.prosecdef,
    array_to_string(p.proconfig, $c$;$c$) AS proconfig,
    pg_get_userbyid(p.proowner) AS owner,
    p.proacl::text AS acl,
    (p.prosrc LIKE $s$%(now() AT TIME ZONE 'Asia/Seoul')::date%$s$) AS has_server_kst,
    (p.prosrc LIKE $s$%NOT IN ('cancelled', 'done')%$s$) AS has_terminal_scope
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $$public$$ AND p.proname IN ($$self_checkin_with_reservation_link$$, $$fn_selfcheckin_dup_guard$$)
    ORDER BY p.proname;`;
  const rows = await query(q);
  const byName = {};
  for (const r of rows) byName[r.proname] = r;
  return byName;
}

// 소스닫힘 센서 baseline: 당일(KST) CI-A(결속)+CI-B(orphan) 지문 = 동일 customer·동일 KST일에
// reservation_id 결속행 ∩ reservation_id=NULL orphan 이 공존하는 케이스 count(seal 후 forward 0 수렴 대상).
async function orphanSensor() {
  const q = `WITH ci AS (
      SELECT clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
             count(*) FILTER (WHERE reservation_id IS NOT NULL) AS linked_cnt,
             count(*) FILTER (WHERE reservation_id IS NULL)     AS orphan_cnt
      FROM check_ins
      WHERE status NOT IN ('cancelled','done') AND customer_id IS NOT NULL
      GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date)
    SELECT count(*)::int AS dup_orphan_fingerprints
    FROM ci WHERE linked_cnt >= 1 AND orphan_cnt >= 1;`;
  const rows = await query(q);
  return rows?.[0]?.dup_orphan_fingerprints ?? null;
}

function nowIso() { return new Date().toISOString(); }

(async () => {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(` ${TICKET} — Leg A forward-seal apply 러너`);
  console.log(`  mode=${MODE_APPLY ? 'APPLY' : 'DRY-RUN'}  version=${VERSION}  prod_ref=${PROJ_REF}`);
  console.log('════════════════════════════════════════════════════════════════════════');

  const sql = readFileSync(MIG_PATH, 'utf8');

  // ── PRE-image (read-only, 항상) ──────────────────────────────────────────────
  const pre = await introspect();
  const preDriftOk = FNS.every((f) => pre[f]?.src_md5 === C10_BEFORE[f]);
  console.log('[PRE] live prosrc md5:');
  for (const f of FNS) {
    console.log(`   ${f}: ${pre[f]?.src_md5} (C10 before=${C10_BEFORE[f]}) ${pre[f]?.src_md5 === C10_BEFORE[f] ? 'MATCH' : '⚠MISMATCH'}`);
  }
  console.log(`[PRE] OOB drift = ${preDriftOk ? '0 (live == C10 before-image)' : '⚠ DRIFT DETECTED'}`);
  if (!preDriftOk) throw new Error('PRE-image != C10 before-image → OOB drift 의심 → abort (fail-closed)');
  const sensorPre = await orphanSensor();
  console.log(`[PRE] dup-orphan 지문(현재 active·당일 KST): ${sensorPre}`);

  // ── GATE (C20) — 실제 COMMIT 직전 chokepoint ────────────────────────────────
  const gateRes = assertApplyGateForRunner({
    ticketId: TICKET,
    targetRef: FOOT_PROD_REF,
    applyRequested: MODE_APPLY,
    migrationSqlFile: MIG_PATH,
    evidenceLog: EVIDENCE_LOG,
  });
  console.log('[GATE] assertApplyGateForRunner →', JSON.stringify({ apply: gateRes.apply, lane: gateRes.lane, gated: gateRes.gated }));
  if (gateRes.gate) {
    console.log(`[GATE] DB-GATE GO ✔ sig=pass issued_at=${gateRes.gate.issuedAt} expires=${gateRes.gate.expiresAt} sha=${gateRes.gate.migrationSha256}`);
  }

  if (!MODE_APPLY) {
    console.log('\n[DRY-RUN] apply/원장 미실행. 게이트 리허설 + PRE-image 통과. DB 무접점.');
    console.log('  실적용: node scripts/' + TICKET + '_apply.mjs --apply --i-have-go-token');
    process.exit(0);
  }
  if (!HAS_GO_FLAG) {
    throw new Error('--apply 는 --i-have-go-token 명시 필요(이중 확인). abort.');
  }

  // ── APPLY (query COMMIT) + 원장 기록 (단일경로: 적용=원장 기록) ───────────────
  const applyTs = nowIso();
  console.log(`\n[APPLY] ${applyTs} — 마이그 SQL apply (Management API POST, BEGIN/COMMIT 내장)`);
  await query(sql);
  console.log('[APPLY] SQL COMMIT 완료.');
  const ledgerRes = await recordLedger({
    version: VERSION, name: MIG_NAME,
    createdBy: `dev-foot:${TICKET}`, dryRun: false,
  });
  const appliedAt = nowIso();
  console.log(`[LEDGER] schema_migrations INSERT(idempotent) version=${VERSION} applied_at=${appliedAt}`);

  // ── POST-image 검증 ──────────────────────────────────────────────────────────
  const post = await introspect();
  console.log('[POST] live prosrc + SECDEF/GRANT:');
  const checks = [];
  for (const f of FNS) {
    const r = post[f];
    const changed = r.src_md5 !== C10_BEFORE[f];
    const secdef = r.prosecdef === true;
    const spath = /public/.test(r.proconfig || '') && /pg_temp/.test(r.proconfig || '');
    const owner = r.owner === 'postgres';
    const acl = /anon=X/.test(r.acl) && /authenticated=X/.test(r.acl) && /service_role=X/.test(r.acl);
    const kst = r.has_server_kst === true;
    const term = r.has_terminal_scope === true;
    console.log(`   ${f}: md5=${r.src_md5} changed=${changed} secdef=${secdef} search_path=${spath} owner=${owner} grant=${acl} server_kst=${kst} terminal_scope=${term}`);
    checks.push({ fn: f, changed, secdef, spath, owner, acl, kst, term });
  }
  const allPass = checks.every((c) => c.changed && c.secdef && c.spath && c.owner && c.acl && c.kst && c.term);
  const sensorPost = await orphanSensor();
  console.log(`[POST] dup-orphan 지문(seal 후 baseline): ${sensorPost}`);
  console.log(`[POST] POSTCHECK ${allPass ? 'PASS ✔' : '⚠ FAIL'}`);

  // ── evidence 산출(C20 3필드 + 원장 applied_at + POSTCHECK) ────────────────────
  const evidence = {
    ticket_id: TICKET, prod_ref: PROJ_REF, migration_version: VERSION, migration_file: MIG_FILE,
    go_token_path: `db-gate/${TICKET}_GO.token.json`,
    go_issued_at: gateRes.gate?.issuedAt ?? null,
    go_expires_at: gateRes.gate?.expiresAt ?? null,
    apply_ts: applyTs,
    applied_at: appliedAt,
    ledger_recorded: ledgerRes.applied === true,
    migration_sha256: gateRes.gate?.migrationSha256 ?? null,
    sig_verify: 'pass',
    pre_image: Object.fromEntries(FNS.map((f) => [f, pre[f]?.src_md5])),
    post_image: Object.fromEntries(FNS.map((f) => [f, post[f]?.src_md5])),
    postcheck: { all_pass: allPass, checks },
    orphan_sensor_pre: sensorPre,
    orphan_sensor_post: sensorPost,
    generated_at: nowIso(),
  };
  mkdirSync(dirname(EVIDENCE_OUT), { recursive: true });
  writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\n[EVIDENCE] → ${EVIDENCE_OUT}`);
  console.log(JSON.stringify(evidence, null, 2));

  if (!allPass) { console.error('⚠ POSTCHECK FAIL — 수동 검토 필요.'); process.exit(2); }
  console.log('\n[DONE] Leg A forward-seal apply 완료 + 원장 기록 + POSTCHECK PASS.');
})().catch((e) => { console.error('[FATAL]', e.message); process.exit(1); });
