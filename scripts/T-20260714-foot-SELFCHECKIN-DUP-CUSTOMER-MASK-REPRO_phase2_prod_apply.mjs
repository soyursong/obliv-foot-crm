/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 2 PROD APPLY
 *
 * 게이트: supervisor DDL-diff = GO (ticket §197~205, ADDITIVE) + DA CONSULT-REPLY GO
 *         + planner apply INFO (MSG-20260714-102243-uvyk). ADDITIVE → 대표 게이트 면제(§3.1).
 *
 * MIG-GATE 프로토콜:
 *   1) 멱등 apply — 마이그 body(자체 BEGIN..COMMIT), helper/4RPC 전부 CREATE OR REPLACE → 재실행 안전.
 *   2) 원장 자동 기록 — supabase_migrations.schema_migrations version=20260714120000
 *      (forward-only, last=20260713170000). ON CONFLICT DO NOTHING(멱등).
 *   3) post-apply introspection — helper 영속(n=1) + predicate 10/10 + 가드 22023 발화.
 *   4) divergence 없음 — dry-run 재현분(predicate 정오탐·가드 fail-closed)과 실적용 동일 확인.
 *
 * ★ 마스킹 payload 만 가드 호출(→ reject, 무삽입). raw payload write 호출 없음(신규 오염행 미생성). ★
 * author: dev-foot / 2026-07-14 · Management API
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
const VERSION = '20260714120000';
const NAME = 'selfcheckin_upsert_masked_pii_reject_guard';
const MIG = 'supabase/migrations/20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql';

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
async function qok(sql) { const r = await q(sql); if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0,1500)}`); return JSON.parse(r.body); }

let pass = true;
const chk = (ok, msg) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); pass = ok && pass; };

async function main() {
  console.log('=== Phase 2 PROD APPLY ===\n');

  // ── PRE: 원장·helper 상태 (forward-only 재확인) ──
  const preLedger = await qok(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  const preHelper = await qok(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii';`);
  console.log('── PRE ──');
  console.log(`  원장 ${VERSION} 기존기록 n=${(preLedger.result ?? preLedger).length}`);
  console.log(`  helper _fn_is_masked_pii n=${(preHelper.result ?? preHelper)[0].n}`);

  // ── 1) 멱등 apply (마이그 자체 BEGIN..COMMIT) ──
  console.log(`\n── APPLY ${MIG} ──`);
  const r = await q(readFileSync(MIG, 'utf8'));
  if (!r.ok) { console.error(`  ❌ 적용 실패 HTTP ${r.status}: ${r.body.slice(0,2000)}`); process.exit(1); }
  console.log('  ✅ 마이그 적용 완료 (COMMIT)');

  // ── 2) 원장 자동 기록 (멱등) ──
  await qok(`INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
             VALUES ('${VERSION}', '${NAME}', 'dev-foot:T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO')
             ON CONFLICT (version) DO NOTHING;`);
  const postLedger = await qok(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  const lr = postLedger.result ?? postLedger;

  // ── 3) post-apply introspection (영속 확인) ──
  console.log('\n════ POST-APPLY INTROSPECTION ════');
  const helper = await qok(`SELECT count(*)::int n, bool_or(p.prosecdef) secdef,
      has_function_privilege('anon', p.oid,'EXECUTE') anon_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='_fn_is_masked_pii' GROUP BY p.oid;`);
  const h = (helper.result ?? helper)[0] || { n: 0 };
  chk(h.n === 1, `helper _fn_is_masked_pii 영속 (n=${h.n}, secdef=${h.secdef}, anon_exec=${h.anon_exec})`);

  const fns = await qok(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
      ('fn_selfcheckin_upsert_customer','fn_selfcheckin_upsert_customer_resolve_v2',
       'fn_selfcheckin_upsert_customer_resolve_v3','self_checkin_create') ORDER BY p.proname;`);
  const fnames = (fns.result ?? fns).map(x => x.proname);
  chk(fnames.length === 4, `4 대상 RPC 존재 (${fnames.join(',')})`);

  chk(lr.length === 1, `원장 기록 완료 version=${VERSION} name=${lr[0]?.name}`);

  // ── 4) divergence 없음: predicate 정오탐 10/10 (persisted helper) ──
  console.log('\n── divergence check: predicate 10/10 (실적용 helper) ──');
  const pred = await qok(`SELECT
      public._fn_is_masked_pii('총**트','7754')          AS m_name_star,
      public._fn_is_masked_pii('홍길동','010****5453')   AS m_phone_star,
      public._fn_is_masked_pii('홍길동','5453')          AS m_phone_tail4,
      public._fn_is_masked_pii('홍길동','7754')          AS m_phone_d4,
      public._fn_is_masked_pii('홍길동','010-9999-8888') AS r_raw,
      public._fn_is_masked_pii('홍길동','+821099998888') AS r_e164,
      public._fn_is_masked_pii('홍길동','01099998888')   AS r_8plus,
      public._fn_is_masked_pii('','')                    AS r_empty,
      public._fn_is_masked_pii('John Doe','')            AS r_email_only,
      public._fn_is_masked_pii('DUMMY','')               AS r_dummy;`);
  const p = (pred.result ?? pred)[0];
  const maskedTrue = ['m_name_star','m_phone_star','m_phone_tail4','m_phone_d4'].every(k => p[k] === true);
  const rawFalse   = ['r_raw','r_e164','r_8plus','r_empty','r_email_only','r_dummy'].every(k => p[k] === false);
  chk(maskedTrue, `masked 4종 → true (false-reject 0)  ${JSON.stringify({m_name_star:p.m_name_star,m_phone_star:p.m_phone_star,m_phone_tail4:p.m_phone_tail4,m_phone_d4:p.m_phone_d4})}`);
  chk(rawFalse,   `raw 6종 → false (false-merge 축 무변경) ${JSON.stringify({r_raw:p.r_raw,r_e164:p.r_e164,r_8plus:p.r_8plus,r_empty:p.r_empty,r_email_only:p.r_email_only,r_dummy:p.r_dummy})}`);

  // ── 가드 fail-closed(22023): masked payload → RPC reject (무삽입) ──
  console.log('\n── divergence check: 가드 fail-closed 22023 (masked → reject, 무삽입) ──');
  const guard = await q(`DO $t$
    DECLARE v_state text; v_fired boolean;
    BEGIN
      v_fired := false;
      BEGIN PERFORM public.fn_selfcheckin_upsert_customer_resolve_v3(gen_random_uuid(),'총**트','7754','new');
      EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE; v_fired:=true;
        IF v_state<>'22023' THEN RAISE EXCEPTION 'resolve_v3 SQLSTATE=% (22023 기대)',v_state; END IF; END;
      IF NOT v_fired THEN RAISE EXCEPTION 'resolve_v3 masked 예외 미발화'; END IF;

      v_fired := false;
      BEGIN PERFORM public.self_checkin_create('__nonexistent_slug__','7754','총**트');
      EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE; v_fired:=true;
        IF v_state<>'22023' THEN RAISE EXCEPTION 'self_checkin_create SQLSTATE=% (22023 기대)',v_state; END IF; END;
      IF NOT v_fired THEN RAISE EXCEPTION 'self_checkin_create masked 예외 미발화'; END IF;
    END $t$;`);
  chk(guard.ok, `masked payload → 22023 fail-closed 발화 (resolve_v3·self_checkin_create)${guard.ok ? '' : ' — '+guard.body.slice(0,600)}`);

  // ── 무삽입 확인: 방금 테스트한 masked 지문(name '총**트' / phone tail 7754)이 신규로 안 생겼는지 ──
  const noInsert = await qok(`SELECT count(*)::int n FROM customers
     WHERE (position('*' in COALESCE(name,''))>0 AND name LIKE '총%트')
       AND created_at > (now() - interval '10 minutes');`);
  chk((noInsert.result ?? noInsert)[0].n === 0, `가드 테스트로 인한 신규 masked row 삽입 0 (무삽입 확인)`);

  console.log('\n════ 결과 ════');
  console.log(pass ? '✅✅ PROD APPLY PASS — 영속·원장기록·divergence0' : '❌ 검증 실패');
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
