/**
 * T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — STEP1 재확인 (READ-ONLY)
 *
 * planner RESUME §작업순서 1 [선결·재확인]:
 *   census 는 매출·통계 surface 가 is_test 미필터(is_simulation 축)라 결론했고,
 *   planner/DA 는 v_daily_revenue 가 이미 customers.is_test customer-join 필터한다고 실측 주장.
 *   → prod 실 view 정의(pg_get_viewdef)로 어느 쪽이 맞는지 SSOT 재대조.
 *   목적: is_test customer-join 이 어느 surface 에 실재하는지 / 통계뷰(visits·visit_rate) 가
 *         is_test 미필터인지 확정 → Step2(ADDITIVE 뷰개정) 대상 확정.
 *
 * ★★★ READ-ONLY. prod write 0. UPDATE/DELETE/INSERT/DDL 없음. ★★★
 * PHI 위생: 뷰 정의 텍스트 + 컬럼 존재 boolean + 집계 count 만 출력. 개인식별 출력 금지.
 * author: dev-foot / 2026-08-13
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// .env.local 로더 (dotenv 미의존)
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* noop */ }
}
loadEnv(new URL('../.env.local', import.meta.url).pathname);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY required (.env.local)'); })();
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// exec_sql 계열 RPC 존재 여부에 의존하지 않고, 뷰 정의는 PostgREST 로 못 읽으므로
// 최소 정보를 얻기 위해 정보성 SELECT 로 대체 조사:
//   (a) customers 대상셋 재count (freeze 전 규모 재확인)
//   (b) v_daily_visits / v_daily_revenue / v_daily_visit_rate 가 대상 pre-0713 데이터를 여전히 노출하는지
//       = is_test=true 로 뒤집기 전/후 비교의 baseline
// 뷰 정의 텍스트는 별도 pg_get_viewdef RPC 가 있으면 사용.

const CUTOFF_KST = '2026-07-13T00:00:00+09:00';

async function tryViewDef(viewname) {
  // pg_get_viewdef 를 노출하는 편의 RPC 후보들 (없으면 skip)
  for (const rpc of ['get_view_def', 'pg_get_viewdef_by_name', 'exec_sql']) {
    try {
      const { data, error } = await sb.rpc(rpc, rpc === 'exec_sql'
        ? { query: `SELECT pg_get_viewdef('public.${viewname}'::regclass, true) AS def` }
        : { p_view: viewname });
      if (!error && data) return { rpc, data };
    } catch { /* try next */ }
  }
  return null;
}

async function count(table, filters) {
  let q = sb.from(table).select('*', { head: true, count: 'exact' });
  for (const [col, op, val] of filters) q = q[op](col, val);
  const { count: c, error } = await q;
  return error ? `ERR:${error.code || ''}:${(error.message || '').slice(0, 50)}` : c;
}

async function main() {
  const out = { ts: new Date().toISOString(), db: SUPABASE_URL, readonly: true };

  // (a) customers 대상셋 재count (RESUME 확정: is_test IN(false,NULL) & created_at < cutoff)
  out.customers_pre0713_total = await count('customers', [['created_at', 'lt', CUTOFF_KST]]);
  out.customers_pre0713_istest_true = await count('customers', [['created_at', 'lt', CUTOFF_KST], ['is_test', 'is', true]]);
  out.customers_pre0713_istest_false = await count('customers', [['created_at', 'lt', CUTOFF_KST], ['is_test', 'is', false]]);
  out.customers_pre0713_istest_null = await count('customers', [['created_at', 'lt', CUTOFF_KST], ['is_test', 'is', null]]);
  // 멱등 대상 = false OR null (215 예상)
  out.customers_pre0713_istest_true_or_boundary_note = '대상셋 = false ∪ null (멱등). 이미 true 는 제외.';

  // 7/13 당일 EXCLUDE 확인 (경계=B, 7/12까지)
  out.customers_on_0713 = await count('customers', [
    ['created_at', 'gte', '2026-07-13T00:00:00+09:00'],
    ['created_at', 'lt', '2026-07-14T00:00:00+09:00'],
  ]);

  // is_simulation 병기 (semantic firewall 확인)
  out.customers_pre0713_issim_true = await count('customers', [['created_at', 'lt', CUTOFF_KST], ['is_simulation', 'is', true]]);

  // (b) 뷰 정의 텍스트 시도
  for (const v of ['v_daily_revenue', 'v_daily_visits', 'v_daily_visit_rate']) {
    const def = await tryViewDef(v);
    out[`viewdef_${v}`] = def
      ? { rpc: def.rpc, has_is_test: /is_test/.test(JSON.stringify(def.data)), has_is_simulation: /is_simulation/.test(JSON.stringify(def.data)), raw: def.data }
      : 'NO-RPC (pg_get_viewdef RPC 부재 — 뷰정의는 마이그레이션 파일 SSOT 로 대조)';
  }

  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
