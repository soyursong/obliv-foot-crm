/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — AC-2 §4-B 경량 apply (plain-DELETE, PK-fixed)
 *
 * ⚠ 실 DELETE(COMMIT) = supervisor DB-GATE(dry-run 무영속 evidence) + 형 apply_gate 통과 후에만.
 *   기본 = DRY-RUN(단일 TX 안 trial-DELETE → POSTCHECK assert → ROLLBACK → 무영속 post-probe).
 *   실삭제 = `--apply` 명시 필요.
 *
 * DA 4차 CONSULT-REPLY GO (MSG-20260721-163320-szw3): Q1·Q2·Q3 전부 GO. net-loss SSOT = **30 확정**.
 *   9 cust + 6 ci + 7 status_transitions + 7 assignment_actions + 1 check_in_room_logs = 30.
 *   경로 근거: CASCADE collateral 8행(aa/crl)이 off-git snapshot_cascade_collateral 로 확보(no-snapshot-no-delete).
 *
 * §4-B 하드 precondition (전부 fail-closed):
 *   ① no-snapshot-no-delete   — off-git 스냅샷(9c/6ci/7st) + cascade-collateral(7aa/1crl) 존재+카운트. 없으면 ABORT.
 *   ② 술어 self-test 독립배선  — selection(고정 PK)과 독립으로 이름접두 재판정. 불일치 ABORT.
 *   ③ prod pre-sweep 착지     — AC-1/AC-3 (commit 453e8475) origin/main ancestor. 아니면 ABORT.
 *   ④ fixpoint 전이-closure    — SOP §2-0 손열거 BAN. edge별 confdeltype 3항 증명:
 *                               (a) NEW row 자식 전량 CASCADE 且 total==30 (b) a/r NEW row==0 (c) n NEW row==0.
 *   ④' abort-if-grown          — DELETE 직전 frozen 6 check_ins-only fixpoint 재census. CASCADE 서명
 *                               {7st,7aa,1crl}·손자0 != 이면 ABORT·재adjudication (야간 cron drift 방어).
 *   ⑤ 단일 TX. DRY-RUN=ROLLBACK / APPLY=COMMIT. 어떤 assert 실패도 ROLLBACK.
 *   ⑥ POSTCHECK(DA 4차 하드): 순소실 == **정확히 30** (≠30 fail-closed 양방[under/over]).
 *                              prefix 잔존 0. 실환자 collateral 0(customers total 감소 == 9).
 *
 * 실행:
 *   node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_apply.mjs           # DRY-RUN (trial+ROLLBACK, 무영속)
 *   node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_apply.mjs --apply   # 실삭제(COMMIT) — supervisor DB-GATE + 형 apply_gate 후
 *
 * DB 비밀번호: process.env.SUPABASE_DB_PASSWORD (fallback: repo .env). 무설정 시 명확 ABORT.
 */
import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  FREEZE_CUSTOMERS, FREEZE_CHECKINS, EXPECT, DUMMY_NAME_PREFIXES,
  OFFGIT_SNAPSHOT_DIR, PRESWEEP_COMMIT, FREEZE_SOURCE_COMMIT, TICKET,
  CASCADE_COLLATERAL_SNAPSHOT, CASCADE_CHILD_SIGNATURE,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_freeze.mjs';
import {
  buildFixpointClosureSql, parseFixpoint, adjudicateFixpoint,
  buildAbortIfGrownSql, adjudicateAbortIfGrown,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_census_lib.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(COMMIT)' : 'DRY-RUN(ROLLBACK)';

const log = [];
const out = (s) => { console.log(s); log.push(s); };
class Abort extends Error {}
const need = (cond, s) => { if (cond) { out('  ✅ ' + s); } else { out('  ❌ ABORT: ' + s); throw new Abort(s); } };

// ── DB password ──
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD) {
  try {
    for (const l of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
      const m = l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
    }
  } catch { /* no .env */ }
}

