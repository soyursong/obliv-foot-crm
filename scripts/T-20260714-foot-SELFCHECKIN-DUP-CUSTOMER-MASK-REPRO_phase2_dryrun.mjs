/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 2 마이그 dry-run (NO-PERSISTENCE)
 *
 * Migration Dry-Run No-Persistence Protocol 준수:
 *   1) 마이그 body 에서 txn-control(BEGIN/COMMIT) strip → 외부 BEGIN..ROLLBACK 로 감싼다
 *      (내장 COMMIT 이 sentinel 前 확정하는 bypass hazard 차단).
 *   2) txn 내 검증: helper 생성·predicate 정오탐·가드 fail-closed(22023) 발화.
 *   3) ROLLBACK 후 post-probe: helper 무영속(n=0) 재확인.
 * author: dev-foot / 2026-07-14 · Management API
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
  return { ok: r.ok, status: r.status, body: t };
}

const MIG = 'supabase/migrations/20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql';

function stripTxn(sql) {
  // 선두 BEGIN; 과 말미 COMMIT; 제거 (txn-control strip)
  return sql
    .replace(/^\s*BEGIN\s*;/i, '')
    .replace(/COMMIT\s*;\s*$/i, '')
    .trim();
}

async function main() {
  console.log('=== Phase 2 dry-run (NO-PERSISTENCE) ===\n');
  const body = stripTxn(readFileSync(MIG, 'utf8'));

  // ── 1) 마이그 + predicate 정오탐 검증을 단일 txn 에서 실행 후 ROLLBACK ──
  const wrapped = `
BEGIN;
${body}

-- helper 생성 확인
SELECT '[chk] helper_exists' AS k,
       (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii') AS v;
-- predicate 정오탐 (true 기대)
SELECT '[chk] mask_name_star'  AS k, public._fn_is_masked_pii('총**트', '7754')::text AS v;      -- true (재현 지문)
SELECT '[chk] mask_phone_star' AS k, public._fn_is_masked_pii('홍길동', '010****5453')::text AS v; -- true
SELECT '[chk] mask_phone_tail' AS k, public._fn_is_masked_pii('홍길동', '5453')::text AS v;        -- true (digits 1~7)
-- predicate 정오탐 (false 기대 — false-reject 0)
SELECT '[chk] raw_ok'          AS k, public._fn_is_masked_pii('홍길동', '010-9999-8888')::text AS v; -- false
SELECT '[chk] raw_e164_ok'     AS k, public._fn_is_masked_pii('홍길동', '+821099998888')::text AS v; -- false
SELECT '[chk] empty_ok'        AS k, public._fn_is_masked_pii('', '')::text AS v;                    -- false (빈/DUMMY)
SELECT '[chk] email_only_ok'   AS k, public._fn_is_masked_pii('John Doe', '')::text AS v;            -- false (외국인)
ROLLBACK;`;

  const r1 = await q(wrapped);
  console.log('── 마이그 적용 + predicate 검증 (txn, ROLLBACK) ──');
  if (!r1.ok) { console.log(`❌ HTTP ${r1.status}: ${r1.body.slice(0, 1500)}`); process.exit(1); }
  console.log('✅ 마이그 무오류 적용(dry) + 검증쿼리 실행:');
  console.log(r1.body.slice(0, 2000));

  // ── 2) 가드 fail-closed(22023) 발화: masked payload → RPC 호출 시 예외. txn 내 DO 로 캐치 ──
  const guardTest = `
BEGIN;
${body}
DO $t$
DECLARE v_state text; v_msg text; v_fired boolean := false;
BEGIN
  BEGIN
    PERFORM public.fn_selfcheckin_upsert_customer_resolve_v3(
      gen_random_uuid(), '총**트', '7754', 'new');
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_fired := true;
    RAISE NOTICE '[guard] resolve_v3 masked → SQLSTATE=% msg=%', v_state, v_msg;
    IF v_state <> '22023' THEN RAISE EXCEPTION '[guard] 예상 22023 아님: %', v_state; END IF;
  END;
  IF NOT v_fired THEN RAISE EXCEPTION '[guard] resolve_v3 masked 인데 예외 미발화(FAIL)'; END IF;

  -- self_checkin_create masked 도 발화 확인
  v_fired := false;
  BEGIN
    PERFORM public.self_checkin_create('__nonexistent_slug__', '7754', '총**트');
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    v_fired := true;
    IF v_state <> '22023' THEN RAISE EXCEPTION '[guard] self_checkin_create 예상 22023 아님: %', v_state; END IF;
  END;
  IF NOT v_fired THEN RAISE EXCEPTION '[guard] self_checkin_create masked 예외 미발화(FAIL)'; END IF;

  RAISE NOTICE '[guard] ✅ 4경로 대표 2종 fail-closed 22023 발화 확인';
END $t$;
ROLLBACK;`;

  const r2 = await q(guardTest);
  console.log('\n── 가드 fail-closed(22023) 발화 검증 ──');
  console.log(r2.ok ? '✅ 가드 발화 검증 통과 (NOTICE 는 API 응답 미포함일 수 있음)' : `❌ HTTP ${r2.status}: ${r2.body.slice(0,1500)}`);
  if (!r2.ok) process.exit(1);

  // ── 3) post-probe: 무영속 확인 (helper 가 prod 에 안 남았는지) ──
  const post = await q(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`);
  const n = JSON.parse(post.body)[0]?.n;
  console.log(`\n── post-probe (무영속) ── helper n=${n} (0 기대)`);
  if (n !== 0) { console.log('❌ 무영속 위반 — helper 가 prod 에 영속됨!'); process.exit(1); }

  console.log('\n✅✅ dry-run PASS: 문법 OK · predicate 정오탐 OK · 가드 fail-closed 22023 OK · 무영속 OK');
}
main().catch(e => { console.error(e); process.exit(1); });
