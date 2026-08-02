/**
 * T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN — 배정 '상담 성격' 수동 저장 컬럼 dry-run / real-apply 하니스
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN = foot-supabase-pat)
 *
 *   node scripts/T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN_migrate.mjs           # DRY-RUN (무영속: txn-strip + BEGIN..ROLLBACK + post-probe)
 *   node scripts/T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN_migrate.mjs --apply   # REAL APPLY (fwd COMMIT + 멱등 + post-probe 컬럼/CHECK/ledger)
 *
 * DA CONSULT-REPLY (da_decision_foot_assign_consulttype_dropdown_20260726) = ADDITIVE + GO(Q3).
 *   신설 1컬럼 assignment_consult_type TEXT NULL + named CHECK chk_check_ins_assignment_consult_type (4값). default NULL(백필 0).
 *   autonomy §3.1 → 대표게이트 면제(초진/재진 업무 재분리 의사결정만 부모 티켓 CEO 게이트, 데이터층은 ADDITIVE GO).
 *   supervisor DDL-diff 게이트만.
 *
 * ★ 무영속 dry-run 규약(Migration Dry-Run No-Persistence Protocol): up.sql 내장 BEGIN/COMMIT strip →
 *   외곽 BEGIN..ROLLBACK 이 실제 unwind 보장(embedded COMMIT sentinel-bypass 차단) → post-probe 로 무영속 실증.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (foot-supabase-pat)'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

const BASE = 'supabase/migrations/20260803090000_foot_check_ins_assignment_consult_type';
const fwdRaw = fs.readFileSync(`${BASE}.sql`, 'utf8');
const rbkRaw = fs.readFileSync(`${BASE}.rollback.sql`, 'utf8');

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

// 신설 컬럼 존재 + named CHECK 정의에 4값 모두 포함 + ledger 등재 여부.
const probe = () => q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='check_ins' AND column_name='assignment_consult_type')::int AS col,
    (SELECT count(*) FROM pg_constraint
       WHERE conname='chk_check_ins_assignment_consult_type'
         AND pg_get_constraintdef(oid) LIKE '%초진%' AND pg_get_constraintdef(oid) LIKE '%재진%'
         AND pg_get_constraintdef(oid) LIKE '%당일재상담%' AND pg_get_constraintdef(oid) LIKE '%대리상담%')::int AS chk_4,
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260803090000')::int AS ledger;
`);

console.log(`\n=== T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN migrate (${APPLY ? 'REAL APPLY' : 'DRY-RUN'}) ===\n`);
try {
  const pre = (await probe())[0];
  console.log(`── PRE ──  col=${pre.col}  chk_4=${pre.chk_4}  ledger=${pre.ledger}\n`);

  if (!APPLY) {
    // DRY-RUN: 무영속. txn-strip fwd(+멱등 재실행)+rbk 를 단일 외곽 tx 로 감싸 ROLLBACK.
    await q(`BEGIN;\n${fwdStripped}\n${fwdStripped}\n${rbkStripped}\nROLLBACK;`);
    console.log('  ✅ tx(fwd→fwd멱등→rbk) 무오류 실행 후 ROLLBACK');
    const post = (await probe())[0];
    chk(post.col === pre.col, `POST-PROBE 컬럼 무영속 (${pre.col}→${post.col})`);
    chk(post.chk_4 === pre.chk_4, `POST-PROBE CHECK 무영속 (${pre.chk_4}→${post.chk_4})`);
    chk(post.ledger === pre.ledger, `POST-PROBE ledger 무영속 (${pre.ledger}→${post.ledger})`);
    console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS (fwd+멱등+rbk 왕복, prod 무영속 실증)' : '❌ DRY-RUN FAIL'}\n`);
  } else {
    await q(fwdRaw);                        // FORWARD (내장 BEGIN..COMMIT 실 커밋)
    console.log('  ✅ FORWARD COMMIT');
    await q(fwdRaw);                        // 멱등 재실행
    console.log('  ✅ FORWARD 멱등 재실행 무오류');
    const post = (await probe())[0];
    chk(post.col === 1, `check_ins.assignment_consult_type 컬럼 존재 (${post.col})`);
    chk(post.chk_4 === 1, `chk_check_ins_assignment_consult_type CHECK 4값 포함 (${post.chk_4})`);
    // ADDITIVE 실효: 4값 중 하나 UPDATE 허용 + 무효값 CHECK 거부(무영속 서브tx 로 시도 후 ROLLBACK).
    let validOk = false, invalidRejected = false;
    try {
      await q(`BEGIN;
        UPDATE check_ins SET assignment_consult_type='초진' WHERE id=(SELECT id FROM check_ins LIMIT 1);
      ROLLBACK;`);
      validOk = true;
    } catch { validOk = false; }
    chk(validOk, "ADDITIVE 실효: 유효값('초진') UPDATE 허용");
    try {
      await q(`BEGIN;
        UPDATE check_ins SET assignment_consult_type='xxx' WHERE id=(SELECT id FROM check_ins LIMIT 1);
      ROLLBACK;`);
      invalidRejected = false; // 통과했으면 CHECK 미작동 = FAIL
    } catch { invalidRejected = true; }
    chk(invalidRejected, "CHECK 집행: 무효값('xxx') UPDATE 거부(check_violation)");
    // default NULL 단언(백필 0): 기존 행 assignment_consult_type IS NULL 이 전량이어야.
    const nn = (await q(`SELECT count(*)::int AS n FROM check_ins WHERE assignment_consult_type IS NOT NULL;`))[0];
    chk(nn.n === 0, `백필 0 (assignment_consult_type NOT NULL 행 = ${nn.n})`);
    console.log(`\n${pass ? '✅ REAL APPLY ALL-PASS (컬럼+CHECK 4값 + ADDITIVE 실효 + 백필0)' : '❌ APPLY FAIL'}\n`);
  }
} catch (e) {
  console.error('❌ 오류:', e.message);
  pass = false;
}
process.exit(pass ? 0 : 1);
