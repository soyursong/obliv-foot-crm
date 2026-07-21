/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — AC-2 §4-B 경량 apply (plain-DELETE, PK-fixed)
 *
 * ⚠ 실 DELETE(COMMIT) = supervisor DB-GATE(dry-run 무영속 evidence) + 형 apply_gate 통과 후에만.
 *   기본 = DRY-RUN(단일 TX 안 trial-DELETE → POSTCHECK assert → ROLLBACK → 무영속 post-probe).
 *   실삭제 = `--apply` 명시 필요.
 *
 * DA 3차 VERIFY GREENLIT (MSG-20260721-150028-4ug6 / da_decision_..._20260721.md §3차):
 *   C2 CLEAR CONFIRMED(미귀속=0) → §4-B 경량 GREENLIT(C4 조건부 pre-auth).
 *   경로 근거: 자식 census 0(순수 stub) → tracked archive 테이블 CREATE 불요.
 *             off-git 전-컬럼 스냅샷(+status_transitions 7행) = 롤백 소스(no-snapshot-no-delete).
 *
 * §4-B 하드 precondition (전부 fail-closed):
 *   ① no-snapshot-no-delete   — off-git 스냅샷(9c/6ci/7st) 존재+카운트 대조. 없으면 ABORT.
 *   ② 술어 self-test 독립배선  — selection(고정 PK)과 독립으로 이름접두 재판정. 불일치 ABORT.
 *   ③ prod pre-sweep 착지     — AC-1/AC-3 (commit 453e8475) origin/main ancestor. 아니면 ABORT.
 *   ④ §2-3 freeze 재검증       — 9/6/7 + FK-graph introspection 전 자식 freeze-scope 카운트
 *                               == {status_transitions:7, 그외:0}. drift/미지자식>0 → ABORT.
 *   ⑤ 단일 TX. DRY-RUN=ROLLBACK / APPLY=COMMIT. 어떤 assert 실패도 ROLLBACK.
 *   ⑥ POSTCHECK(DA §3차 하드): 순소실 == 정확히 9 customers + 6 check_ins + 7 status_transitions
 *                              (PK-fixed). prefix 잔존 0. 실환자 collateral 0(total 감소 == 9).
 *
 * 실행:
 *   node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_apply.mjs           # DRY-RUN (trial+ROLLBACK, 무영속)
 *   node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_apply.mjs --apply   # 실삭제(COMMIT) — supervisor DB-GATE + 형 apply_gate 후
 *
 * DB 비밀번호: process.env.SUPABASE_DB_PASSWORD (fallback: repo .env). 무설정 시 명확 ABORT.
 */
