/**
 * T-20260723-foot-PKGSESSION-LINK-UNWIRED — prod apply (DB-APPLY-GO, supervisor DB-gate GREEN).
 * 마이그: supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.sql
 *   DROP 4-arg → CREATE 5-arg(widened, p_service_sessions DEFAULT NULL) + COMMENT + GRANT + NOTIFY reload.
 * 안전: (1) PREFLIGHT — 현행 consume_package_sessions_for_checkin 오버로드/ACL 스냅샷(C10 재실측)
 *       (2) --apply 없으면 DRY-RUN(미실행)  (3) 마이그 파일 원문 그대로 실행(단일 트랜잭션 query)
 *       (4) POSTVERIFY — 5-arg 단일 시그니처 + 구 4-arg 부재 + ACL 무손실 재조회
 * 롤백: supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.rollback.sql
 * author: dev-foot / 2026-07-23
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const APPLY = process.argv.includes('--apply');
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const PROC_INTROSPECT = `
  SELECT p.oid,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_arguments(p.oid)          AS args_full,
         p.pronargs,
         p.prosecdef                               AS security_definer,
         p.proacl::text                            AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'consume_package_sessions_for_checkin'
  ORDER BY p.pronargs;
`;

// ── 1) PREFLIGHT (C10 재실측) ────────────────────────────────────────────────
const pre = await q(PROC_INTROSPECT);
console.log('=== PREFLIGHT: consume_package_sessions_for_checkin overloads ===');
console.log(JSON.stringify(pre, null, 2));
console.log(`PREFLIGHT overload count = ${pre.length}`);
if (pre.length !== 1) {
  console.error(`⚠️ PREFLIGHT: 오버로드 ${pre.length}개 — 기대 1개(4-arg). 확인 필요.`);
} else {
  console.log(`PREFLIGHT signature = (${pre[0].args})  [expect: uuid, uuid, uuid, jsonb]`);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 없음 → 마이그 미실행. PREFLIGHT 확인 후 --apply 로 실행.');
  process.exit(0);
}

// ── 2) APPLY (마이그 파일 원문 실행) ──────────────────────────────────────────
const migSql = readFileSync('supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.sql', 'utf8');
console.log('\n=== APPLY: executing migration file ===');
await q(migSql);
console.log('APPLY: migration executed OK.');

// ── 3) POSTVERIFY ────────────────────────────────────────────────────────────
const post = await q(PROC_INTROSPECT);
console.log('\n=== POSTVERIFY: consume_package_sessions_for_checkin overloads ===');
console.log(JSON.stringify(post, null, 2));

let ok = true;
if (post.length !== 1) { console.error(`❌ POSTVERIFY: 오버로드 ${post.length}개 — 기대 1개(5-arg 단일)`); ok = false; }
else {
  const args = post[0].args.replace(/\s+/g, ' ').trim();
  const expect5 = 'uuid, uuid, uuid, jsonb, jsonb';
  if (args !== expect5) { console.error(`❌ POSTVERIFY: signature "${args}" ≠ expect "${expect5}"`); ok = false; }
  else console.log(`✅ POSTVERIFY: 5-arg 단일 시그니처 확인 = (${args})`);
  const acl = post[0].acl || '';
  console.log(`ACL = ${acl}`);
  if (!/authenticated/.test(acl)) console.warn('⚠️ ACL: authenticated EXECUTE 미확인 — 재검토');
}

// 구 4-arg 부재 명시 확인
const legacy4 = post.filter(r => (r.args.replace(/\s+/g, ' ').trim() === 'uuid, uuid, uuid, jsonb'));
if (legacy4.length > 0) { console.error('❌ POSTVERIFY: 구 4-arg 시그니처 잔존'); ok = false; }
else console.log('✅ POSTVERIFY: 구 4-arg 부재 확인');

console.log(ok ? '\n✅ ALL POSTVERIFY PASS' : '\n❌ POSTVERIFY FAIL — 롤백 검토');
process.exit(ok ? 0 : 1);
