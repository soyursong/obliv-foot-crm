/**
 * T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — 마이그레이션 DRY-RUN (무영속)
 *   Management API 경로(SUPABASE_ACCESS_TOKEN). Migration Dry-Run No-Persistence Protocol 준수:
 *     (0) baseline  : 대상 객체(테이블/2함수/cron job) 사전 실재 캡처.
 *     (1) canary    : BEGIN; COMMENT ON <기존 테이블>=canary; ROLLBACK; → ROLLBACK 무영속 선증명(세션 독립).
 *                     잔존 시 즉시 ABORT(실 DDL 미실행) — sentinel-bypass hazard 차단.
 *     (2) apply+verify: BEGIN; <txn-control strip 마이그>; DO$$ C-2/C-4/멱등 검증(실패 시 RAISE) $$; ROLLBACK;
 *                       → 구문/검증 실패 = HTTP 에러 = throw = 실패. 통과 = 무예외 반환.
 *     (3) post-probe: 사후 대상 객체가 baseline 과 동일(미생성)해야 무영속 확증.
 * 사용: SUPABASE_ACCESS_TOKEN=sbp_… node scripts/T-20260803-foot-REDPAY-UNREG-LINE-DIGEST_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260803160000_redpay_unregistered_line_digest.sql';
const CANARY = '__DRYRUN_CANARY_T20260803_UNREG__';
const CANARY_TBL = 'public.redpay_terminal_registry'; // 기존 테이블(무해 COMMENT 가역변경 대상)

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

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

const snapshot = async () => (await q(
  `SELECT to_regclass('public.redpay_unregistered_line_seen') IS NOT NULL AS tbl,
    (SELECT count(*)::int FROM pg_proc WHERE proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')) AS fns,
    (SELECT count(*)::int FROM cron.job WHERE jobname='foot-redpay-unreg-digest') AS cron`))[0];

const commentOf = async () => (await q(
  `SELECT obj_description('${CANARY_TBL}'::regclass, 'pg_class') AS c`))[0]?.c ?? null;

// txn-control strip: 내장 BEGIN;/COMMIT; + (COMMIT 이후) schema_migrations INSERT 제거 → 단일 트랜잭션에 감싸기.
let raw = fs.readFileSync(MIG, 'utf8');
raw = raw.replace(/INSERT INTO supabase_migrations\.schema_migrations[\s\S]*?ON CONFLICT \(version\) DO NOTHING;/g, '');
const mig = raw.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

// 트랜잭션 내 검증 — 실패 시 RAISE EXCEPTION(→ HTTP 에러 → throw). 결과 전달 불요(무예외=통과).
const VERIFY = `
DO $v$
DECLARE r record; n int;
BEGIN
  -- C-2 밴드가드
  PERFORM public.redpay_note_unregistered_line('1777289007','풋(멀티)','1047538243', NULL);
  PERFORM public.redpay_note_unregistered_line('1777289007','풋(멀티)','1047538243', NULL); -- 재감지
  PERFORM public.redpay_note_unregistered_line('1777274001','도수','9990001', NULL);        -- carve-out
  PERFORM public.redpay_note_unregistered_line('1777277001','피부','9990002', NULL);        -- carve-out
  PERFORM public.redpay_note_unregistered_line('1777282001','롱레','9990003', NULL);        -- carve-out
  PERFORM public.redpay_note_unregistered_line(NULL,'미상','9990009', NULL);                -- merchant미상 note

  SELECT count(*) INTO n FROM public.redpay_unregistered_line_seen WHERE merchant_id='1777289007';
  IF n <> 1 THEN RAISE EXCEPTION 'C-2 band_foot_noted FAIL: %', n; END IF;
  SELECT max(hit_count) INTO n FROM public.redpay_unregistered_line_seen WHERE merchant_id='1777289007';
  IF n <> 2 THEN RAISE EXCEPTION 'C-2 idempotent hit_count FAIL: %', n; END IF;
  SELECT count(*) INTO n FROM public.redpay_unregistered_line_seen WHERE merchant_id IN ('1777274001','1777277001','1777282001');
  IF n <> 0 THEN RAISE EXCEPTION 'C-2 cross-tenant carve-out FAIL: %', n; END IF;
  SELECT count(*) INTO n FROM public.redpay_unregistered_line_seen WHERE merchant_id IS NULL AND tid='9990009';
  IF n <> 1 THEN RAISE EXCEPTION 'C-2 null-merchant note FAIL: %', n; END IF;

  -- C-4 grant-seal (두 함수)
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest')
  LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION 'C-4 % NOT security definer', r.proname; END IF;
    -- SET search_path='' 은 proconfig 에 search_path="" (빈문자 인용) 로 저장됨.
    IF NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) e WHERE e IN ('search_path=', 'search_path=""')) THEN
      RAISE EXCEPTION 'C-4 % search_path<>empty: %', r.proname, r.proconfig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'C-4 % anon EXECUTE leak', r.proname; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'C-4 % authenticated EXECUTE leak', r.proname; END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'C-4 % service_role missing EXECUTE', r.proname; END IF;
  END LOOP;

  -- C-5 cron 0 0 * * * active
  SELECT count(*) INTO n FROM cron.job WHERE jobname='foot-redpay-unreg-digest' AND schedule='0 0 * * *' AND active;
  IF n <> 1 THEN RAISE EXCEPTION 'C-5 cron schedule/active FAIL: %', n; END IF;

  RAISE NOTICE 'DRYRUN VERIFY ALL PASS (C-2/C-4/C-5 + 멱등)';
END $v$;
`;

let ok = true;
try {
  console.log(`✅ Management API 연결(${REF}) — DRY-RUN 무영속\n`);

  const baseline = await snapshot();
  console.log(`── (0) baseline: table=${baseline.tbl} fns=${baseline.fns}/2 cron=${baseline.cron}`);

  // (1) canary — ROLLBACK 실효성 선증명(기존 테이블 COMMENT, 세션 독립).
  const origComment = await commentOf();
  await q(`BEGIN; COMMENT ON TABLE ${CANARY_TBL} IS '${CANARY}'; ROLLBACK;`);
  const afterComment = await commentOf();
  const canaryPersisted = afterComment === CANARY;
  console.log(`── (1) canary: ROLLBACK 후 잔존? ${canaryPersisted ? '❌ 잔존(autocommit — ABORT)' : '✅ 미잔존(ROLLBACK 실효)'}`);
  if (canaryPersisted) throw new Error('CANARY_PERSISTED — ROLLBACK 무영속 보장 실패, 실 DDL 미실행 중단.');
  if (afterComment !== origComment) console.warn(`   ⚠ 코멘트 원복 확인: orig=${JSON.stringify(origComment)} after=${JSON.stringify(afterComment)}`);

  // (2) apply + verify (무영속) — RAISE 시 throw.
  await q(`BEGIN;\n${mig}\n${VERIFY}\nROLLBACK;`);
  console.log('── (2) apply+verify: 마이그 구문 + C-2 밴드가드 + C-4 grant-seal + C-5 cron + 멱등 = ALL PASS(무예외)');
} catch (e) {
  ok = false;
  console.error('❌ DRY-RUN 실패:', e.message);
} finally {
  const post = await snapshot();
  console.log(`── (3) post-probe: table=${post.tbl} fns=${post.fns}/2 cron=${post.cron}`);
  const noPersist = !post.tbl && post.fns === 0 && post.cron === 0;
  console.log(`── post-probe 판정: 무영속? ${noPersist ? '✅ (신규객체 미생성 · baseline 동일)' : '❌ PERSISTED(사고)'}`);
  process.exit(ok && noPersist ? 0 : 1);
}