import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  FREEZE_CUSTOMERS, FREEZE_CHECKINS, EXPECT, DUMMY_NAME_PREFIXES,
  OFFGIT_SNAPSHOT_DIR, PRESWEEP_COMMIT, FREEZE_SOURCE_COMMIT, TICKET,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_freeze.mjs';

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

  // ── precondition ① no-snapshot-no-delete ──
  out('\n## ① no-snapshot-no-delete (off-git 전-컬럼 스냅샷 존재+카운트)');
  const snapDir = join(homedir(), '.config/medibuilder-secrets/backfill-snapshots', OFFGIT_SNAPSHOT_DIR);
  let snaps = [];
  try { snaps = readdirSync(snapDir).filter((f) => f.startsWith('snapshot_') && f.endsWith('.json')); } catch { /* */ }
  need(snaps.length > 0, `off-git snapshot 존재 (${snapDir})`);
  const latest = snaps.sort().at(-1);
  const snap = JSON.parse(readFileSync(join(snapDir, latest), 'utf8'));
  need(snap.counts?.customers === EXPECT.customers
    && snap.counts?.check_ins === EXPECT.check_ins
    && snap.counts?.status_transitions === EXPECT.status_transitions,
    `snapshot(${latest}) counts == 9/6/7 (실제 ${JSON.stringify(snap.counts)})`);

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

    // ── precondition ④ §2-3 freeze 재검증 (BEGIN 전 읽기) ──
    out('\n## ④ §2-3 freeze 재검증 + FK-graph introspection');
    const q = async (sql) => (await client.query(sql)).rows;
    const [{ n: nc }] = await q(`select count(*)::int n from customers where id = any(${custArr})`);
    const [{ n: nci }] = await q(`select count(*)::int n from check_ins where id = any(${ciArr})`);
    const [{ n: nst }] = await q(`select count(*)::int n from status_transitions where check_in_id = any(${ciArr})`);
    need(nc === EXPECT.customers, `customers freeze 라이브 = ${nc} (expect 9)`);
    need(nci === EXPECT.check_ins, `check_ins freeze 라이브 = ${nci} (expect 6)`);
    need(nst === EXPECT.status_transitions, `status_transitions(CASCADE) = ${nst} (expect 7)`);

    // FK-graph introspection: customers/check_ins 를 참조하는 모든 자식 테이블 열거 → freeze-scope 카운트
    const inbound = await q(`
      select con.conrelid::regclass::text as child_table,
             att.attname as fk_col,
             con.confrelid::regclass::text as parent_table
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f'
        and con.confrelid::regclass::text in ('customers','check_ins')
      order by 1,2`);
    out(`  inbound FK edges: ${inbound.length}`);
    let unknownChildLoss = 0;
    for (const e of inbound) {
      const arr = e.parent_table === 'customers' ? custArr : ciArr;
      const [{ n }] = await q(`select count(*)::int n from ${e.child_table} where ${e.fk_col} = any(${arr})`);
      if (e.child_table === 'status_transitions') {
        need(n === EXPECT.status_transitions, `child status_transitions.${e.fk_col} = ${n} (expect 7)`);
      } else if (n > 0) {
        out(`  ❌ 미지 자식 freeze-scope 행 발견: ${e.child_table}.${e.fk_col} = ${n} (§4-B 전제 붕괴 → §1 heavy 회부)`);
        unknownChildLoss += n;
      } else {
        out(`  ✅ ${e.child_table}.${e.fk_col} = 0`);
      }
    }
    need(unknownChildLoss === 0, `미지 자식 freeze-scope 총합 = ${unknownChildLoss} (expect 0 — status_transitions 외 자식 없음)`);

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

    // ── ⑤ 단일 TX: trial-DELETE ──
    out(`\n## ⑤ 단일 TX ${MODE} — 자식→부모 순 explicit DELETE`);
    await client.query('BEGIN');
    const dSt = await client.query(`delete from status_transitions where check_in_id = any(${ciArr})`);
    const dCi = await client.query(`delete from check_ins where id = any(${ciArr})`);
    const dCu = await client.query(`delete from customers where id = any(${custArr})`);
    out(`  deleted: status_transitions=${dSt.rowCount}, check_ins=${dCi.rowCount}, customers=${dCu.rowCount}`);

    // ── ⑥ POSTCHECK (하드, TX 내부에서 판정) ──
    out('\n## ⑥ POSTCHECK (DA §3차 하드 요구)');
    need(dCu.rowCount === EXPECT.customers, `순소실 customers == ${dCu.rowCount} (expect 9)`);
    need(dCi.rowCount === EXPECT.check_ins, `순소실 check_ins == ${dCi.rowCount} (expect 6)`);
    need(dSt.rowCount === EXPECT.status_transitions, `순소실 status_transitions == ${dSt.rowCount} (expect 7)`);
    const residual = await q(`select count(*)::int n from customers where ${likeOr}`);
    need(residual[0].n === 0, `prefix 잔존 == ${residual[0].n} (expect 0)`);
    const [{ n: totalAfter }] = await q(`select count(*)::int n from customers`);
    need(totalBefore - totalAfter === EXPECT.customers,
      `실환자 collateral 0 — total 감소 == ${totalBefore - totalAfter} (expect 정확히 9)`);

    if (APPLY) {
      await client.query('COMMIT');
      out(`\n  ✅ COMMIT — 실삭제 확정 (supervisor DB-GATE + 형 apply_gate 통과 전제).`);
    } else {
      await client.query('ROLLBACK');
      out(`\n  ↩️  ROLLBACK — 무영속(trial 완료).`);
      // 무영속 post-probe: 롤백 후 행 잔존 재확인
      const [{ n: pc }] = await q(`select count(*)::int n from customers where id = any(${custArr})`);
      const [{ n: pci }] = await q(`select count(*)::int n from check_ins where id = any(${ciArr})`);
      const [{ n: pst }] = await q(`select count(*)::int n from status_transitions where check_in_id = any(${ciArr})`);
      need(pc === 9 && pci === 6 && pst === 7, `post-probe 무영속 확인 — 롤백 후 잔존 ${pc}/${pci}/${pst} (expect 9/6/7)`);
    }
    out(`\n## VERDICT: ✅ ${MODE} PASS`);
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
