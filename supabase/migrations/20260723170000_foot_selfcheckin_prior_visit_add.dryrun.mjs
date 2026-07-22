/**
 * DRY-RUN (no-persistence): T-20260723-foot-JONGNO-KIOSK-READPATH-ANON-CUTOVER 착수조건 ①
 *   20260723170000_foot_selfcheckin_prior_visit_add.sql
 *   net-new SECDEF RPC: fn_selfcheckin_prior_visit(UUID,UUID) RETURNS boolean + REVOKE PUBLIC/GRANT anon.
 *
 * No-Persistence Protocol (Migration Dry-Run 단일표준 준수):
 *   1) txn-control strip  — up.sql 의 자체 BEGIN;/COMMIT; 제거(sentinel-bypass 조기확정 차단).
 *   2) exception rollback — 스트립한 DDL 본문을 `BEGIN; <ddl>; ROLLBACK;` 로 감싸 무영속 실행.
 *   3) post-probe         — 실행 후 prod 실재 재-introspect → "dry-run 이 아무것도 영속시키지 않음" 확증.
 *      기대: BEFORE(absent)==AFTER(absent) → (a) DDL 구문/의미 유효, (b) ROLLBACK 무영속.
 *   + 무영속 실행 중 함수 시그니처/권한 존재를 in-txn 재확인(구문 유효 강검증).
 *
 * 실행: (repo root) node supabase/migrations/20260723170000_foot_selfcheckin_prior_visit_add.dryrun.mjs
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
  // 세미콜론 필수(BEGIN;/COMMIT;)만 strip. sql 함수 본문엔 bare BEGIN 없음(plpgsql 아님).
  return raw
    .split('\n')
    .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
    .join('\n')
    .trim();
}

const FILE = '20260723170000_foot_selfcheckin_prior_visit_add.sql';
let ok = true;

const FN_Q = `SELECT count(*)::int AS n
                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='fn_selfcheckin_prior_visit'
                 AND pg_get_function_identity_arguments(p.oid)='p_clinic_id uuid, p_customer_id uuid';`;

// ── snapshot BEFORE (net-new → 부재 기대) ──
const before = { fnExists: (await q(FN_Q))[0].n };
console.log('── BEFORE (prod 실재) ──');
console.log(JSON.stringify(before, null, 1));

// ── 무영속 실행: BEGIN; <ddl>; <in-txn 존재확인>; ROLLBACK; ──
try {
  const inTxnCheck = await q(`BEGIN;\n${stripTxn(FILE)}\n${FN_Q}\nROLLBACK;`);
  // 마지막 SELECT 결과가 in-txn 함수 존재(=1) 확인
  const rows = Array.isArray(inTxnCheck) ? inTxnCheck.flat() : [];
  const inTxnN = rows.find((r) => r && typeof r.n === 'number')?.n;
  if (inTxnN === 1) {
    console.log('\n✅ DDL 구문·의미 유효 + in-txn 함수 물화 확인(BEGIN…ROLLBACK 무영속).');
  } else {
    ok = false;
    console.log(`\n❌ in-txn 함수 물화 미확인 (n=${JSON.stringify(inTxnN)}).`);
  }
} catch (e) {
  ok = false;
  console.log('\n❌ DDL 실행 실패:', e.message);
}

// ── post-probe: 아무것도 영속되지 않았는지 재확증 ──
const after = { fnExists: (await q(FN_Q))[0].n };
console.log('\n── AFTER (post-probe) ──');
console.log(JSON.stringify(after, null, 1));

const same = JSON.stringify(before) === JSON.stringify(after);
if (!same) { ok = false; console.log('\n❌ NO-PERSISTENCE 위반: BEFORE≠AFTER (dry-run 이 prod 를 변경했다!)'); }
else console.log('\n✅ NO-PERSISTENCE 확증: BEFORE==AFTER (prod 무변경).');

console.log(`\n${ok ? 'PASS' : 'FAIL'}: dry-run ${ok ? '통과' : '실패'}`);
process.exit(ok ? 0 : 1);
