/**
 * T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS — DRY-RUN (No-Persistence Protocol)
 * 표준: Migration Dry-Run No-Persistence Protocol (sentinel-bypass 차단)
 *   1) txn-control strip: migration 의 BEGIN;/COMMIT; 제거 (Mgmt API auto-commit → COMMIT 잔존 시 실영속 hazard)
 *   2) plpgsql exception-handler 실행: DO 블록에서 EXECUTE 후 sentinel RAISE → 전체 롤백(무영속)
 *   3) 컴파일+런타임 검증: EXECUTE 성공 + PERFORM(함수 호출) 무오류
 *   4) post-probe 무영속 introspection: 사후 prod prosrc 가 여전히 '무필터(old)' 인지 확인
 * DB: rxlomoozakkjesdqjtvd (obliv-foot-crm). author: dev-foot / 2026-07-19. READ-ONLY(net effect).
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  return { ok:r.ok, status:r.status, body:t };
}

// ── 1) migration 로드 + txn-control strip ──
const raw = readFileSync('supabase/migrations/20260719140000_foot_stats_revenue_filter_sim_status.sql','utf8');
// DDL 본문만 추출: 첫 BEGIN; 다음 ~ 마지막 COMMIT; 이전. GRANT/REVOKE/COMMENT 포함(모두 롤백됨).
const stripped = raw
  .replace(/^\s*BEGIN\s*;\s*$/mi,'')
  .replace(/^\s*COMMIT\s*;\s*$/mi,'');

// ── 2)+3) DO 블록 sentinel-rollback + 런타임 검증 ──
// 대상 clinic (PREFLIGHT 확인) 로 함수 호출까지 실행. $mig$ 태그로 감싸 함수 내부 $$ 와 충돌 회피.
const clinic = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const doBlock = `
DO $dryrun$
BEGIN
  -- txn-stripped DDL 을 이 트랜잭션 안에서 적용
  EXECUTE $mig$
${stripped}
  $mig$;
  -- 런타임 검증: 새 정의로 함수 호출 (compile + execute OK 확인)
  PERFORM * FROM public.foot_stats_revenue('${clinic}'::uuid, '2026-05-01'::date, '2026-07-31'::date);
  -- 무영속 강제: sentinel 예외로 DO 트랜잭션 전체 롤백
  RAISE EXCEPTION 'DRYRUN_SENTINEL_ROLLBACK_OK';
END
$dryrun$;
`;
const r1 = await q(doBlock);
const sentinel = /DRYRUN_SENTINEL_ROLLBACK_OK/.test(r1.body);
const compiledOk = !r1.ok && sentinel;   // sentinel 도달 = EXECUTE+PERFORM 성공 후 롤백

// ── 4) post-probe 무영속 introspection ──
const post = await q(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='foot_stats_revenue';`);
let postDef = '';
try { postDef = JSON.parse(post.body)[0].def; } catch(e) { postDef = '(probe fail: '+post.body+')'; }
const stillUnfiltered = !/status NOT IN/.test(postDef) && !/is_simulation IS TRUE/.test(postDef);

console.log(JSON.stringify({
  step1_txn_stripped: !/^\s*(BEGIN|COMMIT)\s*;/mi.test(stripped),
  step2_3_dryrun_http_status: r1.status,
  step2_3_sentinel_reached: sentinel,
  step2_3_compiled_and_ran_ok: compiledOk,
  step2_3_error_if_not_sentinel: (!sentinel ? r1.body.slice(0,600) : null),
  step4_postprobe_still_unfiltered_NO_PERSISTENCE: stillUnfiltered,
  VERDICT: (compiledOk && stillUnfiltered) ? 'DRYRUN_PASS (compiles+runs, zero persistence)' : 'DRYRUN_FAIL',
}, null, 2));
