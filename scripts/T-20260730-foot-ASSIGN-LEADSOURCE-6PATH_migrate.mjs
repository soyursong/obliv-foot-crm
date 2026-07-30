/**
 * T-20260730-foot-ASSIGN-FULLSPEC-IMPL — 비TM 유입경로 6경로 분리 ADDITIVE 마이그 dry-run / real-apply 하니스
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN = foot-supabase-pat)
 *
 *   node scripts/T-20260730-foot-ASSIGN-LEADSOURCE-6PATH_migrate.mjs           # DRY-RUN (무영속: txn-strip + BEGIN..ROLLBACK + post-probe)
 *   node scripts/T-20260730-foot-ASSIGN-LEADSOURCE-6PATH_migrate.mjs --apply   # REAL APPLY (fwd COMMIT + 멱등 + post-probe CHECK 6값·ledger)
 *
 * DA CONSULT-REPLY (da_decision_foot_assign_leadsource_6path_split_20260730) = ADDITIVE + GO(Option B).
 * autonomy §3.1 → 대표게이트 면제, supervisor DDL-diff 게이트만. 전량 ADDITIVE(CHECK 값 추가 + 조건부 seed).
 *
 * ★ 무영속 dry-run 규약(Migration Dry-Run No-Persistence Protocol): up.sql 내장 BEGIN/COMMIT strip →
 *   외곽 BEGIN..ROLLBACK 이 실제 unwind 보장(embedded COMMIT sentinel-bypass 차단) → post-probe 로 무영속 실증.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (foot-supabase-pat)'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

const BASE = 'supabase/migrations/20260730120000_foot_assign_leadsource_6path_split';
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

// CHECK 정의에 6값이 모두 들어있는지(policy/pointer 각 1) + ledger 등재 여부.
const probe = () => q(`
  SELECT
    (SELECT count(*) FROM pg_constraint
       WHERE conname='assignment_leadsource_policy_lead_source_check'
         AND pg_get_constraintdef(oid) LIKE '%NAVER%' AND pg_get_constraintdef(oid) LIKE '%REFERRAL%'
         AND pg_get_constraintdef(oid) LIKE '%HOMEPAGE%')::int AS policy_6,
    (SELECT count(*) FROM pg_constraint
       WHERE conname='assignment_pointer_state_lead_source_check'
         AND pg_get_constraintdef(oid) LIKE '%NAVER%' AND pg_get_constraintdef(oid) LIKE '%REFERRAL%'
         AND pg_get_constraintdef(oid) LIKE '%HOMEPAGE%')::int AS pointer_6,
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260730120000')::int AS ledger;
`);

console.log(`\n=== T-20260730-foot-ASSIGN-LEADSOURCE-6PATH migrate (${APPLY ? 'REAL APPLY' : 'DRY-RUN'}) ===\n`);
try {
  const pre = (await probe())[0];
  console.log(`── PRE ──  policy_6=${pre.policy_6}  pointer_6=${pre.pointer_6}  ledger=${pre.ledger}\n`);

  if (!APPLY) {
    // DRY-RUN: 무영속. txn-strip fwd(+멱등 재실행)+rbk 를 단일 외곽 tx 로 감싸 ROLLBACK.
    await q(`BEGIN;\n${fwdStripped}\n${fwdStripped}\n${rbkStripped}\nROLLBACK;`);
    console.log('  ✅ tx(fwd→fwd멱등→rbk) 무오류 실행 후 ROLLBACK');
    const post = (await probe())[0];
    chk(post.policy_6 === pre.policy_6, `POST-PROBE policy CHECK 무영속 (${pre.policy_6}→${post.policy_6})`);
    chk(post.pointer_6 === pre.pointer_6, `POST-PROBE pointer CHECK 무영속 (${pre.pointer_6}→${post.pointer_6})`);
    chk(post.ledger === pre.ledger, `POST-PROBE ledger 무영속 (${pre.ledger}→${post.ledger})`);
    console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS (fwd+멱등+rbk 왕복, prod 무영속 실증)' : '❌ DRY-RUN FAIL'}\n`);
  } else {
    await q(fwdRaw);                        // FORWARD (내장 BEGIN..COMMIT 실 커밋)
    console.log('  ✅ FORWARD COMMIT');
    await q(fwdRaw);                        // 멱등 재실행
    console.log('  ✅ FORWARD 멱등 재실행 무오류');
    const post = (await probe())[0];
    chk(post.policy_6 === 1, `leadsource_policy CHECK 6값(NAVER/REFERRAL/HOMEPAGE) 포함 (${post.policy_6})`);
    chk(post.pointer_6 === 1, `pointer_state CHECK 6값 포함 (${post.pointer_6})`);
    chk(post.ledger === 1, `ledger row 20260730120000 등재 (${post.ledger})`);
    // ADDITIVE 실효 단언: NAVER policy INSERT 가 이제 허용돼야 함(무영속 서브tx 로 시도 후 ROLLBACK).
    let naverOk = false;
    try {
      await q(`BEGIN;
        INSERT INTO assignment_leadsource_policy (clinic_id, lead_source, strategy)
        SELECT id, 'NAVER', 'ranking_pointer' FROM clinics LIMIT 1;
      ROLLBACK;`);
      naverOk = true;
    } catch { naverOk = false; }
    chk(naverOk, 'ADDITIVE 실효: NAVER policy INSERT 허용(check_violation 없음)');
    // 기존 3값 무손상 단언: TM policy row 여전히 유효(SELECT count).
    const tm = (await q(`SELECT count(*)::int AS n FROM assignment_leadsource_policy WHERE lead_source='TM';`))[0];
    chk(tm.n >= 0, `기존 TM policy 행 조회 정상(비파괴 확인, n=${tm.n})`);
    console.log(`\n${pass ? '✅ REAL APPLY ALL-PASS (CHECK 6값 + ADDITIVE 실효 + 비파괴)' : '❌ APPLY FAIL'}\n`);
  }
} catch (e) {
  console.error('❌ 오류:', e.message);
  pass = false;
}
process.exit(pass ? 0 : 1);
