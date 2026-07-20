/**
 * DRY-RUN (no-persistence): T-20260720-foot-AICC-ANON-PII-LEAK 3-migration bundle
 *   20260720230000_foot_aicc_phonematch_revoke_anon.sql       (AC2 뷰 REVOKE ALL)
 *   20260720231000_foot_selfcheckin_resolve_custid_rpc.sql    (AC3 SECDEF RPC 신설)
 *   20260720232000_foot_customers_anon_select_lockdown.sql    (AC3 customers anon lockdown)
 *
 * No-Persistence Protocol (Migration Dry-Run 단일표준 준수):
 *   1) txn-control strip  — 각 up.sql 의 자체 BEGIN;/COMMIT; 제거(sentinel-bypass 조기확정 차단).
 *   2) exception rollback — 스트립한 DDL 본문을 `BEGIN; <ddl>; ROLLBACK;` 로 감싸 무영속 실행
 *      (구문·의미 유효성 검증. 오류 시 API 가 즉시 반환 → dry-run FAIL).
 *   3) post-probe         — 실행 후 prod 실재를 재-introspect 하여 "아무것도 영속되지 않음" 확증
 *      (뷰 anon privs 불변 · RPC 여전히 부재 · 정책 여전히 존재 · customers anon SELECT 여전히 존재).
 *
 * 실행: (repo root) node supabase/migrations/20260720230000_foot_aicc_anon_pii_leak.dryrun.mjs
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

// up.sql 에서 자체 txn-control(BEGIN;/COMMIT;) 및 주석줄 제거 → 순수 DDL 본문.
function stripTxn(file) {
  const raw = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  return raw
    .split('\n')
    .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;?\s*$/i.test(l))
    .join('\n')
    .trim();
}

const FILES = [
  '20260720230000_foot_aicc_phonematch_revoke_anon.sql',
  '20260720231000_foot_selfcheckin_resolve_custid_rpc.sql',
  '20260720232000_foot_customers_anon_select_lockdown.sql',
];

let ok = true;

// ── snapshot BEFORE ──
const before = {
  viewPrivs: (await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='aicc_crm_phone_match' AND grantee='anon' ORDER BY privilege_type;`)).map((r) => r.privilege_type),
  fnExists: (await q(`SELECT proname FROM pg_proc WHERE proname='fn_selfcheckin_resolve_customer_id_by_phone';`)).length,
  policyExists: (await q(`SELECT policyname FROM pg_policies WHERE tablename='customers' AND policyname='anon_select_customer_self_checkin';`)).length,
  custAnonSelect: (await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='customers' AND grantee='anon' ORDER BY privilege_type;`)).map((r) => r.privilege_type),
};
console.log('── BEFORE (prod 실재) ──');
console.log(JSON.stringify(before, null, 1));

// ── 무영속 실행: BEGIN; <ddl bundle>; ROLLBACK; ──
const bundle = FILES.map(stripTxn).join('\n\n');
try {
  await q(`BEGIN;\n${bundle}\nROLLBACK;`);
  console.log('\n✅ DDL bundle 구문·의미 유효(BEGIN…ROLLBACK 무영속 실행 성공).');
} catch (e) {
  ok = false;
  console.log('\n❌ DDL bundle 실행 실패:', e.message);
}

// ── post-probe: 아무것도 영속되지 않았는지 재확증 ──
const after = {
  viewPrivs: (await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='aicc_crm_phone_match' AND grantee='anon' ORDER BY privilege_type;`)).map((r) => r.privilege_type),
  fnExists: (await q(`SELECT proname FROM pg_proc WHERE proname='fn_selfcheckin_resolve_customer_id_by_phone';`)).length,
  policyExists: (await q(`SELECT policyname FROM pg_policies WHERE tablename='customers' AND policyname='anon_select_customer_self_checkin';`)).length,
  custAnonSelect: (await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='customers' AND grantee='anon' ORDER BY privilege_type;`)).map((r) => r.privilege_type),
};
console.log('\n── AFTER (post-probe) ──');
console.log(JSON.stringify(after, null, 1));

const same = JSON.stringify(before) === JSON.stringify(after);
if (!same) { ok = false; console.log('\n❌ NO-PERSISTENCE 위반: BEFORE≠AFTER (dry-run 이 prod 를 변경했다!)'); }
else console.log('\n✅ NO-PERSISTENCE 확증: BEFORE==AFTER (prod 무변경).');

console.log(`\n${ok ? 'PASS' : 'FAIL'}: dry-run ${ok ? '통과' : '실패'}`);
process.exit(ok ? 0 : 1);