function writeEvidence(verdict) {
  const evDir = join(REPO, 'db-gate/census-dummy-cleanup');
  mkdirSync(evDir, { recursive: true });
  const fn = APPLY ? 'ac2_apply_evidence.md' : 'ac2_dryrun_nopersist.md';
  writeFileSync(join(evDir, fn),
    `# ${TICKET} — AC-2 §4-B ${MODE}\n\n\`\`\`\n${log.join('\n')}\n\`\`\`\n`);
}

async function main() {
  out(`# ${TICKET} — AC-2 §4-B apply  [${MODE}]  ${new Date().toISOString()}`);
  out(`freeze source commit: ${FREEZE_SOURCE_COMMIT} | keyed on FIXED PK (no LIKE re-scan for selection)`);

  // ── precondition ① no-snapshot-no-delete (전-컬럼 + CASCADE collateral) ──
  out('\n## ① no-snapshot-no-delete (off-git 전-컬럼 스냅샷 + cascade collateral 존재+카운트)');
  const snapDir = join(homedir(), '.config/medibuilder-secrets/backfill-snapshots', OFFGIT_SNAPSHOT_DIR);
  let snaps = [];
  try { snaps = readdirSync(snapDir).filter((f) => f.startsWith('snapshot_') && f.endsWith('.json') && !f.includes('cascade_collateral')); } catch { /* */ }
  need(snaps.length > 0, `off-git snapshot 존재 (${snapDir})`);
  const latest = snaps.sort().at(-1);
  const snap = JSON.parse(readFileSync(join(snapDir, latest), 'utf8'));
  need(snap.counts?.customers === EXPECT.customers
    && snap.counts?.check_ins === EXPECT.check_ins
    && snap.counts?.status_transitions === EXPECT.status_transitions,
    `snapshot(${latest}) counts == 9/6/7 (실제 ${JSON.stringify(snap.counts)})`);
  // cascade collateral (aa 7 + crl 1) 스냅샷 — DA 4차 net-loss 30 롤백 소스
  const collPath = join(snapDir, CASCADE_COLLATERAL_SNAPSHOT);
  need(existsSync(collPath), `cascade-collateral snapshot 존재 (${CASCADE_COLLATERAL_SNAPSHOT})`);
  const coll = JSON.parse(readFileSync(collPath, 'utf8'));
  need(coll.counts?.assignment_actions === EXPECT.assignment_actions
    && coll.counts?.check_in_room_logs === EXPECT.check_in_room_logs,
    `cascade-collateral counts == 7 aa / 1 crl (실제 ${JSON.stringify(coll.counts)})`);

  // ── precondition ③ prod pre-sweep 착지 (AC-1/AC-3 = 453e8475) ──
  out('\n## ③ prod pre-sweep 착지 (AC-1/AC-3 landmine 차단)');
  let ancestor = false;
  try {
    execSync(`git merge-base --is-ancestor ${PRESWEEP_COMMIT} origin/main`, { cwd: REPO, stdio: 'ignore' });
    ancestor = true;
  } catch { ancestor = false; }
  need(ancestor, `pre-sweep commit ${PRESWEEP_COMMIT} is ancestor of origin/main`);

  // ── DB connect ──
  need(!!DB_PASSWORD, 'SUPABASE_DB_PASSWORD 설정됨 (env 또는 .env)');
  const client = new pg.Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const custArr = `ARRAY[${FREEZE_CUSTOMERS.map((id) => `'${id}'::uuid`).join(',')}]`;
    const ciArr = `ARRAY[${FREEZE_CHECKINS.map((id) => `'${id}'::uuid`).join(',')}]`;
    const q = async (sql) => (await client.query(sql)).rows;
    // RAISE-기반 census: DO 블록이 RAISE EXCEPTION 로 결과 반송(무영속) → e.message 파싱.
    const raiseMsg = async (sql) => { try { await client.query(sql); return null; } catch (e) { return e.message || String(e); } };

    // ── precondition ④ fixpoint 전이-closure census + 3항 증명 (SOP §2-0, 손열거 BAN) ──
    out('\n## ④ fixpoint 전이-closure census (SOP §2-0) + 3항 증명');
    const [{ n: nc }] = await q(`select count(*)::int n from customers where id = any(${custArr})`);
    const [{ n: nci }] = await q(`select count(*)::int n from check_ins where id = any(${ciArr})`);
    need(nc === EXPECT.customers, `customers freeze 라이브 = ${nc} (expect 9)`);
    need(nci === EXPECT.check_ins, `check_ins freeze 라이브 = ${nci} (expect 6)`);
    const fp = parseFixpoint(await raiseMsg(buildFixpointClosureSql(FREEZE_CUSTOMERS, FREEZE_CHECKINS)) || '');
    if (fp) {
      out(`  rounds=${fp.rounds} · closure total=${fp.total} · cascade_extra=${fp.cascade_extra}`);
      out(`  edge classification (confdeltype):${fp.edges}`);
    }
    const adj = adjudicateFixpoint(fp, EXPECT.net_loss_total);
    adj.reasons.forEach((r) => out(`  ${r}`));
    need(adj.pass, `3항 증명 (a)CASCADE·total==30 (b)a/r==0 (c)n==0 — ${adj.pass ? 'PASS' : 'FAIL'}`);

    // ── precondition ② 술어 self-test (selection 과 독립 재판정) ──
    out('\n## ② 술어-스코프 self-test (독립 재판정, §4-B ②)');
    const likeOr = DUMMY_NAME_PREFIXES.map((p) => `name like '${p.replace(/'/g, "''")}%'`).join(' or ');
    const nonDummy = await q(`select id, name from customers where id = any(${custArr}) and not (${likeOr})`);
    need(nonDummy.length === 0, `freeze 전량 DUMMY 접두 매칭 (비매칭 ${nonDummy.length})`);
    const predRows = await q(`select id from customers where ${likeOr}`);
    need(predRows.length > 0, `술어 재스캔 비어있지 않음 (silent-swallow 가드): ${predRows.length}행`);
    const predSet = new Set(predRows.map((r) => r.id));
    const missing = FREEZE_CUSTOMERS.filter((id) => !predSet.has(id));
    need(missing.length === 0, `freeze ⊆ 술어집합 (술어 미포함 freeze ${missing.length})`);

    // pre-counts (collateral 측정용)
    const [{ n: totalBefore }] = await q(`select count(*)::int n from customers`);
    out(`  total customers (before) = ${totalBefore}`);

    // ── ④' abort-if-grown (DA 4차 Q2): DELETE 직전 frozen 6 ci-only fixpoint 재census ──
    out('\n## ④′ abort-if-grown 재census (DELETE 직전, 야간 cron drift 방어)');
    const grownFp = parseFixpoint(await raiseMsg(buildAbortIfGrownSql(FREEZE_CHECKINS)) || '');
    const grown = adjudicateAbortIfGrown(grownFp, CASCADE_CHILD_SIGNATURE, EXPECT.check_ins);
    out(`  ${grown.reason}`);
    need(grown.pass, `abort-if-grown — CASCADE 서명 {7st,7aa,1crl}·손자0 (grown 시 ABORT·재adjudication)`);

    // ── ⑤ 단일 TX: (trial-)DELETE — 자식→부모 순 explicit ──
    out(`\n## ⑤ 단일 TX ${MODE} — 자식→부모 순 explicit DELETE (aa/crl/st → check_ins → customers)`);
    await client.query('BEGIN');
    const dSt = await client.query(`delete from status_transitions where check_in_id = any(${ciArr})`);
    const dAa = await client.query(`delete from assignment_actions where check_in_id = any(${ciArr})`);
    const dCrl = await client.query(`delete from check_in_room_logs where check_in_id = any(${ciArr})`);
    const dCi = await client.query(`delete from check_ins where id = any(${ciArr})`);
    const dCu = await client.query(`delete from customers where id = any(${custArr})`);
    const netLoss = dSt.rowCount + dAa.rowCount + dCrl.rowCount + dCi.rowCount + dCu.rowCount;
    out(`  deleted: status_transitions=${dSt.rowCount}, assignment_actions=${dAa.rowCount}, check_in_room_logs=${dCrl.rowCount}, check_ins=${dCi.rowCount}, customers=${dCu.rowCount} · total=${netLoss}`);

    // ── ⑥ POSTCHECK (하드, TX 내부에서 판정) — DA 4차 net-loss==30 양방 catch ──
    out('\n## ⑥ POSTCHECK (DA 4차 하드 요구: 순소실 정확히 30)');
    need(dCu.rowCount === EXPECT.customers, `순소실 customers == ${dCu.rowCount} (expect 9)`);
    need(dCi.rowCount === EXPECT.check_ins, `순소실 check_ins == ${dCi.rowCount} (expect 6)`);
    need(dSt.rowCount === EXPECT.status_transitions, `순소실 status_transitions == ${dSt.rowCount} (expect 7)`);
    need(dAa.rowCount === EXPECT.assignment_actions, `순소실 assignment_actions == ${dAa.rowCount} (expect 7)`);
    need(dCrl.rowCount === EXPECT.check_in_room_logs, `순소실 check_in_room_logs == ${dCrl.rowCount} (expect 1)`);
    need(netLoss === EXPECT.net_loss_total, `순소실 total == ${netLoss} (expect 정확히 30 — ≠30 fail-closed 양방)`);
    const residual = await q(`select count(*)::int n from customers where ${likeOr}`);
    need(residual[0].n === 0, `prefix 잔존 == ${residual[0].n} (expect 0)`);
    const [{ n: totalAfter }] = await q(`select count(*)::int n from customers`);
    need(totalBefore - totalAfter === EXPECT.customers,
      `실환자 collateral 0 — customers total 감소 == ${totalBefore - totalAfter} (expect 정확히 9)`);

    if (APPLY) {
      await client.query('COMMIT');
      out(`\n  ✅ COMMIT — 실삭제 확정 (supervisor DB-GATE + 형 apply_gate 통과 전제).`);
    } else {
      await client.query('ROLLBACK');
      out(`\n  ↩️  ROLLBACK — 무영속(trial 완료).`);
      // 무영속 post-probe: 롤백 후 행 잔존 재확인 (net-loss 30 전량)
      const [{ n: pc }] = await q(`select count(*)::int n from customers where id = any(${custArr})`);
      const [{ n: pci }] = await q(`select count(*)::int n from check_ins where id = any(${ciArr})`);
      const [{ n: pst }] = await q(`select count(*)::int n from status_transitions where check_in_id = any(${ciArr})`);
      const [{ n: paa }] = await q(`select count(*)::int n from assignment_actions where check_in_id = any(${ciArr})`);
      const [{ n: pcrl }] = await q(`select count(*)::int n from check_in_room_logs where check_in_id = any(${ciArr})`);
      need(pc === 9 && pci === 6 && pst === 7 && paa === 7 && pcrl === 1,
        `post-probe 무영속 확인 — 롤백 후 잔존 ${pc}/${pci}/${pst}/${paa}/${pcrl} (expect 9/6/7/7/1)`);
    }
    out(`\n## VERDICT: ✅ ${MODE} PASS (net-loss 30)`);
  } finally {
    await client.end();
  }
}

main()
  .then(() => { writeEvidence('PASS'); process.exit(0); })
  .catch((e) => {
    out(`\n## VERDICT: ${e instanceof Abort ? '❌ ABORT (fail-closed, 무변경)' : '💥 ERROR: ' + e.message}`);
    writeEvidence('ABORT');
    process.exit(1);
  });
