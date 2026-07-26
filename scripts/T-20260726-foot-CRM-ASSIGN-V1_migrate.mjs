/**
 * T-20260726-foot-CRM-ASSIGN-V1 — 상담 자동배정 ADDITIVE 스키마 dry-run / real-apply 하니스
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN = foot-supabase-pat)
 *
 *   node scripts/T-20260726-foot-CRM-ASSIGN-V1_migrate.mjs           # DRY-RUN (무영속: txn-control strip + BEGIN..ROLLBACK + post-probe)
 *   node scripts/T-20260726-foot-CRM-ASSIGN-V1_migrate.mjs --apply   # REAL APPLY (fwd COMMIT + 멱등 + post-probe 6객체·ledger·2:1 CHECK)
 *
 * DA CONSULT MSG-gxcs GO_WARN+ADDITIVE / supervisor DDL-diff GO (MSG-20260726-113625-loa7).
 * 전량 ADDITIVE(신규 4테이블 + staff 2컬럼). 멱등 IF NOT EXISTS. 롤백 pair 동봉.
 *
 * ★ 무영속 dry-run 규약(Migration Dry-Run No-Persistence Protocol): up.sql 내장 BEGIN/COMMIT 를
 *   strip → 외곽 BEGIN..ROLLBACK 이 실제 unwind 를 보장(embedded COMMIT sentinel-bypass 차단) → post-probe 로 무영속 실증.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (foot-supabase-pat)'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

const MIG = 'supabase/migrations/20260726130000_foot_consult_autoassign_ranking_v1.sql';
const RBK = 'supabase/migrations/20260726130000_foot_consult_autoassign_ranking_v1.rollback.sql';
const fwdRaw = fs.readFileSync(MIG, 'utf8');
const rbkRaw = fs.readFileSync(RBK, 'utf8');

// txn-control strip: 줄 단위로 BEGIN; / COMMIT; / ROLLBACK; 제거(무영속 dry-run 외곽 tx 가 유일 제어점).
const stripTxn = (sql) => sql.split('\n')
  .filter((l) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(l))
  .join('\n');
const fwdStripped = stripTxn(fwdRaw);
const rbkStripped = stripTxn(rbkRaw);

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const probe = () => q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='staff'
         AND column_name IN ('auto_assign_enabled','slack_user_id'))::int AS staff_cols,
    (SELECT count(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN
         ('assignment_ranking_weights','assignment_daily_target_config','assignment_leadsource_policy','assignment_pointer_state'))::int AS new_tables,
    (SELECT count(*) FROM pg_constraint WHERE conname='assignment_daily_target_ratio_2to1')::int AS chk_2to1,
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260726130000')::int AS ledger;
`);

console.log(`\n=== T-20260726-foot-CRM-ASSIGN-V1 migrate (${APPLY ? 'REAL APPLY' : 'DRY-RUN'}) ===\n`);
try {
  const pre = (await probe())[0];
  console.log(`── PRE ──  staff_cols=${pre.staff_cols}/2  new_tables=${pre.new_tables}/4  chk_2to1=${pre.chk_2to1}  ledger=${pre.ledger}\n`);

  if (!APPLY) {
    // DRY-RUN: 무영속. txn-control strip 한 fwd(+멱등 재실행)+rbk 를 단일 외곽 tx 로 감싸 ROLLBACK.
    await q(`BEGIN;\n${fwdStripped}\n${fwdStripped}\n${rbkStripped}\nROLLBACK;`);
    console.log('  ✅ tx(fwd→fwd멱등→rbk) 무오류 실행 후 ROLLBACK');
    // post-probe: 무영속 실증(왕복 후 PRE 와 완전 동일).
    const post = (await probe())[0];
    chk(post.staff_cols === pre.staff_cols, `POST-PROBE staff_cols 무영속 (${pre.staff_cols}→${post.staff_cols})`);
    chk(post.new_tables === pre.new_tables, `POST-PROBE new_tables 무영속 (${pre.new_tables}→${post.new_tables})`);
    chk(post.chk_2to1 === pre.chk_2to1, `POST-PROBE chk_2to1 무영속 (${pre.chk_2to1}→${post.chk_2to1})`);
    chk(post.ledger === pre.ledger, `POST-PROBE ledger 무영속 (${pre.ledger}→${post.ledger})`);
    console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS (fwd+멱등+rbk 왕복, prod 무영속 실증)' : '❌ DRY-RUN FAIL'}\n`);
  } else {
    await q(fwdRaw);                        // FORWARD (내장 BEGIN..COMMIT 실 커밋)
    console.log('  ✅ FORWARD COMMIT');
    await q(fwdRaw);                        // 멱등 재실행
    console.log('  ✅ FORWARD 멱등 재실행 무오류');
    const post = (await probe())[0];
    chk(post.staff_cols === 2, `staff 신규 2컬럼(auto_assign_enabled/slack_user_id) 존재 (${post.staff_cols}/2)`);
    chk(post.new_tables === 4, `신규 4테이블 존재 (${post.new_tables}/4)`);
    chk(post.chk_2to1 === 1, `2:1 CHECK(assignment_daily_target_ratio_2to1) 존재 (${post.chk_2to1})`);
    chk(post.ledger === 1, `ledger row 20260726130000 등재 (${post.ledger})`);
    // 2:1 CHECK 실효 단언: top=3,bottom=1(3≠2) INSERT → check_violation 거부돼야 함.
    let rejected = false;
    try {
      await q(`BEGIN;
        INSERT INTO assignment_daily_target_config (clinic_id, top_rank_target, bottom_rank_target)
        SELECT id, 3, 1 FROM clinics LIMIT 1;
      ROLLBACK;`);
    } catch (e) { rejected = /check|constraint|assignment_daily_target_ratio_2to1/i.test(e.message); }
    chk(rejected, '2:1 CHECK 실효: top=3/bottom=1(3≠2) INSERT 거부(check_violation)');
    console.log(`\n${pass ? '✅ REAL APPLY ALL-PASS (6/6 형상 + 2:1 CHECK 실효)' : '❌ APPLY FAIL'}\n`);
  }
} catch (e) {
  console.error('❌ 오류:', e.message);
  pass = false;
}
process.exit(pass ? 0 : 1);
