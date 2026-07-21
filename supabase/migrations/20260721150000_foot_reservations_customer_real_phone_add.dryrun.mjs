/**
 * DRY-RUN (no-persistence): T-20260721-foot-COMPANION-PHONE-EXPOSE-DECISION
 *   20260721150000_foot_reservations_customer_real_phone_add.sql
 *     (1) reservations.customer_real_phone TEXT ADD (nullable, non-key)
 *     (2) upsert_reservation_from_source RPC 에 customer_real_phone persist 절 ADD (18-arg 무변경)
 *
 * No-Persistence Protocol (Migration Dry-Run 단일표준 준수):
 *   1) txn-control strip  — up.sql 의 자체 BEGIN;/COMMIT; 제거(sentinel-bypass 조기확정 차단).
 *   2) exception rollback — 스트립한 DDL 본문을 `BEGIN; <ddl>; ROLLBACK;` 로 감싸 무영속 실행.
 *   3) post-probe         — 실행 후 prod 실재를 재-introspect 하여 "아무것도 영속되지 않음" 확증
 *      (컬럼 여전히 부재 · RPC functiondef 에 persist 절 여전히 부재).
 *
 * 실행: (repo root) node supabase/migrations/20260721150000_foot_reservations_customer_real_phone_add.dryrun.mjs
 * 필요: .env.local 의 SUPABASE_ACCESS_TOKEN (Management API, DB 비번 불요).
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required (.env.local)');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function stripTxn(file) {
  const raw = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  // ★ 세미콜론 필수(BEGIN;/COMMIT;)만 strip = txn-control 문. plpgsql 본문의 bare `BEGIN`(세미콜론 없음)은
  //   함수 body 구성요소 → 보존(strip 시 42601 syntax error). No-Persistence Protocol txn-strip 정합.
  return raw
    .split('\n')
    .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
    .join('\n')
    .trim();
}

const FILE = '20260721150000_foot_reservations_customer_real_phone_add.sql';
let ok = true;

const COL_Q = `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='customer_real_phone';`;
const PERSIST_Q = `SELECT (pg_get_functiondef(p.oid) ILIKE '%customer_real_phone = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_phone)%') AS persisted
                     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='upsert_reservation_from_source';`;

// ── snapshot BEFORE ──
const before = {
  colExists: (await q(COL_Q)).length,
  rpcPersist: (await q(PERSIST_Q)).map((r) => r.persisted),
};
console.log('── BEFORE (prod 실재) ──');
console.log(JSON.stringify(before, null, 1));

// ── 무영속 실행: BEGIN; <ddl>; ROLLBACK; ──
try {
  await q(`BEGIN;\n${stripTxn(FILE)}\nROLLBACK;`);
  console.log('\n✅ DDL 구문·의미 유효(BEGIN…ROLLBACK 무영속 실행 성공).');
} catch (e) {
  ok = false;
  console.log('\n❌ DDL 실행 실패:', e.message);
}

// ── post-probe: 아무것도 영속되지 않았는지 재확증 ──
const after = {
  colExists: (await q(COL_Q)).length,
  rpcPersist: (await q(PERSIST_Q)).map((r) => r.persisted),
};
console.log('\n── AFTER (post-probe) ──');
console.log(JSON.stringify(after, null, 1));

const same = JSON.stringify(before) === JSON.stringify(after);
if (!same) { ok = false; console.log('\n❌ NO-PERSISTENCE 위반: BEFORE≠AFTER (dry-run 이 prod 를 변경했다!)'); }
else console.log('\n✅ NO-PERSISTENCE 확증: BEFORE==AFTER (prod 무변경).');

console.log(`\n${ok ? 'PASS' : 'FAIL'}: dry-run ${ok ? '통과' : '실패'}`);
process.exit(ok ? 0 : 1);
