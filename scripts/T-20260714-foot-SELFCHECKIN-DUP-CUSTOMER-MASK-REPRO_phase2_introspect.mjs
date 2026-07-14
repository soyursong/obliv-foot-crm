/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 2 introspect (READ-ONLY)
 *
 * 목적: 마스킹-reject 가드를 얹기 前, 4 대상 anon upsert RPC 의 prod 실 정의·시그니처·
 *       anon EXECUTE 실태 확인. 특히 self_checkin_create 는 repo 소스 부재 → prod 정의 필수 확보.
 *       + 신규 helper(_fn_is_masked_pii) 미존재 확인.
 * ★★★ READ-ONLY. pg_get_functiondef / pg_proc 조회만. mutation 0. ★★★
 * author: dev-foot / 2026-07-14 · Management API read-only
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  try { TOKEN = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch {}
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const TARGETS = [
  'fn_selfcheckin_upsert_customer',
  'fn_selfcheckin_upsert_customer_resolve_v2',
  'fn_selfcheckin_upsert_customer_resolve_v3',
  'self_checkin_create',
];

async function main() {
  console.log('=== Phase 2 introspect (READ-ONLY) ===\n');

  // 1) 대상 함수 시그니처 + anon/authenticated EXECUTE 실태
  const sigs = await q(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid)             AS ret,
           p.prosecdef                                AS secdef,
           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (${TARGETS.map(t => `'${t}'`).join(',')})
     ORDER BY p.proname;`);
  console.log('── 대상 함수 시그니처 + EXECUTE 실태 ──');
  for (const r of sigs.result ?? sigs) {
    console.log(`  ${r.proname}(${r.args}) → ${r.ret} | secdef=${r.secdef} anon=${r.anon_exec} auth=${r.auth_exec}`);
  }

  // 2) helper 미존재 확인
  const helper = await q(`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`);
  console.log(`\n── helper _fn_is_masked_pii 존재? n=${(helper.result ?? helper)[0].n} (0 기대)`);

  // 3) self_checkin_create 전체 prod 정의 (repo 부재 → 확보 필수)
  console.log('\n── self_checkin_create prod 정의 (전체) ──');
  try {
    const def = await q(`SELECT pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='self_checkin_create';`);
    const rows = def.result ?? def;
    if (!rows.length) console.log('  (self_checkin_create 미존재 — prod 에 없음)');
    for (const r of rows) console.log(r.def);
  } catch (e) { console.log('  err:', e.message); }

  // 4) 나머지 3종도 prod 정의가 repo 와 일치하는지 확인차 첫 12줄만
  for (const fn of TARGETS.slice(0, 3)) {
    console.log(`\n── ${fn} prod 정의 head ──`);
    try {
      const def = await q(`SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='${fn}' LIMIT 1;`);
      const rows = def.result ?? def;
      if (!rows.length) { console.log('  (미존재)'); continue; }
      console.log(rows[0].def.split('\n').slice(0, 14).join('\n'));
    } catch (e) { console.log('  err:', e.message); }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
